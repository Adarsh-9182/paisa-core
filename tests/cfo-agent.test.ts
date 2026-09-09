/**
 * The standing CFO agent.
 *
 * What is under test is mostly what it refuses to do. An agent that runs
 * unasked is only safe if it cannot invent authority, cannot claim work it
 * did not do, and cannot flood the person it reports to — so those are the
 * assertions, and the happy path is the small part.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { CfoAgent, describeRun, CfoContext } from "../src/erp/cfo-agent.js";
import { ZERO } from "../src/money.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";

const ACTOR = "priya";
const ASOF = "2026-06-30";

/** A company with money owed to it, and a month that will not close itself. */
const company = (orgId: string) => {
  const platform = new Platform();
  const org = platform.createOrganization(orgId, "Nimbus Labs");
  const erp = attachErp(org, { firstPeriod: "2026-01" });

  org.journal.post({
    date: "2026-01-01",
    narration: "Founder capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
    ],
    sourceModule: "manual",
    createdBy: ACTOR,
  });
  return { org, erp };
};

const overdueInvoice = (org: any, number: string, customer: string, issueDate: string, dueDate: string, amount: string) => {
  const inv = org.invoices.create(
    {
      number,
      customer,
      issueDate,
      dueDate,
      lines: [{ description: "Retainer", amount: parseINR(amount), gstRatePct: 18 }],
    },
    ACTOR,
  );
  org.invoices.send(inv.id, ACTOR);
  return inv;
};

describe("CfoAgent", () => {
  it("drafts reminders for what is late, and never sends anything", () => {
    const { org, erp } = company("org_cfo1");
    overdueInvoice(org, "INV-101", "Acme", "2026-04-01", "2026-04-20", "3,00,000");

    const before = org.journal.all().length;
    const run = erp.cfo.run(ASOF, "cfo-agent");

    const receivables = run.plays.find((p) => p.play === "receivables")!;
    expect(receivables.did.length).toBe(1);
    expect(receivables.did[0]).toContain("Acme");

    const drafts = org.actions.pending();
    expect(drafts.map((a: { kind: string }) => a.kind)).toContain("payment_reminder");
    expect(drafts.every((a: { status: string }) => a.status === "pending")).toBe(true);
    expect(org.journal.all().length, "an unasked run must not post to the ledger").toBe(before);
  });

  it("does not draft a second reminder for an invoice already waiting on someone", () => {
    const { org, erp } = company("org_cfo2");
    overdueInvoice(org, "INV-102", "Acme", "2026-04-01", "2026-04-20", "3,00,000");

    erp.cfo.run(ASOF, "cfo-agent");
    const afterFirst = org.actions.pending().length;
    const second = erp.cfo.run(ASOF, "cfo-agent");

    expect(second.plays.find((p) => p.play === "receivables")!.did).toHaveLength(0);
    expect(org.actions.pending().length).toBe(afterFirst);
  });

  it("says nothing new when nothing changed, and says so plainly", () => {
    const { org, erp } = company("org_cfo3");
    overdueInvoice(org, "INV-103", "Acme", "2026-04-01", "2026-04-20", "3,00,000");

    erp.cfo.run(ASOF, "cfo-agent");
    const again = erp.cfo.run(ASOF, "cfo-agent");

    expect(again.plays.find((p) => p.play === "receivables")!.unchanged).toBe(true);

    // Quiet, but not silent about the queue: "nothing new" while an invoice
    // sits unchased is the sentence that makes a digest untrustworthy.
    const digest = describeRun(again);
    expect(digest).toContain("Nothing new");
    expect(digest).toContain("still waiting on you");
  });

  it("treats an invoice getting older as news, not as the same news", () => {
    const { org, erp } = company("org_cfo4");
    overdueInvoice(org, "INV-104", "Acme", "2026-04-01", "2026-04-20", "3,00,000");

    erp.cfo.run("2026-06-30", "cfo-agent");
    const later = erp.cfo.run("2026-07-31", "cfo-agent");
    expect(later.plays.find((p) => p.play === "receivables")!.unchanged).toBe(false);
  });

  it("leaves a week-old invoice alone — late is not the same as overdue", () => {
    const { org, erp } = company("org_cfo5");
    overdueInvoice(org, "INV-105", "Acme", "2026-06-15", "2026-06-25", "3,00,000");

    const run = erp.cfo.run(ASOF, "cfo-agent");
    expect(run.plays.find((p) => p.play === "receivables")!.did).toHaveLength(0);
  });

  it("chases at most three in one run, and says how many it left", () => {
    const { org, erp } = company("org_cfo6");
    for (const n of [1, 2, 3, 4, 5]) {
      overdueInvoice(org, `INV-20${n}`, `Customer ${n}`, "2026-04-01", "2026-04-20", "1,00,000");
    }

    const run = erp.cfo.run(ASOF, "cfo-agent");
    const receivables = run.plays.find((p) => p.play === "receivables")!;
    expect(receivables.did).toHaveLength(3);
    expect(receivables.headline).toContain("2 left for you");
  });

  it("never waives a close blocker to make its own report look better", () => {
    const { erp } = company("org_cfo7");
    erp.cfo.run(ASOF, "cfo-agent");

    const waived = erp.close.status("2026-06")!.tasks.filter((t) => t.status === "WAIVED");
    expect(waived).toHaveLength(0);
  });

  it("keeps running when one play throws, and reports the failure every time", () => {
    const broken: CfoContext = {
      close: {
        close: { status: () => null, run: () => { throw new Error("close engine exploded"); } } as any,
        agents: { scan: () => [], open: () => [] } as any,
        authority: { settle: () => ({ approved: [], refused: [] }) } as any,
      },
      overdueInvoices: () => [],
      pendingDrafts: () => [],
      draftReminder: () => "",
      cash: () => ({ cash: ZERO, runwayDays: null }),
    };
    const agent = new CfoAgent(broken);

    const first = agent.run(ASOF, "cfo-agent");
    const closePlay = first.plays.find((p) => p.play === "close")!;
    expect(closePlay.headline).toContain("close engine exploded");
    expect(first.plays).toHaveLength(3);

    // A failure that repeats is still a failure. Reporting it once and then
    // calling it "unchanged" is how a scheduled agent goes quietly blind.
    const second = agent.run(ASOF, "cfo-agent");
    expect(second.plays.find((p) => p.play === "close")!.unchanged).toBe(false);
  });

  it("speaks about runway only when it bites, and not about every day it wobbles", () => {
    let runwayDays = 200;
    const ctx: CfoContext = {
      close: {
        close: { status: () => null, run: () => ({ passed: 0, blocked: 0, readyToClose: true, tasks: [] }) } as any,
        agents: { scan: () => [], open: () => [] } as any,
        authority: { settle: () => ({ approved: [], refused: [] }) } as any,
      },
      overdueInvoices: () => [],
      pendingDrafts: () => [],
      draftReminder: () => "",
      cash: () => ({ cash: parseINR("40,00,000"), runwayDays }),
    };
    const agent = new CfoAgent(ctx);

    expect(agent.run(ASOF, "cfo-agent").plays.find((p) => p.play === "runway")!.headline).toBeNull();

    runwayDays = 55;
    const bites = agent.run(ASOF, "cfo-agent").plays.find((p) => p.play === "runway")!;
    expect(bites.headline).toContain("55 days");
    expect(bites.unchanged).toBe(false);

    // One day less is not a new fact.
    runwayDays = 54;
    expect(agent.run(ASOF, "cfo-agent").plays.find((p) => p.play === "runway")!.unchanged).toBe(true);

    // Crossing into the next bucket is.
    runwayDays = 28;
    expect(agent.run(ASOF, "cfo-agent").plays.find((p) => p.play === "runway")!.unchanged).toBe(false);
  });

  it("reports a quiet morning as quiet rather than manufacturing a digest", () => {
    const quiet: CfoContext = {
      close: {
        close: { status: () => null, run: () => ({ passed: 3, blocked: 0, readyToClose: true, tasks: [] }) } as any,
        agents: { scan: () => [], open: () => [] } as any,
        authority: { settle: () => ({ approved: [], refused: [] }) } as any,
      },
      overdueInvoices: () => [],
      pendingDrafts: () => [],
      draftReminder: () => "",
      cash: () => ({ cash: parseINR("40,00,000"), runwayDays: 400 }),
    };
    const run = new CfoAgent(quiet).run(ASOF, "cfo-agent");
    expect(run.quiet).toBe(true);
    expect(describeRun(run)).toContain("Nothing new");
  });
});

