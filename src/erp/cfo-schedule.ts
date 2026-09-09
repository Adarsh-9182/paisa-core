/** Capture wall-clock time at the scheduler boundary, before persisting a run. */
import { type CfoRun, describeRun } from "./cfo-agent.js";

export interface ScheduledRuntime {
  sync(): Promise<unknown>;
  execute(type: string, payload: Record<string, unknown>, actor: string): Promise<{ readonly result: CfoRun }>;
}

export class CfoScheduleUnavailableError extends Error {
  override name = "CfoScheduleUnavailableError";
}

/** Indian SMB business date; independent of the server's timezone. */
export function indiaBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * A schedule needs shared memory of its actions. An isolated in-memory run
 * would lose its drafts on restart and repeat them on the next invocation.
 */
export async function runScheduledCfo(runtime: ScheduledRuntime, persistenceMode: string, now = new Date()) {
  if (persistenceMode !== "postgres")
    throw new CfoScheduleUnavailableError("The CFO schedule requires durable storage; this run was not started.");

  const asOf = indiaBusinessDate(now);
  await runtime.sync();
  const { result } = await runtime.execute("cfo.run", { asOf, version: 2 }, "cfo-agent");
  return {
    ok: true,
    asOf,
    persistence: persistenceMode,
    durable: true,
    acted: result.acted,
    waiting: result.waiting,
    quiet: result.quiet,
    digest: describeRun(result),
  };
}
