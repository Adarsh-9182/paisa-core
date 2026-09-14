/**
 * Scoreboard for step 4: does confirming a line teach Paisa enough that the
 * next month's statement books itself, without booking anything wrong?
 *
 * A company's statements run for three months through the real engine
 * (policy 3). Each month a simulated person clears every line in review,
 * always choosing the right account and always accepting the keyword the
 * screen proposes. That person is the worst case for precision: they never
 * notice a keyword that is too broad, and they never go back to fix a line
 * that booked itself wrongly. Whatever a teaching strategy lets through, this
 * person lets through.
 *
 * Strategies compared:
 *
 *   never       — confirming books the line and teaches nothing.
 *   on_confirm  — the first confirmation turns the proposed keyword into a
 *                 rule that books from then on.
 *   twice       — a keyword becomes a rule only when a second confirmation
 *                 agrees with the first on the account, and never once two
 *                 confirmations have disagreed. A payee whose purpose changes
 *                 from month to month never earns a rule.
 *
 * Measured per month: coverage (lines that booked themselves, of all lines),
 * precision (of those, how many to the right account), and questions (lines
 * a person had to clear). "Repeat" lines are the fair test of learning: the
 * payee appeared in an earlier month and was always booked to the account it
 * belongs in this month too. A new payee cannot be learned in advance, so a
 * statement full of them caps coverage whatever the strategy.
 *
 * The gate from the roadmap: coverage ≥ 80% in month three, with precision
 * ≥ 98% across everything that booked itself in the three months.
 */

import { Organization } from "../organization.js";
import { parseINR } from "../money.js";
import { suggestKeyword } from "../banking.js";

export interface MonthLine {
  /** Stable id for the counterparty across months, so repeats can be counted. */
  readonly payee: string;
  readonly day: number;
  /** The narration exactly as the bank prints it that month. */
  readonly description: string;
  /** Signed rupees: "-842.50" is money out. */
  readonly amount: string;
  /** Where a person books it this month. The same payee can differ by month. */
  readonly account: string;
}

export interface CompanyMonths {
  readonly name: string;
  /** Whose statement format the narrations follow. */
  readonly bank: string;
  readonly months: readonly (readonly MonthLine[])[];
}

export type TeachStrategy = "never" | "on_confirm" | "twice";
export const TEACH_STRATEGIES: readonly TeachStrategy[] = ["never", "on_confirm", "twice"];

export interface WrongBooking {
  readonly month: number;
  readonly payee: string;
  readonly description: string;
  readonly bookedTo: string;
  readonly expected: string;
}

export interface MonthScore {
  readonly month: number;
  readonly lines: number;
  readonly booked: number;
  readonly bookedCorrect: number;
  readonly questions: number;
  readonly coveragePct: number;
  readonly precisionPct: number | null;
  readonly repeatLines: number;
  readonly repeatBooked: number;
  readonly repeatCoveragePct: number | null;
}

export interface TeachReport {
  readonly company: string;
  readonly strategy: TeachStrategy;
  readonly months: readonly MonthScore[];
  readonly rulesLearned: number;
  readonly precisionPct: number | null;
  readonly wrong: readonly WrongBooking[];
  readonly gatePassed: boolean;
}

const PERIODS = ["2026-04", "2026-05", "2026-06"];

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

