/**
 * A scoreboard for the model.
 *
 * WHY THIS EXISTS
 *
 * The question "should we fine-tune?" and the question "which model should
 * we use?" have the same prerequisite, and this repository did not have it:
 * a way to tell whether one model is better than another at *this* job.
 * There is a fine-tuning data pipeline in dataset.ts, and there was nothing
 * to measure what it produced against. Training a model you cannot score is
 * faith, not engineering.
 *
 * WHAT THE MODEL'S JOB ACTUALLY IS
 *
 * Narrow, and worth being precise about, because it decides what to measure.
 * The model does not compute anything — verifyNarration rejects any figure
 * that did not come out of a tool. It does two things:
 *
 *   1. pick the right tools, with the right arguments
 *   2. phrase the result without inventing anything
 *
 * So a good model here is one that reaches the right tools in few rounds and
 * survives the verifier. Not one that reasons well about finance. That is
 * why a small cheap model may well win, and why the answer has to be
 * measured rather than assumed.
 *
 * WHAT IT MEASURES
 *
 *   toolRecall     — did it call the tools the answer needs
 *   toolPrecision  — did it avoid calling ones it did not
 *   grounded       — did the answer survive verifyNarration
 *   rounds         — model↔tool round trips (latency and cost)
 *   tokens         — what the provider says it consumed
 *
 * Cost is included because it is a real axis, not a footnote. Measured
 * against a live provider, one Paisa question is two calls of ~3,600 input
 * tokens, of which ~2,548 are the 23 tool schemas and ~1,000 the system
 * prompt — the user's actual question was 25 characters. Roughly 98% of
 * every request is fixed boilerplate. A model that is 100x cheaper per token
 * is 100x cheaper on all of it.
 */

import { Organization, Platform } from "../organization.js";
import { AiUser, NarrationError, Orchestrator, OrchestratorDates } from "./orchestrator.js";
import { CallUsage, LanguageModelProvider } from "./provider.js";

export interface EvalCase {
  readonly id: string;
  readonly question: string;
  /** Tools the answer cannot be right without. */
  readonly expectTools: readonly string[];
  /**
   * Tools that must NOT be called. Some are wrong (a cash question that
   * reaches for the invoice ledger is confused); some are merely expensive.
   * Precision is not decoration — every extra call is another full request.
   */
  readonly forbidTools?: readonly string[];
  /** Substrings the answer must contain, checked after grounding. */
  readonly expectText?: readonly string[];
  /** Above this the model is thrashing, even if it lands on the answer. */
  readonly maxRounds?: number;
}

export interface CaseResult {
  readonly id: string;
  readonly ok: boolean;
  readonly toolsCalled: readonly string[];
  readonly missingTools: readonly string[];
  readonly forbiddenCalled: readonly string[];
  readonly missingText: readonly string[];
  readonly rounds: number;
  readonly grounded: boolean;
  readonly usage: Usage;
  readonly ms: number;
  /** Present when the run threw — a refusal, a timeout, a provider outage. */
  readonly error?: string;
  readonly answer: string;
}

export interface Usage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  /** False when the provider reported nothing, so zero is never read as free. */
  readonly measured: boolean;
}

const NO_USAGE: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, measured: false };

export interface EvalReport {
  readonly provider: string;
  readonly cases: readonly CaseResult[];
  readonly passed: number;
  readonly total: number;
  /** Share of required tools that were actually called, across every case. */
  readonly toolRecall: number;
  /** Share of calls made that were required or at least permitted. */
  readonly toolPrecision: number;
  readonly groundedRate: number;
  readonly avgRounds: number;
  readonly usage: Usage;
  readonly ms: number;
}

/**
 * The golden set.
 *
 * Deliberately small and hand-written. A large generated eval measures the
 * generator; these are the questions a finance team actually asks, and each
 * one exists because getting it wrong is a specific, nameable failure.
 */
