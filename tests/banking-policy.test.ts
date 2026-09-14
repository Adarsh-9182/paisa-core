/**
 * Import policy 2: what a keyword match is not allowed to decide by itself.
 *
 * A keyword names a payee. It cannot tell whether a payment is income, an
 * expense or neither, and the categorizer booked lines as if it could: an
 * overdraft interest charge lowered interest income, rent received credited
 * the rent expense, a salary advance became salary. These cases pin the
 * checks that stop that — and pin that history recorded under the old rules
 * replays exactly as it originally booked.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";

const books = () => new Platform().createOrganization(`pol_${Math.random().toString(36).slice(2)}`, "Policy Traders");

const line = (description: string, amount: string, reference = "R1") => ({
  reference,
  date: "2026-07-15",
  description,
  amount: parseINR(amount),
});

const counterAccount = (org: ReturnType<typeof books>) =>
  org.journal.all().at(-1)!.lines.find((l) => l.accountId !== "acc_bank")!.accountId;

describe("money going the wrong way for its account", () => {
  it("does not book money out to an income account", () => {
    const org = books();
    const r = org.banking.importStatement([line("INTEREST DEBITED OD A/C", "-6420")], "priya");
    expect(r.posted).toHaveLength(0);
    expect(org.banking.reviewQueueWithReasons()[0]!.reason).toEqual({
      kind: "direction",
      accountId: "acc_interest_income",
      keyword: "interest",
    });
  });

  it("does not book money in to an expense account", () => {
    const org = books();
    const r = org.banking.importStatement([line("UPI/CR/1/MEHTA/RENT RECEIVED FLAT 2B", "22000")], "priya");
    expect(r.posted).toHaveLength(0);
    expect(org.banking.reviewQueueWithReasons()[0]!.reason.kind).toBe("direction");
  });

  it("still books money that goes the way its account expects", () => {
    const org = books();
    const r = org.banking.importStatement([line("INTEREST PAID TILL 30-SEP-2026", "1842")], "priya");
    expect(r.posted).toHaveLength(1);
    expect(counterAccount(org)).toBe("acc_interest_income");
  });

  it("holds a rule a person taught to the same standard", () => {
    const org = books();
    org.banking.addRule({ keyword: "acme cloud", accountId: "acc_software", label: "Software" });
    const r = org.banking.importStatement([line("NEFT CR-ACME CLOUD-CREDIT NOTE", "500")], "priya");
    expect(r.posted).toHaveLength(0);
    expect(org.banking.reviewQueueWithReasons()[0]!.reason.kind).toBe("direction");
  });
});

describe("words that mean money is moving, not being earned or spent", () => {
  it("keeps a salary advance out of the salary expense", () => {
    const org = books();
    const r = org.banking.importStatement([line("IMPS/P2A/1/SALARY ADVANCE AMIT K", "-10000")], "priya");
    expect(r.posted).toHaveLength(0);
    expect(org.banking.reviewQueueWithReasons()[0]!.reason).toEqual({
      kind: "movement",
      accountId: "acc_salary",
      keyword: "salary",
      word: "advance",
    });
  });

  it("lets a balance-sheet account take a line that mentions a deposit", () => {
    const org = books();
    const r = org.banking.importStatement([line("CASH DEPOSIT CDM 004512 INDIRANAGAR", "40000")], "priya");
    expect(r.posted).toHaveLength(1);
    expect(counterAccount(org)).toBe("acc_cash");
  });
});

describe("staples", () => {
  it("books the bank's own fee", () => {
    const org = books();
    org.banking.importStatement([line("SMS CHARGES QTR SEP-26", "-17.70")], "priya");
    expect(counterAccount(org)).toBe("acc_bank_charges");
  });

  it("books GST and TDS challans against what is owed, not as expenses", () => {
    const org = books();
    org.banking.importStatement([line("GST PMT CPIN 26091234567890 CBIC", "-38420")], "priya");
    expect(counterAccount(org)).toBe("acc_gst_payable");
    org.banking.importStatement([line("ITNS 281 TDS CHALLAN OLTAS 0512345", "-14500", "R2")], "priya");
    expect(counterAccount(org)).toBe("acc_taxes_payable");
  });

  it("lets a payee rule outrank a format word, so a vendor's charges stay with the vendor", () => {
    const org = books();
    org.banking.importStatement([line("NEFT DR-LINKEDIN TECHNOLOGY-PREMIUM CHARGES", "-8400")], "priya");
    expect(counterAccount(org)).toBe("acc_marketing");
  });

  it("does not consult staples for an import recorded under the old policy", () => {
    const org = books();
    const r = org.banking.importStatement([line("SMS CHARGES QTR SEP-26", "-17.70")], "priya", "acc_bank", 1);
    expect(r.posted).toHaveLength(0);
  });
});

describe("history keeps the rules it ran under", () => {
  it("records the current policy on every new import", async () => {
    const store = new MemoryActionStore();
    const rt = await PaisaRuntime.open({ orgId: "org_policy_new", name: "New", firstPeriod: "2026-01", store });
    await rt.execute("banking.importStatement", { lines: [line("SMS CHARGES QTR SEP-26", "-17.70")] }, "priya");
    expect(store.all().at(-1)!.action.payload.policy).toBe(2);
  });

  it("replays an import recorded before policies existed exactly as it originally booked", async () => {
    const store = new MemoryActionStore();
    // The shape the log held before this change: no policy field.
    await store.append("org_policy_old", {
      type: "banking.importStatement",
      payload: { lines: [line("INTEREST DEBITED OD A/C", "-6420")] },
      actor: "priya",
    });

    const rt = await PaisaRuntime.open({ orgId: "org_policy_old", name: "Old", firstPeriod: "2026-01", store });
    expect(rt.org.banking.pendingReview()).toHaveLength(0);
    const booked = rt.org.journal.all().find((e) => e.referenceId === "R1")!;
    expect(booked.lines.map((l) => l.accountId)).toContain("acc_interest_income");
  });
});
