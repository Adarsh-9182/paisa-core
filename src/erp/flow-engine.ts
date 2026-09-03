/**
 * Flow state that survives a restart.
 *
 * `inMemoryFlowStore` is fine for a test and wrong for a deployment: on a
 * serverless host every cold start would begin with an empty history, so a
 * flow's own record of what it had already done would vanish. The engines
 * themselves are idempotent per period, so the books would survive that — but
 * the run history is the audit answer to "what did the automation do, and
 * when", and losing it defeats the reason a controller switched the flow on.
 *
 * So flow state is command-sourced like everything else. Two things are
 * recorded: whether a flow is switched on, and each occurrence that ran.
 *
 * The rule that makes this replayable is that a command names its occurrence
 * explicitly. "Sweep everything due as of today" is not a command — replaying
 * it a year later would compute a completely different set of occurrences and
 * rebuild a state that never existed. Deciding what is due is the sweep's job,
 * done once, against a clock; the command records the decision.
 */

import { EventBus } from "../events.js";
import { STANDARD_FLOWS } from "./flow-catalog.js";
import {
  FlowError,
  flowStatus,
  type FlowDefinition,
  type FlowRun,
  type FlowStatus,
  type FlowStore,
} from "./flows.js";

export class FlowEngine implements FlowStore {
  private readonly defs = new Map<string, FlowDefinition>();
  private readonly runs: FlowRun[] = [];
  private readonly completed = new Set<string>();

  constructor(
    private readonly orgId: string,
    private readonly bus: EventBus,
    catalogue: readonly FlowDefinition[] = STANDARD_FLOWS,
  ) {
    for (const f of catalogue) this.defs.set(f.id, f);
  }

  /* ---------------- definitions ---------------- */

  all(): readonly FlowDefinition[] {
    return [...this.defs.values()];
  }

  get(flowId: string): FlowDefinition {
    const f = this.defs.get(flowId);
    if (!f) throw new FlowError(`Unknown flow ${flowId}`);
    return f;
  }

  /**
   * Switch a flow on or off.
   *
   * Enabling is a decision with an owner, so it is a command with an actor
   * rather than a config file nobody signed.
   */
  setEnabled(flowId: string, enabled: boolean, actor: string): FlowDefinition {
    const next = { ...this.get(flowId), enabled };
    this.defs.set(flowId, next);
    this.bus.emit({
      orgId: this.orgId,
      type: enabled ? "flows.enabled" : "flows.disabled",
      at: new Date().toISOString(),
      actor,
      payload: { flowId },
    });
    return next;
  }

  /**
   * Move a flow's start date.
   *
   * Worth a command of its own because it decides how far back a first sweep
   * reaches: a flow enabled today with a startDate of January will treat every
   * month since as owed, which for a posting flow is a year of entries.
   */
  setStartDate(flowId: string, startDate: string, actor: string): FlowDefinition {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw new FlowError(`startDate must be YYYY-MM-DD, got "${startDate}"`);
    const next = { ...this.get(flowId), startDate };
    this.defs.set(flowId, next);
    this.bus.emit({
      orgId: this.orgId,
      type: "flows.rescheduled",
      at: new Date().toISOString(),
      actor,
      payload: { flowId, startDate },
    });
    return next;
  }

  /* ---------------- FlowStore ---------------- */

  hasRun(flowId: string, occurrenceKey: string): boolean {
    return this.completed.has(`${flowId} ${occurrenceKey}`);
  }

  lastRun(flowId: string): FlowRun | undefined {
    return this.latest(flowId, () => true);
  }

  lastCompleted(flowId: string): FlowRun | undefined {
    return this.latest(flowId, (r) => r.status !== "failed");
  }

  record(run: FlowRun): void {
    this.runs.push(run);
    // A failure is an occurrence still owed, so it does not enter the
    // completed set and the next sweep will find it again.
    if (run.status !== "failed") this.completed.add(`${run.flowId} ${run.occurrenceKey}`);
  }

  list(flowId?: string): readonly FlowRun[] {
    return flowId ? this.runs.filter((r) => r.flowId === flowId) : [...this.runs];
  }

  private latest(flowId: string, pred: (r: FlowRun) => boolean): FlowRun | undefined {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (r.flowId === flowId && pred(r)) return r;
    }
    return undefined;
  }

  /* ---------------- reading ---------------- */

  status(asOf: string): readonly FlowStatus[] {
    return this.all().map((f) => flowStatus(f, this, asOf));
  }

  /** Most recent runs first — what a console shows without paging. */
  recent(limit = 20): readonly FlowRun[] {
    return [...this.runs].reverse().slice(0, limit);
  }
}
