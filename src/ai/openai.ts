/**
 * OpenAIProvider — GPT behind the same LanguageModelProvider interface.
 *
 * Default model is GPT-5.6 (the alias routes to gpt-5.6-sol, OpenAI's
 * flagship as of 2026-07; override with PAISA_OPENAI_MODEL). Implemented
 * over the Chat Completions API with plain fetch — no SDK dependency —
 * and the same contract as AnthropicProvider: the model only picks tools
 * and phrases the answer; every figure still comes from the deterministic
 * engines and the orchestrator runs verifyNarration() on the result.
 *
 * In the web app this sits second in the FallbackProvider chain
 * (Fable 5 → GPT-5.6 → offline CfoPlanner), so a provider outage or
 * refusal degrades gracefully instead of failing the chat.
 */

import { AgentContext, LanguageModelProvider } from "./provider.js";
import { TOOL_SPECS } from "./tools.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6";

type FetchFn = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

interface OpenAiToolCall {
  readonly id: string;
  readonly function: { readonly name: string; readonly arguments: string };
}

interface OpenAiMessage {
  readonly content?: string | null;
  readonly tool_calls?: readonly OpenAiToolCall[];
  readonly refusal?: string | null;
}

export class OpenAIProvider implements LanguageModelProvider {
  readonly name = "openai";
  readonly model: string;
  private apiKey: string | undefined;
  private fetchFn: FetchFn;
  private baseUrl: string;

  constructor(opts: { model?: string; apiKey?: string; baseUrl?: string; fetchFn?: FetchFn } = {}) {
    this.model = opts.model ?? process.env.PAISA_OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    // OPENAI_BASE_URL lets any OpenAI-compatible server stand in — including
    // a locally served fine-tuned Paisa narrator (lab/, mlx_lm.server).
    // Trailing slash stripped because the routes below carry their own. Google
    // documents its compatibility endpoint WITH one (the OpenAI SDK appends a
    // bare "chat/completions"), so pasting the documented URL here would
    // otherwise request "//chat/completions" and 404 on a correct key.
    this.baseUrl = (opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? (fetch as unknown as FetchFn);
  }

  /**
   * A key is proof of identity to a hosted API, and meaningless to a server
   * running on this machine. Ollama, llama.cpp and mlx_lm all speak this
   * protocol and none of them authenticate, so demanding a key would rule out
   * every free way to run Paisa's narrator — which is the difference between
   * a product that needs a budget and one that does not.
   */
  private get isLocal(): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(this.baseUrl);
  }

  async run(ctx: AgentContext): Promise<string> {
    if (!this.apiKey && !this.isLocal)
      throw new Error("OPENAI_API_KEY is not set; falling back.");

    const tools = TOOL_SPECS.filter((s) => ctx.availableTools.includes(s.name)).map((s) => ({
      type: "function" as const,
      function: { name: s.name, description: s.description, parameters: s.inputSchema },
    }));

    const messages: Record<string, unknown>[] = [
      { role: "system", content: ctx.system },
      ...ctx.history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user", content: ctx.userQuery },
    ];

    for (let round = 0; round <= ctx.maxRounds; round++) {
      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Omitted entirely rather than sent empty: a local server that does
          // check the header should see no credential, not a blank one.
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, messages, tools }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new Error(`OpenAI API error ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: OpenAiMessage }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      // Reported per call, not per run: a single question makes several, and
      // the sum is the only number that answers "what did that cost".
      if (data.usage) {
        ctx.onUsage?.({
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
          ...(data.usage.prompt_tokens_details?.cached_tokens !== undefined
            ? { cachedInputTokens: data.usage.prompt_tokens_details.cached_tokens }
            : {}),
        });
      }
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("OpenAI returned no message");
      if (msg.refusal) throw new Error("Model declined the request; falling back.");

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {
            /* malformed args → run the tool with none; it will report its own error */
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: ctx.executeTool(call.function.name, args),
          });
        }
        continue;
      }

      if (typeof msg.content === "string" && msg.content.length > 0) return msg.content;
      throw new Error("OpenAI returned an empty answer");
    }
    throw new Error("Tool loop exceeded maximum rounds without a final answer");
  }
}
