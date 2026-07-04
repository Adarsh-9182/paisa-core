/**
 * Financial Event Bus + immutable Audit Log.
 * Every mutation in the core emits an event; every event is auditable.
 */

export interface FinancialEvent {
  readonly seq: number;
  readonly orgId: string;
  readonly type: string; // e.g. "journal.posted", "journal.reversed", "rule.fired"
  readonly at: string; // ISO timestamp
  readonly actor: string; // userId or "system"
  readonly payload: Readonly<Record<string, unknown>>;
}

export type EventHandler = (e: FinancialEvent) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private log: FinancialEvent[] = [];
  private seq = 0;

  emit(e: Omit<FinancialEvent, "seq">): FinancialEvent {
    const event: FinancialEvent = Object.freeze({ ...e, seq: ++this.seq });
    this.log.push(event);
    for (const h of this.handlers.get(e.type) ?? []) h(event);
    for (const h of this.handlers.get("*") ?? []) h(event);
    return event;
  }

  on(type: string, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  /** Immutable, append-only audit trail scoped to an organization. */
  audit(orgId: string): readonly FinancialEvent[] {
    return this.log.filter((e) => e.orgId === orgId);
  }
}