/**
 * The agent's memory is the action log.
 *
 * A sweep is a recorded command, so replay rebuilds what the agent had
 * already seen. Without that, every restart re-announces yesterday's news
 * and queues a second copy of a reminder already waiting on someone — the
 * failure mode that makes a scheduled agent worse than no agent.
 */
describe("CfoAgent across a restart", () => {
  const OPTS = { orgId: "org_cfo_p", name: "Nimbus Labs", firstPeriod: "2026-01" as const };

  const anOverdueInvoice = async (rt: any) => {
    await rt.execute("journal.post", {
      date: "2026-01-01",
      narration: "Founder capital",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
      ],
      sourceModule: "manual",
    }, ACTOR);

    const inv = await rt.execute("invoice.create", {
      input: {
        number: "INV-301",
        customer: "Acme",
        issueDate: "2026-04-01",
        dueDate: "2026-04-20",
        lines: [{ description: "Retainer", amount: parseINR("3,00,000"), gstRatePct: 18 }],
      },
    }, ACTOR);
    await rt.execute("invoice.send", { invoiceId: inv.result.id }, ACTOR);
  };

  it("does not re-announce or re-draft after a restart", async () => {
    const store = new MemoryActionStore();
    const live = await PaisaRuntime.open({ ...OPTS, store });
    await anOverdueInvoice(live);
    await live.execute("cfo.run", { asOf: ASOF }, "cfo-agent");

    const drafted = live.org.actions.pending().length;
    expect(drafted).toBeGreaterThan(0);

    const restored = await PaisaRuntime.open({ ...OPTS, store });
    expect(restored.erp.cfo.runs(), "replay should rebuild the sweeps").toHaveLength(1);

    const after = await restored.execute("cfo.run", { asOf: ASOF }, "cfo-agent");
    expect(after.result.plays.find((p: { play: string }) => p.play === "receivables")!.unchanged).toBe(true);
    expect(restored.org.actions.pending().length, "a restart must not queue a second reminder").toBe(drafted);
  });
});
