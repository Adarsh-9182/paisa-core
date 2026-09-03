import { describe, it, expect } from "vitest";
import {
  Platform, parseINR,
  MockProvider, Orchestrator, NarrationError, verifyNarration,
  parseCsvDocument, truncateDocumentText, DOCUMENT_TOOL, MAX_DOCUMENT_TEXT_CHARS,
  AiUser, UploadedDocument,
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
  userId: "adarsh",
  orgId: "org_abc",
  permissions: new Set(["access_ai_cfo", "view_reports"]),
};

describe("parseCsvDocument", () => {
  it("normalizes rows to pipe-separated cells, figures verbatim", () => {
    const doc = parseCsvDocument("stmt.csv", "date,description,amount\n2026-06-01,SWIGGY,-2,400\n");
    expect(doc.source).toBe("csv");
    // The unquoted amount "-2,400" splits on its comma — verbatim cells, no guessing.
    expect(doc.text).toBe("date | description | amount\n2026-06-01 | SWIGGY | -2 | 400");
  });

  it("respects quoted fields with embedded commas and escaped quotes", () => {
    const doc = parseCsvDocument("stmt.csv", '2026-06-01,"UPI, SWIGGY ORDER","1,45,000"\n"He said ""hi""",x,y');
    expect(doc.text).toBe('2026-06-01 | UPI, SWIGGY ORDER | 1,45,000\nHe said "hi" | x | y');
  });

  it("drops blank lines and truncates oversized documents", () => {
    const doc = parseCsvDocument("big.csv", "a,b\n\n\n" + "x".repeat(MAX_DOCUMENT_TEXT_CHARS + 100));
    expect(doc.text.endsWith("[truncated]")).toBe(true);
    expect(truncateDocumentText("short")).toBe("short");
  });
});

describe("verifyNarration — a year is a date, not a figure", () => {
  it("allows a bare year when nothing was looked up", () => {
    // The case this exists for: a question the ledger cannot answer, where
    // there is no tool output to ground anything against. Rejecting the
    // refusal turns an honest "I can't forecast that" into "I couldn't
    // verify every figure", which reads as a malfunction.
    expect(() => verifyNarration("I can't project revenue for 2035 from the ledger.", [])).not.toThrow();
    expect(() => verifyNarration("As of 2026-07-02 I have no basis for that.", [])).not.toThrow();
  });

  it("lets the model quote the user's own figure in order to correct it", () => {
    // The most valuable sentence this product can produce was being thrown
    // away over the ₹40 it quotes to refute.
    const question = "Our revenue last month was about ₹40 lakh, right?";
    const tools = ["revenue=₹14,67,945.21 expenses=₹5,70,600.00"];
    expect(() =>
      verifyNarration(
        "That is incorrect. Revenue was **₹14,67,945.21**, not ₹40 lakh.",
        tools,
        question,
      ),
    ).not.toThrow();
    // and without the question as context it is still a stranger's number
    expect(() =>
      verifyNarration("That is incorrect. Revenue was **₹14,67,945.21**, not ₹40 lakh.", tools),
    ).toThrow(NarrationError);
  });

  it("reads an ISO date as a date, not as three figures", () => {
    // "2026-06-30" is 2026, 06 and 30; the last is past the small-integer
    // allowance, so a correct answer failed on its own reporting period.
    expect(() =>
      verifyNarration(
        "For the period 2026-06-01 to 2026-06-30, revenue was ₹14,67,945.21.",
        ["revenue=₹14,67,945.21"],
      ),
    ).not.toThrow();
  });

  it("still refuses an ungrounded money figure of its own", () => {
    expect(() => verifyNarration("Revenue was ₹2026.", [])).toThrow(NarrationError);
    expect(() => verifyNarration("Revenue was ₹40,00,000.", [])).toThrow(NarrationError);
    // outside any plausible year, so still a claim about a quantity
    expect(() => verifyNarration("We have 45000 in the bank.", [])).toThrow(NarrationError);
  });
});

describe("verifyNarration — ₹ fallback (spec 004)", () => {
  it("accepts a ₹-prefixed figure whose bare numerals appear in a tool output", () => {
    expect(() =>
      verifyNarration("You paid **₹1,45,000** to the landlord.", ["2026-06-01 | RENT | 1,45,000"]),
    ).not.toThrow();
  });

  it("still rejects figures found nowhere", () => {
    expect(() =>
      verifyNarration("You paid ₹9,99,999.", ["2026-06-01 | RENT | 1,45,000"]),
    ).toThrow(NarrationError);
  });
});

describe("orchestrator with an attached document", () => {
  const doc: UploadedDocument = {
    name: "june-statement.csv",
    source: "csv",
    text: "date | description | amount\n2026-06-01 | LANDLORD RENT | 45,500\n2026-06-03 | SWIGGY | 2,315",
  };

  it("records the document as a synthetic tool result and verifies figures from it", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "final", text: "Your biggest line was rent at **₹45,500**, then Swiggy at **₹2,315**." },
    ]);
    const orch = new Orchestrator(provider);
    const record = await orch.ask(cfoUser, org, "What are the big items in this statement?", [], undefined, doc);
    expect(record.verified).toBe(true);
    expect(record.toolsInvoked[0]?.tool).toBe(DOCUMENT_TOOL);
    expect(record.toolsInvoked[0]?.result).toContain("LANDLORD RENT");
    // The audit keeps the user's actual question, not the augmented prompt.
    expect(record.userQuery).toBe("What are the big items in this statement?");
  });

  it("passes the document content to the provider inside the user turn", async () => {
    const org = seededOrg();
    let seenQuery = "";
    const provider = {
      name: "probe",
      run: async (ctx: { userQuery: string }) => {
        seenQuery = ctx.userQuery;
        return "Nothing notable.";
      },
    };
    const orch = new Orchestrator(provider);
    await orch.ask(cfoUser, org, "Summarize", [], undefined, doc);
    expect(seenQuery).toContain("Summarize");
    expect(seenQuery).toContain('[Attached csv document "june-statement.csv"');
    expect(seenQuery).toContain("LANDLORD RENT");
  });

  it("still rejects figures found in neither the document nor tool outputs", async () => {
    const org = seededOrg();
    const provider = new MockProvider([
      { kind: "final", text: "You spent ₹77,777 on rent." },
      { kind: "final", text: "You spent ₹77,777 on rent." }, // corrective retry repeats the sin
    ]);
    const orch = new Orchestrator(provider);
    await expect(
      orch.ask(cfoUser, org, "What did I spend on rent?", [], undefined, doc),
    ).rejects.toThrow(NarrationError);
  });
});
