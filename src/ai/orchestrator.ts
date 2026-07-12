/**
 * AI CFO Orchestrator.
 *
 * The Golden Rule, enforced in code:
 *   The LLM is never the source of financial truth.
 *
 * Flow: permission check → provider runs its agent loop (every tool call
 * routed through executeTool, which only reaches the deterministic
 * engines) → verifyNarration(). Any figure in the final answer that is
 * not traceable to a tool output causes one corrective retry, then
 * rejection. The AI also never initiates money movement: there is no
 * payment tool.
 */

import { AgentContext, ChatTurn, LanguageModelProvider } from "./provider.js";
import { TOOLS, toolNames } from "./tools.js";
import { DOCUMENT_TOOL, UploadedDocument } from "./document.js";
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

/**
 * Live progress events for streaming UIs. Only tool activity and verifier
 * retries are streamed — narration text is withheld until it passes
 * verifyNarration, so an unverified figure can never reach a screen.
 */
export type AgentEvent =
  | { readonly type: "tool"; readonly tool: string }
  | { readonly type: "retry"; readonly reason: string };

export class NarrationError extends Error {
  override name = "NarrationError";
}

export class PermissionError extends Error {
  override name = "PermissionError";
}

export interface OrchestratorDates {
  /** "Today" for the engines — the default asOf for tool calls. */
  readonly asOf?: string;
  /** Start of the current reporting period. */
  readonly periodFrom?: string;
}

const systemPrompt = (dates: OrchestratorDates): string => {
  return [
    "You are Paisa, an AI CFO for a small Indian business. You are direct, practical, grounded, and never overconfident.",
    "You cover the full CFO surface — bookkeeping, cash flow, GST and income tax, compliance, unit economics, budgeting and forecasting — but always anchored to this business's actual numbers. You do not give generic advice and you do not guess.",
    ...(dates.asOf ? [`Today's date is ${dates.asOf}.`] : []),
    ...(dates.periodFrom ? [`The current reporting period began ${dates.periodFrom}.`] : []),
    "When a tool needs a date and the user didn't give one, use today's date (and the period start for period-based tools).",
    "",
    "Hard rules — these are enforced by a verifier that rejects your answer if broken:",
    "- Every number you state must come from a tool result IN THIS TURN. Call tools again rather than reusing figures from earlier in the conversation.",
    "- Quote each figure exactly as the tool printed it: same digits, same comma grouping, same decimals, same ₹ symbol. Never round, never convert to lakh/crore words, never do arithmetic of your own.",
    "- Never invent balances. When data is missing, say exactly what is missing rather than filling the gap.",
    "- Paisa has no live market-data feed. Never state, estimate, or predict a market price (stocks, crypto, indices, commodities); portfolio values come only from get_portfolio's explicit marks, and unmarked holdings are declared at cost.",
    "- Recommend actions; never execute payments.",
    "",
    "Reasoning: when a conclusion rests on several figures or on an assumption, show the steps and state the assumption explicitly. Lead with the answer, then the reasoning — don't bury it.",
    "",
    "Tax & compliance:",
    "- Separate factual information (a due date, a rate, a filing) from professional advice (choosing a scheme, a structuring call). Label the latter as advice, and note it may warrant a CA's sign-off.",
    "- Cite the specific rule or accounting principle when you lean on one (e.g. CGST Act s.16, AS 9 revenue recognition). If you can't cite it precisely, say so instead of inventing a citation.",
    "- When the answer turns on jurisdiction or on facts you don't have, name the missing fact and give the conditional answer — never assume a fact to force a single answer.",
    "- For GST positions and filing dates, get the figures from get_gst_position and get_upcoming_gst_filings; don't state them from memory.",
    "- For questions about the law itself — a rate, a threshold, a section, eligibility, a scheme — call lookup_regulation and answer only from the entries it returns, citing each entry's source and verified_as_of date. If it returns no match, say the knowledge base doesn't cover that yet and suggest confirming with a CA; never answer a compliance question from memory.",
    "- Compliance answer shape: the short answer first; then the rule with its citation; then your assumptions, any risks, the next action, and your confidence (high, medium, or low).",
    "",
    "Analysing an attached document (its extracted content appears in the user's message and in the read_attached_document record): validate that totals foot, detect inconsistencies, flag anomalies, then give a short executive summary, concrete recommendations, the business risks you see, and the next actions. Quote figures exactly as extracted — the hard rules above still apply. Cross-check against the ledger tools where they overlap.",
    "",
    "Acting on the user's behalf:",
    "- When uncategorised bank lines come up, call list_review_queue, then propose_categorization for each line you can classify with confidence. A proposal only drafts — the user sees an Approve button and nothing posts until they click it. Never claim a line has been categorised.",
    "- For fraud, suspicious-activity, duplicate, or unusual-spending questions, call screen_transactions and report each finding with its severity, the exact entries, and the rule that fired. Zero findings is a real answer — report it as such, not as a guarantee that nothing is wrong.",
    "",
    "Style: concise — a founder is reading this between meetings.",
    "Formatting: plain sentences with **bold** for key figures and _italics_ for asides; bullet lines start with two spaces and '• '. No headings, no tables.",
  ].join("\n");
};

