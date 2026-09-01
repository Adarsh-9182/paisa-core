/**
 * AnthropicProvider — real Claude behind the LanguageModelProvider interface.
 *
 * Default model is Claude Sonnet 5 (override with PAISA_AI_MODEL). Runs the
 * native tool-use loop: Claude requests engine tools via tool_use blocks,
 * results go back as tool_result blocks, and the full assistant content
 * (including thinking blocks) is replayed each round as the API requires.
 * The model only decides which tools to call and how to phrase the answer;
 * every number comes from the deterministic engines and the orchestrator
 * still runs verifyNarration() on the result.
 *
 * Refusal chain: on Fable 5 the request carries server-side fallbacks, so a
 * safety-classifier decline is retried on Opus 4.8 inside the same API call;
 * only if the whole chain refuses do we throw, dropping to the offline
 * CfoPlanner via FallbackProvider. Credentials resolve from the environment
 * (ANTHROPIC_API_KEY or an `ant auth login` profile) via the SDK's chain.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AgentContext, LanguageModelProvider } from "./provider.js";
import { TOOL_SPECS } from "./tools.js";
import { truncateDocumentText, UploadedDocument } from "./document.js";

/**
 * Sonnet 5 rather than a top-tier model, deliberately.
 *
 * The model's job here is narrow: pick the right tool and phrase what came
 * back. It is not the source of any figure — the engines are — and
 * verifyNarration rejects an answer that states one the tools did not
 * produce. That safety net is structural, so paying five times as much for
 * deeper reasoning buys very little on this particular task. Override with
 * PAISA_AI_MODEL if tool selection starts going wrong.
 */
export const DEFAULT_AI_MODEL = "claude-sonnet-5";

/** Models whose refusals can be retried server-side, and what they fall back to. */
const SERVER_SIDE_FALLBACK = "claude-fable-5";
export const FALLBACK_AI_MODEL = "claude-opus-4-8";

/** Image media types Claude vision accepts (iOS converts HEIC→JPEG on upload). */
export const VISION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type VisionImageType = (typeof VISION_IMAGE_TYPES)[number];

const EXTRACTION_PROMPT = [
  "You are a precise document transcriber for a financial application.",
  "Extract ALL text, numbers, and tables from this document verbatim.",
  "Preserve every figure's exact formatting: digits, comma grouping, decimals, currency symbols.",
  "Render tables as rows with ' | ' between cells. Keep dates and descriptions with their amounts.",
  "Do not summarize, do not compute, do not omit anything. Output plain text only.",
].join(" ");

/**
 * One-shot vision pass: transcribe a PDF or image into text (spec 004).
 * The result is recorded as a tool result by the orchestrator, so figures
 * the model later quotes from it remain verifiable — auditable extraction,
 * not deterministic parsing (see the spec's honesty boundary).
 */
export async function extractDocumentText(
  name: string,
  source: "pdf" | "image",
  dataBase64: string,
  mediaType: string,
  model?: string,
  client?: Anthropic,
): Promise<UploadedDocument> {
  const c = client ?? new Anthropic();
  const m = model ?? process.env.PAISA_AI_MODEL ?? DEFAULT_AI_MODEL;
  const block: Anthropic.Beta.BetaContentBlockParam =
    source === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: dataBase64 } }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType as VisionImageType, data: dataBase64 },
        };

  const response = await c.beta.messages.create({
    model: m,
    max_tokens: 8000,
    messages: [{ role: "user", content: [block, { type: "text", text: EXTRACTION_PROMPT }] }],
  });

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error(`Could not extract any text from "${name}"`);
  return { name, source, text: truncateDocumentText(text) };
}

export class AnthropicProvider implements LanguageModelProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(model?: string, client?: Anthropic) {
    this.model = model ?? process.env.PAISA_AI_MODEL ?? DEFAULT_AI_MODEL;
    this.client = client ?? new Anthropic();
  }

  async run(ctx: AgentContext): Promise<string> {
    const tools: Anthropic.Beta.BetaTool[] = TOOL_SPECS.filter((s) => ctx.availableTools.includes(s.name)).map(
      (s) => ({
        name: s.name,
        description: s.description,
        input_schema: s.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      }),
    );

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...ctx.history.map(
        (t): Anthropic.Beta.BetaMessageParam => ({ role: t.role, content: t.text }),
      ),
      { role: "user", content: ctx.userQuery },
    ];

    // On Fable 5 a safety-classifier decline retries on Opus 4.8 inside the
    // same call. Other models throw instead, and FallbackProvider drops to
    // the offline planner — the outcome a caller sees is the same either way.
    const fallbacks = this.model === SERVER_SIDE_FALLBACK
      ? { betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: FALLBACK_AI_MODEL }] }
      : {};

    for (let round = 0; round <= ctx.maxRounds; round++) {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: ctx.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        ...fallbacks,
      });

      if (response.stop_reason === "refusal") {
        throw new Error("Model declined the request; falling back.");
      }

      if (response.stop_reason === "tool_use") {
        // Replay the full assistant content (thinking + tool_use blocks must
        // survive intact), then answer every tool_use in ONE user message.
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: ctx.executeTool(b.name, (b.input ?? {}) as Record<string, unknown>),
          }));
        messages.push({ role: "user", content: results });
        continue;
      }

      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    throw new Error("Tool loop exceeded maximum rounds without a final answer");
  }
}
