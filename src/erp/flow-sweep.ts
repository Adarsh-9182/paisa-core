/**
 * The sweep — the one place a clock is allowed to decide anything.
 *
 * Everything downstream of here is replayable because this function does the
 * time-dependent part once, and emits a command per occurrence naming it
 * explicitly. Replay applies those named occurrences; it never re-derives
 * what was due, because "what is due" depends on when you ask.
 *
 * That split is the reason `planRuns` is pure and this is not.
 */

import { planRuns, type FlowDefinition, type FlowRun, type FlowStore } from "./flows.js";

/** What the sweep needs from the runtime, narrowed so tests need no database. */
export interface SweepRuntime {
  execute<T = unknown>(
    type: string,
    payload: Record<string, unknown>,
    actor: string,
  ): Promise<{ readonly result: T }>;
}

export interface SweepResult {
  readonly runs: readonly FlowRun[];
  /** Occurrences whose command itself failed to apply, with the reason. */
  readonly errors: readonly { readonly flowId: string; readonly occurrenceKey: string; readonly error: string }[];
}

/**
 * Run everything due as of `asOf`, one command per occurrence.
 *
 * Occurrences are executed in the order `planRuns` returns them, which for a
 * catch-up is oldest first. That ordering is load-bearing for posting flows:
 * May's amortisation must be appended before June's, so a replay rebuilds the
 * same ledger in the same sequence.
 *
 * A command that throws is caught and reported rather than stopping the
 * sweep. One flow with a bad rule must not prevent the other nine from
 * running, and the failed occurrence stays owed — `record` keeps failures out
 * of the completed set, so the next sweep tries it again.
 */
export const sweepFlows = async (
  runtime: SweepRuntime,
  flows: readonly FlowDefinition[],
  store: FlowStore,
  asOf: string,
  actor: string,
): Promise<SweepResult> => {
  const runs: FlowRun[] = [];
  const errors: { flowId: string; occurrenceKey: string; error: string }[] = [];

  for (const flow of flows) {
    for (const planned of planRuns(flow, store, asOf)) {
      try {
        const { result } = await runtime.execute<FlowRun>(
          "flows.run",
          {
            flowId: flow.id,
            occurrenceKey: planned.occurrence.key,
            scheduledFor: planned.occurrence.scheduledFor,
            period: planned.occurrence.period,
            action: planned.action,
            ...(planned.reason ? { reason: planned.reason } : {}),
          },
          actor,
        );
        runs.push(result);
      } catch (err) {
        errors.push({
          flowId: flow.id,
          occurrenceKey: planned.occurrence.key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { runs, errors };
};
