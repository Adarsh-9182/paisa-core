/**
 * Spec 005 — compliance knowledge base.
 *
 * Part 1 is corpus hygiene (every entry cited and dated), part 2 is the
 * retrieval EVAL BENCHMARK: golden questions pinned to the entry that must
 * answer them. Extend the benchmark with every corpus change — it is the
 * regression net that lets the corpus grow without retrieval rotting.
 * Part 3 proves the Golden Rule extension end-to-end: legal figures reach
 * a narration only via lookup_regulation, and the verifier enforces it.
 */

import { describe, it, expect } from "vitest";
import {
  Platform, parseINR,
  KNOWLEDGE_BASE, searchKnowledge, getRegulation,
  TOOLS, MockProvider, Orchestrator, NarrationError, CfoPlanner,
  AiUser,
} from "../src/index.js";

const seededOrg = () => {
  const platform = new Platform();
  const org = platform.createOrganization("org_abc", "ABC Technologies");
  org.journal.post({
    date: "2026-01-01", narration: "Seed",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR("30,00,000") },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR("30,00,000") },
    ],
    sourceModule: "manual", createdBy: "adarsh",
  });
  return org;
};

const cfoUser: AiUser = {
  userId: "user_adarsh",
  orgId: "org_abc",
  permissions: new Set(["access_ai_cfo", "view_reports"]),
};

describe("knowledge base — corpus hygiene", () => {
  it("every entry is cited, dated, and format-safe", () => {
    expect(KNOWLEDGE_BASE.length).toBeGreaterThanOrEqual(15);
    const ids = new Set<string>();
    for (const e of KNOWLEDGE_BASE) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(e.source.length).toBeGreaterThan(10);
      expect(e.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.text.length).toBeGreaterThan(100);
      expect(e.tags.length).toBeGreaterThanOrEqual(4);
      // Entries are embedded in key="value" tool output — a double quote
      // inside would silently truncate what the model sees.
      expect(e.title).not.toContain('"');
      expect(e.source).not.toContain('"');
      expect(e.text).not.toContain('"');
    }
  });

  it("getRegulation finds by id", () => {
    expect(getRegulation("cgst-s16-itc-conditions")?.source).toContain("s.16");
    expect(getRegulation("nope")).toBeUndefined();
  });
});

/**
 * The eval benchmark. Each case: a question a real user would ask, and the
 * entry that must appear at (or near) the top. `within` = max acceptable
 * rank, default 1 (strict top hit).
 */
const BENCHMARK: readonly { q: string; id: string; within?: number }[] = [
  { q: "What GST rate applies to software services?", id: "gst-software-services-rate" },
  { q: "Is export of software zero-rated?", id: "gst-software-services-rate" },
  { q: "What are the conditions to claim input tax credit?", id: "cgst-s16-itc-conditions" },
  { q: "Is ITC blocked on food and beverages?", id: "cgst-s17-5-blocked-itc" },
  { q: "Can I claim ITC on office food and drinks?", id: "cgst-s17-5-blocked-itc", within: 2 },
  { q: "Am I eligible for the composition scheme?", id: "gst-composition-scheme" },
  { q: "When do I need to register for GST and what is the threshold?", id: "gst-registration-threshold" },
  { q: "GST registration threshold for services", id: "gst-registration-threshold" },
  { q: "What are the GST rate slabs now?", id: "gst-rate-slabs" },
  { q: "GSTR-9 annual return due date", id: "gst-return-due-dates" },
  { q: "Do we need e-invoicing? What is the threshold?", id: "gst-e-invoicing" },
  { q: "Who pays GST under reverse charge on legal services from an advocate?", id: "gst-reverse-charge" },
  { q: "How does 44ADA presumptive taxation work for freelancers?", id: "it-44ada-presumptive-professionals" },
  { q: "What is the turnover limit under section 44AD?", id: "it-44ad-presumptive-business" },
  { q: "New regime income tax slabs", id: "it-new-regime-slabs" },
  { q: "How much can I deduct under 80C?", id: "it-80c-80d-deductions" },
  { q: "80D health insurance deduction for parents under the old regime", id: "it-80c-80d-deductions" },
  { q: "TDS rate on professional fees", id: "it-tds-common-sections" },
  { q: "TDS threshold for contractor payments", id: "it-tds-common-sections" },
  { q: "When is advance tax due?", id: "it-advance-tax" },
];

