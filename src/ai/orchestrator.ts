/**
 * AI CFO Orchestrator.
 *
 * The Golden Rule, enforced in code:
 *   The LLM is never the source of financial truth.
 *
 * Flow: intent → permission check → tool loop (deterministic engines) →
 * narration → verifyNarration(). Any figure in the final answer that is
 * not traceable to a tool output causes the response to be rejected.
 * The AI also never initiates money movement: there is no payment tool.
 */

import { LanguageModelProvider, ModelContext, ToolCallRequest } from "./provider.js";
import { TOOLS, toolNames } from "./tools.js";
import { Organization } from "../organization.js";

export type Permission =
  | "view_reports"
  | "view_payroll"
  | "approve_payments"
  | "access_ai_cfo";

export interface AiUser {
  readonly userId: string;
  readonly orgId: string;
  readonly permissions: ReadonlySet<Permission>;
}

export interface AiAuditRecord {
  readonly userQuery: string;
  readonly toolsInvoked: readonly { tool: string; args: Record<string, unknown>; result: string }[];
  readonly finalAnswer: string;
  readonly verified: boolean;
  readonly at: string;
}

export class NarrationError extends Error {
  override name = "NarrationError";
}

export class PermissionError extends Error {
  override name = "PermissionError";
}

const SYSTEM_PROMPT = [
  "You are Paisa, an AI CFO.",
  "Every number you state must come verbatim from a tool result.",
  "Never invent balances. Never guess when data is missing — say what is missing.",
  "Explain assumptions. Recommend; never execute payments.",
].join(" ");

/** Extract numeric tokens (₹ amounts, percentages, counts) from text. */
export const extractFigures = (text: string): string[] => {
  const re = /₹\s?[\d,]+(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d+)?%?/g;
  return (text.match(re) ?? []).map((s) => s.replace(/\s/g, ""));
};

const normalize = (s: string) => s.replace(/[,\s]/g, "");

/**
 * Every figure in the narration must appear in some tool result.
 * Bare small integers (≤ 12) are allowed as ordinary language ("3 months").
 */
export const verifyNarration = (narration: string, toolOutputs: readonly string[]): void => {
  const corpus = toolOutputs.map(normalize).join("\n");
  for (const fig of extractFigures(narration)) {
    const n = normalize(fig);
    if (!fig.startsWith("₹") && !fig.endsWith("%")) {
      const asNum = Number(n);
      if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 12) continue;
    }
    if (!corpus.includes(n)) {
      throw new NarrationError(`Narration contains figure "${fig}" not traceable to any tool output`);
    }
  }
};

export class Orchestrator {
  private auditLog: AiAuditRecord[] = [];

  constructor(
    private provider: LanguageModelProvider,
    private maxToolRounds = 5,
  ) {}

  async ask(user: AiUser, org: Organization, query: string): Promise<AiAuditRecord> {
    if (user.orgId !== org.orgId) throw new PermissionError("User does not belong to this organization");
    if (!user.permissions.has("access_ai_cfo"))
      throw new PermissionError("You do not have permission to access the AI CFO.");

    const invoked: { tool: string; args: Record<string, unknown>; result: string }[] = [];

    for (let round = 0; round < this.maxToolRounds; round++) {
      const ctx: ModelContext = {
        system: SYSTEM_PROMPT,
        userQuery: query,
        toolResults: invoked.map(({ tool, result }) => ({ tool, result })),
        availableTools: toolNames(),
      };
      const turn = await this.provider.complete(ctx);

      if (turn.kind === "tool_calls") {
        for (const call of turn.toolCalls ?? []) {
          invoked.push({ tool: call.tool, args: { ...call.args }, result: this.runTool(org, call) });
        }
        continue;
      }

      const answer = turn.text ?? "";
      verifyNarration(answer, invoked.map((i) => i.result));
      const record: AiAuditRecord = {
        userQuery: query,
        toolsInvoked: invoked,
        finalAnswer: answer,
        verified: true,
        at: new Date().toISOString(),
      };
      this.auditLog.push(record);
      org.bus.emit({
        orgId: org.orgId,
        type: "ai.answered",
        at: record.at,
        actor: user.userId,
        payload: { query, tools: invoked.map((i) => i.tool) },
      });
      return record;
    }
    throw new Error("Tool loop exceeded maximum rounds without a final answer");
  }

  private runTool(org: Organization, call: ToolCallRequest): string {
    const fn = TOOLS[call.tool];
    if (!fn) return `error="unknown tool ${call.tool}"`;
    try {
      return fn(org, { ...call.args });
    } catch (e) {
      return `error="${e instanceof Error ? e.message : String(e)}"`;
    }
  }

  audit(): readonly AiAuditRecord[] {
    return this.auditLog;
  }
}
