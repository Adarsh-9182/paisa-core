/**
 * ErpSuite — the Rillet-class modules, attached to an existing Organization.
 *
 * Deliberately additive: organization.ts is untouched and the SMB core keeps
 * working exactly as before. attachErp() layers the ERP accounts onto the
 * chart, registers the period lock with the journal, and wires the close
 * checklist to every subledger it needs to tie out against.
 *
 * One org can run without the suite (a small business that just wants books)
 * or with it (a company that needs ASC 606, multi-entity and a real close).
 */

import { Paise, ZERO, add, sub, sum, formatINR } from "../money.js";
import { Organization } from "../organization.js";
import { erpAccounts } from "./accounts.js";
import { PeriodEngine, PeriodKey, periodEnd, periodStart } from "./periods.js";
import { ContractEngine } from "./contracts.js";
import { RevRecEngine } from "./revrec.js";
import { BillEngine, ApprovalPolicy } from "./bills.js";
import { ScheduleEngine } from "./schedules.js";
import { FxEngine } from "./fx.js";
import { ReconciliationEngine } from "./reconciliation.js";
import { MetricsEngine } from "./metrics.js";
import { CloseEngine, CloseContext } from "./close.js";
import { AgentEngine } from "./agents.js";
import { ConnectorHub } from "./connectors.js";
import { FlowEngine } from "./flow-engine.js";

export interface SubledgerTieOut {
  readonly asOf: string;
  readonly subledger: Paise;
  readonly ledger: Paise;
  readonly difference: Paise;
  readonly ties: boolean;
}

export interface ErpSuite {
  readonly periods: PeriodEngine;
  readonly contracts: ContractEngine;
  readonly revrec: RevRecEngine;
  readonly bills: BillEngine;
  readonly schedules: ScheduleEngine;
  readonly fx: FxEngine;
  readonly reconciliation: ReconciliationEngine;
  readonly metrics: MetricsEngine;
  readonly close: CloseEngine;
  readonly agents: AgentEngine;
  readonly connectors: ConnectorHub;
  readonly flows: FlowEngine;
  /**
   * AR and AP as they stood on a date, against their GL control accounts.
   * The close checklist and any reporting surface must share this one
   * implementation — two copies of a tie-out is how they come to disagree.
   */
  readonly tieOut: (asOf: string) => { readonly ar: SubledgerTieOut; readonly ap: SubledgerTieOut };
}

export interface ErpOptions {
  /** First period the books exist for. */
  readonly firstPeriod: PeriodKey;
  readonly functionalCurrency?: string;
  readonly approvalPolicy?: ApprovalPolicy;
  /** Cash accounts the close requires a completed reconciliation for. */
  readonly cashAccounts?: readonly { accountId: string; name: string }[];
}

