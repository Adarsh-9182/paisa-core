/**
 * The scoreboard has to be trustworthy before its scores mean anything.
 *
 * These run against MockProvider, so they measure the harness rather than any
 * model: a scripted "perfect" run must score perfect, and each specific
 * failure — wrong tool, extra tool, thrashing, ungrounded, provider down —
 * must show up as that failure and not as something else.
 */
import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/provider.js";
import { GOLDEN_CASES, costOf, formatReport, passesEvalReleaseGate, runCase, runEval, type EvalCase, type Usage } from "../src/ai/eval.js";
import { Platform } from "../src/organization.js";
import { AiUser, Orchestrator } from "../src/ai/orchestrator.js";
import { CfoPlanner } from "../src/ai/planner.js";
import { parseINR } from "../src/money.js";

const user: AiUser = {
  userId: "u_eval",
  orgId: "org_eval",
  permissions: new Set(["access_ai_cfo"]),
};

let n = 0;
const makeOrg = () => new Platform().createOrganization(`org_eval_${n++}`, "Eval Co");

const opts = { makeOrg, user: { ...user }, dates: { asOf: "2026-07-02" } };

const CASH: EvalCase = { id: "cash", question: "cash?", expectTools: ["get_cash_position"], maxRounds: 2 };

describe("scoring one case", () => {
  it("passes a run that calls the right tool and stays grounded", async () => {
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Nothing numeric to verify here." },
    ]);
    const r = await runCase(provider, CASH, opts);
    expect(r.ok).toBe(true);
    expect(r.toolsCalled).toEqual(["get_cash_position"]);
    expect(r.grounded).toBe(true);
  });

  it("names the tool that was missing rather than just failing", async () => {
    const provider = new MockProvider([{ kind: "final", text: "I would rather not look." }]);
    const r = await runCase(provider, CASH, opts);
    expect(r.ok).toBe(false);
    expect(r.missingTools).toEqual(["get_cash_position"]);
  });

  it("fails a forbidden call even when the required tools were all reached", async () => {
    // Precision is not decoration: every extra call is another full request
    // carrying the whole 23-tool schema block with it.
    const provider = new MockProvider([
      {
        kind: "tool_calls",
        toolCalls: [
          { tool: "get_cash_position", args: { asOf: "2026-07-02" } },
          { tool: "get_burn_and_runway", args: { asOf: "2026-07-02" } },
        ],
      },
      { kind: "final", text: "Both looked at." },
    ]);
    const r = await runCase(provider, { ...CASH, forbidTools: ["get_burn_and_runway"] }, opts);
    expect(r.ok).toBe(false);
    expect(r.forbiddenCalled).toEqual(["get_burn_and_runway"]);
    expect(r.missingTools).toEqual([]);
  });

  it("fails a model that thrashes its way to the right answer", async () => {
    const call = { tool: "get_cash_position", args: { asOf: "2026-07-02" } };
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [call, call, call] },
      { kind: "final", text: "Eventually." },
    ]);
    const r = await runCase(provider, CASH, opts);
    expect(r.ok).toBe(false);
    expect(r.rounds).toBe(3);
    expect(r.missingTools).toEqual([]); // it *did* reach the tool — it just took three goes
  });

  it("records an ungrounded answer as ungrounded, not as an outage", async () => {
    // The verifier working is a model failure, not an infrastructure one, and
    // the report has to be able to tell them apart.
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Cash is ₹99,99,999.00." },
      { kind: "final", text: "Cash is ₹99,99,999.00." }, // the corrective retry, unrepentant
    ]);
    const r = await runCase(provider, CASH, opts);
    expect(r.ok).toBe(false);
    expect(r.grounded).toBe(false);
    expect(r.error).not.toMatch(/^provider:/);
  });

  it("marks a provider failure as a provider failure and keeps going", async () => {
    const provider = new MockProvider([]); // script exhausted → throws
    const r = await runCase(provider, CASH, opts);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^provider:/);
  });

  it("checks required text only after grounding", async () => {
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "All fine." },
    ]);
    const r = await runCase(provider, { ...CASH, expectText: ["runway"] }, opts);
    expect(r.ok).toBe(false);
    expect(r.missingText).toEqual(["runway"]);
  });
});

