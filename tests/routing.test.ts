/**
 * The router's one job is to never withhold a tool the answer needed.
 *
 * A tool that was required and not offered does not produce "I lacked a
 * tool" — it produces an improvised answer, which is the exact failure the
 * rest of the architecture exists to prevent. So the load-bearing test here
 * is that every golden case still receives everything it is graded on, and
 * it runs against the real GOLDEN_CASES so a new case cannot be added
 * without the router being checked against it.
 */
import { describe, expect, it } from "vitest";
import { routeTools } from "../src/ai/routing.js";
import { GOLDEN_CASES } from "../src/ai/eval.js";
import { TOOL_SPECS, toolNames } from "../src/ai/tools.js";

describe("tool routing", () => {
  it("offers every tool each golden case is graded on", () => {
    const missing: string[] = [];
    for (const c of GOLDEN_CASES) {
      const offered = new Set(routeTools(c.question));
      for (const needed of c.expectTools)
        if (!offered.has(needed)) missing.push(`${c.id}: "${c.question}" → missing ${needed}`);
    }
    expect(missing).toEqual([]);
  });

  it("actually narrows the menu for a focused question", () => {
    const all = toolNames().length;
    const routed = routeTools("What is my cash position?").length;
    expect(routed).toBeLessThan(all);
    expect(routed).toBeGreaterThan(0);
  });

  it("returns everything when it cannot tell what the question is about", () => {
    // Guessing narrowly on an unrecognised question is how a router becomes
    // a source of wrong answers rather than a saving.
    expect(routeTools("qwertyuiop zxcvbnm").length).toBe(toolNames().length);
    expect(routeTools("").length).toBe(toolNames().length);
  });

  it("routes the topics that are easy to confuse", () => {
    const has = (q: string, tool: string) => routeTools(q).includes(tool);
    expect(has("Which invoices are overdue?", "list_overdue_invoices")).toBe(true);
    expect(has("How much are we spending on software subscriptions each month?", "get_recurring_payments")).toBe(true);
    expect(has("What is the GST rate on consulting services?", "lookup_regulation")).toBe(true);
    expect(has("What GST do I owe for last month?", "get_gst_position")).toBe(true);
    expect(has("Any duplicate payments last quarter?", "screen_transactions")).toBe(true);
    expect(has("How is my portfolio doing?", "get_portfolio")).toBe(true);
    expect(has("What would happen if I hired someone at ₹1,20,000 a month?", "simulate_scenario")).toBe(true);
  });

  it("never names a tool that does not exist", () => {
    const real = new Set(TOOL_SPECS.map((s) => s.name));
    const questions = [
      "cash", "burn and runway", "profit and loss", "overdue invoices", "gst filing",
      "forecast next month", "health score", "portfolio", "review queue", "fraud check",
      "recommendations", "balance sheet", "subscriptions", "what is the gst rate",
    ];
    for (const q of questions) for (const t of routeTools(q)) expect(real.has(t)).toBe(true);
  });

  it("keeps a stable order, so identical questions cache identically", () => {
    expect(routeTools("What is my cash position?")).toEqual(routeTools("What is my cash position?"));
    const order = toolNames();
    const routed = routeTools("cash and profit and gst");
    const positions = routed.map((t) => order.indexOf(t));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
