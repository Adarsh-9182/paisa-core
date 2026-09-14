/**
 * Scoreboard for step 3: how good is a small model at suggesting accounts?
 *
 * Only the lines a person would otherwise face with nothing chosen are asked
 * about: lines under policy 3 that did not book and did not get a suggestion
 * from a shipped rule. Those are the lines the model has to earn its keep on.
 *
 * The gate is accuracy when the model says it is confident. A confident wrong
 * suggestion is the costly kind — a person skimming a pre-filled review screen
 * is likely to accept it — so it is counted separately from a low-confidence
 * miss and from the model declining. A line labelled "review" (nobody could
 * know without asking) that the model confidently places is counted as a
 * confident wrong answer, because that is exactly the overreach to catch.
 */

import { Organization } from "../organization.js";
import { parseINR } from "../money.js";
import type { CategorizeCase } from "./categorize-eval.js";
import type { CompletionModel } from "./provider.js";
import { Confidence, SuggestOptions, SuggestUsage, suggestAccounts } from "./suggest-accounts.js";

export type SuggestVerdict = "confident_correct" | "confident_wrong" | "low_correct" | "low_wrong" | "abstained" | "unreached";

export interface SuggestOutcome {
  readonly id: string;
  readonly description: string;
  readonly amount: string;
  readonly expect: string;
  readonly suggested: string | null;
  readonly confidence: Confidence | null;
  readonly verdict: SuggestVerdict;
  readonly discarded?: string;
}

