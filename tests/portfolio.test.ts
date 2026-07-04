import { describe, it, expect } from "vitest";
import {
  Platform,
  parseINR,
  parseQty,
  formatQty,
  Orchestrator,
  CfoPlanner,
  AiUser,
  Permission,
} from "../src/index.js";

const freshOrg = (id = "org_p") => {
  const org = new Platform().createOrganization(id, "Test Co");
  org.journal.post({
    date: "2026-01-01",
    narration: "Seed capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
    createdBy: "adarsh",
  });
  return org;
};

describe("quantity parsing", () => {
  it("parses and formats 4-decimal quantities exactly", () => {
    expect(parseQty("10")).toBe(100_000n);
    expect(parseQty("10.5")).toBe(105_000n);
    expect(parseQty("0.0042")).toBe(42n);
    expect(formatQty(parseQty("123.4567"))).toBe("123.4567");
    expect(formatQty(parseQty("10.5000"))).toBe("10.5");
    expect(() => parseQty("1.23456")).toThrow();
    expect(() => parseQty("-3")).toThrow();
  });
});

describe("portfolio engine", () => {
  it("posts a balanced journal entry on buy and moves cash into Investments", () => {
    const org = freshOrg();
    org.portfolio.record(
      { symbol: "NIFTYBEES", name: "Nippon Nifty 50 ETF", kind: "ETF", side: "BUY", date: "2026-02-01", qty: parseQty("1000"), pricePerUnit: parseINR("250"), fees: parseINR("500") },
      "adarsh",
    );
    expect(org.ledger.balance("acc_investments", "2026-02-01")).toBe(parseINR("2,50,500"));
    expect(org.ledger.balance("acc_bank", "2026-02-01")).toBe(parseINR("47,49,500"));
    expect(org.ledger.trialBalance("2026-02-01").balanced).toBe(true);
  });

  it("tracks weighted-average cost across multiple buys", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "X", name: "X Fund", kind: "MUTUAL_FUND", side: "BUY", date: "2026-02-01", qty: parseQty("100"), pricePerUnit: parseINR("100") }, "a");
    org.portfolio.record({ symbol: "X", name: "X Fund", kind: "MUTUAL_FUND", side: "BUY", date: "2026-03-01", qty: parseQty("100"), pricePerUnit: parseINR("200") }, "a");
    const [h] = org.portfolio.holdings("2026-03-02");
    expect(h!.qty).toBe(parseQty("200"));
    expect(h!.costBasis).toBe(parseINR("30,000"));
    expect(h!.avgCostPerUnit).toBe(parseINR("150"));
  });

  it("realizes gains on sell and posts them to the P&L", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "S", name: "Stock", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("100"), pricePerUnit: parseINR("1,000") }, "a");
    const sell = org.portfolio.record(
      { symbol: "S", name: "Stock", kind: "STOCK", side: "SELL", date: "2026-04-01", qty: parseQty("40"), pricePerUnit: parseINR("1,500"), fees: parseINR("100") },
      "a",
    );
    // proceeds 60,000 - 100 fees = 59,900; cost removed 40% of 1,00,000 = 40,000
    expect(sell.realizedPnl).toBe(parseINR("19,900"));
    expect(org.ledger.balance("acc_realized_gains", "2026-04-01")).toBe(parseINR("19,900"));
    expect(org.ledger.balance("acc_investments", "2026-04-01")).toBe(parseINR("60,000"));
    expect(org.ledger.trialBalance("2026-04-01").balanced).toBe(true);
    const pl = org.statements.profitAndLoss("2026-01-01", "2026-04-30");
    expect(pl.revenue.some((r) => r.name === "Realized Investment Gains")).toBe(true);
  });

  it("realizes losses to the expense side", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "L", name: "Loser", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("10"), pricePerUnit: parseINR("1,000") }, "a");
    const sell = org.portfolio.record({ symbol: "L", name: "Loser", kind: "STOCK", side: "SELL", date: "2026-03-01", qty: parseQty("10"), pricePerUnit: parseINR("800") }, "a");
    expect(sell.realizedPnl).toBe(parseINR("-2,000"));
    expect(org.ledger.balance("acc_realized_losses", "2026-03-01")).toBe(parseINR("2,000"));
    expect(org.ledger.balance("acc_investments", "2026-03-01")).toBe(parseINR("0"));
    expect(org.ledger.trialBalance("2026-03-01").balanced).toBe(true);
  });

  it("rejects a backdated sell that would break a later sell", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "B", name: "Back", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("10"), pricePerUnit: parseINR("100") }, "a");
    org.portfolio.record({ symbol: "B", name: "Back", kind: "STOCK", side: "SELL", date: "2026-04-01", qty: parseQty("10"), pricePerUnit: parseINR("120") }, "a");
    // Selling 5 more, backdated to March, was "affordable" on that date —
    // but it would drive the April sell negative. Must be rejected.
    expect(() =>
      org.portfolio.record({ symbol: "B", name: "Back", kind: "STOCK", side: "SELL", date: "2026-03-01", qty: parseQty("5"), pricePerUnit: parseINR("110") }, "a"),
    ).toThrow(/negative/);
    // And no journal entry leaked from the rejected trade.
    expect(org.ledger.trialBalance("2026-04-30").balanced).toBe(true);
    expect(org.portfolio.allTrades()).toHaveLength(2);
  });

  it("refuses to sell more than is held", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "S", name: "Stock", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("10"), pricePerUnit: parseINR("100") }, "a");
    expect(() =>
      org.portfolio.record({ symbol: "S", name: "Stock", kind: "STOCK", side: "SELL", date: "2026-02-02", qty: parseQty("11"), pricePerUnit: parseINR("100") }, "a"),
    ).toThrow(/Cannot sell/);
    expect(() =>
      org.portfolio.record({ symbol: "GHOST", name: "Ghost", kind: "STOCK", side: "SELL", date: "2026-02-02", qty: parseQty("1"), pricePerUnit: parseINR("100") }, "a"),
    ).toThrow(/Cannot sell/);
  });

  it("never guesses a market value: unmarked holdings are declared", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "U", name: "Unmarked", kind: "MUTUAL_FUND", side: "BUY", date: "2026-02-01", qty: parseQty("100"), pricePerUnit: parseINR("50") }, "a");
    const s = org.portfolio.summary("2026-03-01");
    expect(s.holdings[0]!.marketValue).toBeNull();
    expect(s.holdings[0]!.unrealizedPnl).toBeNull();
    expect(s.unmarkedSymbols).toEqual(["U"]);
    expect(s.markedValue).toBe(parseINR("0"));
  });

  it("values holdings from the latest mark on or before asOf", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "M", name: "Marked", kind: "ETF", side: "BUY", date: "2026-02-01", qty: parseQty("100"), pricePerUnit: parseINR("100") }, "a");
    org.portfolio.mark("M", "2026-02-15", parseINR("110"), "a");
    org.portfolio.mark("M", "2026-03-15", parseINR("120"), "a");
    org.portfolio.mark("M", "2026-05-15", parseINR("90"), "a"); // after asOf — ignored
    const s = org.portfolio.summary("2026-04-01");
    expect(s.holdings[0]!.marketValue).toBe(parseINR("12,000"));
    expect(s.holdings[0]!.unrealizedPnl).toBe(parseINR("2,000"));
    expect(s.unrealizedPnl).toBe(parseINR("2,000"));
  });

  it("computes allocation across kinds and keeps totals exact", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "E", name: "ETF", kind: "ETF", side: "BUY", date: "2026-02-01", qty: parseQty("100"), pricePerUnit: parseINR("300") }, "a");
    org.portfolio.record({ symbol: "F", name: "FD", kind: "FIXED_DEPOSIT", side: "BUY", date: "2026-02-01", qty: parseQty("1"), pricePerUnit: parseINR("10,000") }, "a");
    const s = org.portfolio.summary("2026-02-02");
    expect(s.totalCostBasis).toBe(parseINR("40,000"));
    expect(s.allocation.map((x) => x.kind)).toEqual(["ETF", "FIXED_DEPOSIT"]);
    expect(s.allocation[0]!.pct).toBe(75);
    expect(s.allocation[1]!.pct).toBe(25);
  });

  it("rejects trading the same symbol under a different kind", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "D", name: "Dual", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("1"), pricePerUnit: parseINR("100") }, "a");
    expect(() =>
      org.portfolio.record({ symbol: "D", name: "Dual", kind: "ETF", side: "BUY", date: "2026-02-02", qty: parseQty("1"), pricePerUnit: parseINR("100") }, "a"),
    ).toThrow(/already held/);
  });

  it("audits trades and marks on the event log", () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "A", name: "Audit", kind: "STOCK", side: "BUY", date: "2026-02-01", qty: parseQty("1"), pricePerUnit: parseINR("100") }, "adarsh");
    org.portfolio.mark("A", "2026-02-02", parseINR("105"), "adarsh");
    const types = org.bus.audit(org.orgId).map((e) => e.type);
    expect(types).toContain("trade.recorded");
    expect(types).toContain("price.marked");
  });
});

describe("portfolio through the AI", () => {
  it("answers portfolio questions with verified figures from get_portfolio", async () => {
    const org = freshOrg();
    org.portfolio.record({ symbol: "NIFTYBEES", name: "Nifty 50 ETF", kind: "ETF", side: "BUY", date: "2026-02-01", qty: parseQty("1000"), pricePerUnit: parseINR("250") }, "adarsh");
    org.portfolio.mark("NIFTYBEES", "2026-06-30", parseINR("270"), "adarsh");

    const ai = new Orchestrator(new CfoPlanner({ asOf: "2026-07-02", periodFrom: "2026-01-01" }));
    const user: AiUser = { userId: "adarsh", orgId: org.orgId, permissions: new Set<Permission>(["access_ai_cfo", "view_reports"]) };
    const res = await ai.ask(user, org, "How is my investment portfolio doing?");
    expect(res.verified).toBe(true);
    expect(res.toolsInvoked.map((t) => t.tool)).toContain("get_portfolio");
    expect(res.finalAnswer).toContain("₹2,70,000.00"); // marked value, verbatim from the tool
  });
});
