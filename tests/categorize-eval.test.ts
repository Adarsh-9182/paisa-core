/**
 * The categorization scoreboard grades correctly — and its dataset is sane.
 *
 * These cases do not pin today's score: the score is expected to change as
 * the categorizer improves. They pin the grading, so a better number means
 * the categorizer got better rather than the scorer got lenient.
 */
import { describe, it, expect } from "vitest";
import { Platform } from "../src/index.js";
import {
  scoreCategorizer,
  formatCategorizeReport,
  comparePolicies,
  formatPolicyComparison,
  CategorizeCase,
} from "../src/ai/categorize-eval.js";
import { CATEGORIZE_CASES, PROPOSED_ACCOUNTS } from "../src/ai/categorize-cases.js";

const books = () => new Platform().createOrganization(`cat_${Math.random().toString(36).slice(2)}`, "Eval Traders");

// Grading is tested under policy 2, where shipped rules book, so there is
// something to grade as right and wrong; the policies are compared below.
const grade = (cases: CategorizeCase[]) => scoreCategorizer(cases, books, "acc_bank", 2);

describe("grading", () => {
  it("counts a line booked to the expected account as correct", () => {
    const r = grade([{ id: "a", description: "POS 4521 AWS SERVICES", amount: "-100", expect: "acc_software" }]);
    expect(r.outcomes[0]!.verdict).toBe("correct");
    expect(r.precisionPct).toBe(100);
    expect(r.coveragePct).toBe(100);
  });

  it("counts a line sent to review as abstaining, never as an error", () => {
    const r = grade([{ id: "a", description: "UPI/DR/1/SOMEONE/someone@ybl", amount: "-100", expect: "acc_software" }]);
    expect(r.outcomes[0]!.verdict).toBe("abstained");
    expect(r.wrong).toBe(0);
    expect(r.precisionPct).toBeNull();
    expect(r.coveragePct).toBe(0);
  });

  it("counts a line booked somewhere it does not belong as wrong", () => {
    const r = grade([{ id: "a", description: "POS 4521 UBER EATS", amount: "-100", expect: "acc_meals" }]);
    expect(r.outcomes[0]!.verdict).toBe("wrong");
    expect(r.precisionPct).toBe(0);
  });

  it("singles out money booked in the wrong direction", () => {
    // The engine now refuses these, so a stub stands in for one that does
    // not: the scorer has to keep catching it if the guard ever regresses.
    const real = books();
    const stub = {
      chart: real.chart,
      banking: {
        importStatement: (lines: { reference: string }[]) => ({
          posted: [{ line: lines[0], entry: { lines: [{ accountId: "acc_interest_income" }, { accountId: "acc_bank" }] } }],
          needsReview: [],
          duplicates: [],
        }),
      },
    } as unknown as ReturnType<typeof books>;
    const r = scoreCategorizer(
      [{ id: "a", description: "INTEREST DEBITED OD A/C", amount: "-100", expect: "acc_interest_expense" }],
      () => stub,
    );
    expect(r.outcomes[0]!.verdict).toBe("wrong_direction");
    expect(r.wrongDirection).toBe(1);
    expect(r.wrong).toBe(1);
  });

  it("does not let a review-labelled line count towards coverage", () => {
    const r = grade([
      { id: "a", description: "POS 4521 AWS SERVICES", amount: "-100", expect: "acc_software" },
      { id: "b", description: "UPI/CR/1/SUNIL/sunil@ybl", amount: "100", expect: "review" },
    ]);
    expect(r.bookable).toBe(1);
    expect(r.coveragePct).toBe(100);
  });

  it("names every wrong booking in the report", () => {
    const r = grade([{ id: "trap", description: "POS 4521 UBER EATS", amount: "-100", expect: "acc_meals" }]);
    expect(formatCategorizeReport(r)).toContain("trap");
  });
});

