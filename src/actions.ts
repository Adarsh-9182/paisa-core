/**
 * PendingActions — how the AI CFO is allowed to act.
 *
 * The assistant can read the books freely. It cannot change them. Anything
 * that would write goes through here instead: the agent describes what it
 * wants to do, that description is stored with an id, and nothing happens
 * until a person approves it.
 *
 * The effect is a closure captured at propose time, so the agent never gets
 * to name the operation being run — it only fills in a shape the tool
 * already decided. A tool that can propose "send a reminder" cannot be
 * argued into proposing "send a payment", because that closure does not
 * exist for it to reach.
 *
 * Pending actions expire. An approval three weeks after the fact is an approval of
 * numbers that have since moved, and the engines will have changed
 * underneath it.
 */

import { EventBus } from "./events.js";

export type ActionStatus = "pending" | "approved" | "dismissed" | "expired";

export interface PendingAction {
  readonly id: string;
  /** Tool-defined category, e.g. "categorize" or "payment_reminder". */
  readonly kind: string;
  /** One line, shown on the approve button's row. */
  readonly summary: string;
  /** What will actually happen, in full, for the person deciding. */
  readonly detail: string;
  readonly status: ActionStatus;
  readonly proposedAt: string;
  readonly proposedBy: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
  /** Whatever the effect returned, for the audit trail. */
  readonly result?: string;
}

export class ActionError extends Error {
  override name = "ActionError";
}

/** Runs the approved change and returns a line describing what it did. */
export type ActionEffect = () => string;

const DEFAULT_TTL_MINUTES = 60;

export class ActionQueue {
  private items = new Map<string, PendingAction>();
  private effects = new Map<string, ActionEffect>();
  private seq = 0;

  constructor(
    private readonly orgId: string,
    private readonly bus: EventBus,
    private readonly ttlMinutes: number = DEFAULT_TTL_MINUTES,
    private readonly now: () => Date = () => new Date(),
  ) {}

  propose(input: {
    kind: string;
    summary: string;
    detail: string;
    proposedBy: string;
    effect: ActionEffect;
  }): PendingAction {
    const at = this.now();
    const id = `prop_${(++this.seq).toString(36)}${at.getTime().toString(36)}`;
    const proposal: PendingAction = {
      id,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      status: "pending",
      proposedAt: at.toISOString(),
      proposedBy: input.proposedBy,
      expiresAt: new Date(at.getTime() + this.ttlMinutes * 60_000).toISOString(),
    };
    this.items.set(id, proposal);
    this.effects.set(id, input.effect);
    this.emit("proposal.created", input.proposedBy, { id, kind: input.kind, summary: input.summary });
    return proposal;
  }

  /**
   * Run the change. The effect is dropped afterwards either way, so an
   * approval cannot be replayed — a double-clicked button posts once.
   */
  approve(id: string, actor: string): PendingAction {
    const proposal = this.require(id);
    if (proposal.status !== "pending")
      throw new ActionError(`PendingAction ${id} is already ${proposal.status}`);
    if (this.hasExpired(proposal)) return this.markExpired(proposal);

    const effect = this.effects.get(id);
    if (!effect) throw new ActionError(`PendingAction ${id} has no effect left to run`);
    this.effects.delete(id);

    let result: string;
    try {
      result = effect();
    } catch (e) {
      // The change failed, so the proposal did not happen. Leave it pending
      // rather than recording an approval of something that never ran.
      this.effects.set(id, effect);
      throw new ActionError(`PendingAction ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return this.settle(proposal, "approved", actor, result);
  }

  dismiss(id: string, actor: string): PendingAction {
    const proposal = this.require(id);
    if (proposal.status !== "pending")
      throw new ActionError(`PendingAction ${id} is already ${proposal.status}`);
    this.effects.delete(id);
    return this.settle(proposal, "dismissed", actor);
  }

  get(id: string): PendingAction {
    return this.require(id);
  }

  /** Pending and still live — what the UI should offer a decision on. */
  pending(): readonly PendingAction[] {
    for (const p of [...this.items.values()])
      if (p.status === "pending" && this.hasExpired(p)) this.markExpired(p);
    return [...this.items.values()].filter((p) => p.status === "pending");
  }

  all(): readonly PendingAction[] {
    return [...this.items.values()];
  }

  private require(id: string): PendingAction {
    const proposal = this.items.get(id);
    if (!proposal) throw new ActionError(`Unknown proposal ${id}`);
    return proposal;
  }

  private hasExpired(p: PendingAction): boolean {
    return this.now().toISOString() > p.expiresAt;
  }

  private markExpired(p: PendingAction): PendingAction {
    this.effects.delete(p.id);
    const expired: PendingAction = { ...p, status: "expired" };
    this.items.set(p.id, expired);
    this.emit("proposal.expired", p.proposedBy, { id: p.id, kind: p.kind });
    return expired;
  }

  private settle(p: PendingAction, status: ActionStatus, actor: string, result?: string): PendingAction {
    const settled: PendingAction = {
      ...p,
      status,
      decidedAt: this.now().toISOString(),
      decidedBy: actor,
      ...(result === undefined ? {} : { result }),
    };
    this.items.set(p.id, settled);
    this.emit(`proposal.${status}`, actor, { id: p.id, kind: p.kind, ...(result ? { result } : {}) });
    return settled;
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: this.now().toISOString(), actor, payload });
  }
}
