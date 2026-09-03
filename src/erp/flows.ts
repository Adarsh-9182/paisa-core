/**
 * Flows — the scheduling layer above the agents.
 *
 * `agents.ts` answers "what is wrong with the books right now". It runs when
 * something asks it to. Flows answer the other half: "run this every month on
 * the 1st, whether or not anyone remembers". Close prep, a weekly cash
 * forecast, prepaid amortisation, a board summary — the work a finance team
 * does on a calendar rather than on demand.
 *
 * Three rules carry over from the agent layer unchanged, because a scheduled
 * agent is still an agent:
 *
 *   - A flow proposes. Approving is still what posts, and the approval is
 *     still attributed. A flow that could post unattended would be automation
 *     a controller switches off after the first surprise.
 *   - Scheduling is deterministic. The clock is injected, the cadence is
 *     arithmetic over dates, and no run depends on a model. What ran, and
 *     what was due, is reproducible a year later during an audit.
 *   - Nothing is dropped silently. An occurrence that is deliberately not run
 *     is recorded with the reason, in the same shape as one that ran.
 *
 * The subtle part is what happens after downtime, and it is the reason this
 * file has a `catchUp` field rather than a single obvious behaviour. If a
 * monthly flow has not run since April and it is now September, two different
 * right answers exist and the flow has to say which one it means:
 *
 *   - A prepaid amortisation must post for May, June, July and August. Every
 *     period's entry is owed; skipping four leaves the books wrong. That is
 *     `catchUp: "each"`.
 *   - A weekly CFO digest must not send four stale digests describing weeks
 *     nobody can act on any more. Only the current one is worth anything.
 *     That is `catchUp: "latest"`, and the four skipped occurrences are
 *     recorded rather than forgotten.
 *
 * Getting that backwards is silent in tests and expensive in production, so
 * it is a required field with no default.
 */

import { PeriodKey } from "./periods.js";

export class FlowError extends Error {
  override name = "FlowError";
}

/* ------------------------------------------------------------------ */
/* Cadence                                                             */
/* ------------------------------------------------------------------ */

/**
 * Dates are treated as UTC calendar days throughout.
 *
 * A ledger's "1st of the month" is a calendar fact, not an instant, and
 * resolving it against a server's local zone would move a posting across a
 * period boundary depending on where the process happened to be running.
 */
export type Cadence =
  | { readonly kind: "daily" }
  /** `weekday` is 0=Sunday … 6=Saturday, matching `Date#getUTCDay`. */
  | { readonly kind: "weekly"; readonly weekday: number }
  /** `day` is 1–31, clamped to the last day of a short month. */
  | { readonly kind: "monthly"; readonly day: number }
  /** Fires in Jan/Apr/Jul/Oct on `day`, clamped the same way. */
  | { readonly kind: "quarterly"; readonly day: number };

/**
 * What to do about occurrences missed while nothing was running.
 * See the file header — there is no safe default.
 */
export type CatchUp = "each" | "latest";

