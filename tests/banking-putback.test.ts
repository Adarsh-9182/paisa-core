/**
 * Putting a wrong booking back: the entry is reversed, the line returns to
 * review, a keyword that booked it is withdrawn, and a person's own slip
 * stops counting towards learning. Plus the per-month pilot numbers.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";

const books = () => new Platform().createOrganization(`pb_${Math.random().toString(36).slice(2)}`, "Put Back Traders");

const line = (description: string, amount: string, reference: string, date = "2026-07-15") => ({
  reference,
  date,
  description,
  amount: parseINR(amount),
});

const entryFor = (org: ReturnType<typeof books>, reference: string) =>
  org.banking.bookedLines().find((b) => b.line.reference === reference)!;

/** Two agreeing confirmations, so "blue tokai" is a learned rule. */
const learnedTokai = () => {
  const org = books();
  org.banking.importStatement([line("POS BLUE TOKAI 1", "-1800", "T1", "2026-04-11")], "priya");
  org.banking.confirm("T1", "acc_meals", "priya", "blue tokai");
  org.banking.importStatement([line("POS BLUE TOKAI 2", "-2000", "T2", "2026-05-11")], "priya");
  org.banking.confirm("T2", "acc_meals", "priya", "blue tokai");
  return org;
};

describe("putBack", () => {
  it("reverses a line that booked itself and returns it to review", () => {
    const org = books();
    org.banking.importStatement([line("SMS CHARGES QTR", "-17.70", "S1")], "priya");
    const booked = entryFor(org, "S1");
    expect(booked.by).toBe("rule");

    const { reversal } = org.banking.putBack(booked.entryId, "priya");
    expect(reversal.reverses).toBe(booked.entryId);
    expect(org.ledger.balance("acc_bank_charges", "2026-07-31")).toBe(0n);
    expect(org.banking.reviewQueueWithReasons()).toEqual([
      { line: booked.line, reason: { kind: "put_back", previousAccountId: "acc_bank_charges" } },
    ]);
    expect(org.banking.bookedLines()).toHaveLength(0);
    expect(org.banking.stats()).toMatchObject({ putBack: 1, putBackAfterBookingItself: 1 });

    // Book it again, correctly this time.
    org.banking.confirm("S1", "acc_professional", "priya");
    expect(entryFor(org, "S1").accountId).toBe("acc_professional");
  });

  it("withdraws the learned keyword that booked a wrong line, for good", () => {
    const org = learnedTokai();
    org.banking.importStatement([line("POS BLUE TOKAI 3", "-1900", "T3", "2026-06-11")], "priya");
    const { withdrawnRule } = org.banking.putBack(entryFor(org, "T3").entryId, "priya", "was a client gift");
    expect(withdrawnRule).toBe("blue tokai");

    org.banking.confirm("T3", "acc_marketing", "priya", "blue tokai");
    org.banking.importStatement([line("POS BLUE TOKAI 4", "-1900", "T4", "2026-07-11")], "priya");
    expect(org.banking.pendingReview().map((l) => l.reference)).toEqual(["T4"]);
  });

  it("stops a person's own mistaken confirmation counting towards a keyword", () => {
    const org = books();
    org.banking.importStatement([line("POS BLUE TOKAI 1", "-1800", "T1", "2026-04-11")], "priya");
    org.banking.confirm("T1", "acc_travel", "priya", "blue tokai"); // slip
    org.banking.putBack(entryFor(org, "T1").entryId, "priya");
    org.banking.confirm("T1", "acc_meals", "priya", "blue tokai");

    org.banking.importStatement([line("POS BLUE TOKAI 2", "-2000", "T2", "2026-05-11")], "priya");
    expect(org.banking.confirm("T2", "acc_meals", "priya", "blue tokai").learned).toBe(true);
  });

  it("refuses an entry that is not a standing bank line", () => {
    const org = books();
    org.banking.importStatement([line("SMS CHARGES QTR", "-17.70", "S1")], "priya");
    const { entryId } = entryFor(org, "S1");
    org.banking.putBack(entryId, "priya");
    expect(() => org.banking.putBack(entryId, "priya")).toThrow(/not a bank line that stands booked/);
    expect(() => org.banking.putBack("je_nope", "priya")).toThrow(/not a bank line/);
  });

  it("replays from the log", async () => {
    const store = new MemoryActionStore();
    const rt = await PaisaRuntime.open({ orgId: "org_putback_replay", name: "Replay", firstPeriod: "2026-01", store });
    await rt.execute("banking.importStatement", { lines: [line("SMS CHARGES QTR", "-17.70", "S1")] }, "priya");
    const { entryId } = rt.org.banking.bookedLines()[0]!;
    await rt.execute("banking.putBack", { entryId }, "priya");
    await rt.execute("banking.recordReviewSession", { seconds: 95, lines: 1, month: "2026-07" }, "priya");

    const again = await PaisaRuntime.open({ orgId: "org_putback_replay", name: "Replay", firstPeriod: "2026-01", store });
    expect(again.org.banking.reviewQueueWithReasons()[0]!.reason.kind).toBe("put_back");
    expect(again.org.banking.monthly()[0]).toMatchObject({ month: "2026-07", putBack: 1, reviewSessions: 1 });
    expect(again.skippedActions()).toEqual([]);
  });
});

describe("monthly pilot numbers", () => {
  it("counts lines, self-bookings, confirmations and put-backs by the lines' month", () => {
    const org = learnedTokai();
    org.banking.importStatement(
      [line("POS BLUE TOKAI 3", "-1900", "T3", "2026-06-11"), line("SMS CHARGES QTR", "-17.70", "S1", "2026-06-30")],
      "priya",
    );
    org.banking.putBack(entryFor(org, "T3").entryId, "priya");
    const [june, may, april] = org.banking.monthly();
    expect(june).toMatchObject({ month: "2026-06", lines: 2, bookedItself: 2, confirmed: 0, putBack: 1, putBackAfterBookingItself: 1 });
    expect(may).toMatchObject({ month: "2026-05", lines: 1, bookedItself: 0, confirmed: 1 });
    expect(april).toMatchObject({ month: "2026-04", lines: 1, confirmed: 1 });
  });

  it("reports the median visible minutes to clear review, and refuses implausible sessions", () => {
    const org = books();
    org.banking.importStatement([line("SMS CHARGES QTR", "-17.70", "S1")], "priya");
    org.banking.recordReviewSession(240, 12, "2026-07", "priya");
    org.banking.recordReviewSession(420, 9, "2026-07", "priya");
    org.banking.recordReviewSession(600, 20, "2026-07", "priya");
    expect(org.banking.monthly()[0]).toMatchObject({ reviewSessions: 3, medianReviewMinutes: 7 });
    expect(() => org.banking.recordReviewSession(0, 3, "2026-07", "priya")).toThrow(/between 1 second and 6 hours/);
    expect(() => org.banking.recordReviewSession(60, 0, "2026-07", "priya")).toThrow(/at least one line/);
    expect(() => org.banking.recordReviewSession(60, 3, "July", "priya")).toThrow(/not a month/);
  });
});
