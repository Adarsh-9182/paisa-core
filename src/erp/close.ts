/**
 * Close management — the checklist that turns a month-end into a procedure
 * instead of a memory exercise.
 *
 * Every task is a *check*, not a checkbox: it runs code against the ledger
 * and returns PASSED or BLOCKED with the reason. A human can override with
 * an explicit, attributed waiver, but nobody can quietly tick a box that
 * the books do not support.
 *
 * Automated tasks (recognition, amortisation, depreciation, FX) run their
 * engines when they are not yet done, so `run()` moves the close forward
 * rather than only reporting on it. All of those engines are idempotent,
 * so re-running the close after a correction is safe.
 *
 * The period can only be locked once every task is PASSED or WAIVED.
 */

import { Paise, ZERO, add, sub, abs, cmp, formatINR } from "../money.js";
import { EventBus } from "../events.js";
import { PeriodEngine, PeriodKey, periodEnd, periodStart, prevPeriod } from "./periods.js";

export type TaskStatus = "PENDING" | "PASSED" | "BLOCKED" | "WAIVED";

export type TaskCategory =
  | "SUBLEDGER"
  | "RECONCILIATION"
  | "REVENUE"
  | "SCHEDULES"
  | "FX"
  | "TIE_OUT"
  | "REVIEW";

export interface CheckResult {
  readonly passed: boolean;
  readonly detail: string;
  readonly blockers: readonly string[];
}

export interface CloseTaskDef {
  readonly id: string;
  readonly name: string;
  readonly category: TaskCategory;
  /** Automated tasks may act; review tasks only inspect. */
  readonly automated: boolean;
  readonly run: (period: PeriodKey, actor: string) => CheckResult;
}

export interface CloseTaskState {
  readonly id: string;
  readonly name: string;
  readonly category: TaskCategory;
  readonly automated: boolean;
  readonly status: TaskStatus;
  readonly detail: string;
  readonly blockers: readonly string[];
  readonly ranAt: string | null;
  readonly waivedBy: string | null;
  readonly waiverReason: string | null;
}

export interface CloseRun {
  readonly period: PeriodKey;
  readonly tasks: readonly CloseTaskState[];
  readonly passed: number;
  readonly blocked: number;
  readonly readyToClose: boolean;
  readonly locked: boolean;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface FluxLine {
  readonly accountId: string;
  readonly name: string;
  readonly current: Paise;
  readonly prior: Paise;
  readonly delta: Paise;
  /** Basis points of change vs prior; null when prior was zero. */
  readonly changeBps: number | null;
  readonly explanation: string | null;
  readonly needsExplanation: boolean;
}

export class CloseError extends Error {
  override name = "CloseError";
}

/** What the standard checklist needs from the rest of the system. */
export interface CloseContext {
  readonly periods: PeriodEngine;
  /** Trial balance check for the period end. */
  readonly trialBalanceBalanced: (asOf: string) => boolean;
  /** Ledger balance of an account, signed in its normal direction. */
  readonly ledgerBalance: (accountId: string, asOf: string) => Paise;
  /** Subledger totals to tie back to their GL control accounts. */
  readonly arSubledgerTotal: (asOf: string) => Paise;
  readonly apSubledgerTotal: (asOf: string) => Paise;
  /** Deferred revenue roll-forward: does the subledger tie to the GL? */
  readonly deferredTiesToLedger: (period: PeriodKey) => { ties: boolean; detail: string };
  /** Cash accounts that must carry a completed reconciliation. */
  readonly cashAccounts: readonly { accountId: string; name: string }[];
  readonly reconciliationComplete: (accountId: string, asOf: string) => boolean;
  /** Automated runs — each returns the amount posted (zero if nothing due). */
  readonly runRevenueRecognition: (period: PeriodKey, actor: string) => Paise;
  readonly runAmortization: (period: PeriodKey, actor: string) => Paise;
  readonly runDepreciation: (period: PeriodKey, actor: string) => Paise;
  readonly runFxRevaluation: (period: PeriodKey, actor: string) => Paise;
  readonly fxRevalued: (period: PeriodKey) => boolean;
  /** Flux analysis input: P&L accounts for a period. */
  readonly plAccounts: (period: PeriodKey) => readonly { accountId: string; name: string; amount: Paise }[];
}

export class CloseEngine {
  private runs = new Map<PeriodKey, CloseRun>();
  private explanations = new Map<string, string>(); // "period|accountId" -> text
  private waivers = new Map<string, { by: string; reason: string }>(); // "period|taskId"

