/**
 * A scoreboard for bank-line categorization.
 *
 * WHY THIS EXISTS
 *
 * Categorizing a bank statement is the most repetitive job in a small
 * business's books: every line, every month, into one of a couple of dozen
 * accounts. It is the job AI bookkeeping products start with, and the claim
 * behind building on it is that a keyword memory plus a small model can do
 * it reliably. A claim like that is only as good as its measurement, and
 * there was none — the chat has an eval, the categorizer did not.
 *
 * WHAT GOOD LOOKS LIKE
 *
 *   precision — of the lines that booked themselves, how many went to the
 *               right account. A wrong auto-posting is a wrong figure in the
 *               books that nobody was asked about, and in India it can also
 *               be a wrong ITC claim. This has to be close to 100%.
 *
 *   coverage  — of the lines that could have been booked, how many were.
 *               Every line that is not is a question for a person.
 *
 *   one tap   — of the lines that could have been booked, how many a person
 *               clears with at most one tap: booked right, or waiting in
 *               review with the right account already suggested. Under
 *               suggest-only this, not coverage, is what saves time.
 *
 * Sending a line to review is never an error. Booking it wrong is. And
 * booking money that went out as income, or money that came in as an expense,
 * is counted separately, because it is the error that inverts a P&L line.
 */

import { Organization } from "../organization.js";
import { parseINR } from "../money.js";
import type { ImportPolicy } from "../banking.js";

export interface CategorizeCase {
  readonly id: string;
  /** The narration exactly as a bank would print it. */
  readonly description: string;
  /** Signed rupees: "-842.50" is money out, "15000" is money in. */
  readonly amount: string;
  /**
   * The account this line belongs in, or "review" when nobody could know
   * without asking — a transfer to a person's name, an EMI that mixes
   * principal and interest, a marketplace purchase that could be anything.
   */
  readonly expect: string;
  /** Why the label is what it is, where that is not obvious. */
  readonly why?: string;
}

export type Verdict = "correct" | "abstained" | "wrong" | "wrong_direction";

export interface CaseOutcome {
  readonly id: string;
  readonly description: string;
  readonly amount: string;
  readonly expect: string;
  /** The account it booked to, or "review". */
  readonly got: string;
  readonly verdict: Verdict;
  /** For a line sent to review, the account the categorizer proposed, if any. */
  readonly suggested?: string;
}