describe("aggregating a run", () => {
  const perfect = () =>
    new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Looked." },
      { kind: "tool_calls", toolCalls: [{ tool: "get_burn_and_runway", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Looked." },
    ]);

  it("reports recall, precision and grounding across cases", async () => {
    const cases: EvalCase[] = [
      CASH,
      { id: "runway", question: "runway?", expectTools: ["get_burn_and_runway"], maxRounds: 2 },
    ];
    const report = await runEval(perfect(), cases, opts);
    expect(report.passed).toBe(2);
    expect(report.toolRecall).toBe(1);
    expect(report.toolPrecision).toBe(1);
    expect(report.groundedRate).toBe(1);
    expect(report.avgRounds).toBe(1);
    expect(passesEvalReleaseGate(report, cases)).toBe(true);
  });

  it("scores partial recall as partial, not as pass or fail", async () => {
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Only half the job." },
    ]);
    const report = await runEval(
      provider,
      [{ id: "two", question: "both?", expectTools: ["get_cash_position", "get_burn_and_runway"] }],
      opts,
    );
    expect(report.toolRecall).toBe(0.5);
    expect(report.passed).toBe(0);
  });

  it("does not score a rate limit as a wrong answer", async () => {
    // The failure this guards against: a free tier 429s half the set, those
    // cases are counted as the model getting them wrong, and a model that
    // never ran is reported as 50% accurate — then compared against another
    // model and a decision is made on it.
    const rateLimited = {
      name: "busy",
      run: async () => {
        throw new Error("OpenAI API error 429: You exceeded your current quota");
      },
    };
    const report = await runEval(rateLimited, [CASH, { ...CASH, id: "cash-2" }], opts);
    expect(report.unreached).toBe(2);
    expect(report.total).toBe(0); // nothing was actually scored
    expect(report.toolRecall).toBe(1); // no claim either way, not 0%
    expect(report.groundedRate).toBe(1);
    expect(formatReport(report)).toContain("never reached the model");
    expect(passesEvalReleaseGate(report, [CASH, { ...CASH, id: "cash-2" }])).toBe(false);
  });

  it("still scores a refusal against the model, since that is its answer", async () => {
    // The other half of the rule: only infrastructure is excused. A model
    // that declines, or answers ungroundedly, has told us something real.
    const refuses = {
      name: "refuser",
      run: async () => {
        throw new Error("content policy refusal");
      },
    };
    const report = await runEval(refuses, [CASH], opts);
    expect(report.unreached).toBe(0);
    expect(report.total).toBe(1);
    expect(report.passed).toBe(0);
    expect(passesEvalReleaseGate(report, [CASH])).toBe(false);
  });

  it("separates a right answer that cost too much from a wrong one", async () => {
    // Correctness and cost were being answered by one number. A model whose
    // figures are all grounded but which takes four trips where two would do
    // is expensive, not wrong, and the fixes are different.
    const chatty = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" } }] },
      { kind: "final", text: "Plenty." },
    ]);
    const report = await runEval(chatty, [{ ...CASH, maxRounds: 1 }], opts);
    expect(report.passed).toBe(0); // it did break the round budget
    expect(report.correct).toBe(1); // but it got the answer right
    expect(report.cases[0]!.overRoundsOnly).toBe(true);
    expect(formatReport(report)).toContain("costs quota, not correctness");
    expect(passesEvalReleaseGate(report, [{ ...CASH, maxRounds: 1 }])).toBe(false);
  });

  it("does not call a wrong answer merely expensive", async () => {
    const wrong = new MockProvider([{ kind: "final", text: "No idea." }]);
    const report = await runEval(wrong, [{ ...CASH, maxRounds: 1 }], opts);
    expect(report.correct).toBe(0);
    expect(report.cases[0]!.overRoundsOnly).toBe(false);
  });

  it("reports a repeated case by its worst attempt, not its best", async () => {
    // A model that agrees with a made-up figure one time in three is not
    // two-thirds safe. Reporting the best attempt is how a coin flip gets
    // recorded as a capability.
    let call = 0;
    const flaky = {
      name: "flaky",
      run: async (ctx: { executeTool: (t: string, a: Record<string, unknown>) => string }) => {
        call++;
        // passes on the first attempt, skips the tool on later ones
        if (call === 1) ctx.executeTool("get_cash_position", { asOf: "2026-07-02" });
        return "Nothing to report.";
      },
    };
    const report = await runEval(flaky, [{ ...CASH, repeat: 3 }], opts);
    expect(report.passed).toBe(0);
    const only = report.cases[0]!;
    expect(only.attempts).toBe(3);
    expect(only.passes).toBe(1);
    expect(formatReport(report)).toContain("passed 1/3 attempts");
    expect(formatReport(report)).toContain("intermittent");
    expect(passesEvalReleaseGate(report, [{ ...CASH, repeat: 3 }])).toBe(false);
  });

  it("does not report zero cost when the provider reported nothing", async () => {
    // A provider that cannot measure must read as unknown. Zero would look
    // like the cheapest option in a comparison, which is the worst possible
    // way to be wrong about money.
    const report = await runEval(perfect(), [CASH], opts);
    expect(report.usage.measured).toBe(false);
    expect(costOf(report.usage, { inputPerMillion: 1, outputPerMillion: 1 })).toBeNull();
    expect(formatReport(report)).toContain("cost unknown, not zero");
  });
});

