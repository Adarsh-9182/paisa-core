/**
 * PaisaRuntime — an organization whose state survives a restart.
 *
 * State is never written out; it is rebuilt by replaying the action log
 * through the same command handlers that applied it in the first place.
 * There is no "save" path that could disagree with the "apply" path,
 * because there is only one path.
 *
 * `execute()` appends first, then applies. If applying throws — a closed
 * period, a failed validation — the action is already in the log, so the
 * runtime marks it failed and replay skips it by the same rule. A command
 * that could not be applied then cannot be applied on restore either,
 * which keeps a restored ledger identical to the live one rather than
 * quietly better.
 *
 * Multiple instances converge by calling `sync()`: it fetches everything
 * after the last applied sequence and applies it in order.
 */

import { Organization, Platform } from "../organization.js";
import { ErpSuite, attachErp, ErpOptions } from "../erp/suite.js";
import { COMMANDS, Action, CommandContext, CommandError, isKnownCommand } from "./commands.js";
import { ActionStore, LoggedAction, MemoryActionStore } from "./store.js";

export interface RuntimeOptions extends ErpOptions {
  readonly orgId: string;
  readonly name: string;
  readonly store?: ActionStore;
}

export interface ExecuteResult<T = unknown> {
  readonly seq: number;
  readonly result: T;
}

export interface ReplayReport {
  readonly applied: number;
  readonly skipped: readonly { readonly seq: number; readonly type: string; readonly reason: string }[];
  readonly lastSeq: number;
}

export class RuntimeError extends Error {
  override name = "RuntimeError";
}

export class PaisaRuntime {
  readonly org: Organization;
  readonly erp: ErpSuite;
  readonly store: ActionStore;
  private lastSeq = 0;
  private skipped: { seq: number; type: string; reason: string }[] = [];

  private constructor(
    public readonly orgId: string,
    org: Organization,
    erp: ErpSuite,
    store: ActionStore,
  ) {
    this.org = org;
    this.erp = erp;
    this.store = store;
  }

  /**
   * Build a runtime and bring it up to date with the log. A fresh log
   * yields an empty org; a populated one yields exactly the state its
   * actions produced.
   */
  static async open(opts: RuntimeOptions): Promise<PaisaRuntime> {
    const store = opts.store ?? new MemoryActionStore();
    await store.ready();
    const platform = new Platform();
    const org = platform.createOrganization(opts.orgId, opts.name);
    const erp = attachErp(org, opts);
    const runtime = new PaisaRuntime(opts.orgId, org, erp, store);
    await runtime.sync();
    return runtime;
  }

  /** Append the action, then apply it. Returns the handler's own result. */
  async execute<T = unknown>(type: string, payload: Record<string, unknown>, actor: string): Promise<ExecuteResult<T>> {
    if (!isKnownCommand(type))
      throw new CommandError(`Unknown command "${type}" — it cannot be persisted, so it is refused`);
    const action: Action = { type, payload, actor };
    const logged = await this.store.append(this.orgId, action);
    this.lastSeq = logged.seq;
    const result = this.apply(logged, /* throwOnError */ true) as T;
    return { seq: logged.seq, result };
  }

  /** Pull and apply everything appended since this instance last looked. */
  async sync(): Promise<ReplayReport> {
    const pending = await this.store.after(this.orgId, this.lastSeq);
    let applied = 0;
    for (const logged of pending) {
      const ok = this.apply(logged, false) !== APPLY_FAILED;
      if (ok) applied++;
      this.lastSeq = logged.seq;
    }
    return { applied, skipped: [...this.skipped], lastSeq: this.lastSeq };
  }

  /** The sequence number this instance has applied up to. */
  appliedThrough(): number {
    return this.lastSeq;
  }

  /** Actions the log holds that could not be applied, with the reason. */
  skippedActions(): readonly { seq: number; type: string; reason: string }[] {
    return this.skipped;
  }

  private apply(logged: LoggedAction, throwOnError: boolean): unknown {
    const handler = COMMANDS[logged.action.type];
    if (!handler) {
      const reason = `unknown command "${logged.action.type}"`;
      this.skipped.push({ seq: logged.seq, type: logged.action.type, reason });
      if (throwOnError) throw new CommandError(reason);
      return APPLY_FAILED;
    }
    const ctx: CommandContext = { org: this.org, erp: this.erp };
    try {
      return handler(ctx, { ...logged.action.payload }, logged.action.actor);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.skipped.push({ seq: logged.seq, type: logged.action.type, reason });
      if (throwOnError) throw e;
      return APPLY_FAILED;
    }
  }
}

/** Sentinel distinguishing "handler returned undefined" from "handler threw". */
const APPLY_FAILED = Symbol("apply-failed");
