/**
 * The command registry — the only mutations that reach the engines.
 *
 * Persistence here is command sourcing, not state dumping: the log records
 * *what was asked for*, and replaying those asks through the same engine
 * code paths rebuilds the exact state. That works because the engines are
 * deterministic — ids come from ordered counters, balances are projections
 * over the journal, and nothing depends on wall-clock time to be correct.
 *
 * The consequence worth stating: there is no separate "load state" path
 * that could disagree with the "apply change" path, because there is only
 * one path. A restored ledger is arrived at the same way the original was.
 *
 * Metadata timestamps (createdAt on an entry, raisedAt on a proposal) are
 * regenerated at replay time and therefore reflect the replay, not the
 * original moment. The action log's own created_at is the audit record for
 * when something actually happened.
 */

import { Paise } from "../money.js";
import { Organization } from "../organization.js";
import { ErpSuite } from "../erp/suite.js";
import { standardHandlers } from "../erp/flow-handlers.js";
import type { FlowRun } from "../erp/flows.js";

export interface CommandContext {
  readonly org: Organization;
  readonly erp: ErpSuite;
}

export interface Action {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actor: string;
}

export type CommandHandler = (ctx: CommandContext, payload: Record<string, unknown>, actor: string) => unknown;

export class CommandError extends Error {
  override name = "CommandError";
}

const p = <T>(payload: Record<string, unknown>, key: string): T => {
  if (!(key in payload)) throw new CommandError(`Command payload is missing "${key}"`);
  return payload[key] as T;
};

const opt = <T>(payload: Record<string, unknown>, key: string, fallback: T): T =>
  key in payload && payload[key] !== undefined ? (payload[key] as T) : fallback;

/**
 * Execute one named occurrence and record it.
 *
 * Kept out of the table because it is longer than a line, and because the two
 * refusals in it are worth reading. A flow handler that returned a promise
 * would apply after `apply()` had already returned, so replay would record a
 * run whose postings had not happened yet — the persisted path therefore
 * requires synchronous handlers rather than silently accepting a race.
 */