  constructor(
    public readonly orgId: string,
    private ctx: CloseContext,
    private bus: EventBus,
    /** A P&L swing beyond BOTH thresholds needs a written explanation. */
    private fluxThreshold: { amount: Paise; bps: number } = { amount: 5000000n as Paise, bps: 2000 },
  ) {}

  /** The standard month-end checklist, in dependency order. */
  private tasks(): readonly CloseTaskDef[] {
    const c = this.ctx;
    return [
      {
        id: "subledgers_frozen",
        name: "Subledgers frozen for the period",
        category: "SUBLEDGER",
        automated: true,
        run: (period, actor) => {
          if (c.periods.status(period) === "OPEN") c.periods.softClose(period, actor);
          const status = c.periods.status(period);
          return {
            passed: status !== "OPEN",
            detail: `Period ${period} is ${status}`,
            blockers: status === "OPEN" ? ["Period is still open to subledger postings"] : [],
          };
        },
      },
      {
        id: "bank_reconciliations",
        name: "Bank reconciliations completed",
        category: "RECONCILIATION",
        automated: false,
        run: (period) => {
          const asOf = periodEnd(period);
          const missing = c.cashAccounts.filter((a) => !c.reconciliationComplete(a.accountId, asOf));
          return {
            passed: missing.length === 0,
            detail:
              missing.length === 0
                ? `${c.cashAccounts.length} cash account${c.cashAccounts.length === 1 ? "" : "s"} reconciled to ${asOf}`
                : `${missing.length} of ${c.cashAccounts.length} accounts unreconciled`,
            blockers: missing.map((a) => `${a.name} has no completed reconciliation as of ${asOf}`),
          };
        },
      },
      {
        id: "revenue_recognition",
        name: "Revenue recognition posted",
        category: "REVENUE",
        automated: true,
        run: (period, actor) => {
          const amount = c.runRevenueRecognition(period, actor);
          return {
            passed: true,
            detail:
              amount === ZERO
                ? "Nothing further to recognise this period"
                : `Recognised ${formatINR(amount)}`,
            blockers: [],
          };
        },
      },
      {
        id: "prepaid_amortization",
        name: "Prepaid amortisation posted",
        category: "SCHEDULES",
        automated: true,
        run: (period, actor) => {
          const amount = c.runAmortization(period, actor);
          return {
            passed: true,
            detail: amount === ZERO ? "No prepaid instalments due" : `Amortised ${formatINR(amount)}`,
            blockers: [],
          };
        },
      },
      {
        id: "depreciation",
        name: "Depreciation posted",
        category: "SCHEDULES",
        automated: true,
        run: (period, actor) => {
          const amount = c.runDepreciation(period, actor);
          return {
            passed: true,
            detail: amount === ZERO ? "No assets in service" : `Depreciated ${formatINR(amount)}`,
            blockers: [],
          };
        },
      },
      {
        id: "fx_revaluation",
        name: "Foreign currency balances revalued",
        category: "FX",
        automated: true,
        run: (period, actor) => {
          if (!c.fxRevalued(period)) c.runFxRevaluation(period, actor);
          return {
            passed: c.fxRevalued(period),
            detail: c.fxRevalued(period) ? `Monetary balances revalued at ${periodEnd(period)}` : "Not revalued",
            blockers: c.fxRevalued(period) ? [] : ["FX revaluation did not run"],
          };
        },
      },
      {
        id: "ar_tie_out",
        name: "AR subledger ties to the control account",
        category: "TIE_OUT",
        automated: false,
        run: (period) => this.tieOut("Accounts Receivable", c.arSubledgerTotal(periodEnd(period)), c.ledgerBalance("acc_ar", periodEnd(period))),
      },
      {
        id: "ap_tie_out",
        name: "AP subledger ties to the control account",
        category: "TIE_OUT",
        automated: false,
        run: (period) => this.tieOut("Accounts Payable", c.apSubledgerTotal(periodEnd(period)), c.ledgerBalance("acc_ap", periodEnd(period))),
      },
      {
        id: "deferred_revenue_tie_out",
        name: "Deferred revenue roll-forward ties to the ledger",
        category: "TIE_OUT",
        automated: false,
        run: (period) => {
          const { ties, detail } = c.deferredTiesToLedger(period);
          return { passed: ties, detail, blockers: ties ? [] : [`Deferred revenue roll-forward does not tie: ${detail}`] };
        },
      },
      {
        id: "trial_balance",
        name: "Trial balance is in balance",
        category: "TIE_OUT",
        automated: false,
        run: (period) => {
          const balanced = c.trialBalanceBalanced(periodEnd(period));
          return {
            passed: balanced,
            detail: balanced ? `Debits equal credits at ${periodEnd(period)}` : "Trial balance is out",
            blockers: balanced ? [] : ["Trial balance does not balance — investigate before closing"],
          };
        },
      },
      {
        id: "flux_analysis",
        name: "Material P&L movements explained",
        category: "REVIEW",
        automated: false,
        run: (period) => {
          const unexplained = this.flux(period).filter((f) => f.needsExplanation && !f.explanation);
          return {
            passed: unexplained.length === 0,
            detail:
              unexplained.length === 0
                ? "All material movements explained"
                : `${unexplained.length} movement${unexplained.length === 1 ? "" : "s"} need an explanation`,
            blockers: unexplained.map(
              (f) => `${f.name} moved ${formatINR(f.delta)} vs prior period and has no explanation`,
            ),
          };
        },
      },
    ];
  }