export interface CategorizeReport {
  readonly total: number;
  /** Cases whose correct answer is an account rather than "review". */
  readonly bookable: number;
  readonly autoBooked: number;
  readonly correct: number;
  readonly wrong: number;
  readonly wrongDirection: number;
  readonly abstained: number;
  /** correct / bookable, as a percentage. */
  readonly coveragePct: number;
  /** correct / autoBooked, as a percentage; null when nothing booked itself. */
  readonly precisionPct: number | null;
  /** Review lines that arrived with an account already proposed. */
  readonly suggested: number;
  readonly suggestionCorrect: number;
  readonly suggestionWrong: number;
  /** (correct + suggestionCorrect) / bookable, as a percentage. */
  readonly oneTapPct: number;
  readonly outcomes: readonly CaseOutcome[];
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

/**
 * Import every case as one statement into fresh books and grade what the
 * categorizer did with each line.
 *
 * One statement rather than a line at a time, because that is how the
 * product receives them, and fresh books per run so a rule taught by one
 * experiment cannot leak into the next measurement. `policy` defaults to the
 * one new imports run under.
 */
export const scoreCategorizer = (
  cases: readonly CategorizeCase[],
  makeOrg: () => Organization,
  bankAccountId = "acc_bank",
  policy?: ImportPolicy,
): CategorizeReport => {
  const org = makeOrg();
  const lines = cases.map((c, i) => ({
    reference: `EVAL${String(i + 1).padStart(4, "0")}`,
    date: "2026-07-15",
    description: c.description,
    amount: parseINR(c.amount),
  }));

  const result = org.banking.importStatement(lines, "eval", bankAccountId, policy);

  const bookedTo = new Map<string, string>();
  for (const p of result.posted) {
    const counter = p.entry.lines.find((l) => l.accountId !== bankAccountId);
    if (counter) bookedTo.set(p.line.reference, counter.accountId);
  }

  const suggestedFor = new Map<string, string>();
  for (const { line, reason } of org.banking.reviewQueueWithReasons?.() ?? [])
    if (reason.kind === "suggested") suggestedFor.set(line.reference, reason.accountId);

  const outcomes: CaseOutcome[] = cases.map((c, i) => {
    const line = lines[i]!;
    const got = bookedTo.get(line.reference) ?? "review";
    const suggested = suggestedFor.get(line.reference);

    let verdict: Verdict;
    if (got === "review") verdict = "abstained";
    else if (got === c.expect) verdict = "correct";
    else {
      const type = org.chart.get(got).type;
      const out = line.amount < 0n;
      verdict = (out && type === "REVENUE") || (!out && type === "EXPENSE") ? "wrong_direction" : "wrong";
    }
    return {
      id: c.id,
      description: c.description,
      amount: c.amount,
      expect: c.expect,
      got,
      verdict,
      ...(suggested ? { suggested } : {}),
    };
  });

  const count = (v: Verdict) => outcomes.filter((o) => o.verdict === v).length;
  const correct = count("correct");
  const wrongDirection = count("wrong_direction");
  const wrong = count("wrong") + wrongDirection;
  const autoBooked = correct + wrong;
  const bookable = cases.filter((c) => c.expect !== "review").length;
  const withSuggestion = outcomes.filter((o) => o.suggested !== undefined);
  const suggestionCorrect = withSuggestion.filter((o) => o.suggested === o.expect).length;

  return {
    total: cases.length,
    bookable,
    autoBooked,
    correct,
    wrong,
    wrongDirection,
    abstained: count("abstained"),
    coveragePct: pct(correct, bookable),
    precisionPct: autoBooked === 0 ? null : pct(correct, autoBooked),
    suggested: withSuggestion.length,
    suggestionCorrect,
    suggestionWrong: withSuggestion.length - suggestionCorrect,
    oneTapPct: pct(correct + suggestionCorrect, bookable),
    outcomes,
  };
};

export const formatCategorizeReport = (r: CategorizeReport): string => {
  const rows = [
    `lines=${r.total} bookable=${r.bookable}`,
    `auto-booked=${r.autoBooked} correct=${r.correct} wrong=${r.wrong} (wrong direction=${r.wrongDirection}) to-review=${r.abstained}`,
    `precision=${r.precisionPct === null ? "n/a" : `${r.precisionPct}%`}   coverage=${r.coveragePct}%`,
  ];
  if (r.suggested)
    rows.push(`suggested=${r.suggested} (right ${r.suggestionCorrect}, wrong ${r.suggestionWrong})   cleared in one tap or none=${r.oneTapPct}%`);
  const bad = r.outcomes.filter((o) => o.verdict === "wrong" || o.verdict === "wrong_direction");
  if (bad.length) {
    rows.push("", "Booked wrong:");
    for (const o of bad)
      rows.push(`  ${o.verdict === "wrong_direction" ? "DIRECTION" : "wrong    "}  ${o.id.padEnd(28)} ${o.amount.padStart(10)}  got ${o.got}, expected ${o.expect}`);
  }
  return rows.join("\n");
};

/* ------------------------------------------------------------------ */
/* Two policies, side by side                                          */
/* ------------------------------------------------------------------ */

/** Suggest-only (policy 3), with its suggestion counts surfaced for comparison. */
export interface SuggestOnlyReport {
  readonly report: CategorizeReport;
  readonly suggested: number;
  readonly suggestionCorrect: number;
  readonly suggestionWrong: number;
  readonly oneTapPct: number;
}

export interface PolicyComparison {
  /** Policy 2: the rules Paisa ships book what they match. */
  readonly bookAll: CategorizeReport;
  /** Policy 3: they only propose; taught rules and staples book. */
  readonly suggestOnly: SuggestOnlyReport;
}

/** Both policies over the same cases, each in fresh books, run by the real engine. */
export const comparePolicies = (
  cases: readonly CategorizeCase[],
  makeOrg: () => Organization,
): PolicyComparison => {
  const bookAll = scoreCategorizer(cases, makeOrg, "acc_bank", 2);
  const report = scoreCategorizer(cases, makeOrg, "acc_bank", 3);
  return {
    bookAll,
    suggestOnly: {
      report,
      suggested: report.suggested,
      suggestionCorrect: report.suggestionCorrect,
      suggestionWrong: report.suggestionWrong,
      oneTapPct: report.oneTapPct,
    },
  };
};

export const formatPolicyComparison = (c: PolicyComparison): string => {
  const a = c.bookAll;
  const b = c.suggestOnly.report;
  const p = (v: number | null) => (v === null ? "n/a" : `${v}%`);
  const row = (label: string, left: string, right: string) => `  ${label.padEnd(34)}${left.padEnd(18)}${right}`;
  return [
    row("", "book-all (2)", "suggest-only (3)"),
    row("precision of what booked itself", p(a.precisionPct), p(b.precisionPct)),
    row("lines booked wrong", String(a.wrong), String(b.wrong)),
    row("booked by itself (coverage)", `${a.coveragePct}%`, `${b.coveragePct}%`),
    row("arrive with a suggestion", "—", `${b.suggested} (right ${b.suggestionCorrect}, wrong ${b.suggestionWrong})`),
    row("cleared in one tap or none", `${a.oneTapPct}%`, `${b.oneTapPct}%`),
  ].join("\n");
};
