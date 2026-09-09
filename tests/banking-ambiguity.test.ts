/**
 * When two rules disagree about the same bank line.
 *
 * `match` ranked by keyword length and, on a tie, let the later rule win.
 * The reasoning was sound and is preserved: defaults are constructed first
 * and taught rules appended, so "later" meant "a person taught this", and a
 * person outranks a default.
 *
 * It stopped being sound when two *taught* rules were equally specific and
 * named different accounts. Then the winner was whichever happened to be
 * added last, so teaching a new rule could silently re-book descriptions
 * that already matched an old one — and nothing anywhere said it had
 * happened.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";

const line = (description: string, reference = "R1") => ({
  reference,
  date: "2026-04-01",
  description,
  amount: parseINR("-500"),
});

const books = (id: string) => new Platform().createOrganization(id, "Nimbus Labs");

describe("two equally specific rules that disagree", () => {
  it("asks instead of picking, whichever order they were taught in", () => {
    for (const [first, second] of [
      ["swiggy", "zomato"],
      ["zomato", "swiggy"],
    ] as const) {
      const org = books(`amb_${first}`);
      org.banking.addRule({ keyword: first, accountId: "acc_software", label: "A" });
      org.banking.addRule({ keyword: second, accountId: "acc_travel", label: "B" });

      const r = org.banking.importStatement([line("UPI swiggy zomato combined")], "priya");

      expect(r.posted, `${first} then ${second} must not book itself`).toHaveLength(0);
      expect(r.needsReview).toHaveLength(1);
    }
  });

  it("says the line is ambiguous, and names what disagreed", () => {
    const org = books("amb_reason");
    org.banking.addRule({ keyword: "swiggy", accountId: "acc_software", label: "A" });
    org.banking.addRule({ keyword: "zomato", accountId: "acc_travel", label: "B" });
    org.banking.importStatement([line("UPI swiggy zomato combined")], "priya");

    const [queued] = org.banking.reviewQueueWithReasons();
    expect(queued!.reason.kind).toBe("ambiguous");
    if (queued!.reason.kind === "ambiguous") {
      expect([...queued!.reason.keywords].sort()).toEqual(["swiggy", "zomato"]);
      expect([...queued!.reason.accounts].sort()).toEqual(["acc_software", "acc_travel"]);
    }
  });

  it("still books when the tied rules agree on the account", () => {
    const org = books("amb_agree");
    org.banking.addRule({ keyword: "swiggy", accountId: "acc_software", label: "A" });
    org.banking.addRule({ keyword: "zomato", accountId: "acc_software", label: "B" });

    const r = org.banking.importStatement([line("UPI swiggy zomato combined")], "priya");
    expect(r.posted, "two keywords can both be right about one expense").toHaveLength(1);
  });
});

describe("what the tie-break was always meant to do, now stated outright", () => {
  it("a taught rule still beats a default of the same length", () => {
    const org = books("amb_authority");
    // A default, as the constructor would supply it.
    org.banking.addRule({ keyword: "google", accountId: "acc_software", label: "Default", taught: false });
    // A person correcting it, same specificity.
    org.banking.addRule({ keyword: "google", accountId: "acc_travel", label: "Taught" });

    const r = org.banking.importStatement([line("google payment")], "priya");
    expect(r.posted, "the person's rule must win, not go to review").toHaveLength(1);
    expect(r.posted[0]!.label).toBe("Taught");
  });

  it("a longer keyword still beats a shorter one", () => {
    const org = books("amb_longest");
    org.banking.addRule({ keyword: "google", accountId: "acc_travel", label: "Short" });
    org.banking.addRule({ keyword: "google cloud", accountId: "acc_software", label: "Long" });

    const r = org.banking.importStatement([line("google cloud invoice")], "priya");
    expect(r.posted[0]!.label).toBe("Long");
  });

  it("a line no rule matches still says so, and says nothing more", () => {
    const org = books("amb_norule");
    org.banking.importStatement([line("SOMETHING NOBODY TAUGHT")], "priya");
    expect(org.banking.reviewQueueWithReasons()[0]!.reason.kind).toBe("no_rule");
  });
});

describe("the honest cost", () => {
  it("lowers the auto-book rate rather than booking a coin flip", () => {
    const org = books("amb_rate");
    org.banking.addRule({ keyword: "swiggy", accountId: "acc_software", label: "A" });
    org.banking.addRule({ keyword: "zomato", accountId: "acc_travel", label: "B" });

    org.banking.importStatement(
      [line("UPI swiggy zomato combined", "R1"), line("UPI swiggy only", "R2")],
      "priya",
    );

    const stats = org.banking.stats();
    expect(stats.posted).toBe(1);
    expect(stats.needsReview).toBe(1);
    // 50% and trustworthy beats 100% where half of it was decided by
    // insertion order.
    expect(stats.autoBookedPct).toBe(50);
  });
});