describe("release acceptance", () => {
  const passing = {
    name: "passing",
    run: async (ctx: { executeTool: (t: string, a: Record<string, unknown>) => string }) => {
      ctx.executeTool("get_cash_position", { asOf: "2026-07-02" });
      return "Looked.";
    },
  };

  it("rejects a partial outage even when every scored case passed", async () => {
    let call = 0;
    const provider = {
      name: "partly-unavailable",
      run: async (ctx: Parameters<typeof passing.run>[0]) => {
        if (++call === 2) throw new Error("503 service unavailable");
        return passing.run(ctx);
      },
    };
    const cases = [CASH, { ...CASH, id: "cash-2" }];
    const report = await runEval(provider, cases, opts);
    expect(report.passed).toBe(1);
    expect(report.total).toBe(1);
    expect(report.unreached).toBe(1);
    expect(report.toolRecall).toBe(1);
    expect(report.groundedRate).toBe(1);
    expect(passesEvalReleaseGate(report, cases)).toBe(false);
  });

  it("rejects an empty suite", async () => {
    const report = await runEval(passing, [], opts);
    expect(passesEvalReleaseGate(report, [])).toBe(false);
    expect(passesEvalReleaseGate(report, [CASH])).toBe(false);
  });

  it("requires exactly the expected case identities", async () => {
    const cases = [CASH, { ...CASH, id: "cash-2" }];
    const report = await runEval(passing, cases, opts);
    expect(passesEvalReleaseGate(report, [...cases].reverse())).toBe(true);
    expect(passesEvalReleaseGate(report, [CASH])).toBe(false);
    expect(passesEvalReleaseGate(report, [...cases, { ...CASH, id: "missing" }])).toBe(false);
    expect(passesEvalReleaseGate(report, [CASH, { ...CASH, id: "different" }])).toBe(false);
    expect(passesEvalReleaseGate(report, [CASH, CASH])).toBe(false);
    expect(passesEvalReleaseGate({ ...report, cases: [report.cases[0]!, report.cases[0]!] }, cases)).toBe(false);
  });

  it("does not accept successful counters that hide a failed case", async () => {
    const report = await runEval(new MockProvider([{ kind: "final", text: "No idea." }]), [CASH], opts);
    expect(passesEvalReleaseGate({ ...report, passed: 1 }, [CASH])).toBe(false);
  });

  it("accepts a repeated case only when all required attempts passed", async () => {
    const cases = [{ ...CASH, repeat: 3 }];
    const report = await runEval(passing, cases, opts);
    expect(report.cases[0]!.attempts).toBe(3);
    expect(report.cases[0]!.passes).toBe(3);
    expect(passesEvalReleaseGate(report, cases)).toBe(true);

    const singleAttempt = await runEval(passing, [CASH], opts);
    expect(passesEvalReleaseGate(singleAttempt, cases)).toBe(false);
    expect(passesEvalReleaseGate(report, [{ ...CASH, repeat: 4 }])).toBe(false);
  });

  it("rejects an outage within a repeated case despite other successful attempts", async () => {
    let call = 0;
    const provider = {
      name: "intermittent-outage",
      run: async (ctx: Parameters<typeof passing.run>[0]) => {
        if (++call === 2) throw new Error("request timeout");
        return passing.run(ctx);
      },
    };
    const cases = [{ ...CASH, repeat: 3 }];
    const report = await runEval(provider, cases, opts);
    expect(report.cases[0]!.attempts).toBe(3);
    expect(report.cases[0]!.passes).toBe(2);
    expect(report.unreached).toBe(1);
    expect(passesEvalReleaseGate(report, cases)).toBe(false);
  });
});