export const simulateTeaching = (
  company: CompanyMonths,
  makeOrg: () => Organization,
  strategy: TeachStrategy,
): TeachReport => {
  const org = makeOrg();
  const seen = new Map<string, Set<string>>();
  const evidence = new Map<string, { accountId: string; count: number; conflicted: boolean }>();
  const wrong: WrongBooking[] = [];
  let rulesLearned = 0;
  let totalBooked = 0;
  let totalCorrect = 0;

  const months = company.months.map((lines, i): MonthScore => {
    const month = i + 1;
    const statement = lines.map((l, j) => ({
      reference: `${company.name}-M${month}-${String(j + 1).padStart(3, "0")}`,
      date: `${PERIODS[i]}-${String(l.day).padStart(2, "0")}`,
      description: l.description,
      amount: parseINR(l.amount),
    }));
    const truth = new Map(statement.map((s, j) => [s.reference, lines[j]!]));
    const isRepeat = (l: MonthLine): boolean => {
      const before = seen.get(l.payee);
      return before !== undefined && before.size === 1 && before.has(l.account);
    };

    const result = org.banking.importStatement(statement, "person", "acc_bank", 3);
    let bookedCorrect = 0;
    let repeatBooked = 0;
    for (const p of result.posted) {
      const t = truth.get(p.line.reference)!;
      const bookedTo = p.entry.lines.find((x) => x.accountId !== "acc_bank")!.accountId;
      if (bookedTo === t.account) bookedCorrect++;
      else wrong.push({ month, payee: t.payee, description: t.description, bookedTo, expected: t.account });
      if (isRepeat(t)) repeatBooked++;
    }

    const queue = [...org.banking.reviewQueueWithReasons()];
    for (const { line, reason } of queue) {
      const t = truth.get(line.reference);
      if (!t) continue;
      const keyword = reason.kind === "suggested" ? reason.keyword : suggestKeyword(line.description);
      let learn: string | undefined;
      if (keyword && strategy === "on_confirm") learn = keyword;
      if (keyword && strategy === "twice") {
        const key = keyword.toLowerCase();
        const e = evidence.get(key);
        if (!e) evidence.set(key, { accountId: t.account, count: 1, conflicted: false });
        else if (e.accountId !== t.account) e.conflicted = true;
        else if (!e.conflicted && ++e.count === 2) learn = keyword;
      }
      try {
        org.banking.categorize(line.reference, t.account, "person", learn);
        if (learn) rulesLearned++;
      } catch {
        // A keyword the engine refuses (too short, not in the text) is
        // validated before anything posts, so the line is simply cleared.
        org.banking.categorize(line.reference, t.account, "person");
      }
    }

    const repeatLines = lines.filter(isRepeat).length;
    for (const l of lines) {
      const s = seen.get(l.payee) ?? new Set<string>();
      s.add(l.account);
      seen.set(l.payee, s);
    }
    totalBooked += result.posted.length;
    totalCorrect += bookedCorrect;
    return {
      month,
      lines: lines.length,
      booked: result.posted.length,
      bookedCorrect,
      questions: queue.length,
      coveragePct: pct(result.posted.length, lines.length),
      precisionPct: result.posted.length === 0 ? null : pct(bookedCorrect, result.posted.length),
      repeatLines,
      repeatBooked,
      repeatCoveragePct: repeatLines === 0 ? null : pct(repeatBooked, repeatLines),
    };
  });

  const precisionPct = totalBooked === 0 ? null : pct(totalCorrect, totalBooked);
  const last = months[months.length - 1]!;
  return {
    company: company.name,
    strategy,
    months,
    rulesLearned,
    precisionPct,
    wrong,
    gatePassed: last.coveragePct >= 80 && precisionPct !== null && precisionPct >= 98,
  };
};

export const formatTeachReports = (reports: readonly TeachReport[]): string => {
  const rows = [
    "strategy     coverage m1 / m2 / m3     repeat cov m3   questions m1/m2/m3   precision   rules   gate",
  ];
  for (const r of reports) {
    const cov = r.months.map((m) => `${m.coveragePct}%`.padStart(6)).join(" /");
    const q = r.months.map((m) => String(m.questions)).join("/");
    const rep = r.months.at(-1)!.repeatCoveragePct;
    rows.push(
      `${r.strategy.padEnd(12)} ${cov.padEnd(25)} ${(rep === null ? "n/a" : `${rep}%`).padEnd(15)} ${q.padEnd(20)} ${(r.precisionPct === null ? "n/a" : `${r.precisionPct}%`).padEnd(11)} ${String(r.rulesLearned).padEnd(7)} ${r.gatePassed ? "PASS" : "fail"}`,
    );
  }
  for (const r of reports) {
    if (!r.wrong.length) continue;
    rows.push("", `Booked wrong under ${r.strategy}:`);
    for (const w of r.wrong)
      rows.push(`  m${w.month} ${w.payee.padEnd(18)} ${w.bookedTo} (should be ${w.expected})  ${w.description}`);
  }
  return rows.join("\n");
};
