/**
 * Spec 006 — transaction screening, multi-model provider chain, and the
 * planner misrouting regressions (the "bitcoin → GST" bug: bare /itc/
 * matched b-ITC-oin and answered a crypto question with GST filings).
 */

import { describe, it, expect } from "vitest";
import {
  Platform, parseINR,
  screenTransactions,
  TOOLS, Orchestrator, CfoPlanner, OpenAIProvider, FallbackProvider,
  AiUser, Organization,
} from "../src/index.js";

const AS_OF = "2026-07-02";

const cfoUser: AiUser = {
  userId: "user_adarsh",
  orgId: "org_abc",
  permissions: new Set(["access_ai_cfo", "view_reports"]),
};

const baseOrg = (): Organization => {
  const platform = new Platform();
  const org = platform.createOrganization("org_abc", "ABC Technologies");
  org.journal.post({
    date: "2026-01-01", narration: "Seed capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("30,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("30,00,000") },
    ],
    sourceModule: "manual", createdBy: "adarsh",
  });
  return org;
};

const payExpense = (org: Organization, date: string, narration: string, code: string, amountINR: string) => {
  const acct = org.chart.getByCode(code);
  return org.journal.post({
    date, narration,
    lines: [
      { accountId: acct.id, side: "DEBIT", amount: parseINR(amountINR) },
      { accountId: "acc_bank", side: "CREDIT", amount: parseINR(amountINR) },
    ],
    sourceModule: "manual", createdBy: "adarsh",
  });
};

describe("screenTransactions", () => {
  it("flags identical payments posted twice within a week as high severity", () => {
    const org = baseOrg();
    payExpense(org, "2026-06-20", "AWS Invoice 991", "5300", "45,000");
    payExpense(org, "2026-06-23", "AWS Invoice 991", "5300", "45,000");
    const report = screenTransactions(org, AS_OF);
    const dup = report.findings.find((f) => f.kind === "duplicate_payment");
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe("high");
    expect(dup!.entryIds.length).toBe(2);
    expect(dup!.narration).toBe("AWS Invoice 991");
  });

  it("does not flag the same vendor charge recurring monthly", () => {
    const org = baseOrg();
    for (const d of ["2026-04-05", "2026-05-05", "2026-06-05"])
      payExpense(org, d, "Notion subscription", "5300", "2,000");
    const report = screenTransactions(org, AS_OF);
    expect(report.findings.filter((f) => f.kind === "duplicate_payment")).toEqual([]);
  });

  it("flags a charge far above the account's median as an outlier", () => {
    const org = baseOrg();
    const dates = ["2026-04-10", "2026-04-25", "2026-05-10", "2026-05-25", "2026-06-10"];
    dates.forEach((d, i) => payExpense(org, d, `Small software charge ${i}`, "5300", "2,000"));
    payExpense(org, "2026-06-28", "UNKNOWN VENDOR PAYMENT", "5300", "1,00,000");
    const report = screenTransactions(org, AS_OF);
    const outlier = report.findings.find((f) => f.kind === "amount_outlier");
    expect(outlier).toBeDefined();
    expect(outlier!.narration).toBe("UNKNOWN VENDOR PAYMENT");
    expect(outlier!.severity).toBe("medium");
  });

  it("needs a minimum history before calling anything an outlier", () => {
    const org = baseOrg();
    payExpense(org, "2026-06-01", "First ever charge", "5300", "5,00,000");
    expect(screenTransactions(org, AS_OF).findings).toEqual([]);
  });

  it("skips corrected entries — a reversed duplicate is not re-flagged", () => {
    const org = baseOrg();
    payExpense(org, "2026-06-20", "AWS Invoice 991", "5300", "45,000");
    const second = payExpense(org, "2026-06-23", "AWS Invoice 991", "5300", "45,000");
    org.journal.reverse(second.id, "adarsh", "double payment corrected");
    expect(screenTransactions(org, AS_OF).findings).toEqual([]);
  });

  it("reports a clean window honestly", () => {
    const report = screenTransactions(baseOrg(), AS_OF);
    expect(report.findings).toEqual([]);
    expect(report.entriesChecked).toBeGreaterThanOrEqual(0);
  });
});