  /**
   * Flux (variance) analysis: this period's P&L against the prior period.
   * A line needs an explanation only when it clears BOTH the absolute and
   * the relative threshold — a large percentage swing on a tiny account is
   * noise, and a small percentage on a huge account usually is too.
   */
  flux(period: PeriodKey): readonly FluxLine[] {
    const current = this.ctx.plAccounts(period);
    const priorAccounts = this.ctx.plAccounts(prevPeriod(period));
    // The first trading period has nothing to compare against: every line
    // would be "new" and demanding an explanation for each is noise, not
    // control. Flux analysis begins once there is a prior period to vary from.
    const hasPrior = priorAccounts.some((a) => a.amount !== ZERO);
    const prior = new Map(priorAccounts.map((a) => [a.accountId, a.amount]));

    /**
     * Both periods, not just this one.
     *
     * Walking only the current period made a line that stopped invisible: a
     * cost centre running at ₹4,00,000 a month that books nothing at all this
     * month produced no flux line, because there was no current row to hang
     * it on. That is the wrong way round — an expense line going quiet
     * usually means an invoice that has not arrived or a posting that went
     * somewhere else, and revenue going quiet is worse. Falling to zero is a
     * 100% movement and belongs in front of whoever signs the close.
     */
    const names = new Map(current.map((a) => [a.accountId, a.name]));
    for (const a of priorAccounts) if (!names.has(a.accountId)) names.set(a.accountId, a.name);
    const currentAmounts = new Map(current.map((a) => [a.accountId, a.amount]));
    const union = [...names].map(([accountId, name]) => ({
      accountId,
      name,
      amount: currentAmounts.get(accountId) ?? (ZERO as Paise),
    }));

    return union
      .map((a) => {
        const priorAmount = prior.get(a.accountId) ?? ZERO;
        const delta = sub(a.amount, priorAmount);
        const changeBps = priorAmount === ZERO ? null : Number((abs(delta) * 10000n) / abs(priorAmount));
        const material =
          hasPrior &&
          cmp(abs(delta), this.fluxThreshold.amount) >= 0 &&
          (changeBps === null || changeBps >= this.fluxThreshold.bps);
        return {
          accountId: a.accountId,
          name: a.name,
          current: a.amount,
          prior: priorAmount,
          delta,
          changeBps,
          explanation: this.explanations.get(`${period}|${a.accountId}`) ?? null,
          needsExplanation: material,
        };
      })
      .filter((f) => f.delta !== ZERO)
      .sort((a, b) => (cmp(abs(b.delta), abs(a.delta))));
  }