describe("the dataset", () => {
  it("has unique case ids", () => {
    const ids = CATEGORIZE_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only expects accounts that exist, are proposed, or 'review'", () => {
    const chart = books().chart;
    for (const c of CATEGORIZE_CASES) {
      const known = c.expect === "review" || c.expect in PROPOSED_ACCOUNTS || (() => {
        try { chart.get(c.expect); return true; } catch { return false; }
      })();
      expect(known, `${c.id} expects unknown account ${c.expect}`).toBe(true);
    }
  });

  it("explains every label a reader would otherwise question", () => {
    for (const c of CATEGORIZE_CASES.filter((c) => c.expect === "review" || c.id.startsWith("trap-")))
      expect(c.why, `${c.id} needs a reason`).toBeTruthy();
  });

  it("never labels money out as income, or money in as an expense, in either set", async () => {
    const { CATEGORIZE_HOLDOUT } = await import("../src/ai/categorize-holdout.js");
    const chart = books().chart;
    for (const c of [...CATEGORIZE_CASES, ...CATEGORIZE_HOLDOUT]) {
      if (c.expect === "review") continue;
      const type = PROPOSED_ACCOUNTS[c.expect]?.type ?? chart.get(c.expect).type;
      if (c.amount.startsWith("-")) expect(type, c.id).not.toBe("REVENUE");
      else expect(type, c.id).not.toBe("EXPENSE");
    }
  });
});

describe("the held-out set", () => {
  it("shares no case id with the development set", async () => {
    const { CATEGORIZE_HOLDOUT } = await import("../src/ai/categorize-holdout.js");
    const dev = new Set(CATEGORIZE_CASES.map((c) => c.id));
    const ids = CATEGORIZE_HOLDOUT.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(dev.has(id), `${id} is also a development case`).toBe(false);
  });

  it("only expects accounts that exist, are proposed, or 'review', and explains its judgement calls", async () => {
    const { CATEGORIZE_HOLDOUT } = await import("../src/ai/categorize-holdout.js");
    const chart = books().chart;
    for (const c of CATEGORIZE_HOLDOUT) {
      const known = c.expect === "review" || c.expect in PROPOSED_ACCOUNTS || (() => {
        try { chart.get(c.expect); return true; } catch { return false; }
      })();
      expect(known, `${c.id} expects unknown account ${c.expect}`).toBe(true);
      if (c.expect === "review" || c.id.startsWith("h-trap-")) expect(c.why, `${c.id} needs a reason`).toBeTruthy();
    }
  });
});

describe("comparing book-all with suggest-only", () => {
  it("turns a correct shipped booking into a correct suggestion, cleared in one tap", () => {
    const r = comparePolicies([{ id: "a", description: "POS 4521 AWS SERVICES", amount: "-100", expect: "acc_software" }], books);
    expect(r.bookAll.outcomes[0]!.verdict).toBe("correct");
    expect(r.suggestOnly.report.outcomes[0]!.verdict).toBe("abstained");
    expect(r.suggestOnly.suggestionCorrect).toBe(1);
    expect(r.suggestOnly.oneTapPct).toBe(100);
  });

  it("turns a wrong shipped booking into a wrong suggestion rather than a wrong figure", () => {
    const r = comparePolicies([{ id: "a", description: "UPI DR 1 UBER EATS INDIA", amount: "-100", expect: "acc_meals" }], books);
    expect(r.bookAll.wrong).toBe(1);
    expect(r.suggestOnly.report.wrong).toBe(0);
    expect(r.suggestOnly.suggestionWrong).toBe(1);
    expect(r.suggestOnly.oneTapPct).toBe(0);
  });

  it("still lets a format staple book itself under suggest-only", () => {
    const r = comparePolicies([{ id: "a", description: "SMS CHARGES QTR SEP-26", amount: "-17.70", expect: "acc_bank_charges" }], books);
    expect(r.suggestOnly.report.correct).toBe(1);
    expect(r.suggestOnly.oneTapPct).toBe(100);
  });

  it("offers no suggestion where the shipped rules had nothing either", () => {
    const r = comparePolicies([{ id: "a", description: "UPI/DR/1/SOMEONE/someone@ybl", amount: "-100", expect: "acc_software" }], books);
    expect(r.suggestOnly.suggested).toBe(0);
    expect(formatPolicyComparison(r)).toContain("suggest-only");
  });
});
