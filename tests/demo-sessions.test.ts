import { describe, it, expect, beforeEach } from "vitest";
// @ts-expect-error — demo/ is plain JS, not part of the typed src build
import { demoRuntime, newDemoId, isDemoId, demoStats, resetDemoSessions } from "../demo/demo-sessions.js";

describe("demo sessions", () => {
  beforeEach(() => resetDemoSessions());

  it("gives each visitor their own books", async () => {
    const a = await demoRuntime(newDemoId());
    const b = await demoRuntime(newDemoId());

    expect(a.org.orgId).not.toBe(b.org.orgId);
    expect(demoStats().active).toBe(2);
  });

  it("keeps one visitor's changes out of another's books", async () => {
    const a = await demoRuntime(newDemoId());
    const b = await demoRuntime(newDemoId());

    a.org.recommendations.generate("2026-07-02", "2026-01-01");
    b.org.recommendations.generate("2026-07-02", "2026-01-01");
    const target = a.org.recommendations.pending()[0]!;

    a.org.recommendations.approve(target.id, "demo");

    expect(a.org.recommendations.all().find((r) => r.id === target.id)?.status).toBe("approved");
    // B's recommendations are its own objects with its own ids — A's approval
    // is not visible here in any form.
    expect(b.org.recommendations.all().some((r) => r.id === target.id)).toBe(false);
    expect(b.org.recommendations.pending().length).toBeGreaterThan(0);
  });

  it("returns the same books for the same visitor", async () => {
    const id = newDemoId();
    const first = await demoRuntime(id);
    const again = await demoRuntime(id);
    expect(again.org).toBe(first.org);
    expect(demoStats().active).toBe(1);
  });

  it("seeds every visitor with the same company", async () => {
    const a = await demoRuntime(newDemoId());
    const b = await demoRuntime(newDemoId());
    expect(a.org.cashflow.cashOnHand("2026-07-02")).toBe(b.org.cashflow.cashOnHand("2026-07-02"));
  });

  it("caps how many sessions can exist at once", async () => {
    const { max } = demoStats();
    for (let i = 0; i < max + 10; i++) await demoRuntime(newDemoId());
    expect(demoStats().active).toBeLessThanOrEqual(max);
  });

  it("only accepts ids it could have issued", () => {
    expect(isDemoId(newDemoId())).toBe(true);
    expect(isDemoId("org_nimbus")).toBe(false);
    expect(isDemoId("demo_../../etc")).toBe(false);
    expect(isDemoId("")).toBe(false);
    expect(isDemoId(undefined)).toBe(false);
  });
});
