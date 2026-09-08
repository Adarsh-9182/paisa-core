/**
 * Standing authority — the bounds that let work finish unattended.
 *
 * Every test here is a refusal a controller would want to see happen. The
 * approval path is stubbed rather than driven through a real ledger, because
 * what is under test is the decision to approve, not the posting — the
 * posting is `AgentEngine.approve()`, which is covered where it lives.
 */

import { describe, it, expect, vi } from "vitest";
import { paise, ZERO, type Paise } from "../src/money.js";
import { EventBus } from "../src/events.js";
import {
  AuthorityRegistry,
  AuthorityError,
  refusalFor,
  actorFor,
  type StandingAuthority,
} from "../src/erp/authority.js";
import type { Proposal, ProposalKind } from "../src/erp/agents.js";

const RS = (n: number) => paise(BigInt(n) * 100n) as Paise;

let seq = 0;
function proposal(over: Partial<Proposal> = {}): Proposal {
  const amount = over.proposedEntry?.amount ?? RS(1_000);
  return {
    id: `p${++seq}`,
    kind: "MISSING_RECOGNITION" as ProposalKind,
    severity: "LOW",
    period: "2026-03",
    title: "Prepaid insurance — March share",
    rationale: "One month of a twelve-month policy.",
    amount,
    evidence: [],
    proposedEntry: {
      date: "2026-03-31",
      narration: "Prepaid insurance amortisation",
      debitAccountId: "expense.insurance",
      creditAccountId: "asset.prepaid",
      amount,
      sourceModule: "schedules",
    },
    status: "OPEN",
    raisedAt: "2026-03-31T00:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    resultingEntryId: null,
    ...over,
  } as Proposal;
}

/** A registry whose approvals are recorded rather than posted. */
function harness(opts: { periodStatus?: string; reversed?: Set<string> } = {}) {
  const approvals: { id: string; actor: string }[] = [];
  const reversed = opts.reversed ?? new Set<string>();
  let entryNo = 0;
  const bus = new EventBus();
  const events: string[] = [];
  bus.on("*", (e) => events.push(e.type));

  const registry = new AuthorityRegistry(
    "org1",
    {
      approve(id, actor) {
        approvals.push({ id, actor });
        return { ...proposal({ id }), status: "APPROVED", decidedBy: actor, resultingEntryId: `e${++entryNo}` };
      },
      periodStatus: () => opts.periodStatus ?? "OPEN",
      isReversed: (id) => reversed.has(id),
    },
    bus,
    () => new Date("2026-04-01T00:00:00.000Z"),
  );
  return { registry, approvals, events, reversed };
}

const GRANT = {
  kind: "MISSING_RECOGNITION" as ProposalKind,
  maxAmount: RS(50_000),
  maxPerSweep: RS(200_000),
  note: "Prepaid amortisation is arithmetic over a schedule; approve it up to ₹50,000 a posting.",
};

describe("granting", () => {
  it("refuses a grant with no stated reason", () => {
    const { registry } = harness();
    expect(() => registry.grant({ ...GRANT, note: "   " }, "priya")).toThrow(AuthorityError);
  });

  it("refuses a sweep ceiling below the per-posting ceiling, which would block everything", () => {
    const { registry } = harness();
    expect(() => registry.grant({ ...GRANT, maxPerSweep: RS(1_000) }, "priya")).toThrow(AuthorityError);
  });

  it("records who granted it, and says so in the actor that reaches the ledger", () => {
    const { registry, events } = harness();
    const a = registry.grant(GRANT, "priya");
    expect(a.grantedBy).toBe("priya");
    expect(actorFor(a)).toBe(`standing-authority:${a.id}`);
    expect(events).toContain("authority.granted");
  });
});

