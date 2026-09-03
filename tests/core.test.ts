import { describe, it, expect } from "vitest";
import {
  parseINR, formatINR, paise, mulRatio, add, sub,
  Platform, JournalError, StatementError,
} from "../src/index.js";

const setup = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_abc", "ABC Technologies");
  return { platform, org };
};

describe("money", () => {
  it("parses Indian formatted amounts to paise", () => {
    expect(parseINR("₹1,23,456.78")).toBe(12345678n);
    expect(parseINR("15,00,000")).toBe(150000000n);
    expect(parseINR("-500")).toBe(-50000n);
    expect(parseINR("0.05")).toBe(5n);
    expect(parseINR("0.5")).toBe(50n);
  });

  it("formats with Indian digit grouping", () => {
    expect(formatINR(paise(12345678n))).toBe("₹1,23,456.78");
    expect(formatINR(paise(150000000n))).toBe("₹15,00,000.00");
    expect(formatINR(paise(-50000n))).toBe("-₹500.00");
    expect(formatINR(paise(999n))).toBe("₹9.99");
  });

  it("rejects non-integer paise", () => {
    expect(() => paise(10.5)).toThrow();
  });

  it("mulRatio rounds half away from zero", () => {
    expect(mulRatio(paise(100n), 1n, 3n)).toBe(33n);
    expect(mulRatio(paise(100n), 1n, 2n)).toBe(50n);
    expect(mulRatio(paise(101n), 1n, 2n)).toBe(51n); // 50.5 → 51
    expect(mulRatio(paise(-101n), 1n, 2n)).toBe(-51n);
  });
});