export const GOLDEN_CASES: readonly EvalCase[] = [
  {
    id: "cash-position",
    question: "What is my cash position?",
    expectTools: ["get_cash_position"],
    // The single most common question. One tool, one round. A model that
    // needs three has misunderstood the toolset, not the question.
    maxRounds: 2,
  },
  {
    id: "runway",
    question: "How long can we survive at this burn?",
    expectTools: ["get_burn_and_runway"],
    maxRounds: 2,
  },
  {
    id: "overdue",
    question: "Which invoices are overdue?",
    expectTools: ["list_overdue_invoices"],
    maxRounds: 2,
  },
  {
    id: "gst-position",
    question: "What GST do I owe for last month?",
    expectTools: ["get_gst_position"],
    maxRounds: 3,
  },
  {
    id: "chase-requires-two-steps",
    question: "Chase the overdue invoice for me.",
    // The interesting one: the model must look before it acts. Drafting a
    // reminder without reading the ledger first means it invented a
    // customer and an amount.
    expectTools: ["list_overdue_invoices", "propose_payment_reminder"],
    maxRounds: 4,
  },
  {
    id: "no-tool-needed",
    question: "What can you help me with?",
    // Capability questions need no ledger at all. A model that queries the
    // books to answer this is burning a full request on nothing — the
    // cheapest possible failure to detect, and easy to miss without a test.
    expectTools: [],
    forbidTools: ["get_cash_position", "get_burn_and_runway", "list_overdue_invoices"],
    maxRounds: 1,
  },
  {
    id: "refuses-to-invent",
    question: "What will my revenue be in 2035?",
    // Nothing in the ledger answers this. The right behaviour is to say so.
    // The verifier cannot catch a fabricated *forecast* — it only checks
    // that figures trace to tools — so this is the case that tests judgment
    // rather than plumbing.
    expectTools: [],
    forbidTools: [],
    maxRounds: 2,
  },
];

const sumUsage = (parts: readonly CallUsage[]): Usage =>
  parts.length === 0
    ? NO_USAGE
    : {
        calls: parts.length,
        inputTokens: parts.reduce((n, u) => n + u.inputTokens, 0),
        outputTokens: parts.reduce((n, u) => n + u.outputTokens, 0),
        cachedInputTokens: parts.reduce((n, u) => n + (u.cachedInputTokens ?? 0), 0),
        measured: true,
      };

const mergeUsage = (a: Usage, b: Usage): Usage => ({
  calls: a.calls + b.calls,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  measured: a.measured || b.measured,
});

export interface EvalOptions {
  /** Fresh books per case, so one case cannot contaminate the next. */
  readonly makeOrg: () => Organization | Promise<Organization>;
  readonly user: AiUser;
  readonly dates?: OrchestratorDates;
  readonly maxToolRounds?: number;
  readonly onCase?: (result: CaseResult) => void;
}

/** Run one case. Never throws — a provider failure is a result, not a crash. */
export async function runCase(
  provider: LanguageModelProvider,
  testCase: EvalCase,
  opts: EvalOptions,
): Promise<CaseResult> {
  const org = await opts.makeOrg();
  const calls: CallUsage[] = [];
  const orchestrator = new Orchestrator(provider, opts.maxToolRounds ?? 5, opts.dates ?? {});
  const started = Date.now();

  let answer = "";
  let grounded = false;
  let error: string | undefined;
  let toolsCalled: string[] = [];

  try {
    const record = await orchestrator.ask(
      { ...opts.user, orgId: org.orgId },
      org,
      testCase.question,
      [],
      undefined,
      undefined,
      // The orchestrator builds the AgentContext; usage rides through it.
      (usage) => calls.push(usage),
    );
    answer = record.finalAnswer;
    toolsCalled = record.toolsInvoked.map((t) => t.tool);
    grounded = record.verified;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // A narration failure is a *result* — the verifier did its job and the
    // model failed. Anything else is an outage and should read as one.
    grounded = false;
    if (!(err instanceof NarrationError)) error = `provider: ${error}`;
  }

  const called = new Set(toolsCalled);
  const missingTools = testCase.expectTools.filter((t) => !called.has(t));
  const forbiddenCalled = (testCase.forbidTools ?? []).filter((t) => called.has(t));
  const missingText = (testCase.expectText ?? []).filter((t) => !answer.includes(t));
  const rounds = toolsCalled.length;

  const result: CaseResult = {
    id: testCase.id,
    toolsCalled,
    missingTools,
    forbiddenCalled,
    missingText,
    rounds,
    grounded,
    usage: sumUsage(calls),
    ms: Date.now() - started,
    answer,
    ...(error ? { error } : {}),
    ok:
      !error &&
      grounded &&
      missingTools.length === 0 &&
      forbiddenCalled.length === 0 &&
      missingText.length === 0 &&
      (testCase.maxRounds === undefined || rounds <= testCase.maxRounds),
  };

  opts.onCase?.(result);
  return result;
}

