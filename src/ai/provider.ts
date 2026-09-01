/**
 * LanguageModelProvider — provider-agnostic agent interface.
 *
 * The provider owns its conversation loop (native tool use, thinking blocks,
 * retries) but every tool runs through the executeTool callback the
 * orchestrator supplies, so the deterministic engines stay the only source
 * of financial figures and the orchestrator records every invocation.
 * Swap Anthropic/offline-planner/etc. behind this one interface.
 */

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/** Runs one engine tool; returns the structured result string (errors come back as `error="…"`). */
export type ToolExecutor = (tool: string, args: Record<string, unknown>) => string;

/** What one model call consumed, as the provider reported it. */
export interface CallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens served from the provider's prompt cache, when it says so. */
  readonly cachedInputTokens?: number;
}

export interface AgentContext {
  readonly system: string;
  /** Prior conversation turns, oldest first. The current question is separate. */
  readonly history: readonly ChatTurn[];
  readonly userQuery: string;
  readonly availableTools: readonly string[];
  readonly executeTool: ToolExecutor;
  /** Upper bound on model↔tool round trips before the provider must answer. */
  readonly maxRounds: number;
  /**
   * Called once per model call with what it consumed.
   *
   * Optional, and reported rather than returned, because a run makes several
   * calls and the interesting number is the sum across all of them. Nothing
   * measured what a question cost before this existed — which made "which
   * model should we use" a question that could only be answered with taste.
   *
   * A provider that cannot measure (the offline planner) simply never calls
   * it, and the absence is visible in the report rather than showing as zero.
   */
  readonly onUsage?: (usage: CallUsage) => void;
}

export interface LanguageModelProvider {
  readonly name: string;
  /** Run the full agent loop and return the final narration text. */
  run(ctx: AgentContext): Promise<string>;
}

/** One scripted step for MockProvider — mirrors the shape tests already use. */
export interface ToolCallRequest {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ModelTurn {
  readonly kind: "tool_calls" | "final";
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly text?: string;
}

/** Deterministic mock used in tests and offline development. */
export class MockProvider implements LanguageModelProvider {
  readonly name = "mock";
  constructor(private script: ModelTurn[]) {}

  async run(ctx: AgentContext): Promise<string> {
    for (let round = 0; round <= ctx.maxRounds; round++) {
      const turn = this.script.shift();
      if (!turn) throw new Error("MockProvider script exhausted");
      if (turn.kind === "tool_calls") {
        for (const call of turn.toolCalls ?? []) ctx.executeTool(call.tool, { ...call.args });
        continue;
      }
      return turn.text ?? "";
    }
    throw new Error("Tool loop exceeded maximum rounds without a final answer");
  }
}

/** Tries providers in order until one succeeds. */
export class FallbackProvider implements LanguageModelProvider {
  readonly name = "fallback";
  /**
   * Which provider produced the last successful answer. Silent degradation
   * is the point of this class — but it must never be invisible: surface
   * this in API responses/logs so "the model is hallucinating" reports can
   * be told apart from "the planner answered because the key is dead".
   */
  lastUsedName: string | null = null;
  constructor(private chain: LanguageModelProvider[]) {}
  async run(ctx: AgentContext): Promise<string> {
    this.lastUsedName = null;
    let lastError: unknown;
    for (const p of this.chain) {
      try {
        const answer = await p.run(ctx);
        this.lastUsedName = p.name;
        return answer;
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`All providers failed: ${String(lastError)}`);
  }
}
