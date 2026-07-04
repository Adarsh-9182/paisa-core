/**
 * AnthropicProvider — real Claude behind the LanguageModelProvider interface.
 *
 * The provider only decides which tools to call and how to phrase the
 * answer; every number still comes from the deterministic engines and the
 * orchestrator still runs verifyNarration() on the result. Credentials
 * resolve from the environment (ANTHROPIC_API_KEY or an `ant auth login`
 * profile) via the SDK's default chain.
 */

import Anthropic from "@anthropic-ai/sdk";
import { LanguageModelProvider, ModelContext, ModelTurn, ToolCallRequest } from "./provider.js";
import { TOOL_SPECS } from "./tools.js";

export class AnthropicProvider implements LanguageModelProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    private model = "claude-opus-4-8",
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async complete(ctx: ModelContext): Promise<ModelTurn> {
    const tools: Anthropic.Tool[] = TOOL_SPECS.filter((s) => ctx.availableTools.includes(s.name)).map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: s.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // The orchestrator gives us prior tool results as strings; replay them as
    // context so the model can either request more tools or answer.
    const priorResults =
      ctx.toolResults.length > 0
        ? "\n\nTool results so far (quote figures from these verbatim):\n" +
          ctx.toolResults.map((t) => `<tool_result tool="${t.tool}">${t.result}</tool_result>`).join("\n")
        : "";

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: ctx.system,
      tools,
      messages: [{ role: "user", content: ctx.userQuery + priorResults }],
    });

    const toolCalls: ToolCallRequest[] = [];
    let text = "";
    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCalls.push({ tool: block.name, args: block.input as Record<string, unknown> });
      } else if (block.type === "text") {
        text += block.text;
      }
    }
    if (toolCalls.length > 0) return { kind: "tool_calls", toolCalls };
    return { kind: "final", text };
  }
}