describe("what it refuses, and why", () => {
  const base = (over: Partial<StandingAuthority> = {}): StandingAuthority => ({
    id: "auth_1",
    kind: "MISSING_RECOGNITION",
    maxAmount: RS(50_000),
    maxPerSweep: RS(200_000),
    accounts: null,
    grantedBy: "priya",
    grantedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    note: "n",
    ...over,
  });
  const ctx = { periodStatus: () => "OPEN", spentThisSweep: ZERO as Paise, now: "2026-04-01T00:00:00.000Z" };

  it("takes a proposal that sits inside every bound", () => {
    expect(refusalFor(base(), proposal(), ctx)).toBeNull();
  });

  it("will not approve a finding that carries no entry — that needs a decision", () => {
    const r = refusalFor(base(), proposal({ proposedEntry: null }), ctx);
    expect(r).toMatch(/needs a decision/);
  });

  it("will not cross into another kind of finding", () => {
    const r = refusalFor(base(), proposal({ kind: "UNUSUAL_AMOUNT" as ProposalKind }), ctx);
    expect(r).toMatch(/covers MISSING_RECOGNITION/);
  });

  it("stops at the per-posting ceiling", () => {
    const big = proposal({ proposedEntry: { ...proposal().proposedEntry!, amount: RS(50_001) } });
    expect(refusalFor(base(), big, ctx)).toMatch(/per-posting limit/);
  });

  it("stops at the sweep ceiling, counting what it has already spent", () => {
    const r = refusalFor(base(), proposal(), { ...ctx, spentThisSweep: RS(199_500) });
    expect(r).toMatch(/limit for one sweep/);
  });

  it("stays inside its accounts", () => {
    const r = refusalFor(base({ accounts: ["asset.prepaid", "expense.rent"] }), proposal(), ctx);
    expect(r).toMatch(/outside this authority's accounts/);
  });

  it("stands aside once the period is no longer open", () => {
    const r = refusalFor(base(), proposal(), { ...ctx, periodStatus: () => "SOFT_CLOSED" });
    expect(r).toMatch(/a person should decide during a close/);
  });

  it("is dead once revoked", () => {
    const r = refusalFor(base({ revokedAt: "2026-02-01T00:00:00.000Z" }), proposal(), ctx);
    expect(r).toMatch(/revoked/);
  });

  it("is dead once expired", () => {
    const r = refusalFor(base({ expiresAt: "2026-03-01" }), proposal(), ctx);
    expect(r).toMatch(/expired/);
  });
});

describe("settling a queue", () => {
  it("approves what it covers and leaves the rest with a reason", () => {
    const { registry, approvals } = harness();
    registry.grant(GRANT, "priya");

    const covered = proposal();
    const tooBig = proposal({ proposedEntry: { ...proposal().proposedEntry!, amount: RS(80_000) } });
    const otherKind = proposal({ kind: "STALE_RECEIVABLE" as ProposalKind });

    const result = registry.settle([covered, tooBig, otherKind]);

    expect(result.approved.map((a) => a.proposalId)).toEqual([covered.id]);
    expect(approvals[0]!.actor).toMatch(/^standing-authority:/);
    expect(result.refused.find((r) => r.proposalId === tooBig.id)!.reason).toMatch(/per-posting limit/);
    expect(result.refused.find((r) => r.proposalId === otherKind.id)!.reason).toMatch(/no standing authority/);
  });

  it("spends the sweep allowance on the small ones and leaves the large ones for a person", () => {
    const { registry } = harness();
    registry.grant({ ...GRANT, maxPerSweep: RS(60_000) }, "priya");

    const small = proposal({ proposedEntry: { ...proposal().proposedEntry!, amount: RS(10_000) } });
    const medium = proposal({ proposedEntry: { ...proposal().proposedEntry!, amount: RS(20_000) } });
    const large = proposal({ proposedEntry: { ...proposal().proposedEntry!, amount: RS(45_000) } });

    const result = registry.settle([large, medium, small]);

    expect(result.approved.map((a) => a.proposalId).sort()).toEqual([medium.id, small.id].sort());
    expect(result.refused.map((r) => r.proposalId)).toEqual([large.id]);
    expect(result.totalApproved).toBe(RS(30_000));
  });

  it("does nothing at all once the grant is revoked", () => {
    const { registry, approvals } = harness();
    const a = registry.grant(GRANT, "priya");
    registry.revoke(a.id, "priya");

    const result = registry.settle([proposal()]);
    expect(approvals).toHaveLength(0);
    expect(result.refused[0]!.reason).toMatch(/revoked/);
  });

  it("ignores proposals a person has already decided", () => {
    const { registry, approvals } = harness();
    registry.grant(GRANT, "priya");
    registry.settle([proposal({ status: "APPROVED" }), proposal({ status: "DISMISSED" })]);
    expect(approvals).toHaveLength(0);
  });
});

describe("the trust number", () => {
  it("counts postings made under a grant, and how many a human undid", () => {
    const reversed = new Set<string>();
    const { registry } = harness({ reversed });
    registry.grant(GRANT, "priya");

    registry.settle([proposal(), proposal()]);
    expect(registry.stats()).toMatchObject({ granted: 1, active: 1, approved: 2, reversed: 0 });

    // A controller reverses one of them the next morning.
    reversed.add("e1");
    expect(registry.stats().reversed).toBe(1);
  });

  it("stops counting a revoked grant as active", () => {
    const { registry } = harness();
    const a = registry.grant(GRANT, "priya");
    registry.revoke(a.id, "priya");
    expect(registry.stats()).toMatchObject({ granted: 1, active: 0 });
  });
});

/* ==================================================================== */
/* End to end: a finding reaches the ledger with nobody at the keyboard  */
/* ==================================================================== */

/**
 * A company whose hosting vendor bills every month, and then does not.
 *
 * That is what MISSING_ACCRUAL is for and it is the only agent that proposes
 * an entry, so it is the only one a standing authority can settle. The first
 * version of this test asserted against a bare org, where nothing was raised
 * at all — every assertion passed over an empty queue and proved nothing.
 */
async function companyWithAMissedBill() {
  const { Platform, parseINR } = await import("../src/index.js");
  const { attachErp } = await import("../src/erp/suite.js");

  const platform = new Platform();
  const org = platform.createOrganization(`org_${++seq}`, "Nimbus Labs");
  const erp = attachErp(org, { firstPeriod: "2026-01" });

  org.journal.post({
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
    createdBy: "priya",
  });

  // Three months of the same bill establishes the pattern the agent looks for.
  for (const month of ["01", "02", "03"]) {
    const b = erp.bills.create(
      {
        number: `AWS-${month}`,
        vendor: "AWS India",
        billDate: `2026-${month}-05`,
        dueDate: `2026-${month}-25`,
        lines: [
          { description: "Hosting", amount: parseINR("20,000"), expenseAccountId: "acc_software", gstRatePct: 18, itcEligible: true },
        ],
      },
      "priya",
    );
    erp.bills.submit(b.id, "priya");
    erp.bills.approve(b.id, "raj");
  }

  return { org, erp, parseINR };
}

describe("through the real suite", () => {
  it("posts the accrual the agent proposed, attributed to the grant and not to a person", async () => {
    const { org, erp, parseINR } = await companyWithAMissedBill();

    // April: AWS did not bill. The agent notices.
    const raised = erp.agents.scan("2026-04", "priya");
    const accrual = raised.find((p) => p.kind === "MISSING_ACCRUAL");
    expect(accrual, "the scenario must actually raise an accrual, or this test proves nothing").toBeDefined();
    expect(accrual!.proposedEntry).not.toBeNull();

    const before = org.journal.all().length;

    const grant = erp.authority.grant(
      {
        kind: "MISSING_ACCRUAL",
        maxAmount: parseINR("50,000"),
        maxPerSweep: parseINR("2,00,000"),
        note: "A recurring vendor's monthly accrual reverses next month when the invoice lands.",
      },
      "priya",
    );

    const settled = erp.authority.settle(erp.agents.open());

    // It took the accrual, and the ledger moved.
    expect(settled.approved.map((a) => a.proposalId)).toContain(accrual!.id);
    expect(org.journal.all().length).toBeGreaterThan(before);

    // And the entry names the authority, so "who approved this" resolves to
    // a grant with a person's name on it rather than to nobody.
    const posted = settled.approved.find((a) => a.proposalId === accrual!.id)!;
    const entry = org.journal.get(posted.entryId!);
    expect(entry.createdBy).toBe(`standing-authority:${grant.id}`);
    expect(erp.authority.get(grant.id)!.grantedBy).toBe("priya");

    expect(erp.authority.stats()).toMatchObject({ granted: 1, active: 1, approved: 1, reversed: 0 });
  });

  it("counts it as reversed once a controller undoes it — the number that says widen or narrow", async () => {
    const { org, erp, parseINR } = await companyWithAMissedBill();
    erp.agents.scan("2026-04", "priya");
    erp.authority.grant(
      { kind: "MISSING_ACCRUAL", maxAmount: parseINR("50,000"), maxPerSweep: parseINR("2,00,000"), note: "n" },
      "priya",
    );

    const settled = erp.authority.settle(erp.agents.open());
    const entryId = settled.approved.find((a) => a.entryId)!.entryId!;
    expect(erp.authority.stats().reversed).toBe(0);

    org.journal.reverse(entryId, "priya", "Invoice arrived after all");
    expect(erp.authority.stats().reversed).toBe(1);
  });

  it("without a grant the same finding waits for a person, and the ledger does not move", async () => {
    const { org, erp } = await companyWithAMissedBill();
    erp.agents.scan("2026-04", "priya");

    const before = org.journal.all().length;
    const settled = erp.authority.settle(erp.agents.open());

    expect(settled.approved).toHaveLength(0);
    expect(org.journal.all().length).toBe(before);
    expect(settled.refused.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("a grant that is too small to cover the accrual leaves it, and says the amount", async () => {
    const { org, erp, parseINR } = await companyWithAMissedBill();
    erp.agents.scan("2026-04", "priya");
    erp.authority.grant(
      { kind: "MISSING_ACCRUAL", maxAmount: parseINR("100"), maxPerSweep: parseINR("1,000"), note: "n" },
      "priya",
    );

    const before = org.journal.all().length;
    const settled = erp.authority.settle(erp.agents.open());

    expect(settled.approved).toHaveLength(0);
    expect(org.journal.all().length).toBe(before);
    expect(settled.refused.some((r) => /per-posting limit/.test(r.reason))).toBe(true);
  });
});
