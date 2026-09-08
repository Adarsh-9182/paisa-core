/**
 * The tool that finishes work, and the permission that stops the wrong
 * person reaching it.
 *
 * Until `settle_authorised` existed, one permission at the door was enough:
 * every tool either read the books or drafted something a human still had to
 * approve, so the architecture was safe because nothing the AI could call
 * actually did anything.
 *
 * `viewer` carries `access_ai_cfo`. The moment one tool acts, a viewer who
 * gets 403 on POST /api/erp/authority/settle could have done the same thing
 * by typing "clear the queue" into a chat box. A permission that holds at one
 * door and not the other is not a permission, so these tests drive the
 * orchestrator itself rather than the tool function.
 */

import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { attachErp } from "../src/erp/suite.js";
import { TOOLS } from "../src/ai/tools.js";
import { Orchestrator } from "../src/ai/orchestrator.js";
import { permissionsOf } from "../src/tenancy/roles.js";
import type { AgentContext, LanguageModelProvider } from "../src/ai/provider.js";

const ACTOR = "priya";

/** A vendor that billed for three months and then did not. */
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
      ACTOR,
    );
    erp.bills.submit(b.id, ACTOR);
    erp.bills.approve(b.id, "raj");
  }

  const raised = erp.agents.scan("2026-04", ACTOR);
  // Guard: without a real finding every assertion below is vacuous.
  if (raised.length === 0) throw new Error("scenario raised nothing — the test would prove nothing");
  return { org, erp };
};

/** A provider that calls one named tool once, then answers with its result. */
const providerCalling = (tool: string): { provider: LanguageModelProvider; seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    provider: {
      name: "stub",
      async run(ctx: AgentContext): Promise<string> {
        seen.push(...ctx.availableTools);
        const out = ctx.executeTool(tool, {});
        return `Done. ${out.includes("error=") ? "Refused." : "Settled."}`;
      },
    } as unknown as LanguageModelProvider,
  };
};

const user = (role: "owner" | "viewer", orgId: string) => ({
  userId: `u_${role}`,
  orgId,
  permissions: permissionsOf(role),
});

describe("settle_authorised", () => {
  it("settles what a grant covers and reports what it left", () => {
    const { org, erp } = company("org_act1");
    erp.authority.grant(
      {
        kind: "MISSING_ACCRUAL",
        maxAmount: parseINR("50,000"),
        maxPerSweep: parseINR("2,00,000"),
        note: "Recurring vendor accruals reverse next month.",
      },
      ACTOR,
    );
    const before = org.journal.all().length;

    const out = TOOLS.settle_authorised!(org, {});

    expect(out).toMatch(/settled=[1-9]/);
    expect(org.journal.all().length).toBeGreaterThan(before);
  });

  it("says plainly that nothing is granted, rather than reporting a failure", () => {
    const { org } = company("org_act2");
    const out = TOOLS.settle_authorised!(org, {});
    expect(out).toMatch(/settled=0/);
    expect(out).toMatch(/No standing authority/);
    expect(out).toMatch(/the assistant cannot/);
  });

  it("does not pretend to have looked when there is no ERP layer", () => {
    const platform = new Platform();
    const org = platform.createOrganization("org_act3", "Bare Books");
    expect(TOOLS.settle_authorised!(org, {})).toMatch(/no ERP layer/);
  });
});

describe("permission holds at the tool, not just at the route", () => {
  it("refuses a viewer, and posts nothing", async () => {
    const { org, erp } = company("org_act4");
    erp.authority.grant(
      { kind: "MISSING_ACCRUAL", maxAmount: parseINR("50,000"), maxPerSweep: parseINR("2,00,000"), note: "n" },
      ACTOR,
    );
    const before = org.journal.all().length;

    const { provider } = providerCalling("settle_authorised");
    const orchestrator = new Orchestrator(provider, 3);

    // A viewer has access_ai_cfo — that is exactly why this must be checked
    // somewhere other than the door.
    expect(permissionsOf("viewer").has("access_ai_cfo")).toBe(true);
    expect(permissionsOf("viewer").has("post_journal")).toBe(false);

    const record = await orchestrator.ask(user("viewer", "org_act4"), org, "clear the queue please");

    const call = record.toolsInvoked.find((t) => t.tool === "settle_authorised");
    expect(call, "the stub must have attempted the tool").toBeDefined();
    expect(call!.result).toMatch(/do not have permission to post journal/);
    expect(org.journal.all().length, "a refused tool must not move the ledger").toBe(before);
  });

  it("allows an owner through the same path", async () => {
    const { org, erp } = company("org_act5");
    erp.authority.grant(
      { kind: "MISSING_ACCRUAL", maxAmount: parseINR("50,000"), maxPerSweep: parseINR("2,00,000"), note: "n" },
      ACTOR,
    );
    const before = org.journal.all().length;

    const { provider } = providerCalling("settle_authorised");
    const orchestrator = new Orchestrator(provider, 3);

    await orchestrator.ask(user("owner", "org_act5"), org, "clear the queue please");
    expect(org.journal.all().length).toBeGreaterThan(before);
  });

  it("does not even offer the tool to someone who cannot use it", async () => {
    const { org } = company("org_act6");
    const { provider, seen } = providerCalling("get_cash_position");
    const orchestrator = new Orchestrator(provider, 3);

    await orchestrator.ask(user("viewer", "org_act6"), org, "close the month");
    expect(seen).not.toContain("settle_authorised");

    const owner = providerCalling("get_cash_position");
    await new Orchestrator(owner.provider, 3).ask(user("owner", "org_act6"), org, "close the month");
    expect(owner.seen).toContain("settle_authorised");
  });
});