describe("knowledge base — retrieval eval benchmark", () => {
  for (const { q, id, within = 1 } of BENCHMARK) {
    it(`"${q}" → ${id} (top ${within})`, () => {
      const got = searchKnowledge(q).slice(0, within).map((m) => m.entry.id);
      expect(got).toContain(id);
    });
  }

  it("is deterministic — same query, same ranking", () => {
    const a = searchKnowledge("can I claim ITC on food?").map((m) => m.entry.id);
    const b = searchKnowledge("can I claim ITC on food?").map((m) => m.entry.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("returns nothing rather than guessing on unrelated questions", () => {
    expect(searchKnowledge("what's my runway looking like")).toEqual([]);
    expect(searchKnowledge("hello there")).toEqual([]);
    expect(searchKnowledge("")).toEqual([]);
  });

  it("respects the result limit", () => {
    expect(searchKnowledge("gst itc tax credit return", 2).length).toBeLessThanOrEqual(2);
  });
});

describe("lookup_regulation tool", () => {
  const org = seededOrg();

  it("returns cited, dated passages with figures verbatim", () => {
    const out = TOOLS.lookup_regulation!(org, { query: "GST rate on software services" });
    expect(out).toContain("verified_as_of=2025-09-22");
    expect(out).toContain("SAC 9983");
    expect(out).toContain("18%");
    expect(out).toContain("source=");
  });

  it("says so when the knowledge base has no answer", () => {
    const out = TOOLS.lookup_regulation!(org, { query: "quantum entanglement rules" });
    expect(out).toContain("matches=0");
    expect(out).toContain("do not answer from memory");
  });
});

describe("Golden Rule over law — verifier integration", () => {
  it("legal figures quoted from lookup_regulation pass verification", async () => {
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "lookup_regulation", args: { query: "TDS on professional fees" } }] },
      {
        kind: "final",
        text: "TDS on professional fees is **10%** once you cross the ₹50,000 annual threshold (s.194J, verified as of 2025-04-01). _Confirm with your CA for edge cases._",
      },
    ]);
    const record = await new Orchestrator(provider).ask(cfoUser, seededOrg(), "TDS on professional fees?");
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked.map((t) => t.tool)).toContain("lookup_regulation");
  });

  it("a rate the tool never returned is rejected", async () => {
    const provider = new MockProvider([
      { kind: "tool_calls", toolCalls: [{ tool: "lookup_regulation", args: { query: "TDS on professional fees" } }] },
      { kind: "final", text: "TDS is 37% on everything." },
      { kind: "final", text: "TDS is 37% on everything." }, // corrective retry also refuses to fix it
    ]);
    await expect(new Orchestrator(provider).ask(cfoUser, seededOrg(), "TDS rate?")).rejects.toThrow(NarrationError);
  });
});

describe("offline planner — regulation routing", () => {
  const planner = () => new CfoPlanner({ asOf: "2026-07-11", periodFrom: "2026-07-01" });

  it("routes law questions to lookup_regulation and answers with citations", async () => {
    const record = await new Orchestrator(planner()).ask(
      cfoUser, seededOrg(), "Can I claim ITC on food and drinks for the office?",
    );
    expect(record.toolsInvoked[0]!.tool).toBe("lookup_regulation");
    expect(record.finalAnswer).toContain("s.17(5)");
    expect(record.verified).toBe(true);
  });

  it("quotes the exact statutory rate for a rate question", async () => {
    const record = await new Orchestrator(planner()).ask(
      cfoUser, seededOrg(), "What GST rate applies to software services?",
    );
    expect(record.toolsInvoked[0]!.tool).toBe("lookup_regulation");
    expect(record.finalAnswer).toContain("18%");
    expect(record.finalAnswer).toContain("998314");
  });

  it("routes TDS questions to the knowledge base", async () => {
    const record = await new Orchestrator(planner()).ask(
      cfoUser, seededOrg(), "How much TDS should I deduct on my CA's professional fees?",
    );
    expect(record.toolsInvoked[0]!.tool).toBe("lookup_regulation");
    expect(record.finalAnswer).toContain("194J");
  });

  it("still routes THIS business's tax position to the live GST tools", async () => {
    const record = await new Orchestrator(planner()).ask(
      cfoUser, seededOrg(), "What is my GST position for this month?",
    );
    const tools = record.toolsInvoked.map((t) => t.tool);
    expect(tools).toContain("get_gst_position");
    expect(tools).not.toContain("lookup_regulation");
  });
});