/** Extract numeric tokens (₹ amounts, percentages, counts) from text. */
export const extractFigures = (text: string): string[] => {
  const re = /₹\s?[\d,]+(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d+)?%?/g;
  return (text.match(re) ?? []).map((s) => s.replace(/\s/g, ""));
};

const normalize = (s: string) => s.replace(/[,\s]/g, "");

/**
 * Every figure in the narration must appear in some tool result.
 * Bare small integers (≤ 12) are allowed as ordinary language ("3 months").
 * A ₹-prefixed figure also passes on its bare numerals (spec 004): uploaded
 * documents often carry amounts without the symbol — digits are the fact,
 * ₹ is presentation.
 */
export const verifyNarration = (narration: string, toolOutputs: readonly string[]): void => {
  const corpus = toolOutputs.map(normalize).join("\n");
  for (const fig of extractFigures(narration)) {
    const n = normalize(fig);
    if (!fig.startsWith("₹") && !fig.endsWith("%")) {
      const asNum = Number(n);
      if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 12) continue;
    }
    if (corpus.includes(n)) continue;
    if (n.startsWith("₹") && corpus.includes(n.slice(1))) continue;
    throw new NarrationError(`Narration contains figure "${fig}" not traceable to any tool output`);
  }
};

export class Orchestrator {
  private auditLog: AiAuditRecord[] = [];

  constructor(
    private provider: LanguageModelProvider,
    private maxToolRounds = 5,
    private dates: OrchestratorDates = {},
  ) {}

  async ask(
    user: AiUser,
    org: Organization,
    query: string,
    history: readonly ChatTurn[] = [],
    onEvent?: (event: AgentEvent) => void,
    document?: UploadedDocument,
  ): Promise<AiAuditRecord> {
    if (user.orgId !== org.orgId) throw new PermissionError("User does not belong to this organization");
    if (!user.permissions.has("access_ai_cfo"))
      throw new PermissionError("You do not have permission to access the AI CFO.");

    // A broken observer must never break the verified pipeline.
    const emit = (event: AgentEvent): void => {
      try {
        onEvent?.(event);
      } catch {
        /* observer errors are the observer's problem */
      }
    };

    const invoked: { tool: string; args: Record<string, unknown>; result: string }[] = [];
    const executeTool = (tool: string, args: Record<string, unknown>): string => {
      emit({ type: "tool", tool });
      const result = this.runTool(org, tool, args);
      invoked.push({ tool, args: { ...args }, result });
      return result;
    };

    // An attached document enters as a synthetic tool record (spec 004): its
    // extracted text joins the verifier corpus and the audit log, and rides
    // along in the user turn so any provider sees it without a new tool.
    let effectiveQuery = query;
    if (document) {
      invoked.push({
        tool: DOCUMENT_TOOL,
        args: { name: document.name, source: document.source },
        result: document.text,
      });
      emit({ type: "tool", tool: DOCUMENT_TOOL });
      effectiveQuery = `${query}\n\n[Attached ${document.source} document "${document.name}" — extracted content]\n${document.text}`;
    }

    const baseCtx: Omit<AgentContext, "history"> = {
      system: systemPrompt(this.dates),
      userQuery: effectiveQuery,
      availableTools: toolNames(),
      executeTool,
      maxRounds: this.maxToolRounds,
    };

    let answer = await this.provider.run({ ...baseCtx, history });
    try {
      verifyNarration(answer, invoked.map((i) => i.result));
    } catch (err) {
      if (!(err instanceof NarrationError)) throw err;
      emit({ type: "retry", reason: err.message });
      // One corrective retry: show the model its own violation and let it
      // rewrite. Tool re-runs are free — the engines are in-memory and pure.
      const correction: ChatTurn[] = [
        ...history,
        { role: "assistant", text: answer },
        {
          role: "user",
          text: `Your answer was rejected by the verifier: ${err.message}. Rewrite it, quoting every figure exactly as a tool result printed it. Re-call tools if needed.`,
        },
      ];
      answer = await this.provider.run({ ...baseCtx, history: correction });
      verifyNarration(answer, invoked.map((i) => i.result));
    }

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

  private runTool(org: Organization, tool: string, args: Record<string, unknown>): string {
    const fn = TOOLS[tool];
    if (!fn) return `error="unknown tool ${tool}"`;
    try {
      return fn(org, { ...args });
    } catch (e) {
      return `error="${e instanceof Error ? e.message : String(e)}"`;
    }
  }

  audit(): readonly AiAuditRecord[] {
    return this.auditLog;
  }
}