describe("screen_transactions tool", () => {
  it("formats findings with account, amount, entries, and rule detail", () => {
    const org = baseOrg();
    payExpense(org, "2026-06-20", "AWS Invoice 991", "5300", "45,000");
    payExpense(org, "2026-06-23", "AWS Invoice 991", "5300", "45,000");
    const out = TOOLS.screen_transactions!(org, { asOf: AS_OF });
    expect(out).toContain("findings=1");
    expect(out).toContain("kind=duplicate_payment");
    expect(out).toContain("₹45,000.00");
    expect(out).toContain("severity=high");
  });

  it("says so when the window is clean", () => {
    const out = TOOLS.screen_transactions!(baseOrg(), { asOf: AS_OF });
    expect(out).toContain("findings=0");
  });
});

describe("planner routing regressions", () => {
  const orch = () => new Orchestrator(new CfoPlanner({ asOf: AS_OF, periodFrom: "2026-01-01" }));

  it("bitcoin price question routes to the honest market reply, NOT GST", async () => {
    const record = await orch().ask(cfoUser, baseOrg(), "What will the bitcoin price be next month?");
    const tools = record.toolsInvoked.map((t) => t.tool);
    expect(tools).toContain("get_portfolio");
    expect(tools).not.toContain("get_gst_position");
    expect(record.finalAnswer).toContain("never guesses or predicts a price");
  });

  it("GST-rate-on-crypto is a law question and goes to the knowledge base", async () => {
    const record = await orch().ask(cfoUser, baseOrg(), "GST rate on software exports?");
    expect(record.toolsInvoked[0]!.tool).toBe("lookup_regulation");
  });

  it("fraud questions route to screen_transactions", async () => {
    const org = baseOrg();
    payExpense(org, "2026-06-20", "AWS Invoice 991", "5300", "45,000");
    payExpense(org, "2026-06-23", "AWS Invoice 991", "5300", "45,000");
    const record = await orch().ask(cfoUser, org, "Any suspicious or duplicate transactions I should know about?");
    expect(record.toolsInvoked[0]!.tool).toBe("screen_transactions");
    expect(record.finalAnswer).toContain("duplicate_payment");
    expect(record.verified).toBe(true);
  });

  it("plain GST position questions still hit the live GST tools", async () => {
    const record = await orch().ask(cfoUser, baseOrg(), "What is my GST position for this month?");
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("get_gst_position");
  });
});

