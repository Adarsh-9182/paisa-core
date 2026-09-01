import { describe, it, expect } from "vitest";
import { EventBus } from "../src/events.js";
import { ActionQueue, ActionError } from "../src/actions.js";

const store = (opts: { ttl?: number; clock?: () => Date } = {}) => {
  const bus = new EventBus();
  return {
    // The bus keeps an audit log per org; read it rather than subscribing.
    events: () => bus.audit("org_test").map((e) => e.type),
    store: new ActionQueue("org_test", bus, opts.ttl ?? 60, opts.clock),
  };
};

const propose = (s: ActionQueue, effect: () => string, kind = "categorize") =>
  s.propose({
    kind,
    summary: "Categorise the Swiggy line as Meals",
    detail: "reference=imps-4032 account=5400 amount=₹1,250.00",
    proposedBy: "cfo-agent",
    effect,
  });

describe("ActionQueue", () => {
  it("does not run the effect when the proposal is made", () => {
    let ran = false;
    const { store: s } = store();
    const p = propose(s, () => { ran = true; return "posted"; });

    expect(ran).toBe(false);
    expect(p.status).toBe("pending");
    expect(s.pending()).toHaveLength(1);
  });

  it("runs the effect only on approval, and records what it returned", () => {
    let ran = false;
    const { store: s } = store();
    const p = propose(s, () => { ran = true; return "entry je_9 posted"; });

    const approved = s.approve(p.id, "adarsh");
    expect(ran).toBe(true);
    expect(approved.status).toBe("approved");
    expect(approved.result).toBe("entry je_9 posted");
    expect(approved.decidedBy).toBe("adarsh");
    expect(s.pending()).toHaveLength(0);
  });

  it("never runs the effect when dismissed", () => {
    let ran = false;
    const { store: s } = store();
    const p = propose(s, () => { ran = true; return "posted"; });

    expect(s.dismiss(p.id, "adarsh").status).toBe("dismissed");
    expect(ran).toBe(false);
  });

  it("cannot be approved twice — a double-clicked button posts once", () => {
    let runs = 0;
    const { store: s } = store();
    const p = propose(s, () => { runs++; return "posted"; });

    s.approve(p.id, "adarsh");
    expect(() => s.approve(p.id, "adarsh")).toThrow(ActionError);
    expect(runs).toBe(1);
  });

  it("cannot be dismissed after approval, or approved after dismissal", () => {
    const { store: s } = store();
    const a = propose(s, () => "ok");
    s.approve(a.id, "adarsh");
    expect(() => s.dismiss(a.id, "adarsh")).toThrow(/already approved/);

    const b = propose(s, () => "ok");
    s.dismiss(b.id, "adarsh");
    expect(() => s.approve(b.id, "adarsh")).toThrow(/already dismissed/);
  });

  it("leaves the proposal pending when the effect throws", () => {
    const { store: s } = store();
    let attempts = 0;
    const p = propose(s, () => {
      attempts++;
      if (attempts === 1) throw new Error("ledger locked");
      return "posted on retry";
    });

    expect(() => s.approve(p.id, "adarsh")).toThrow(/ledger locked/);
    expect(s.get(p.id).status).toBe("pending");

    // Still approvable once the underlying problem is gone.
    expect(s.approve(p.id, "adarsh").result).toBe("posted on retry");
  });

  it("expires rather than acting on numbers that have since moved", () => {
    let now = new Date("2026-07-02T10:00:00Z");
    let ran = false;
    const { store: s } = store({ ttl: 30, clock: () => now });
    const p = propose(s, () => { ran = true; return "posted"; });

    now = new Date("2026-07-02T10:31:00Z");
    expect(s.approve(p.id, "adarsh").status).toBe("expired");
    expect(ran).toBe(false);
    expect(s.pending()).toHaveLength(0);
  });

  it("rejects an unknown id", () => {
    const { store: s } = store();
    expect(() => s.approve("prop_nope", "adarsh")).toThrow(/Unknown proposal/);
  });

  it("emits an auditable event for every transition", () => {
    const { store: s, events } = store();
    const a = propose(s, () => "ok");
    s.approve(a.id, "adarsh");
    const b = propose(s, () => "ok");
    s.dismiss(b.id, "adarsh");

    expect(events()).toEqual([
      "proposal.created",
      "proposal.approved",
      "proposal.created",
      "proposal.dismissed",
    ]);
  });
});
