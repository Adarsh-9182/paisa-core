import { describe, it, expect } from "vitest";
import {
  Platform, parseINR,
  MockProvider, FallbackProvider, Orchestrator,
  NarrationError, PermissionError,
  verifyNarration, extractFigures, assertsAFigure,
  AiUser, ChatTurn, AgentContext,
} from "../src/index.js";

const seededOrg = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_abc", "ABC Technologies");
  const post = (date: string, dr: string, cr: string, amt: string, narration = "txn") =>
    org.journal.post({
      date, narration,
      lines: [
        { accountId: dr, side: "DEBIT", amount: parseINR(amt) },
        { accountId: cr, side: "CREDIT", amount: parseINR(amt) },
      ],
      sourceModule: "manual", createdBy: "adarsh",
    });
  post("2026-01-01", "acc_bank", "acc_capital", "30,00,000", "Seed");
  for (const m of ["04", "05", "06"]) {
    post(`2026-${m}-01`, "acc_salary", "acc_bank", "2,00,000", "Payroll");
    post(`2026-${m}-15`, "acc_bank", "acc_sales", "1,00,000", "Sales");
  }
  return org;
};

const cfoUser: AiUser = {
  userId: "adarsh",
  orgId: "org_abc",
  permissions: new Set(["access_ai_cfo", "view_reports"]),
};

describe("verifyNarration — the hard invariant", () => {
  it("accepts narration whose figures all come from tool outputs", () => {
    expect(() =>
      verifyNarration(
        "You have ₹24,00,000.00 in cash and 360 days of runway.",
        ["cash_on_hand=₹24,00,000.00", "runway=360 days"],
      ),
    ).not.toThrow();
  });

  it("rejects invented figures", () => {
    expect(() =>
      verifyNarration("Your balance is ₹99,99,999.00.", ["cash_on_hand=₹24,00,000.00"]),
    ).toThrow(NarrationError);
    expect(() =>
      verifyNarration("Runway is 500 days.", ["runway=360 days"]),
    ).toThrow(NarrationError);
  });

  it("allows small ordinary-language integers", () => {
    expect(() =>
      verifyNarration("Over the last 3 months, across 2 categories, cash is ₹24,00,000.00.", [
        "cash_on_hand=₹24,00,000.00",
      ]),
    ).not.toThrow();
  });

  it("extractFigures finds rupee amounts and percentages", () => {
    expect(extractFigures("Spent ₹1,00,000.00, up 22% over 90 days")).toEqual([
      "₹1,00,000.00", "22%", "90",
    ]);
  });
});