const runFlowOccurrence = (ctx: CommandContext, pl: Record<string, unknown>, actor: string): FlowRun => {
  const flowId = p<string>(pl, "flowId");
  const flow = ctx.erp.flows.get(flowId);
  const occurrence = {
    key: p<string>(pl, "occurrenceKey"),
    scheduledFor: p<string>(pl, "scheduledFor"),
    period: p<string>(pl, "period"),
  };
  const startedAt = new Date().toISOString();
  const base = { flowId, occurrenceKey: occurrence.key, scheduledFor: occurrence.scheduledFor, startedAt };

  const finish = (run: FlowRun): FlowRun => {
    ctx.erp.flows.record(run);
    return run;
  };

  if (opt<string>(pl, "action", "run") === "skip")
    return finish({
      ...base,
      status: "skipped",
      summary: opt(pl, "reason", "skipped"),
      proposalIds: [],
      finishedAt: new Date().toISOString(),
    });

  const handler = standardHandlers({ org: ctx.org, erp: ctx.erp, actor }).get(flow.task);
  if (!handler)
    return finish({
      ...base,
      status: "failed",
      summary: `No handler registered for task "${flow.task}"`,
      error: `unknown task: ${flow.task}`,
      proposalIds: [],
      finishedAt: new Date().toISOString(),
    });

  try {
    const outcome = handler({ flow, occurrence, now: startedAt });
    if (outcome instanceof Promise)
      throw new CommandError(
        `Flow "${flow.task}" returned a promise. A persisted flow must be synchronous, ` +
          "or replay records a run whose postings have not happened yet.",
      );
    return finish({
      ...base,
      status: "ok",
      summary: outcome.summary,
      proposalIds: outcome.proposalIds ?? [],
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    return finish({
      ...base,
      status: "failed",
      summary: `${flow.name} failed`,
      error: err instanceof Error ? err.message : String(err),
      proposalIds: [],
      finishedAt: new Date().toISOString(),
    });
  }
};

/**
 * Every mutating operation the runtime will accept. Anything not here
 * cannot change persisted state — which is the point: the surface that
 * survives a restart is enumerated, not inferred.
 */
export const COMMANDS: Record<string, CommandHandler> = {
  /* ---------------- general ledger ---------------- */

  "journal.post": (ctx, pl, actor) =>
    ctx.org.journal.post({
      date: p(pl, "date"),
      narration: p(pl, "narration"),
      lines: p(pl, "lines"),
      sourceModule: p(pl, "sourceModule"),
      referenceId: opt(pl, "referenceId", null),
      createdBy: actor,
    }),

  "journal.reverse": (ctx, pl, actor) =>
    ctx.org.journal.reverse(p(pl, "originalId"), actor, p(pl, "reason"), opt(pl, "date", undefined)),

  /* ---------------- accounts receivable ---------------- */

  "invoice.create": (ctx, pl, actor) => ctx.org.invoices.create(p(pl, "input"), actor),
  "invoice.send": (ctx, pl, actor) => ctx.org.invoices.send(p(pl, "invoiceId"), actor),
  "invoice.payment": (ctx, pl, actor) =>
    ctx.org.invoices.recordPayment(
      p(pl, "invoiceId"),
      p(pl, "date"),
      p<Paise>(pl, "amount"),
      actor,
      opt(pl, "bankAccountId", "acc_bank"),
    ),
  "invoice.cancel": (ctx, pl, actor) => ctx.org.invoices.cancel(p(pl, "invoiceId"), actor, p(pl, "reason")),

  /* ---------------- periods ---------------- */

  "period.softClose": (ctx, pl, actor) => ctx.erp.periods.softClose(p(pl, "period"), actor),
  "period.close": (ctx, pl, actor) => ctx.erp.periods.close(p(pl, "period"), actor),
  "period.reopen": (ctx, pl, actor) => ctx.erp.periods.reopen(p(pl, "period"), actor, p(pl, "reason")),

  /* ---------------- revenue contracts ---------------- */

  "contract.create": (ctx, pl, actor) => ctx.erp.contracts.create(p(pl, "input"), actor),
  "contract.activate": (ctx, pl, actor) => ctx.erp.contracts.activate(p(pl, "contractId"), actor),
  "contract.amend": (ctx, pl, actor) =>
    ctx.erp.contracts.amend(p(pl, "contractId"), p(pl, "input"), actor, p(pl, "reason")),
  "contract.cancel": (ctx, pl, actor) => ctx.erp.contracts.cancel(p(pl, "contractId"), actor, p(pl, "reason")),

  /* ---------------- revenue recognition ---------------- */

  "revrec.bill": (ctx, pl, actor) =>
    ctx.erp.revrec.bill(p(pl, "contractId"), p(pl, "billingEventId"), actor, opt(pl, "gstRatePct", 0)),
  "revrec.billDue": (ctx, pl, actor) =>
    ctx.erp.revrec.billDue(p(pl, "asOf"), actor, opt(pl, "gstRatePct", 0)),
  "revrec.recognize": (ctx, pl, actor) => ctx.erp.revrec.recognize(p(pl, "period"), actor),
  "revrec.payment": (ctx, pl, actor) =>
    ctx.erp.revrec.recordPayment(
      p(pl, "contractId"),
      p(pl, "billingEventId"),
      p(pl, "date"),
      p<Paise>(pl, "amount"),
      actor,
      opt(pl, "bankAccountId", "acc_bank"),
    ),
  "revrec.reportUsage": (ctx, pl, actor) =>
    ctx.erp.revrec.reportUsage(
      p(pl, "contractId"),
      p(pl, "obligationId"),
      p(pl, "period"),
      p<Paise>(pl, "amount"),
      actor,
    ),

  /* ---------------- accounts payable ---------------- */

  "bill.create": (ctx, pl, actor) => ctx.erp.bills.create(p(pl, "input"), actor),
  "bill.submit": (ctx, pl, actor) => ctx.erp.bills.submit(p(pl, "billId"), actor),
  "bill.approve": (ctx, pl, actor) => ctx.erp.bills.approve(p(pl, "billId"), actor),
  "bill.reject": (ctx, pl, actor) => ctx.erp.bills.reject(p(pl, "billId"), actor, p(pl, "reason")),
  "bill.payment": (ctx, pl, actor) =>
    ctx.erp.bills.recordPayment(
      p(pl, "billId"),
      p(pl, "date"),
      p<Paise>(pl, "amount"),
      actor,
      opt(pl, "method", "bank transfer"),
      opt(pl, "bankAccountId", undefined),
    ),
  "bill.cancel": (ctx, pl, actor) => ctx.erp.bills.cancel(p(pl, "billId"), actor, p(pl, "reason")),

  /* ---------------- schedules ---------------- */

  "schedule.accrue": (ctx, pl, actor) => ctx.erp.schedules.accrue(p(pl, "input"), actor),
  "schedule.addPrepaid": (ctx, pl, actor) => ctx.erp.schedules.addPrepaid(p(pl, "input"), actor),
  "schedule.addAsset": (ctx, pl, actor) => ctx.erp.schedules.addAsset(p(pl, "input"), actor),
  "schedule.runAmortization": (ctx, pl, actor) => ctx.erp.schedules.runAmortization(p(pl, "period"), actor),
  "schedule.runDepreciation": (ctx, pl, actor) => ctx.erp.schedules.runDepreciation(p(pl, "period"), actor),

  /* ---------------- multi-currency ---------------- */

  "fx.setRate": (ctx, pl) =>
    ctx.erp.fx.setRate(p(pl, "currency"), p(pl, "date"), p<bigint>(pl, "num"), p<bigint>(pl, "den")),
  "fx.markMonetary": (ctx, pl) => ctx.erp.fx.markMonetary(p(pl, "accountId"), p(pl, "currency")),

  /* ---------------- bank reconciliation ---------------- */

  "reconciliation.reconcile": (ctx, pl) => ctx.erp.reconciliation.reconcile(p(pl, "input")),
  "reconciliation.complete": (ctx, pl, actor) =>
    ctx.erp.reconciliation.complete(p(pl, "reconciliationId"), actor),

  /* ---------------- close ---------------- */

  "close.run": (ctx, pl, actor) => ctx.erp.close.run(p(pl, "period"), actor),
  "close.explain": (ctx, pl, actor) =>
    ctx.erp.close.explain(p(pl, "period"), p(pl, "accountId"), p(pl, "explanation"), actor),
  "close.waive": (ctx, pl, actor) =>
    ctx.erp.close.waive(p(pl, "period"), p(pl, "taskId"), actor, p(pl, "reason")),
  "close.lock": (ctx, pl, actor) => ctx.erp.close.lock(p(pl, "period"), actor),

  /* ---------------- agents ---------------- */

  "agents.scan": (ctx, pl, actor) => ctx.erp.agents.scan(p(pl, "period"), actor),
  "agents.approve": (ctx, pl, actor) => ctx.erp.agents.approve(p(pl, "proposalId"), actor),
  "agents.dismiss": (ctx, pl, actor) =>
    ctx.erp.agents.dismiss(p(pl, "proposalId"), actor, p(pl, "reason")),

  /* ---------------- flows ---------------- */

  "flows.enable": (ctx, pl, actor) =>
    ctx.erp.flows.setEnabled(p(pl, "flowId"), p<boolean>(pl, "enabled"), actor),

  "flows.reschedule": (ctx, pl, actor) =>
    ctx.erp.flows.setStartDate(p(pl, "flowId"), p(pl, "startDate"), actor),

  /**
   * One occurrence of one flow.
   *
   * The occurrence is named in the payload rather than derived from a clock,
   * which is what makes this replayable: re-deriving "what was due" a year
   * later would produce a different set and rebuild a state that never
   * existed. `sweepFlows` does the time-dependent reasoning once and emits
   * these; replay applies exactly what was decided then.
   *
   * The handler is re-executed on replay rather than its result being
   * restored, so a posting flow's entries are rebuilt through the same engine
   * path as the original — which is the same rule every other command follows.
   * That is safe because the engines are idempotent per period and the
   * handlers are deterministic.
   */
  "flows.run": (ctx, pl, actor) => runFlowOccurrence(ctx, pl, actor),

  /* ---------------- bank feed ---------------- */

  "banking.importStatement": (ctx, pl, actor) =>
    ctx.org.banking.importStatement(p(pl, "lines"), actor, opt(pl, "bankAccountId", "acc_bank")),

  /* ---------------- recommendations ---------------- */

  "recommendations.generate": (ctx, pl) =>
    ctx.org.recommendations.generate(p(pl, "asOf"), p(pl, "periodFrom")),
  "recommendations.approve": (ctx, pl, actor) => ctx.org.recommendations.approve(p(pl, "id"), actor),
  "recommendations.dismiss": (ctx, pl, actor) => ctx.org.recommendations.dismiss(p(pl, "id"), actor),

  /* ---------------- connectors ---------------- */

  "connector.register": (ctx, pl) => ctx.erp.connectors.register(p(pl, "source"), p(pl, "kind")),
  "connector.syncCrmDeals": (ctx, pl, actor) =>
    ctx.erp.connectors.syncCrmDeals(p(pl, "source"), p(pl, "deals"), actor),
  "connector.syncBilling": (ctx, pl, actor) =>
    ctx.erp.connectors.syncBilling(p(pl, "source"), p(pl, "records"), actor),
  "connector.syncBank": (ctx, pl, actor) =>
    ctx.erp.connectors.syncBank(p(pl, "source"), p(pl, "lines"), actor),
  "connector.syncPayroll": (ctx, pl, actor) =>
    ctx.erp.connectors.syncPayroll(p(pl, "source"), p(pl, "runs"), actor),
};

export const isKnownCommand = (type: string): boolean => type in COMMANDS;

export const commandNames = (): readonly string[] => Object.keys(COMMANDS);
