/**
 * LanguageModelProvider — provider-agnostic LLM interface.
 * The model receives tool results and produces narration; it never
 * originates a financial figure. Swap Anthropic/OpenAI/Groq/etc. behind
 * this one interface.
 */

export interface ToolCallRequest {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ModelTurn {
  readonly kind: "tool_calls" | "final";
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly text?: string;
}

export interface ModelContext {
  readonly system: string;
  readonly userQuery: string;
  readonly toolResults: readonly { tool: string; result: string }[];
  readonly availableTools: readonly string[];
}

export interface LanguageModelProvider {
  readonly name: string;
  complete(ctx: ModelContext): Promise<ModelTurn>;
}

/** Deterministic mock used in tests and offline development. */
export class MockProvider implements LanguageModelProvider {
  readonly name = "mock";
  constructor(private script: ModelTurn[]) {}
  async complete(): Promise<ModelTurn> {
    const turn = this.script.shift();
    if (!turn) throw new Error("MockProvider script exhausted");
    return turn;
  }
}

/** Tries providers in order until one succeeds. */
export class FallbackProvider implements LanguageModelProvider {
  readonly name = "fallback";
  constructor(private chain: LanguageModelProvider[]) {}
  async complete(ctx: ModelContext): Promise<ModelTurn> {
    let lastError: unknown;
    for (const p of this.chain) {
      try {
        return await p.complete(ctx);
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`All providers failed: ${String(lastError)}`);
  }
}