describe("offline planner collections routing", () => {
  const planner = () => new CfoPlanner({ asOf: "2026-07-02", periodFrom: "2026-01-01" });
  const company = () => {
    const org = makeOrg();
    for (const [number, dueDate] of [["NEW-2026/7", "2026-06-15"], ["OLD-2026/3", "2026-05-01"]]) {
      const invoice = org.invoices.create({
        number: number!, customer: "Agency client", issueDate: "2026-04-01", dueDate: dueDate!,
        lines: [{ description: "Retainer", amount: parseINR("10,000"), gstRatePct: 18 }],
      }, "eval");
      org.invoices.send(invoice.id, "eval");
    }
    return org;
  };

  it("reads the ledger before drafting the oldest overdue invoice for approval", async () => {
    const org = company();
    const record = await new Orchestrator(planner()).ask(
      { ...user, orgId: org.orgId }, org, "Chase the overdue invoice for me.",
    );
    expect(record.toolsInvoked.map((t) => t.tool)).toEqual(["list_overdue_invoices", "propose_payment_reminder"]);
    expect(record.toolsInvoked[1]!.args).toEqual({ asOf: "2026-07-02", invoiceNumber: "OLD-2026/3" });
    expect(record.verified).toBe(true);
    expect(record.finalAnswer).toContain("nothing sent");
    expect(org.actions.pending()).toHaveLength(1);
    expect(org.actions.pending()[0]!.summary).toContain("OLD-2026/3");
  });

  it.each([
    "Which invoices are overdue?",
    "Show the overdue invoices.",
    "Should I chase the overdue invoice?",
    "What would happen if you chase the overdue invoice?",
    "Do not chase the overdue invoice.",
    "Chase invoice NEW-2026/7.",
  ])("keeps ambiguous or informational requests read-only: %s", async (question) => {
    const org = company();
    const record = await new Orchestrator(planner()).ask({ ...user, orgId: org.orgId }, org, question);
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("list_overdue_invoices");
    expect(record.toolsInvoked.map((t) => t.tool)).not.toContain("lookup_regulation");
    expect(record.toolsInvoked.map((t) => t.tool)).not.toContain("propose_payment_reminder");
    expect(org.actions.pending()).toHaveLength(0);
  });

  it.each(["e-invoice", "e invoice", "einvoice", "e-invoicing", "e-invoices"])(
    "preserves regulation lookup for %s questions", async (term) => {
      const org = makeOrg();
      const record = await new Orchestrator(planner()).ask(
        { ...user, orgId: org.orgId }, org, `Does ${term} apply to my agency?`,
      );
      expect(record.toolsInvoked.map((t) => t.tool)).toEqual(["lookup_regulation"]);
      expect(record.verified).toBe(true);
      expect(org.actions.pending()).toHaveLength(0);
    },
  );

  it("does not draft when there are no overdue invoices", async () => {
    const org = makeOrg();
    const record = await new Orchestrator(planner()).ask(
      { ...user, orgId: org.orgId }, org, "Please chase the overdue invoice.",
    );
    expect(record.toolsInvoked.map((t) => t.tool)).toEqual(["list_overdue_invoices"]);
    expect(record.finalAnswer).toContain("No overdue invoices");
    expect(org.actions.pending()).toHaveLength(0);
  });

  it("does not guess an invoice after a failed overdue read", async () => {
    const calls: string[] = [];
    const answer = await planner().run({
      system: "", history: [], userQuery: "Chase the overdue invoice for me.",
      availableTools: ["list_overdue_invoices", "propose_payment_reminder"], maxRounds: 5,
      executeTool: (tool) => { calls.push(tool); return 'error="ledger unavailable"'; },
    });
    expect(calls).toEqual(["list_overdue_invoices"]);
    expect(answer).toContain("ledger unavailable");
  });
});