export interface ModelSuggestReport {
  readonly model: string;
  readonly lines: number;
  readonly bookable: number;
  /** Lines with no booking and no rule suggestion, sent to the model. */
  readonly asked: number;
  readonly unreached: number;
  readonly confident: number;
  readonly confidentCorrect: number;
  readonly confidentWrong: number;
  readonly low: number;
  readonly lowCorrect: number;
  readonly abstained: number;
  /** Answers the checks threw away (not offered, wrong direction, movement word). */
  readonly discarded: number;
  /** confidentCorrect / confident; null when nothing was confident. */
  readonly accuracyWhenConfidentPct: number | null;
  /** Bookable lines a person clears in one tap or none, from rules alone. */
  readonly oneTapBeforePct: number;
  /** The same, once confident model suggestions are shown too. */
  readonly oneTapAfterPct: number;
  readonly usage: SuggestUsage;
  readonly outcomes: readonly SuggestOutcome[];
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export const scoreModelSuggestions = async (
  cases: readonly CategorizeCase[],
  makeOrg: () => Organization,
  model: CompletionModel,
  opts: SuggestOptions = {},
): Promise<ModelSuggestReport> => {
  const org = makeOrg();
  const lines = cases.map((c, i) => ({
    reference: `EVAL${String(i + 1).padStart(4, "0")}`,
    date: "2026-07-15",
    description: c.description,
    amount: parseINR(c.amount),
  }));
  const caseFor = new Map(lines.map((l, i) => [l.reference, cases[i]!]));

  const result = org.banking.importStatement(lines, "eval", "acc_bank", 3);
  const bookedTo = new Map<string, string>();
  for (const p of result.posted) {
    const counter = p.entry.lines.find((l) => l.accountId !== "acc_bank");
    if (counter) bookedTo.set(p.line.reference, counter.accountId);
  }

  const queue = org.banking.reviewQueueWithReasons();
  const ruleSuggested = new Map<string, string>();
  for (const { line, reason } of queue) if (reason.kind === "suggested") ruleSuggested.set(line.reference, reason.accountId);
  const askLines = queue.filter((q) => q.reason.kind !== "suggested").map((q) => q.line);

  const { suggestions, usage, unreached } = await suggestAccounts(askLines, org.chart, model, opts);
  const unreachedSet = new Set(unreached);

  const outcomes: SuggestOutcome[] = [];
  for (const line of askLines) {
    const c = caseFor.get(line.reference)!;
    const base = { id: c.id, description: c.description, amount: c.amount, expect: c.expect };
    if (unreachedSet.has(line.reference)) {
      outcomes.push({ ...base, suggested: null, confidence: null, verdict: "unreached" });
      continue;
    }
    const s = suggestions.get(line.reference);
    const discarded = s?.discarded ? { discarded: s.discarded } : {};
    if (!s || s.accountId === null) {
      outcomes.push({ ...base, suggested: null, confidence: s?.confidence ?? null, verdict: "abstained", ...discarded });
      continue;
    }
    const right = s.accountId === c.expect;
    const verdict: SuggestVerdict =
      s.confidence === "high" ? (right ? "confident_correct" : "confident_wrong") : right ? "low_correct" : "low_wrong";
    outcomes.push({ ...base, suggested: s.accountId, confidence: s.confidence, verdict });
  }

  const count = (v: SuggestVerdict) => outcomes.filter((o) => o.verdict === v).length;
  const confidentCorrect = count("confident_correct");
  const confidentWrong = count("confident_wrong");
  const confident = confidentCorrect + confidentWrong;

  const bookable = cases.filter((c) => c.expect !== "review").length;
  let clearedBefore = 0;
  for (const l of lines) {
    const c = caseFor.get(l.reference)!;
    if (c.expect === "review") continue;
    if (bookedTo.get(l.reference) === c.expect || ruleSuggested.get(l.reference) === c.expect) clearedBefore++;
  }

  return {
    model: model.model ?? model.name,
    lines: cases.length,
    bookable,
    asked: askLines.length,
    unreached: count("unreached"),
    confident,
    confidentCorrect,
    confidentWrong,
    low: count("low_correct") + count("low_wrong"),
    lowCorrect: count("low_correct"),
    abstained: count("abstained"),
    discarded: outcomes.filter((o) => o.discarded).length,
    accuracyWhenConfidentPct: confident === 0 ? null : pct(confidentCorrect, confident),
    oneTapBeforePct: pct(clearedBefore, bookable),
    oneTapAfterPct: pct(clearedBefore + confidentCorrect, bookable),
    usage,
    outcomes,
  };
};

export const formatModelSuggestReport = (
  r: ModelSuggestReport,
  rates?: { inputPerMillion: number; outputPerMillion: number },
): string => {
  const rows = [
    `model=${r.model} lines=${r.lines} asked=${r.asked} unreached=${r.unreached}`,
    `confident=${r.confident} (right ${r.confidentCorrect}, wrong ${r.confidentWrong})   low=${r.low} (right ${r.lowCorrect})   declined=${r.abstained} (answers discarded by checks: ${r.discarded})`,
    `accuracy when confident=${r.accuracyWhenConfidentPct === null ? "n/a" : `${r.accuracyWhenConfidentPct}%`}   cleared in one tap or none: ${r.oneTapBeforePct}% -> ${r.oneTapAfterPct}%`,
  ];
  if (r.usage.measured) {
    const perLineIn = r.asked ? Math.round(r.usage.inputTokens / r.asked) : 0;
    const perLineOut = r.asked ? Math.round(r.usage.outputTokens / r.asked) : 0;
    let tokens = `tokens in=${r.usage.inputTokens} out=${r.usage.outputTokens} calls=${r.usage.calls} (~${perLineIn} in / ${perLineOut} out per line)`;
    if (rates && r.asked) {
      const cost = (r.usage.inputTokens * rates.inputPerMillion + r.usage.outputTokens * rates.outputPerMillion) / 1e6;
      tokens += `   ~$${((cost / r.asked) * 1000).toFixed(4)} per 1,000 lines`;
    }
    rows.push(tokens);
  } else {
    rows.push("tokens not reported by this provider — cost unknown, not zero");
  }
  if (r.unreached) rows.push(`!! ${r.unreached} line(s) never got an answer (outage, rate limit or unreadable reply). Do not trust these numbers until they are re-run.`);
  const wrong = r.outcomes.filter((o) => o.verdict === "confident_wrong");
  if (wrong.length) {
    rows.push("", "Confident and wrong:");
    for (const o of wrong) rows.push(`  ${o.id.padEnd(30)} suggested ${o.suggested}, expected ${o.expect}`);
  }
  return rows.join("\n");
};
