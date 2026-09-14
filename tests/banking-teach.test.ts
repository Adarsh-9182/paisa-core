/**
 * One-tap confirm: a keyword earns a rule from agreeing confirmations, loses
 * it when a person contradicts it, and a learned rule holds back an amount
 * unlike anything it was confirmed on.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR, suggestKeyword } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";

const books = () => new Platform().createOrganization(`teach_${Math.random().toString(36).slice(2)}`, "Teach Traders");

const line = (description: string, amount: string, reference: string, date = "2026-07-15") => ({
  reference,
  date,
  description,
  amount: parseINR(amount),
});

const TOKAI = (n: number) => `POS 416021XXXXXX4821 BLUE TOKAI OUTLET ${n}`;

describe("confirm", () => {
  it("books the line on every confirmation, and learns only when a second one agrees", () => {
    const org = books();
    org.banking.importStatement([line(TOKAI(1), "-1840", "T1", "2026-04-11")], "priya");
    const first = org.banking.confirm("T1", "acc_meals", "priya", "blue tokai");
    expect(first.learned).toBe(false);
    expect(org.ledger.balance("acc_meals", "2026-04-30")).toBe(parseINR("1840"));

    org.banking.importStatement([line(TOKAI(2), "-2120", "T2", "2026-05-11")], "priya");
    expect(org.banking.pendingReview()).toHaveLength(1);
    expect(org.banking.confirm("T2", "acc_meals", "priya", "blue tokai").learned).toBe(true);

    const june = org.banking.importStatement([line(TOKAI(3), "-1760", "T3", "2026-06-11")], "priya");
    expect(june.posted).toHaveLength(1);
    expect(org.banking.stats().learned).toBe(1);
  });

  it("never learns a keyword two confirmations disagreed on", () => {
    const org = books();
    const rahul = (n: number, date: string) => line(`UPI-RAHUL VERMA-rahulv@ybl-NOTE ${n}`, "-1000", `R${n}`, date);
    org.banking.importStatement([rahul(1, "2026-04-19")], "priya");
    org.banking.confirm("R1", "acc_travel", "priya", "rahul verma");
    org.banking.importStatement([rahul(2, "2026-05-19")], "priya");
    org.banking.confirm("R2", "acc_meals", "priya", "rahul verma");
    org.banking.importStatement([rahul(3, "2026-06-19")], "priya");
    org.banking.confirm("R3", "acc_meals", "priya", "rahul verma");
    org.banking.importStatement([rahul(4, "2026-07-19")], "priya");
    expect(org.banking.pendingReview()).toHaveLength(1);
  });

  it("holds back an amount far outside what the rule was confirmed on, and books normal drift", () => {
    const org = books();
    const amazon = (n: number, amount: string, date: string) =>
      line(`UPI-AMAZON PAY INDIA-amazonpay@apl-ORDER ${n}`, amount, `A${n}`, date);
    org.banking.importStatement([amazon(1, "-3499", "2026-04-16")], "priya");
    org.banking.confirm("A1", "acc_office_supplies", "priya", "amazonpay@apl");
    org.banking.importStatement([amazon(2, "-2199", "2026-05-16")], "priya");
    org.banking.confirm("A2", "acc_office_supplies", "priya", "amazonpay@apl");

    const drift = org.banking.importStatement([amazon(3, "-5200", "2026-06-02")], "priya");
    expect(drift.posted).toHaveLength(1);

    org.banking.importStatement([amazon(4, "-45990", "2026-06-16")], "priya");
    const [held] = org.banking.reviewQueueWithReasons();
    expect(held!.reason).toEqual({
      kind: "unusual_amount",
      accountId: "acc_office_supplies",
      keyword: "amazonpay@apl",
      usualMin: parseINR("2199"),
      usualMax: parseINR("5200"),
    });
  });

  it("withdraws a learned rule the moment a person contradicts it", () => {
    const org = books();
    const amazon = (n: number, amount: string, date: string) =>
      line(`UPI-AMAZON PAY INDIA-amazonpay@apl-ORDER ${n}`, amount, `A${n}`, date);
    org.banking.importStatement([amazon(1, "-3499", "2026-04-16")], "priya");
    org.banking.confirm("A1", "acc_office_supplies", "priya", "amazonpay@apl");
    org.banking.importStatement([amazon(2, "-2199", "2026-05-16")], "priya");
    org.banking.confirm("A2", "acc_office_supplies", "priya", "amazonpay@apl");
    org.banking.importStatement([amazon(3, "-45990", "2026-06-16")], "priya");

    expect(org.banking.confirm("A3", "acc_equipment", "priya", "amazonpay@apl").withdrawn).toBe(true);
    const july = org.banking.importStatement([amazon(4, "-2500", "2026-07-16")], "priya");
    expect(july.posted).toHaveLength(0);
  });

  it("refuses a keyword that is not in the line before anything posts", () => {
    const org = books();
    org.banking.importStatement([line(TOKAI(1), "-1840", "T1")], "priya");
    expect(() => org.banking.confirm("T1", "acc_meals", "priya", "zomato")).toThrow(/does not appear/);
    expect(org.banking.pendingReview()).toHaveLength(1);
  });
});

describe("the same payee with a different tail", () => {
  const confirmWithProposal = (org: ReturnType<typeof books>, ref: string, accountId: string) => {
    const [q] = org.banking.reviewQueueWithReasons().filter((x) => x.line.reference === ref);
    return org.banking.confirm(ref, accountId, "priya", suggestKeyword(q!.line.description) ?? undefined);
  };

  it("learns the words two outlets share", () => {
    const org = books();
    org.banking.importStatement([line("POS 416021XXXXXX4821 BLUE TOKAI KORAMANGALA", "-1840", "B1", "2026-04-11")], "priya");
    confirmWithProposal(org, "B1", "acc_meals");
    org.banking.importStatement([line("POS 416021XXXXXX4821 BLUE TOKAI INDIRANAGAR", "-2120", "B2", "2026-05-11")], "priya");
    expect(confirmWithProposal(org, "B2", "acc_meals").learned).toBe(true);

    const june = org.banking.importStatement([line("POS 416021XXXXXX4821 BLUE TOKAI HSR", "-1760", "B3", "2026-06-11")], "priya");
    expect(june.posted).toHaveLength(1);
  });

  it("keeps two businesses apart when they share a prefix but not an account", () => {
    const org = books();
    org.banking.importStatement([line("NEFT DR-SHREE GANESH STEEL-INV", "-24500", "G1", "2026-04-13")], "priya");
    confirmWithProposal(org, "G1", "acc_inventory");
    org.banking.importStatement([line("NEFT DR-SHREE GANESH TRAVELS-BUS", "-4500", "G2", "2026-05-13")], "priya");
    expect(confirmWithProposal(org, "G2", "acc_travel").learned).toBe(false);
    org.banking.importStatement([line("NEFT DR-SHREE GANESH TRAVELS-BUS", "-4200", "G3", "2026-06-13")], "priya");
    expect(org.banking.pendingReview()).toHaveLength(1);
  });

  it("never pools two people who share only a first name", () => {
    const org = books();
    org.banking.importStatement([line("UPI-RAHUL VERMA-CAB", "-900", "P1", "2026-04-19")], "priya");
    org.banking.confirm("P1", "acc_travel", "priya", "rahul verma");
    org.banking.importStatement([line("UPI-RAHUL SHARMA-CAB", "-700", "P2", "2026-05-19")], "priya");
    expect(org.banking.confirm("P2", "acc_travel", "priya", "rahul sharma").learned).toBe(false);
  });
});

describe("history under policy 4", () => {
  it("replays confirmations and the amount guard from the log", async () => {
    const store = new MemoryActionStore();
    const rt = await PaisaRuntime.open({ orgId: "org_teach_replay", name: "Replay", firstPeriod: "2026-01", store });
    const amazon = (n: number, amount: string, date: string) =>
      line(`UPI-AMAZON PAY INDIA-amazonpay@apl-ORDER ${n}`, amount, `A${n}`, date);
    await rt.execute("banking.importStatement", { lines: [amazon(1, "-3499", "2026-04-16")] }, "priya");
    await rt.execute("banking.confirm", { reference: "A1", accountId: "acc_office_supplies", keyword: "amazonpay@apl" }, "priya");
    await rt.execute("banking.importStatement", { lines: [amazon(2, "-2199", "2026-05-16")] }, "priya");
    await rt.execute("banking.confirm", { reference: "A2", accountId: "acc_office_supplies", keyword: "amazonpay@apl" }, "priya");
    await rt.execute("banking.importStatement", { lines: [amazon(3, "-45990", "2026-06-16")] }, "priya");
    expect(store.all().at(-1)!.action.payload.policy).toBe(4);

    const reopened = await PaisaRuntime.open({ orgId: "org_teach_replay", name: "Replay", firstPeriod: "2026-01", store });
    expect(reopened.org.banking.reviewQueueWithReasons().map((q) => q.reason.kind)).toEqual(["unusual_amount"]);
  });

  it("an import recorded under policy 3 books past a learned rule's amounts, as it did then", () => {
    const org = books();
    const amazon = (n: number, amount: string, date: string) =>
      line(`UPI-AMAZON PAY INDIA-amazonpay@apl-ORDER ${n}`, amount, `A${n}`, date);
    org.banking.importStatement([amazon(1, "-3499", "2026-04-16")], "priya");
    org.banking.confirm("A1", "acc_office_supplies", "priya", "amazonpay@apl");
    org.banking.importStatement([amazon(2, "-2199", "2026-05-16")], "priya");
    org.banking.confirm("A2", "acc_office_supplies", "priya", "amazonpay@apl");
    expect(org.banking.importStatement([amazon(3, "-45990", "2026-06-16")], "priya", "acc_bank", 3).posted).toHaveLength(1);
  });
});

describe("proposed keywords", () => {
  it("leave out codes that mix letters and digits", () => {
    expect(suggestKeyword("POS 416021XXXXXX4821 BLUE TOKAI KORAMANGALA")).toBe("blue tokai koramangala");
    expect(suggestKeyword("NEFT DR-ICIC0001234-PRIYA MENON-NETBANK, MUM-N118260455901-SAL APR26")).toBe("priya menon-netbank");
    expect(suggestKeyword("EMI 4455621 CHQ S3120045 0426")).toBe(null);
  });
});