describe("orchestrator", () => {
  it("runs the tool loop and returns a verified, audited answer", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_burn_and_runway", args: { asOf: "2026-06-30" } }] },
      { kind: "final", text: "Your monthly net burn is ₹1,00,000.00. Cash-flow context is in the tool note." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "What is my burn rate?");
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked.length).toBe(1);
    expect(record.toolsInvoked[0]!.tool).toBe("get_burn_and_runway");
    expect(orch.audit().length).toBe(1);
    expect(org.bus.audit("org_abc").some((e) => e.type === "ai.answered")).toBe(true);
  });

  it("rejects an answer that still hallucinates after the corrective retry", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-06-30" } }] },
      { kind: "final", text: "You have ₹5,00,00,000.00 in cash. Spend freely." },
      // retry run — the model doubles down on the invented figure
      { kind: "final", text: "As I said, ₹5,00,00,000.00. Trust me." },
    ]);
    const orch = new Orchestrator(provider);
    await expect(orch.ask(cfoUser, org, "How much cash do I have?")).rejects.toThrow(NarrationError);
  });

  it("a hallucinated draft gets one corrective retry and can recover", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-06-30" } }] },
      { kind: "final", text: "You have ₹5,00,00,000.00 in cash." },
      // retry run — rewritten quoting the tool output verbatim
      { kind: "final", text: "You have ₹27,00,000.00 in cash." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "How much cash do I have?");
    expect(record.verified).toBe(true);
    expect(record.finalAnswer).toContain("₹27,00,000.00");
  });

  it("review-queue tools: list, then draft a proposal that never posts", async () => {
    const org = seededOrg();
    org.banking.importStatement(
      [{ date: "2026-06-20", description: "IMPS 9911 Mystery Vendor", amount: parseINR("-1,250"), reference: "imps-9911" }],
      "adarsh",
    );
    const provider = new MockProvider([
      {
        kind: "tool_calls",
        toolCalls: [
          { tool: "list_review_queue", args: {} },
          { tool: "propose_categorization", args: { reference: "imps-9911", accountCode: "5300" } },
        ],
      },
      { kind: "final", text: "One line of ₹-1,250.00 awaits review — I drafted Software for it; approve to post." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "Categorise my pending bank lines");
    expect(record.toolsInvoked[0]!.result).toContain('reference="imps-9911"');
    expect(record.toolsInvoked[1]!.result).toContain("kind=categorize");
    expect(record.toolsInvoked[1]!.result).toContain('account="Software"');
    // The draft must NOT have touched the ledger — it is queued, and the line
    // still awaits review until a human approves the queued action.
    expect(record.toolsInvoked[1]!.result).toContain("nothing has posted");
    expect(org.actions.pending()).toHaveLength(1);
    expect(org.banking.pendingReview().length).toBe(1);
  });

  it("propose_categorization rejects unknown lines and wrong-direction accounts as data", async () => {
    const org = seededOrg();
    org.banking.importStatement(
      [{ date: "2026-06-20", description: "IMPS 9911 Mystery Vendor", amount: parseINR("-1,250"), reference: "imps-9911" }],
      "adarsh",
    );
    const provider = new MockProvider([
      {
        kind: "tool_calls",
        toolCalls: [
          { tool: "propose_categorization", args: { reference: "no-such-ref", accountCode: "5300" } },
          // Sales (4000) is REVENUE — an outflow must not land there.
          { tool: "propose_categorization", args: { reference: "imps-9911", accountCode: "4000" } },
        ],
      },
      { kind: "final", text: "I could not draft those categorisations; the details did not check out." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "categorise");
    expect(record.toolsInvoked[0]!.result).toContain("error=");
    expect(record.toolsInvoked[1]!.result).toContain("error=");
    expect(record.toolsInvoked[1]!.result).toContain("EXPENSE");
  });

  it("enforces AI permission layer", async () => {
    const org = seededOrg();
    const employee: AiUser = { userId: "emp1", orgId: "org_abc", permissions: new Set() };
    const orch = new Orchestrator(new MockProvider([]));
    await expect(orch.ask(employee, org, "What is the CEO's salary?")).rejects.toThrow(PermissionError);
  });

  it("enforces org scoping — user from another org is rejected", async () => {
    const org = seededOrg();
    const outsider: AiUser = { userId: "x", orgId: "org_other", permissions: new Set(["access_ai_cfo"]) };
    const orch = new Orchestrator(new MockProvider([]));
    await expect(orch.ask(outsider, org, "Show me everything")).rejects.toThrow(PermissionError);
  });

  it("tool errors are surfaced as data, never crash the loop", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "no_such_tool", args: {} }] },
      { kind: "final", text: "I could not retrieve that figure; the tool is unavailable." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "??");
    expect(record.toolsInvoked[0]!.result).toContain("unknown tool");
  });

  it("affordability check answers a real CFO question", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "check_affordability", args: { asOf: "2026-06-30", amountINR: "15,00,000" } }] },
      { kind: "final", text: "Buying the ₹15,00,000.00 machine leaves ₹12,00,000.00 in cash — affordable, but review runway first." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "Should I buy a ₹15 lakh machine?");
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked[0]!.result).toContain("affordable=true");
  });

  it("streams tool and retry events to an observer, never narration", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-06-30" } }] },
      { kind: "final", text: "You have ₹5,00,00,000.00 in cash." },
      { kind: "final", text: "You have ₹27,00,000.00 in cash." },
    ]);
    const events: string[] = [];
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "How much cash?", [], (e) => events.push(e.type));
    expect(record.verified).toBe(true);
    expect(events).toEqual(["tool", "retry"]);
  });

  it("a throwing observer cannot break the verified pipeline", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "get_cash_position", args: { asOf: "2026-06-30" } }] },
      { kind: "final", text: "You have ₹27,00,000.00 in cash." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "cash?", [], () => {
      throw new Error("observer exploded");
    });
    expect(record.verified).toBe(true);
  });

  it("FallbackProvider chains past a failing provider", async () => {
    const failing = { name: "down", run: async () => { throw new Error("503"); } };
    const org = seededOrg();
    const provider = new FallbackProvider([
      failing,
      new MockProvider([{ kind: "final", text: "All engines are healthy; no figures to report." }]),
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "status?");
    expect(record.finalAnswer).toContain("healthy");
  });
});