export async function runEval(
  provider: LanguageModelProvider,
  cases: readonly EvalCase[],
  opts: EvalOptions,
): Promise<EvalReport> {
  const started = Date.now();
  const results: CaseResult[] = [];
  // Sequential on purpose: a rate-limited free tier is the normal case here,
  // and a burst of parallel requests turns a measurement into a 429.
  for (const c of cases) results.push(await runCase(provider, c, opts));

  const requiredTotal = cases.reduce((n, c) => n + c.expectTools.length, 0);
  const requiredHit = results.reduce((n, r, i) => n + (cases[i]!.expectTools.length - r.missingTools.length), 0);
  const callsMade = results.reduce((n, r) => n + r.toolsCalled.length, 0);
  const callsForbidden = results.reduce((n, r) => n + r.forbiddenCalled.length, 0);

  return {
    provider: provider.name,
    cases: results,
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    // A set with no required tools would divide by zero; a perfect score on
    // an empty requirement is the honest reading.
    toolRecall: requiredTotal === 0 ? 1 : requiredHit / requiredTotal,
    toolPrecision: callsMade === 0 ? 1 : (callsMade - callsForbidden) / callsMade,
    groundedRate: results.length === 0 ? 1 : results.filter((r) => r.grounded).length / results.length,
    avgRounds: results.length === 0 ? 0 : results.reduce((n, r) => n + r.rounds, 0) / results.length,
    usage: results.map((r) => r.usage).reduce(mergeUsage, NO_USAGE),
    ms: Date.now() - started,
  };
}

/**
 * Price a report.
 *
 * Rates are per million tokens and belong to the caller, not to this file —
 * they change monthly and a stale constant here would quietly misreport
 * money. Cached input is billed at a fraction of the input rate by every
 * provider that offers it, so it is priced separately or the saving is
 * invisible.
 */
export interface Rates {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  /** Defaults to a tenth of input, the common industry discount. */
  readonly cachedInputPerMillion?: number;
}

export function costOf(usage: Usage, rates: Rates): number | null {
  if (!usage.measured) return null;
  const cachedRate = rates.cachedInputPerMillion ?? rates.inputPerMillion / 10;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (fresh * rates.inputPerMillion + usage.cachedInputTokens * cachedRate + usage.outputTokens * rates.outputPerMillion) /
    1_000_000
  );
}

/** A short, readable summary. Deliberately plain text — this goes in CI logs. */
export function formatReport(report: EvalReport, rates?: Rates): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const lines = [
    `provider=${report.provider} passed=${report.passed}/${report.total} ` +
      `toolRecall=${pct(report.toolRecall)} toolPrecision=${pct(report.toolPrecision)} ` +
      `grounded=${pct(report.groundedRate)} avgRounds=${report.avgRounds.toFixed(1)} ` +
      `${(report.ms / 1000).toFixed(1)}s`,
  ];

  if (report.usage.measured) {
    const u = report.usage;
    const perQuestion = report.total ? Math.round(u.inputTokens / report.total) : 0;
    lines.push(
      `tokens in=${u.inputTokens.toLocaleString()} (cached ${u.cachedInputTokens.toLocaleString()}) ` +
        `out=${u.outputTokens.toLocaleString()} calls=${u.calls} ≈${perQuestion.toLocaleString()} input/question`,
    );
    const cost = rates ? costOf(u, rates) : null;
    if (cost !== null) {
      lines.push(`cost $${cost.toFixed(4)} for ${report.total} questions ≈ $${(cost / report.total).toFixed(5)} each`);
    }
  } else {
    lines.push("tokens not reported by this provider — cost unknown, not zero");
  }

  for (const c of report.cases.filter((r) => !r.ok)) {
    const why = [
      c.error && `error=${c.error}`,
      c.missingTools.length && `missing=${c.missingTools.join(",")}`,
      c.forbiddenCalled.length && `forbidden=${c.forbiddenCalled.join(",")}`,
      c.missingText.length && `missingText=${c.missingText.join("|")}`,
      !c.grounded && !c.error && "ungrounded",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`  FAIL ${c.id}: ${why || "over maxRounds"} (rounds=${c.rounds}, called=${c.toolsCalled.join(",") || "none"})`);
  }
  return lines.join("\n");
}

/** Fresh demo books, so every case starts from the same known ledger. */
export const demoOrgFactory = (seed: () => Organization | Promise<Organization>) => seed;

export { Platform };
