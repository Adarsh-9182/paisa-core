/**
 * The step 4 simulation: the datasets are well-formed, and each teaching
 * strategy does what it claims on a company small enough to reason about.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { simulateTeaching, type CompanyMonths } from "../src/ai/teach-eval.js";
import { TEACH_DEV } from "../src/ai/teach-months.js";
import { TEACH_HOLDOUT } from "../src/ai/teach-months-holdout.js";

const books = () => new Platform().createOrganization(`teach_${Math.random().toString(36).slice(2)}`, "Teach Traders");

describe("the three-month datasets", () => {
  for (const company of [TEACH_DEV, TEACH_HOLDOUT]) {
    it(`${company.name}: three months, real accounts, money going the right way`, () => {
      const chart = books().chart;
      expect(company.months).toHaveLength(3);
      for (const month of company.months) {
        for (const l of month) {
          const account = chart.get(l.account);
          const out = parseINR(l.amount) < 0n;
          if (account.type === "EXPENSE") expect(out, l.description).toBe(true);
          if (account.type === "REVENUE") expect(out, l.description).toBe(false);
          expect(l.day).toBeGreaterThanOrEqual(1);
          expect(l.day).toBeLessThanOrEqual(30);
        }
        // One line per payee per month, so repeats are unambiguous.
        expect(new Set(month.map((l) => l.payee)).size).toBe(month.length);
      }
    });
  }

  it("does not share payees between the development and held-out companies", () => {
    const names = (c: CompanyMonths) => new Set(c.months.flat().map((l) => l.description.replace(/[^A-Z ]/g, "")));
    const dev = names(TEACH_DEV);
    for (const d of names(TEACH_HOLDOUT)) expect(dev.has(d)).toBe(false);
  });
});

const tiny: CompanyMonths = {
  name: "TINY",
  bank: "HDFC",
  months: [1, 2, 3].map((m) => [
    { payee: "canva", day: 5, description: "ME DC SI 416021XXXXXX4821 CANVA", amount: "-499", account: "acc_software" },
    {
      payee: "rahul",
      day: 9,
      description: `UPI-RAHUL VERMA-rahulv@ybl-SBIN0001111-61091231111${m}-NOTE`,
      amount: "-1000",
      account: m === 2 ? "acc_meals" : "acc_travel",
    },
  ]),
};

describe("teaching strategies", () => {
  it("never: nothing books itself, every month asks the same questions", () => {
    const r = simulateTeaching(tiny, books, "never");
    expect(r.months.map((m) => m.booked)).toEqual([0, 0, 0]);
    expect(r.months.map((m) => m.questions)).toEqual([2, 2, 2]);
    expect(r.rulesLearned).toBe(0);
  });

  it("on_confirm: books from month two, including a payee whose purpose changed", () => {
    const r = simulateTeaching(tiny, books, "on_confirm");
    expect(r.months[1]!.booked).toBe(2);
    expect(r.wrong).toEqual([
      expect.objectContaining({ month: 2, payee: "rahul", bookedTo: "acc_travel", expected: "acc_meals" }),
    ]);
  });

  it("twice: a consistent payee books from month three, a changing one never learns", () => {
    const r = simulateTeaching(tiny, books, "twice");
    expect(r.months.map((m) => m.booked)).toEqual([0, 0, 1]);
    expect(r.wrong).toEqual([]);
    expect(r.months[2]!.repeatCoveragePct).toBe(100);
  });
});