export interface FlowDefinition {
  readonly id: string;
  readonly name: string;
  readonly cadence: Cadence;
  readonly catchUp: CatchUp;
  /** Names the handler in the registry. Several flows may share one. */
  readonly task: string;
  /** No occurrence before this date is ever due. */
  readonly startDate: string;
  readonly enabled: boolean;
  /** Passed through to the handler untouched. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** One scheduled instance of a flow. */
export interface Occurrence {
  /** Stable across a cadence edit — see `occurrenceKey`. */
  readonly key: string;
  /** The calendar day it was scheduled for, `YYYY-MM-DD`. */
  readonly scheduledFor: string;
  /** The accounting period that day falls in, for handlers that post. */
  readonly period: PeriodKey;
}

/* ------------------------------------------------------------------ */
/* Date arithmetic                                                     */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const asUTC = (d: string): number => Date.parse(`${d}T00:00:00Z`);

const toISO = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const daysInMonth = (year: number, month0: number): number => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

const quarterOf = (month0: number): number => Math.floor(month0 / 3) + 1;

/**
 * The day a cadence fires in a given month, clamped.
 *
 * A flow set to the 31st still has to fire in February. Clamping to the last
 * day is the only choice that fires exactly once a month; skipping the month
 * would silently drop a posting a year has twelve of.
 */
const firingDay = (day: number, year: number, month0: number): number => Math.min(day, daysInMonth(year, month0));

/** Whether a calendar day is an occurrence of this cadence. */
const fallsOn = (cadence: Cadence, dateISO: string): boolean => {
  const d = new Date(asUTC(dateISO));
  switch (cadence.kind) {
    case "daily":
      return true;
    case "weekly":
      return d.getUTCDay() === cadence.weekday;
    case "monthly":
      return d.getUTCDate() === firingDay(cadence.day, d.getUTCFullYear(), d.getUTCMonth());
    case "quarterly":
      return (
        d.getUTCMonth() % 3 === 0 &&
        d.getUTCDate() === firingDay(cadence.day, d.getUTCFullYear(), d.getUTCMonth())
      );
  }
};

/**
 * The idempotency key for an occurrence.
 *
 * Monthly and quarterly keys name the period rather than the date, so moving
 * a monthly flow from the 1st to the 5th does not make September look unrun
 * and post it twice. Daily and weekly keys are the date, which already
 * identifies the occurrence uniquely.
 */
export const occurrenceKey = (cadence: Cadence, dateISO: string): string => {
  const d = new Date(asUTC(dateISO));
  switch (cadence.kind) {
    case "daily":
    case "weekly":
      return dateISO;
    case "monthly":
      return dateISO.slice(0, 7);
    case "quarterly":
      return `${d.getUTCFullYear()}-Q${quarterOf(d.getUTCMonth())}`;
  }
};

const validateCadence = (c: Cadence): void => {
  if (c.kind === "weekly" && (!Number.isInteger(c.weekday) || c.weekday < 0 || c.weekday > 6))
    throw new FlowError(`weekday must be 0–6, got ${c.weekday}`);
  if ((c.kind === "monthly" || c.kind === "quarterly") && (!Number.isInteger(c.day) || c.day < 1 || c.day > 31))
    throw new FlowError(`day must be 1–31, got ${c.day}`);
};

/**
 * How far back a single sweep will look for missed occurrences.
 *
 * A flow that has never run and started three years ago should not walk a
 * thousand days on every sweep. The bound is generous enough that a normal
 * outage is caught up in full, and small enough that a misconfigured
 * `startDate` cannot stall the process.
 */
export const MAX_LOOKBACK_DAYS = 400;

/**
 * Every occurrence between `after` (exclusive) and `asOf` (inclusive).
 *
 * Walks day by day rather than computing boundaries directly. A month is not
 * a fixed number of days, quarters do not align to weeks, and February is a
 * standing exception — the arithmetic that gets all three right is longer and
 * easier to get wrong than simply asking each day whether it qualifies.
 */
export const occurrencesBetween = (
  cadence: Cadence,
  after: string | undefined,
  asOf: string,
): readonly Occurrence[] => {
  validateCadence(cadence);
  if (!isDate(asOf)) throw new FlowError(`asOf must be YYYY-MM-DD, got "${asOf}"`);
  if (after !== undefined && !isDate(after)) throw new FlowError(`after must be YYYY-MM-DD, got "${after}"`);

  const end = asUTC(asOf);
  const floor = end - MAX_LOOKBACK_DAYS * DAY_MS;
  // `after` is exclusive, so start the day following it.
  const requested = after === undefined ? floor : asUTC(after) + DAY_MS;
  let cursor = Math.max(requested, floor);

  const out: Occurrence[] = [];
  const seen = new Set<string>();
  for (; cursor <= end; cursor += DAY_MS) {
    const date = toISO(cursor);
    if (!fallsOn(cadence, date)) continue;
    const key = occurrenceKey(cadence, date);
    // A clamped monthly day can only produce one firing per month, but a
    // cadence edited mid-window could otherwise yield two keys the same.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, scheduledFor: date, period: date.slice(0, 7) });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export type RunStatus = "ok" | "failed" | "skipped";

export interface FlowRun {
  readonly flowId: string;
  readonly occurrenceKey: string;
  readonly scheduledFor: string;
  readonly status: RunStatus;
  /** One line a human can read in a list without opening it. */
  readonly summary: string;
  /** Ids of proposals this run raised, if any. Approval still posts them. */
  readonly proposalIds: readonly string[];
  /** Present when `status` is "failed". */
  readonly error?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/** Where run history lives. In-memory here; a database behind the same shape. */
export interface FlowStore {
  hasRun(flowId: string, occurrenceKey: string): boolean;
  /** The most recent attempt, failures included — what an operator should see. */
  lastRun(flowId: string): FlowRun | undefined;
  /**
   * The most recent occurrence that finished, failures excluded.
   *
   * This is the sweep's cursor, and it is deliberately not `lastRun`. A failed
   * run is an occurrence still owed: advancing the cursor past it moves the
   * window beyond the failure, so the retry `hasRun` allows is never reached
   * because the occurrence is no longer in range. The two questions differ,
   * so they are two methods.
   */
  lastCompleted(flowId: string): FlowRun | undefined;
  record(run: FlowRun): void;
  list(flowId?: string): readonly FlowRun[];
}

export const inMemoryFlowStore = (): FlowStore => {
  const runs: FlowRun[] = [];
  const done = new Set<string>();
  const latest = (flowId: string, pred: (r: FlowRun) => boolean) =>
    [...runs].reverse().find((r) => r.flowId === flowId && pred(r));
  return {
    // A failed run is not a completed one: leaving it out of the idempotency
    // set is what lets the next sweep retry it rather than skip it forever.
    hasRun: (flowId, key) => done.has(`${flowId} ${key}`),
    lastRun: (flowId) => latest(flowId, () => true),
    lastCompleted: (flowId) => latest(flowId, (r) => r.status !== "failed"),
    record: (run) => {
      runs.push(run);
      if (run.status !== "failed") done.add(`${run.flowId} ${run.occurrenceKey}`);
    },
    list: (flowId) => (flowId ? runs.filter((r) => r.flowId === flowId) : runs),
  };
};

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

export interface FlowContext {
  readonly flow: FlowDefinition;
  readonly occurrence: Occurrence;
  /** ISO instant the sweep began. */
  readonly now: string;
}

export interface FlowOutcome {
  readonly summary: string;
  readonly proposalIds?: readonly string[];
}

export type FlowHandler = (ctx: FlowContext) => Promise<FlowOutcome> | FlowOutcome;

export type FlowRegistry = ReadonlyMap<string, FlowHandler>;

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

export interface PlannedRun {
  readonly occurrence: Occurrence;
  /** "run" executes the handler; "skip" records why it deliberately did not. */
  readonly action: "run" | "skip";
  readonly reason?: string;
}

/**
 * What a sweep would do, without doing it.
 *
 * Pure, so the catch-up policy is assertable directly rather than inferred
 * from what a handler happened to be called with — and so an operator can be
 * shown the plan before switching a flow on against real books.
 */
export const planRuns = (flow: FlowDefinition, store: FlowStore, asOf: string): readonly PlannedRun[] => {
  if (!flow.enabled) return [];
  if (!isDate(flow.startDate)) throw new FlowError(`startDate must be YYYY-MM-DD, got "${flow.startDate}"`);
  if (asOf < flow.startDate) return [];

  // Completed, not merely most recent: a failed occurrence must stay inside
  // the window so the next sweep can retry it.
  const last = store.lastCompleted(flow.id);
  // Start from the day before startDate so startDate itself can be an
  // occurrence, since `after` is exclusive.
  const after = last ? last.scheduledFor : toISO(asUTC(flow.startDate) - DAY_MS);

  const pending = occurrencesBetween(flow.cadence, after, asOf).filter(
    (o) => o.scheduledFor >= flow.startDate && !store.hasRun(flow.id, o.key),
  );
  if (pending.length === 0) return [];

  if (flow.catchUp === "each") return pending.map((occurrence) => ({ occurrence, action: "run" as const }));

  // "latest": the most recent occurrence is the only one worth doing, but the
  // ones passed over are recorded so a gap in the history has an explanation
  // rather than looking like the flow silently stopped.
  const latest = pending[pending.length - 1]!;
  return pending.map((occurrence) =>
    occurrence.key === latest.key
      ? { occurrence, action: "run" as const }
      : {
          occurrence,
          action: "skip" as const,
          reason: `superseded by ${latest.key} — this flow catches up to the latest occurrence only`,
        },
  );
};

/**
 * Run everything due, recording one entry per occurrence either way.
 *
 * A handler that throws fails its own occurrence and nothing else: one broken
 * flow must not stop the other eleven, and a close-prep scan that fails is
 * still better news than a sweep that stopped silently at the first error.
 */
export const runDue = async (
  flows: readonly FlowDefinition[],
  registry: FlowRegistry,
  store: FlowStore,
  asOf: string,
  now: string = new Date().toISOString(),
): Promise<readonly FlowRun[]> => {
  const out: FlowRun[] = [];

  for (const flow of flows) {
    for (const planned of planRuns(flow, store, asOf)) {
      const startedAt = new Date().toISOString();
      const base = {
        flowId: flow.id,
        occurrenceKey: planned.occurrence.key,
        scheduledFor: planned.occurrence.scheduledFor,
        startedAt,
      };

      if (planned.action === "skip") {
        const run: FlowRun = {
          ...base,
          status: "skipped",
          summary: planned.reason ?? "skipped",
          proposalIds: [],
          finishedAt: new Date().toISOString(),
        };
        store.record(run);
        out.push(run);
        continue;
      }

      const handler = registry.get(flow.task);
      if (!handler) {
        // Unregistered is a deployment mistake, not a data problem, so it
        // fails rather than skips — a skip would be recorded as handled and
        // never retried after the handler ships.
        const run: FlowRun = {
          ...base,
          status: "failed",
          summary: `No handler registered for task "${flow.task}"`,
          error: `unknown task: ${flow.task}`,
          proposalIds: [],
          finishedAt: new Date().toISOString(),
        };
        store.record(run);
        out.push(run);
        continue;
      }

      try {
        const outcome = await handler({ flow, occurrence: planned.occurrence, now });
        const run: FlowRun = {
          ...base,
          status: "ok",
          summary: outcome.summary,
          proposalIds: outcome.proposalIds ?? [],
          finishedAt: new Date().toISOString(),
        };
        store.record(run);
        out.push(run);
      } catch (err) {
        const run: FlowRun = {
          ...base,
          status: "failed",
          summary: `${flow.name} failed`,
          error: err instanceof Error ? err.message : String(err),
          proposalIds: [],
          finishedAt: new Date().toISOString(),
        };
        store.record(run);
        out.push(run);
      }
    }
  }

  return out;
};

/* ------------------------------------------------------------------ */
/* Reading the schedule                                                */
/* ------------------------------------------------------------------ */

export interface FlowStatus {
  readonly flow: FlowDefinition;
  readonly lastRun?: FlowRun;
  readonly dueNow: number;
  /** The next calendar day this flow fires on, or undefined if disabled. */
  readonly nextDue?: string;
}

/** The next firing strictly after `asOf`, found by walking forward. */
export const nextOccurrence = (cadence: Cadence, asOf: string): string | undefined => {
  validateCadence(cadence);
  let cursor = asUTC(asOf) + DAY_MS;
  const limit = cursor + MAX_LOOKBACK_DAYS * DAY_MS;
  for (; cursor <= limit; cursor += DAY_MS) {
    const date = toISO(cursor);
    if (fallsOn(cadence, date)) return date;
  }
  return undefined;
};

export const flowStatus = (flow: FlowDefinition, store: FlowStore, asOf: string): FlowStatus => {
  const next = flow.enabled ? nextOccurrence(flow.cadence, asOf) : undefined;
  const last = store.lastRun(flow.id);
  return {
    flow,
    ...(last ? { lastRun: last } : {}),
    dueNow: planRuns(flow, store, asOf).filter((p) => p.action === "run").length,
    ...(next ? { nextDue: next } : {}),
  };
};