export const attachErp = (org: Organization, opts: ErpOptions): ErpSuite => {
  erpAccounts(org.chart);

  const periods = new PeriodEngine(org.orgId, org.bus, opts.firstPeriod);
  org.journal.addGuard(periods.guard());

  const contracts = new ContractEngine(org.orgId, org.bus);
  const revrec = new RevRecEngine(org.orgId, contracts, org.journal, org.bus);
  const bills = new BillEngine(
    org.orgId,
    org.chart,
    org.journal,
    org.bus,
    opts.approvalPolicy ?? { limits: new Map(), segregationOfDuties: true },
  );
  const schedules = new ScheduleEngine(org.orgId, org.journal, org.bus);
  const fx = new FxEngine(org.orgId, opts.functionalCurrency ?? "INR", org.journal, org.bus);
  const reconciliation = new ReconciliationEngine(org.orgId, org.bus);
  const metrics = new MetricsEngine(contracts, revrec);
  const flows = new FlowEngine(org.orgId, org.bus);

  const cashAccounts = opts.cashAccounts ?? [{ accountId: "acc_bank", name: "Bank" }];

  // Rebuilt as-at the date rather than read off aging(), which reports on
  // *currently* open documents: a document raised after `asOf` has not hit
  // the ledger yet, and one settled after `asOf` was still outstanding then.
  // Tying a past period needs the balance as it stood, not as it stands today.
  const arSubledgerTotal = (asOf: string): Paise => {
    const invoiceAr = sum(
      org.invoices
        .all()
        .filter((i) => i.status !== "DRAFT" && i.status !== "CANCELLED" && i.issueDate <= asOf)
        .map((i) => sub(i.total, sum(i.payments.filter((p) => p.date <= asOf).map((p) => p.amount)))),
    );
    return add(invoiceAr, revrec.arOutstanding(asOf));
  };

  const apSubledgerTotal = (asOf: string): Paise =>
    sum(
      bills
        .all()
        .filter(
          (b) =>
            (b.status === "APPROVED" || b.status === "PARTIALLY_PAID" || b.status === "PAID") &&
            b.billDate <= asOf,
        )
        .map((b) => sub(b.total, sum(b.payments.filter((p) => p.date <= asOf).map((p) => p.amount)))),
    );

  const tieOut = (asOf: string) => {
    const build = (subledger: Paise, accountId: string): SubledgerTieOut => {
      const ledger = org.ledger.balance(accountId, asOf);
      const difference = sub(subledger, ledger);
      return { asOf, subledger, ledger, difference, ties: difference === ZERO };
    };
    return { ar: build(arSubledgerTotal(asOf), "acc_ar"), ap: build(apSubledgerTotal(asOf), "acc_ap") };
  };

  const closeContext: CloseContext = {
    periods,
    trialBalanceBalanced: (asOf) => org.ledger.trialBalance(asOf).balanced,
    ledgerBalance: (accountId, asOf) => org.ledger.balance(accountId, asOf),

    // AR control account is fed by both the invoice engine and contract
    // billings, so the subledger total is the sum of both.
    //
    // Both are rebuilt as-at the date rather than read off aging(), which
    // reports on *currently* open documents: a document raised after `asOf`
    // has not hit the ledger yet, and one settled after `asOf` was still
    // outstanding then. Tying a past period needs the balance as it stood,
    // not as it stands today.
    arSubledgerTotal,
    apSubledgerTotal,

    deferredTiesToLedger: (period) => {
      const rf = revrec.rollforward(period, (d) => org.ledger.balance("acc_deferred_revenue", d));
      return {
        ties: rf.tiesToLedger,
        detail:
          `opening ${formatINR(rf.opening)} + billed ${formatINR(rf.billed)} ` +
          `− recognised ${formatINR(rf.recognized)} = ${formatINR(rf.closing)} ` +
          `(ledger ${formatINR(rf.ledgerClosing)})`,
      };
    },

    cashAccounts,
    reconciliationComplete: (accountId, asOf) => {
      const latest = reconciliation.latestCompleted(accountId);
      return latest !== null && latest.asOf >= asOf;
    },

    runRevenueRecognition: (period, actor) => revrec.recognize(period, actor)?.amount ?? ZERO,
    runAmortization: (period, actor) => schedules.runAmortization(period, actor).amount,
    runDepreciation: (period, actor) => schedules.runDepreciation(period, actor).amount,
    runFxRevaluation: (period, actor) =>
      fx.revalue(
        period,
        actor,
        () => ZERO, // no foreign balances until markMonetary() is used
        (accountId) => org.ledger.balance(accountId, periodEnd(period)),
      ).netGain,
    fxRevalued: (period) => fx.wasRevalued(period),

    plAccounts: (period) => {
      const pl = org.statements.profitAndLoss(periodStart(period), periodEnd(period));
      return [
        ...pl.revenue.map((r) => ({ accountId: r.accountId, name: r.name, amount: r.amount })),
        ...pl.expenses.map((e) => ({ accountId: e.accountId, name: e.name, amount: e.amount })),
      ];
    },
  };

  const close = new CloseEngine(org.orgId, closeContext, org.bus);

  const agents = new AgentEngine(
    org.orgId,
    {
      chart: org.chart,
      journal: org.journal,
      recurringVendors: () =>
        bills
          .all()
          .filter((b) => b.status !== "CANCELLED" && b.status !== "REJECTED")
          .reduce<{ vendor: string; accountId: string; monthlyAmount: Paise }[]>((acc, b) => {
            if (acc.some((v) => v.vendor === b.vendor)) return acc;
            const sameVendor = bills.all().filter((x) => x.vendor === b.vendor);
            if (sameVendor.length < 3) return acc; // needs a pattern, not a one-off
            const accountId = b.lines[0]!.expenseAccountId;
            const monthlyAmount = (sum(sameVendor.map((x) => x.subtotal)) / BigInt(sameVendor.length)) as Paise;
            return [...acc, { vendor: b.vendor, accountId, monthlyAmount }];
          }, []),
      billsInPeriod: (period) =>
        bills
          .all()
          .filter((b) => b.billDate.slice(0, 7) === period)
          .map((b) => ({ vendor: b.vendor, amount: b.total })),
      staleReceivables: (asOf, days) =>
        org.invoices
          .overdue(asOf)
          .filter((o) => o.daysOverdue >= days)
          .map((o) => ({
            reference: o.invoice.number,
            customer: o.invoice.customer,
            outstanding: o.outstanding,
            daysOverdue: o.daysOverdue,
          })),
      unrecognizedRevenue: (period) =>
        sum(revrec.waterfall(period, 1).map((w) => w.amount)),
    },
    org.bus,
  );

  const connectors = new ConnectorHub(org.orgId, contracts, org.bus);

  return { periods, contracts, revrec, bills, schedules, fx, reconciliation, metrics, close, agents, connectors, flows, tieOut };
};