  /** Attach the story behind a movement so the close can proceed. */
  explain(period: PeriodKey, accountId: string, explanation: string, actor: string): void {
    if (!explanation.trim()) throw new CloseError("An explanation cannot be blank");
    this.explanations.set(`${period}|${accountId}`, explanation);
    this.bus.emit({
      orgId: this.orgId,
      type: "close.explained",
      at: new Date().toISOString(),
      actor,
      payload: { period, accountId, explanation },
    });
  }

  /** Run (or re-run) the checklist. Automated tasks act; the rest report. */
  run(period: PeriodKey, actor: string): CloseRun {
    const existing = this.runs.get(period);
    if (existing?.locked) throw new CloseError(`Period ${period} is already closed`);
    const startedAt = existing?.startedAt ?? new Date().toISOString();

    const states: CloseTaskState[] = this.tasks().map((def) => {
      const waiver = this.waivers.get(`${period}|${def.id}`);
      let result: CheckResult;
      try {
        result = def.run(period, actor);
      } catch (e) {
        result = {
          passed: false,
          detail: e instanceof Error ? e.message : String(e),
          blockers: [e instanceof Error ? e.message : String(e)],
        };
      }
      const status: TaskStatus = result.passed ? "PASSED" : waiver ? "WAIVED" : "BLOCKED";
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        automated: def.automated,
        status,
        detail: result.detail,
        blockers: result.passed ? [] : result.blockers,
        ranAt: new Date().toISOString(),
        waivedBy: waiver?.by ?? null,
        waiverReason: waiver?.reason ?? null,
      };
    });

    const blocked = states.filter((t) => t.status === "BLOCKED").length;
    const run: CloseRun = {
      period,
      tasks: states,
      passed: states.filter((t) => t.status === "PASSED").length,
      blocked,
      readyToClose: blocked === 0,
      locked: false,
      startedAt,
      completedAt: null,
    };
    this.runs.set(period, run);
    this.bus.emit({
      orgId: this.orgId,
      type: "close.run",
      at: new Date().toISOString(),
      actor,
      payload: { period, passed: run.passed, blocked: run.blocked, readyToClose: run.readyToClose },
    });
    return run;
  }

  /** A blocked task can be waived, but only on the record, with a reason. */
  waive(period: PeriodKey, taskId: string, actor: string, reason: string): CloseRun {
    if (!reason.trim()) throw new CloseError("Waiving a close task requires a stated reason");
    if (!this.tasks().some((t) => t.id === taskId)) throw new CloseError(`Unknown close task ${taskId}`);
    this.waivers.set(`${period}|${taskId}`, { by: actor, reason });
    this.bus.emit({
      orgId: this.orgId,
      type: "close.waived",
      at: new Date().toISOString(),
      actor,
      payload: { period, taskId, reason },
    });
    return this.run(period, actor);
  }

  /** Lock the period. Refuses while anything is BLOCKED. */
  lock(period: PeriodKey, actor: string): CloseRun {
    const run = this.runs.get(period) ?? this.run(period, actor);
    if (!run.readyToClose) {
      const blockers = run.tasks.flatMap((t) => t.blockers);
      throw new CloseError(
        `Cannot close ${period}: ${run.blocked} task${run.blocked === 1 ? "" : "s"} blocked — ${blockers.join("; ")}`,
      );
    }
    this.ctx.periods.close(period, actor);
    const locked: CloseRun = { ...run, locked: true, completedAt: new Date().toISOString() };
    this.runs.set(period, locked);
    this.bus.emit({
      orgId: this.orgId,
      type: "close.locked",
      at: locked.completedAt!,
      actor,
      payload: { period, tasks: run.tasks.length },
    });
    return locked;
  }

  status(period: PeriodKey): CloseRun | null {
    return this.runs.get(period) ?? null;
  }

  private tieOut(label: string, subledger: Paise, ledger: Paise): CheckResult {
    const difference = sub(subledger, ledger);
    return {
      passed: difference === ZERO,
      detail:
        difference === ZERO
          ? `${label} subledger ${formatINR(subledger)} agrees with the general ledger`
          : `${label} subledger ${formatINR(subledger)} vs GL ${formatINR(ledger)}`,
      blockers:
        difference === ZERO
          ? []
          : [`${label} is out by ${formatINR(difference)} — the subledger and the control account disagree`],
    };
  }
}