describe("verifyNarration — whole-number grounding", () => {
  // Regression: the verifier searched the tool outputs as one string, so any
  // figure whose digits appeared inside a larger number passed. With a real
  // balance of ₹32,42,600.00, the claims "₹26" and "₹42,600.00" both verified
  // as grounded — the Golden Rule silently not being enforced.
  const cash = ["cash_on_hand=₹32,42,600.00 as_of=2026-07-02"];

  it("rejects a figure that is only a substring of a real one", () => {
    expect(() => verifyNarration("You have ₹26.", cash)).toThrow(NarrationError);
    expect(() => verifyNarration("You have ₹42,600.00.", cash)).toThrow(NarrationError);
  });

  it("still accepts the figure the tool actually printed", () => {
    expect(() => verifyNarration("You have ₹32,42,600.00.", cash)).not.toThrow();
  });

  it("grounds a figure sitting at the end of a line in multi-line output", () => {
    const statement = ["date | amount\n2026-06-01 | RENT | 45,500\n2026-06-03 | SWIGGY | 2,315"];
    expect(() => verifyNarration("Rent was ₹45,500, Swiggy ₹2,315.", statement)).not.toThrow();
    expect(() => verifyNarration("Total ₹455002026.", statement)).toThrow(NarrationError);
  });
});

describe("conversation memory", () => {
  /** A provider that records the context it was handed. */
  const spy = () => {
    const seen: { history: readonly ChatTurn[]; query: string }[] = [];
    return {
      seen,
      provider: {
        name: "spy",
        async run(ctx: AgentContext) {
          seen.push({ history: ctx.history, query: ctx.userQuery });
          return "Nothing to report.";
        },
      },
    };
  };

  it("passes prior turns through to the provider", async () => {
    const { seen, provider } = spy();
    const orch = new Orchestrator(provider);
    await orch.ask(cfoUser, seededOrg(), "and last month?", [
      { role: "user", text: "what is my cash position?" },
      { role: "assistant", text: "You have some cash." },
    ]);

    expect(seen[0]?.history).toHaveLength(2);
    expect(seen[0]?.history[0]?.text).toBe("what is my cash position?");
    expect(seen[0]?.query).toBe("and last month?");
  });

  it("defaults to no history rather than failing", async () => {
    const { seen, provider } = spy();
    await new Orchestrator(provider).ask(cfoUser, seededOrg(), "hello");
    expect(seen[0]?.history).toEqual([]);
  });

  it("keeps the corrective retry's history separate from the caller's", async () => {
    // The retry appends the rejected answer and a correction to whatever the
    // caller passed; the caller's own array must not be mutated.
    const caller: ChatTurn[] = [{ role: "user", text: "earlier question" }];
    const provider = new MockProvider([
      { kind: "final", text: "Cash is ₹9,99,999." }, // ungrounded
      { kind: "final", text: "I could not verify that." },
    ]);
    await new Orchestrator(provider).ask(cfoUser, seededOrg(), "how much?", caller);
    expect(caller).toHaveLength(1);
  });
});

describe("a figure the user supplies is a claim, not a fact", () => {
  it("recognises the shapes a founder actually types", () => {
    expect(assertsAFigure("Our revenue last month was about ₹40 lakh, right?")).toBe(true);
    expect(assertsAFigure("we spend 2 lakh on salaries")).toBe(true);
    expect(assertsAFigure("isn't our burn 3.5 lakhs?")).toBe(true);
    expect(assertsAFigure("I think we have 3200000 in the bank")).toBe(true);
    expect(assertsAFigure("₹1,20,000 a month for an engineer — affordable?")).toBe(true);
  });

  it("stays quiet when there is no figure to check", () => {
    expect(assertsAFigure("What is my cash position?")).toBe(false);
    expect(assertsAFigure("Which invoices are overdue?")).toBe(false);
    // small bare numbers are ordinary language, not claims about money
    expect(assertsAFigure("show me the last 3 months")).toBe(false);
  });
});
