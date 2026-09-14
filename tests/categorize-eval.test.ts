/**
 * The categorization scoreboard grades correctly — and its dataset is sane.
 *
 * These cases do not pin today's score: the score is expected to change as
 * the categorizer improves. They pin the grading, so a better number means
 * the categorizer got better rather than the scorer got lenient.
 */
import { describe, it, expect } from "vitest";
import { Platform } from "../src/index.js";
import { scoreCategorizer, formatCategorizeReport, CategorizeCase } from "../src/ai/categorize-eval.js";
import { CATEGORIZE_CASES, PROPOSED_ACCOUNTS } from "../src/ai/categorize-cases.js";

const books = () => new Platform().createOrganization(`cat_${Math.random().toString(36).slice(2)}`, "Eval Traders");

const grade = (cases: CategorizeCase[]) => scoreCategorizer(cases, books);

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
    const r = grade([{ id: "a", description: "INTEREST DEBITED OD A/C", amount: "-100", expect: "acc_interest_expense" }]);
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

  it("keeps proposed accounts on the side of the ledger their direction implies", () => {
    for (const c of CATEGORIZE_CASES) {
      const proposed = PROPOSED_ACCOUNTS[c.expect];
      if (!proposed) continue;
      const out = c.amount.startsWith("-");
      expect(proposed.type, `${c.id}`).toBe(out ? "EXPENSE" : "REVENUE");
    }
  });
});
