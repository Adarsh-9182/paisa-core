import { describe, it, expect, vi } from "vitest";
import { indiaBusinessDate, runScheduledCfo } from "../src/erp/cfo-schedule.js";
import type { CfoRun } from "../src/erp/cfo-agent.js";

const run: CfoRun = {
  asOf: "2026-09-10", period: "2026-09", actor: "cfo-agent",
  ranAt: "2026-09-10T03:30:00Z", plays: [], acted: 0, waiting: 0, quiet: true,
};

const runtime = () => ({
  sync: vi.fn(async () => ({})),
  execute: vi.fn(async () => ({ result: run })),
});

describe("the scheduled CFO clock", () => {
  it.each([
    ["2026-09-09T18:29:59Z", "2026-09-09"],
    ["2026-09-09T18:30:00Z", "2026-09-10"],
    ["2026-09-30T18:30:00Z", "2026-10-01"],
    ["2026-12-31T18:30:00Z", "2027-01-01"],
  ])("uses the Indian business date at %s", (instant, date) => {
    expect(indiaBusinessDate(new Date(instant))).toBe(date);
  });

  it("syncs first, then persists today's date and the decision version", async () => {
    const rt = runtime();
    const response = await runScheduledCfo(rt, "postgres", new Date("2026-09-10T03:30:00Z"));
    expect(rt.execute).toHaveBeenCalledExactlyOnceWith("cfo.run", { asOf: "2026-09-10", version: 2 }, "cfo-agent");
    expect(rt.sync.mock.invocationCallOrder[0]).toBeLessThan(rt.execute.mock.invocationCallOrder[0]!);
    expect(response).toMatchObject({ ok: true, asOf: "2026-09-10", durable: true, quiet: true });
    expect(response.digest).toContain("2026-09-10");
  });

  it.each(["memory", "memory-fallback", "unknown"])("refuses %s before touching the books", async (mode) => {
    const rt = runtime();
    await expect(runScheduledCfo(rt, mode)).rejects.toThrow("requires durable storage");
    expect(rt.sync).not.toHaveBeenCalled();
    expect(rt.execute).not.toHaveBeenCalled();
  });

  it("does not act on stale books when sync fails", async () => {
    const rt = runtime();
    rt.sync.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(runScheduledCfo(rt, "postgres")).rejects.toThrow("storage unavailable");
    expect(rt.execute).not.toHaveBeenCalled();
  });

  it("propagates a failed command instead of reporting a successful run", async () => {
    const rt = runtime();
    rt.execute.mockRejectedValueOnce(new Error("command failed"));
    await expect(runScheduledCfo(rt, "postgres")).rejects.toThrow("command failed");
  });
});