describe("pricing", () => {
  const usage = (over: Partial<Usage> = {}): Usage => ({
    calls: 2,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cachedInputTokens: 0,
    measured: true,
    ...over,
  });

  it("prices a million input tokens at the input rate", () => {
    expect(costOf(usage(), { inputPerMillion: 3, outputPerMillion: 15 })).toBeCloseTo(3, 6);
  });

  it("bills cached input at the discount, or the saving is invisible", () => {
    // Two calls of ~3,600 tokens per question, ~98% of it byte-identical
    // boilerplate: caching is the largest single lever on this workload, so
    // a report that cannot show it is not measuring the thing that matters.
    const half = usage({ cachedInputTokens: 500_000 });
    expect(costOf(half, { inputPerMillion: 3, outputPerMillion: 15 })).toBeCloseTo(1.65, 6); // 0.5*3 + 0.5*0.3
  });

  it("honours an explicit cached rate over the default tenth", () => {
    const c = usage({ cachedInputTokens: 1_000_000 });
    expect(costOf(c, { inputPerMillion: 10, outputPerMillion: 10, cachedInputPerMillion: 0 })).toBe(0);
  });

  it("never charges for more fresh input than there was", () => {
    // Providers have reported cached > input during rollouts; that must not
    // come out as a negative bill.
    const odd = usage({ inputTokens: 100, cachedInputTokens: 500 });
    expect(costOf(odd, { inputPerMillion: 1000, outputPerMillion: 0 })!).toBeGreaterThanOrEqual(0);
  });
});

describe("the golden set", () => {
  it("has unique ids, so a regression can be named", () => {
    const ids = GOLDEN_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only names tools that exist", async () => {
    const { toolNames } = await import("../src/ai/tools.js");
    const known = new Set(toolNames());
    for (const c of GOLDEN_CASES) {
      for (const t of [...c.expectTools, ...(c.forbidTools ?? [])]) {
        expect(known.has(t), `${c.id} references unknown tool ${t}`).toBe(true);
      }
    }
  });

  it("includes at least one case that must call nothing at all", () => {
    // The cheapest failure to miss: a model that queries the ledger to answer
    // "what can you help me with" burns a full request on nothing.
    expect(GOLDEN_CASES.some((c) => c.expectTools.length === 0)).toBe(true);
  });
});