describe("journal engine — double entry", () => {
  it("posts a balanced entry (owner invests cash)", () => {
    const { org } = setup();
    const e = org.journal.post({
      date: "2026-04-01",
      narration: "Owner invests cash",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("10,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("10,00,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    expect(e.id).toBeTruthy();
    expect(org.ledger.balance("acc_bank", "2026-04-01")).toBe(parseINR("10,00,000"));
    expect(org.ledger.balance("acc_capital", "2026-04-01")).toBe(parseINR("10,00,000"));
  });

  it("rejects a date the reports could never find again", () => {
    const { org } = setup();
    const entry = (date: string) => () =>
      org.journal.post({
        date,
        narration: "Test",
        lines: [
          { accountId: "acc_bank", side: "DEBIT", amount: parseINR("1,000") },
          { accountId: "acc_capital", side: "CREDIT", amount: parseINR("1,000") },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      });

    // A balanced entry with a junk date used to post happily and then vanish
    // from every date-ranged report — no error, and books that disagree with
    // their own statements.
    expect(entry("not-a-date")).toThrow(/expected YYYY-MM-DD/);
    expect(entry("2026-4-1")).toThrow(/expected YYYY-MM-DD/);
    expect(entry("01-04-2026")).toThrow(/expected YYYY-MM-DD/);
    // right shape, not a real day — Date would have rolled these into March
    expect(entry("2026-02-30")).toThrow(/not a real calendar date/);
    expect(entry("2026-13-01")).toThrow(/not a real calendar date/);
    // and the valid one still posts
    expect(entry("2026-02-28")).not.toThrow();
  });

  it("rejects a reversal dated onto nothing", () => {
    const { org } = setup();
    const e = org.journal.post({
      date: "2026-04-01",
      narration: "Original",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("1,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("1,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    expect(() => org.journal.reverse(e.id, "adarsh", "wrong", "nonsense")).toThrow(/reversal date/);
  });

  it("rejects unbalanced entries", () => {
    const { org } = setup();
    expect(() =>
      org.journal.post({
        date: "2026-04-01",
        narration: "Broken entry",
        lines: [
          { accountId: "acc_bank", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_capital", side: "CREDIT", amount: parseINR("99") },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      }),
    ).toThrow(JournalError);
  });

  it("rejects zero/negative line amounts and unknown accounts", () => {
    const { org } = setup();
    expect(() =>
      org.journal.post({
        date: "2026-04-01",
        narration: "Zero line",
        lines: [
          { accountId: "acc_bank", side: "DEBIT", amount: paise(0n) },
          { accountId: "acc_capital", side: "CREDIT", amount: paise(0n) },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      }),
    ).toThrow(JournalError);
    expect(() =>
      org.journal.post({
        date: "2026-04-01",
        narration: "Unknown account",
        lines: [
          { accountId: "acc_nope", side: "DEBIT", amount: parseINR("100") },
          { accountId: "acc_capital", side: "CREDIT", amount: parseINR("100") },
        ],
        sourceModule: "manual",
        createdBy: "adarsh",
      }),
    ).toThrow();
  });

  it("entries are frozen — no silent mutation", () => {
    const { org } = setup();
    const e = org.journal.post({
      date: "2026-04-01",
      narration: "Immutable",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("100") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("100") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.lines)).toBe(true);
    expect(Object.isFrozen(e.lines[0])).toBe(true);
  });
});

describe("journal engine — reversal-based corrections", () => {
  const seed = () => {
    const { org } = setup();
    org.journal.post({
      date: "2026-04-01",
      narration: "Seed capital",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("10,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("10,00,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    const wrong = org.journal.post({
      date: "2026-04-02",
      narration: "Rent paid (wrong amount)",
      lines: [
        { accountId: "acc_rent", side: "DEBIT", amount: parseINR("90,000") },
        { accountId: "acc_bank", side: "CREDIT", amount: parseINR("90,000") },
      ],
      sourceModule: "manual",
      createdBy: "adarsh",
    });
    return { org, wrong };
  };

  it("reversal restores balances and preserves full history", () => {
    const { org, wrong } = seed();
    const before = org.journal.all().length;
    const rev = org.journal.reverse(wrong.id, "adarsh", "amount was ₹9,000 not ₹90,000", "2026-04-03");
    expect(org.journal.all().length).toBe(before + 1); // nothing deleted
    expect(rev.reverses).toBe(wrong.id);
    expect(org.journal.get(wrong.id).reversedBy).toBe(rev.id);
    expect(org.ledger.balance("acc_rent", "2026-04-03")).toBe(0n);
    expect(org.ledger.balance("acc_bank", "2026-04-03")).toBe(parseINR("10,00,000"));
  });

  it("cannot double-reverse or reverse a reversal", () => {
    const { org, wrong } = seed();
    const rev = org.journal.reverse(wrong.id, "adarsh", "fix", "2026-04-03");
    expect(() => org.journal.reverse(wrong.id, "adarsh", "again")).toThrow(JournalError);
    expect(() => org.journal.reverse(rev.id, "adarsh", "undo the undo")).toThrow(JournalError);
  });
});

describe("trial balance and statements", () => {
  const seedBusiness = () => {
    const { org } = setup();
    const post = (date: string, narration: string, dr: string, cr: string, amt: string) =>
      org.journal.post({
        date, narration,
        lines: [
          { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
          { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
        ],
        sourceModule: "manual", createdBy: "adarsh",
      });
    post("2026-01-01", "Owner capital", "acc_bank", "acc_capital", "20,00,000");
    post("2026-01-10", "Invoice paid by customer", "acc_bank", "acc_sales", "5,00,000");
    post("2026-02-01", "Salary", "acc_salary", "acc_bank", "2,00,000");
    post("2026-02-05", "Rent", "acc_rent", "acc_bank", "50,000");
    post("2026-02-20", "Services revenue", "acc_bank", "acc_services", "3,00,000");
    post("2026-03-01", "Marketing", "acc_marketing", "acc_bank", "1,00,000");
    post("2026-03-15", "Loan received", "acc_bank", "acc_loans", "4,00,000");
    return org;
  };

  it("trial balance always balances for valid postings", () => {
    const org = seedBusiness();
    const tb = org.ledger.trialBalance("2026-03-31");
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.rows.length).toBeGreaterThan(0);
  });

  it("balance sheet satisfies the accounting equation", () => {
    const org = seedBusiness();
    const bs = org.statements.balanceSheet("2026-03-31");
    expect(bs.equationHolds).toBe(true);
    expect(bs.totalAssets).toBe(add(bs.totalLiabilities, bs.totalEquity));
    expect(bs.totalAssets).toBe(parseINR("28,50,000")); // 20+5-2-0.5+3-1+4 lakh in bank
  });

  it("P&L computes period revenue, expenses, and net profit", () => {
    const org = seedBusiness();
    const pl = org.statements.profitAndLoss("2026-02-01", "2026-02-28");
    expect(pl.totalRevenue).toBe(parseINR("3,00,000"));
    expect(pl.totalExpenses).toBe(parseINR("2,50,000"));
    expect(pl.netProfit).toBe(parseINR("50,000"));
  });

  it("cash flow statement reconciles opening + net change = closing", () => {
    const org = seedBusiness();
    const cf = org.statements.cashFlow("2026-02-01", "2026-03-31");
    expect(add(cf.openingCash, cf.netChange)).toBe(cf.closingCash);
    expect(sub(cf.inflows, cf.outflows)).toBe(cf.netChange);
  });
});
