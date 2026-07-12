/**
 * Spec 007 — fine-tuning data pipeline. The properties that matter:
 * determinism (a seed pins the dataset), honesty (only verified narrations
 * become training data), and format (every line is a valid chat example
 * whose figures are traceable to its own inlined tool results).
 */

import { describe, it, expect } from "vitest";
import {
  generateSyntheticDataset, auditRecordToExample, toJsonl, NARRATOR_SYSTEM,
  extractFigures, AiAuditRecord,
} from "../src/index.js";

describe("generateSyntheticDataset", () => {
  it("same seed → byte-identical dataset; different seed → different dataset", async () => {
    const a = await generateSyntheticDataset(12, 42);
    const b = await generateSyntheticDataset(12, 42);
    const c = await generateSyntheticDataset(12, 7);
    expect(toJsonl(a.examples)).toEqual(toJsonl(b.examples));
    expect(toJsonl(a.examples)).not.toEqual(toJsonl(c.examples));
    expect(a.examples.length).toBe(12);
  }, 30_000);

  it("covers multiple scenario families in a modest sample", async () => {
    const { examples } = await generateSyntheticDataset(40, 3);
    const scenarios = new Set(examples.map((e) => e.meta.scenario));
    expect(scenarios.size).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it("every example is well-formed and self-grounded", async () => {
    const { examples, discarded } = await generateSyntheticDataset(25, 11);
    expect(discarded).toBe(0); // planner narrations are verified by construction
    for (const ex of examples) {
      expect(ex.messages[0]).toEqual({ role: "system", content: NARRATOR_SYSTEM });
      expect(ex.messages[1]!.role).toBe("user");
      expect(ex.messages[1]!.content).toContain("[Tool results");
      expect(ex.messages[2]!.role).toBe("assistant");
      // Self-grounding: every figure in the completion appears in the prompt's
      // tool results — the property the fine-tuned narrator must learn.
      const prompt = ex.messages[1]!.content.replace(/[,\s]/g, "");
      for (const fig of extractFigures(ex.messages[2]!.content)) {
        const n = fig.replace(/[,\s]/g, "");
        const bare = n.startsWith("₹") ? n.slice(1) : n;
        const small = !n.startsWith("₹") && !n.endsWith("%") && Number(n) <= 12;
        expect(small || prompt.includes(n) || prompt.includes(bare)).toBe(true);
      }
    }
  }, 60_000);

  it("emits valid JSONL", async () => {
    const { examples } = await generateSyntheticDataset(5, 99);
    const lines = toJsonl(examples).trim().split("\n");
    expect(lines.length).toBe(5);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { messages: unknown[] };
      expect(parsed.messages.length).toBe(3);
    }
  }, 30_000);
});

describe("auditRecordToExample", () => {
  const record = (verified: boolean): AiAuditRecord => ({
    userQuery: "How much cash?",
    toolsInvoked: [{ tool: "get_cash_position", args: { asOf: "2026-07-02" }, result: "cash_on_hand=₹5,00,000.00 as_of=2026-07-02" }],
    finalAnswer: "You hold **₹5,00,000.00** in cash.",
    verified,
    at: "2026-07-02T10:00:00Z",
  });

  it("converts a verified record into the chat format", () => {
    const ex = auditRecordToExample(record(true), { scenario: "cash", seed: 1 });
    expect(ex).not.toBeNull();
    expect(ex!.messages[1]!.content).toContain("get_cash_position");
    expect(ex!.messages[2]!.content).toContain("₹5,00,000.00");
    expect(ex!.meta.tools).toEqual(["get_cash_position"]);
  });

  it("refuses unverified records — they must never teach", () => {
    expect(auditRecordToExample(record(false), { scenario: "cash", seed: 1 })).toBeNull();
  });
});