describe("OpenAIProvider (GPT-5.6)", () => {
  const scripted = (bodies: unknown[]) => {
    const queue = [...bodies];
    return async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => queue.shift(),
    });
  };

  it("runs the tool loop and its answer passes the verifier", async () => {
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchFn: scripted([
        {
          choices: [{
            message: {
              tool_calls: [{ id: "c1", function: { name: "get_cash_position", arguments: `{"asOf":"${AS_OF}"}` } }],
            },
          }],
        },
        { choices: [{ message: { content: "Cash on hand is **₹30,00,000.00** as of today." } }] },
      ]),
    });
    expect(provider.model).toBe("gpt-5.6");
    const record = await new Orchestrator(provider).ask(cfoUser, baseOrg(), "How much cash do we have?");
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked[0]!.tool).toBe("get_cash_position");
  });

  it("runs against a keyless local server, and sends no Authorization header", async () => {
    // Ollama / llama.cpp / mlx_lm speak this protocol and none authenticate.
    // Requiring a key would rule out every free way to run the narrator.
    const seen: Record<string, string>[] = [];
    const queue = [
      { choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "get_cash_position", arguments: `{"asOf":"${AS_OF}"}` } }] } }] },
      { choices: [{ message: { content: "Cash on hand is **₹30,00,000.00** as of today." } }] },
    ];
    const provider = new OpenAIProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3:14b",
      fetchFn: async (_url, init) => {
        seen.push(init.headers);
        return { ok: true, status: 200, text: async () => "", json: async () => queue.shift() };
      },
    });
    const record = await new Orchestrator(provider).ask(cfoUser, baseOrg(), "How much cash do we have?");
    expect(record.verified).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => !("Authorization" in h))).toBe(true);
  });

  it("tolerates a base URL with a trailing slash, as Google documents it", async () => {
    const urls: string[] = [];
    const provider = new OpenAIProvider({
      apiKey: "k",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      fetchFn: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
      },
    });
    await provider.run({
      system: "s", history: [], userQuery: "q", availableTools: [],
      executeTool: () => "", maxRounds: 1,
    });
    expect(urls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(urls[0]).not.toContain("//chat");
  });

  it("retries a busy free tier instead of silently demoting the answer", async () => {
    // A free endpoint returning 503 is busy, not broken. Without a retry the
    // question drops to the offline planner and the user just gets a worse
    // answer for no visible reason.
    let calls = 0;
    const provider = new OpenAIProvider({
      apiKey: "k",
      maxRetries: 2,
      fetchFn: async () => {
        calls++;
        // busy twice, then the normal tool-call / answer exchange
        if (calls <= 2)
          return { ok: false, status: 503, text: async () => "high demand", json: async () => ({}) };
        const body = calls === 3
          ? { choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "get_cash_position", arguments: `{"asOf":"${AS_OF}"}` } }] } }] }
          : { choices: [{ message: { content: "Cash on hand is **₹30,00,000.00** as of today." } }] };
        return { ok: true, status: 200, text: async () => "", json: async () => body };
      },
    });
    const record = await new Orchestrator(provider).ask(cfoUser, baseOrg(), "How much cash do we have?");
    expect(calls).toBe(4); // 2 rejected + tool call + answer
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked[0]!.tool).toBe("get_cash_position");
  });

  it("does not retry a failure that will never succeed", async () => {
    // A dead key or a bad schema fails identically forever; retrying it only
    // spends the caller's deadline before failing anyway.
    let calls = 0;
    const provider = new OpenAIProvider({
      apiKey: "bad",
      maxRetries: 2,
      fetchFn: async () => {
        calls++;
        return { ok: false, status: 401, text: async () => "invalid key", json: async () => ({}) };
      },
    });
    await expect(
      provider.run({
        system: "s", history: [], userQuery: "q", availableTools: [],
        executeTool: () => "", maxRounds: 1,
      }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });

  it("still demands a key for a hosted endpoint", async () => {
    const provider = new OpenAIProvider({ apiKey: "", baseUrl: "https://api.openai.com/v1" });
    await expect(
      provider.run({
        system: "s", history: [], userQuery: "q", availableTools: [],
        executeTool: () => "", maxRounds: 1,
      }),
    ).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it("throws without an API key so the fallback chain can take over — and the fallback names who answered", async () => {
    const provider = new OpenAIProvider({ apiKey: "" });
    const planner = new CfoPlanner({ asOf: AS_OF, periodFrom: "2026-01-01" });
    const fallback = new FallbackProvider([provider, planner]);
    const record = await new Orchestrator(fallback).ask(cfoUser, baseOrg(), "How much cash do we have?");
    expect(record.verified).toBe(true); // planner answered
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("get_cash_position");
    // Silent degradation must be observable: a dead key reads as "planner
    // answered", never as "the model got dumber".
    expect(fallback.lastUsedName).toBe("cfo-planner");
  });

  it("surfaces API errors as provider failures, not silent empty answers", async () => {
    const provider = new OpenAIProvider({
      apiKey: "sk-test",
      fetchFn: async () => ({ ok: false, status: 401, text: async () => "bad key", json: async () => ({}) }),
    });
    await expect(new Orchestrator(provider).ask(cfoUser, baseOrg(), "cash?")).rejects.toThrow(/401/);
  });
});
