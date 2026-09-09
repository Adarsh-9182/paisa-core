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
import { BudgetEngine, ActualLine, BudgetError, VarianceReport } from "./budgets.js";
import { CloseEngine, CloseContext } from "./close.js";
import { AgentEngine } from "./agents.js";
import { AuthorityRegistry } from "./authority.js";
import { ConnectorHub } from "./connectors.js";
import { FlowEngine } from "./flow-engine.js";
import { CfoAgent } from "./cfo-agent.js";
import { draftPaymentReminder, REMINDER_KIND } from "../reminders.js";

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
  readonly budgets: BudgetEngine;
  readonly close: CloseEngine;
  readonly agents: AgentEngine;
  readonly authority: AuthorityRegistry;
  readonly connectors: ConnectorHub;
  readonly flows: FlowEngine;
  /**
   * The standing agent: the one thing here that runs without being asked.
   * It spends authority that already exists and drafts what it cannot do
   * alone — see cfo-agent.ts for why that boundary is the whole design.
   */
  readonly cfo: CfoAgent;
  /**
   * AR and AP as they stood on a date, against their GL control accounts.
   * The close checklist and any reporting surface must share this one
   * implementation — two copies of a tie-out is how they come to disagree.
   */
  readonly tieOut: (asOf: string) => { readonly ar: SubledgerTieOut; readonly ap: SubledgerTieOut };
  /**
   * Budget against actuals for a period, with the actuals already supplied
   * from the P&L. Callers get the same figures the BUDGET_VARIANCE agent
   * read — a reporting surface that assembles its own actuals is a second
   * set of books waiting to disagree with the first.
   */
  readonly budgetReport: (period: PeriodKey) => VarianceReport;
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
  /*
   * Only P&L accounts can be budgeted. Budgeting a bank balance is not a
   * plan a variance report can speak about, and letting it through would put
   * a line on the page whose "over" and "under" mean nothing.
   */
  const budgetAccount = (accountId: string) => {
    const account = org.chart.get(accountId);
    if (account.type !== "REVENUE" && account.type !== "EXPENSE") {
      throw new BudgetError(
        `${accountId} is a ${account.type} account — only revenue and expense accounts can be budgeted`,
      );
    }
    return { name: account.name, type: account.type };
  };

  const budgets = new BudgetEngine(org.orgId, org.bus, budgetAccount);
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

  /**
   * P&L accounts for a period, tagged with their direction. The close
   * checklist and the budget report read the same numbers from here — a
   * second way to total the P&L is a second set of figures to reconcile.
   */
  const plActuals = (period: PeriodKey): readonly ActualLine[] => {
    const pl = org.statements.profitAndLoss(periodStart(period), periodEnd(period));
    return [
      ...pl.revenue.map((r) => ({ accountId: r.accountId, name: r.name, type: "REVENUE" as const, amount: r.amount })),
      ...pl.expenses.map((e) => ({ accountId: e.accountId, name: e.name, type: "EXPENSE" as const, amount: e.amount })),
    ];
  };

  const budgetReport = (period: PeriodKey): VarianceReport => budgets.variance(period, plActuals(period));

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
    unreviewedBankLines: (asOf) => org.banking.pendingReview().filter((l) => l.date <= asOf),
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

    plAccounts: (period) => plActuals(period).map(({ accountId, name, amount }) => ({ accountId, name, amount })),
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
      // One definition of materiality, owned by the close checklist. The
      // agent explains the movements; it does not get its own opinion about
      // which ones matter.
      materialFlux: (period) => close.flux(period),
      // Same discipline for the plan: the budget engine decides what counts
      // as off-plan, the agent only explains what drove it.
      budgetVariance: (period) => budgetReport(period).lines,
      unreviewedBankLines: (asOf) => org.banking.pendingReview().filter((l) => l.date <= asOf),
      latestReconciliations: () =>
        cashAccounts
          .map(({ accountId, name }) => {
            // Latest of any status: a draft that would not balance and was
            // abandoned is the one most worth raising.
            const rec = reconciliation
              .all()
              .filter((r) => r.accountId === accountId)
              .sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
            return rec ? { rec, name } : null;
          })
          .filter((x): x is { rec: ReturnType<typeof reconciliation.all>[number]; name: string } => x !== null)
          .map(({ rec, name }) => ({
            accountId: rec.accountId,
            accountName: name,
            asOf: rec.asOf,
            difference: rec.difference,
            reconciled: rec.reconciled,
            status: rec.status,
            unmatchedStatement: rec.unmatchedStatement.map((l) => ({
              reference: l.reference, date: l.date, description: l.description, amount: l.amount,
            })),
            unmatchedBook: rec.unmatchedBook.map((e) => ({
              entryId: e.entryId, date: e.date, narration: e.narration, amount: e.amount,
            })),
          })),
    },
    org.bus,
  );

  const connectors = new ConnectorHub(org.orgId, contracts, org.bus);

  /*
   * The standing-authority registry approves through `agents.approve`, which
   * is still the only path to the ledger — this adds no second way in. It
   * reads period status and reversals live rather than being handed copies,
   * so a grant can never act on a period that has since closed or stay
   * confident about a posting a controller has already undone.
   */
  const authority = new AuthorityRegistry(
    org.orgId,
    {
      approve: (proposalId, actor) => agents.approve(proposalId, actor),
      periodStatus: (period) => periods.status(period),
      isReversed: (entryId) => org.journal.get(entryId).reversedBy !== null,
    },
    org.bus,
  );

  /*
   * The agent reaches the organization through these hooks and nothing else.
   * Handing it `org` would give a scheduled process the run of the books;
   * this way its blast radius is four functions long and reviewable.
   */
  const cfo = new CfoAgent({
    close: { close, agents, authority },
    periods: { firstPeriod: periods.firstPeriod, status: (period) => periods.status(period) },
    overdueInvoices: (asOf, minDaysOverdue) =>
      org.invoices
        .overdue(asOf)
        .filter((o) => o.daysOverdue >= minDaysOverdue)
        .map((o) => ({
          number: o.invoice.number,
          customer: o.invoice.customer,
          outstanding: o.outstanding,
          daysOverdue: o.daysOverdue,
        })),
    pendingDrafts: () => org.actions.pending().map((a) => ({ kind: a.kind, summary: a.summary })),
    draftReminder: (invoiceNumber, asOf) => draftPaymentReminder(org, invoiceNumber, asOf).summary,
    cash: (asOf) => {
      const m = org.cashflow.metrics(asOf);
      return { cash: m.cashOnHand, runwayDays: m.runwayDays, monthlyNetBurn: m.monthlyNetBurn, note: m.note };
    },
  });

  const suite: ErpSuite = { periods, contracts, revrec, bills, schedules, fx, reconciliation, metrics, budgets, close, agents, authority, connectors, flows, cfo, tieOut, budgetReport };

  /*
   * Record what was attached, on the org it was attached to.
   *
   * Without this the AI's tools can only see `org.actions` — so
   * `list_pending_actions`, whose description promises everything waiting on
   * the user, was quietly omitting every agent proposal. An agent that
   * answers "nothing is waiting on you" while nine findings sit in a queue is
   * worse than one that cannot answer at all.
   */
  org.erp = suite;

  return suite;
};
