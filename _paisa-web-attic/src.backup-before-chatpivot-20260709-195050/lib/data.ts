/**
 * Server-side data assembly — every page reads the deterministic engines
 * through these functions and receives plain, display-ready objects
 * (no bigints cross the server/client boundary).
 */

import { ZERO, sum, formatQty, type Paise } from "paisa-core";
import { getPaisa, AS_OF, PERIOD_FROM } from "./engine";
import { inr, inrCompact, rupees, pctChange } from "./format";
import { listConnections } from "./connections";

const monthWindow = (offset: number): { from: string; to: string } => {
  const [y, m] = AS_OF.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + offset;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};

/* ---------------- home ---------------- */

export async function getBrief() {
  const { org } = await getPaisa();
  org.recommendations.generate(AS_OF, PERIOD_FROM);
  const b = org.brief.compose(AS_OF, PERIOD_FROM);
  return {
    asOf: AS_OF,
    headline: b.headline,
    health: {
      score: b.health.score,
      grade: b.health.grade,
      components: b.health.components.map((c) => ({ name: c.name, score: c.score, detail: c.detail, available: c.dataAvailable })),
    },
    cash: inr(b.cashOnHand),
    overdueCount: b.overdueCount,
    pendingRecommendations: b.pendingRecommendations.length,
  };
}

export async function getMetrics() {
  const { org } = await getPaisa();
  const cur = monthWindow(-1);
  const prev = monthWindow(-2);
  const plCur = org.statements.profitAndLoss(cur.from, cur.to);
  const plPrev = org.statements.profitAndLoss(prev.from, prev.to);
  const cm = org.cashflow.metrics(AS_OF);

  // Trailing 6-month series for the KPI sparklines (rupees).
  const revSpark: number[] = [];
  const expSpark: number[] = [];
  const profSpark: number[] = [];
  for (let k = 6; k >= 1; k--) {
    const w = monthWindow(-k);
    const pl = org.statements.profitAndLoss(w.from, w.to);
    revSpark.push(rupees(pl.totalRevenue));
    expSpark.push(rupees(pl.totalExpenses));
    profSpark.push(rupees(pl.netProfit));
  }

  return {
    monthLabel: cur.from.slice(0, 7),
    revenue: { value: inrCompact(plCur.totalRevenue), full: inr(plCur.totalRevenue), raw: rupees(plCur.totalRevenue), spark: revSpark, changePct: pctChange(plCur.totalRevenue, plPrev.totalRevenue) },
    expenses: { value: inrCompact(plCur.totalExpenses), full: inr(plCur.totalExpenses), raw: rupees(plCur.totalExpenses), spark: expSpark, changePct: pctChange(plCur.totalExpenses, plPrev.totalExpenses) },
    profit: {
      value: inrCompact(plCur.netProfit),
      full: inr(plCur.netProfit),
      raw: rupees(plCur.netProfit),
      spark: profSpark,
      marginPct: plCur.totalRevenue > 0n ? Number((plCur.netProfit * 100n) / plCur.totalRevenue) : null,
    },
    runway: {
      days: cm.runwayDays,
      burn: cm.monthlyNetBurn === null ? null : inrCompact(cm.monthlyNetBurn),
      positive: cm.monthlyNetBurn !== null && cm.monthlyNetBurn <= 0n,
      note: cm.note,
    },
  };
}

export async function getCashflow() {
  const { org } = await getPaisa();
  const f = org.forecast.cashForecast(AS_OF, 6, 3);
  return {
    assumption: f.assumption,
    depletionMonth: f.depletionMonth,
    cash: inr(org.cashflow.cashOnHand(AS_OF)),
    points: f.points.map((p) => ({
      month: p.month,
      kind: p.kind,
      closing: rupees(p.closingCash),
      closingLabel: inrCompact(p.closingCash),
      netLabel: inrCompact(p.net),
    })),
  };
}

export async function getUpcoming() {
  const { org } = await getPaisa();
  const filings = org.gst.upcomingFilings(AS_OF).filter((f) => f.daysLeft >= 0).slice(0, 2);
  const recurring = org.recurring
    .detect(AS_OF)
    .filter((r) => r.nextExpectedDate >= AS_OF)
    .slice(0, 3);
  return [
    ...filings.map((f) => ({
      title: `${f.form} · ${f.period}`,
      sub: f.note,
      date: f.dueDate,
      badge: f.daysLeft <= 7 ? `${f.daysLeft}d left` : null,
      amount: null as string | null,
    })),
    ...recurring.map((r) => {
      const title = r.name.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        title,
        sub: title.toLowerCase() === r.accountName.toLowerCase() ? "Recurring · monthly" : r.accountName,
        date: r.nextExpectedDate,
        badge: null as string | null,
        amount: inrCompact(r.monthlyAmount),
      };
    }),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function getTransactions(limit = 7) {
  const { org } = await getPaisa();
  const cashIds = new Set(org.chart.all().filter((a) => a.isCashEquivalent).map((a) => a.id));
  const rows = [...org.journal.all()]
    .reverse()
    .map((e) => {
      let cashDelta: bigint = 0n;
      let counterName = "";
      for (const l of e.lines) {
        if (cashIds.has(l.accountId)) cashDelta += l.side === "DEBIT" ? l.amount : -l.amount;
        else counterName = org.chart.get(l.accountId).name;
      }
      if (cashDelta === 0n) return null;
      return {
        date: e.date,
        narration: e.narration,
        category: counterName,
        amount: inr((cashDelta < 0n ? -cashDelta : cashDelta) as Paise),
        direction: cashDelta < 0n ? ("out" as const) : ("in" as const),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .slice(0, limit);
  return { rows, needsReview: org.banking.pendingReview().length };
}

export async function getRecommendations() {
  const { org } = await getPaisa();
  org.recommendations.generate(AS_OF, PERIOD_FROM);
  return org.recommendations.all().map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    problem: r.problem,
    reason: r.reason,
    requiredAction: r.requiredAction,
    impact: r.impact ? inr(r.impact) : null,
    estimatedSavings: r.estimatedSavings ? inr(r.estimatedSavings) : null,
    confidence: r.confidence,
    risk: r.risk,
    requiresApproval: r.requiresApproval,
    status: r.status,
  }));
}

/* ---------------- money ---------------- */

export async function getMoney() {
  const { org } = await getPaisa();
  const cash = org.cashflow.cashOnHand(AS_OF);
  const month = monthWindow(0);
  const cf = org.statements.cashFlow(month.from, AS_OF);
  const cm = org.cashflow.metrics(AS_OF);
  const accounts = org.chart
    .all()
    .map((a) => ({ account: a, balance: org.ledger.balance(a.id, AS_OF) }))
    .filter(({ account, balance }) => account.isCashEquivalent || balance !== 0n)
    .map(({ account, balance }) => ({
      code: account.code,
      name: account.name,
      type: account.type,
      isCash: account.isCashEquivalent,
      balance: inr(balance),
    }));
  const review = org.banking.pendingReview().map((l) => ({
    reference: l.reference,
    date: l.date,
    description: l.description,
    amount: inr((l.amount < 0n ? -l.amount : l.amount) as Paise),
    direction: l.amount < 0n ? ("out" as const) : ("in" as const),
  }));
  const categorizeTargets = org.chart
    .all()
    .filter((a) => a.type === "EXPENSE" || a.type === "REVENUE")
    .map((a) => ({ id: a.id, name: a.name, type: a.type }));
  const bankAccounts = org.chart
    .all()
    .filter((a) => a.type === "ASSET" && a.isCashEquivalent)
    .map((a) => ({ id: a.id, code: a.code, name: a.name }));
  return {
    asOf: AS_OF,
    cash: inr(cash),
    cashCompact: inrCompact(cash),
    monthInflows: inrCompact(cf.inflows),
    monthOutflows: inrCompact(cf.outflows),
    monthNet: inrCompact(cf.netChange),
    burn: cm.monthlyNetBurn === null ? null : inrCompact(cm.monthlyNetBurn),
    burnPositive: cm.monthlyNetBurn !== null && cm.monthlyNetBurn <= 0n,
    accounts,
    bankAccounts,
    review,
    categorizeTargets,
    recurring: org.recurring.detect(AS_OF).map((r) => ({
      name: r.name.replace(/\b\w/g, (c) => c.toUpperCase()),
      account: r.accountName,
      monthly: inr(r.monthlyAmount),
      annualized: inrCompact(r.annualizedCost),
      next: r.nextExpectedDate,
      isSubscription: r.isSubscription,
    })),
  };
}

/* ---------------- invoices ---------------- */

export async function getInvoices() {
  const { org } = await getPaisa();
  const all = org.invoices.all();
  const open = all.filter((i) => (i.status === "SENT" || i.status === "PARTIALLY_PAID") && org.invoices.outstanding(i) > 0n);
  const overdue = org.invoices.overdue(AS_OF);
  const aging = org.invoices.aging(AS_OF);
  return {
    totals: {
      outstanding: inr(sum(open.map((i) => org.invoices.outstanding(i)))),
      overdueAmount: inr(sum(overdue.map((o) => o.outstanding))),
      overdueCount: overdue.length,
      openCount: open.length,
    },
    aging: aging.buckets.map((b) => ({ label: b.label, count: b.count, amount: inr(b.amount), raw: rupees(b.amount) })),
    items: [...all].reverse().map((i) => ({
      number: i.number,
      customer: i.customer,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      total: inr(i.total),
      outstanding: inr(org.invoices.outstanding(i)),
      status: i.status,
      overdue: (i.status === "SENT" || i.status === "PARTIALLY_PAID") && i.dueDate < AS_OF,
    })),
  };
}

/* ---------------- taxes & gst ---------------- */

export async function getGst() {
  const { org } = await getPaisa();
  const last = monthWindow(-1);
  const pos = org.gst.position(last.from, last.to);
  const mtd = org.gst.position(monthWindow(0).from, AS_OF);
  return {
    periodLabel: last.from.slice(0, 7),
    outputTax: inr(pos.outputTax),
    itc: inr(pos.inputTaxCredit),
    netPayable: inr(pos.netPayable),
    unusedCredit: inr(pos.unusedCredit),
    payableBalance: inr(pos.gstPayableBalance),
    mtdOutputTax: inr(mtd.outputTax),
    filings: org.gst.upcomingFilings(AS_OF).map((f) => ({
      form: f.form,
      period: f.period,
      dueDate: f.dueDate,
      daysLeft: f.daysLeft,
      note: f.note,
    })),
    gstRecommendations: (await getRecommendations()).filter((r) => r.kind === "gst_filing"),
  };
}

/* ---------------- investments ---------------- */

export async function getInvestments() {
  const { org } = await getPaisa();
  const cash = org.cashflow.cashOnHand(AS_OF);
  let trailingExpenses: Paise = ZERO;
  for (let i = 1; i <= 3; i++) {
    const w = monthWindow(-i);
    trailingExpenses = (trailingExpenses + org.statements.profitAndLoss(w.from, w.to).totalExpenses) as Paise;
  }
  const avgMonthly = (trailingExpenses / 3n) as Paise;
  const coverageMonths = avgMonthly > 0n ? Number((cash * 10n) / avgMonthly) / 10 : null;
  const idleCashRec = (await getRecommendations()).find((r) => r.kind === "idle_cash") ?? null;

  const s = org.portfolio.summary(AS_OF);
  const pnlPct = (pnl: Paise, cost: Paise): number | null =>
    cost > 0n ? Number((pnl * 1000n) / cost) / 10 : null;

  return {
    cash: inr(cash),
    cashCompact: inrCompact(cash),
    avgMonthlyExpenses: inr(avgMonthly),
    coverageMonths,
    idleCashRec,
    portfolio: {
      hasHoldings: s.holdings.length > 0,
      invested: inr(s.totalCostBasis),
      investedCompact: inrCompact(s.totalCostBasis),
      markedValue: inr(s.markedValue),
      markedValueCompact: inrCompact(s.markedValue),
      unrealizedPnl: inr(s.unrealizedPnl),
      unrealizedPct: pnlPct(s.unrealizedPnl, s.markedCostBasis),
      realizedPnl: inr(s.realizedPnl),
      unmarkedSymbols: s.unmarkedSymbols,
      allocation: s.allocation.map((a) => ({
        kind: a.kind.replace(/_/g, " "),
        value: inrCompact(a.value),
        pct: a.pct,
      })),
      holdings: s.holdings.map((h) => ({
        symbol: h.symbol,
        name: h.name,
        kind: h.kind.replace(/_/g, " "),
        qty: formatQty(h.qty),
        avgCost: inr(h.avgCostPerUnit),
        costBasis: inr(h.costBasis),
        markPrice: h.mark ? inr(h.mark.pricePerUnit) : null,
        markDate: h.mark?.date ?? null,
        marketValue: h.marketValue !== null ? inr(h.marketValue) : null,
        unrealizedPnl: h.unrealizedPnl !== null ? inr(h.unrealizedPnl) : null,
        unrealizedUp: h.unrealizedPnl !== null ? h.unrealizedPnl >= 0n : null,
        unrealizedPct: h.unrealizedPnl !== null ? pnlPct(h.unrealizedPnl, h.costBasis) : null,
      })),
      trades: [...org.portfolio.tradesUpTo(AS_OF)].reverse().map((t) => ({
        id: t.id,
        date: t.date,
        side: t.side,
        symbol: t.symbol,
        name: t.name,
        qty: formatQty(t.qty),
        price: inr(t.pricePerUnit),
        cash: inr(t.cashAmount),
        realizedPnl: t.realizedPnl !== null ? inr(t.realizedPnl) : null,
        realizedUp: t.realizedPnl !== null ? t.realizedPnl >= 0n : null,
      })),
    },
  };
}

/* ---------------- reports ---------------- */

export async function getReports() {
  const { org } = await getPaisa();
  const pl = org.statements.profitAndLoss(PERIOD_FROM, AS_OF);
  const bs = org.statements.balanceSheet(AS_OF);
  const cf = org.statements.cashFlow(PERIOD_FROM, AS_OF);
  const line = (l: { name: string; amount: Paise }) => ({ name: l.name, amount: inr(l.amount) });
  return {
    period: { from: PERIOD_FROM, to: AS_OF },
    pl: {
      revenue: pl.revenue.map(line),
      expenses: pl.expenses.map(line),
      totalRevenue: inr(pl.totalRevenue),
      totalExpenses: inr(pl.totalExpenses),
      netProfit: inr(pl.netProfit),
    },
    bs: {
      assets: bs.assets.map(line),
      liabilities: bs.liabilities.map(line),
      equity: bs.equity.map(line),
      totalAssets: inr(bs.totalAssets),
      totalLiabilities: inr(bs.totalLiabilities),
      totalEquity: inr(bs.totalEquity),
      equationHolds: bs.equationHolds,
    },
    cf: {
      openingCash: inr(cf.openingCash),
      closingCash: inr(cf.closingCash),
      inflows: inr(cf.inflows),
      outflows: inr(cf.outflows),
      netChange: inr(cf.netChange),
    },
  };
}

/* ---------------- settings ---------------- */

export async function getSettings() {
  const { org, providerName } = await getPaisa();
  return {
    org: { id: org.orgId, name: org.name, asOf: AS_OF, periodFrom: PERIOD_FROM },
    provider: providerName,
    rules: org.rules.all().map((r) => ({
      name: r.name,
      metric: r.metric,
      op: r.op,
      threshold: typeof r.threshold === "bigint" ? inr(r.threshold as Paise) : String(r.threshold),
      action: r.action,
      enabled: r.enabled,
    })),
    categorization: org.banking.allRules().map((r) => ({ keyword: r.keyword, label: r.label })),
    chart: org.chart.all().map((a) => ({ code: a.code, name: a.name, type: a.type, cash: a.isCashEquivalent })),
  };
}

/* ---------------- ask ai ---------------- */

export async function getAiLog() {
  const { orchestrator } = await getPaisa();
  return [...orchestrator.audit()].reverse().map((r) => ({
    at: r.at,
    query: r.userQuery,
    answer: r.finalAnswer,
    verified: r.verified,
    tools: r.toolsInvoked.map((t) => t.tool),
  }));
}

/* ---------------- agent activity (real event log) ---------------- */

export type ActivityTone = "blue" | "emerald" | "amber" | "rose" | "purple" | "cyan" | "muted";
export interface ActivityItem {
  kind: string;
  title: string;
  detail: string;
  tone: ActivityTone;
  at: string; // ISO
  actor: string;
}

const humanize = (s: string) => s.replace(/[._]/g, " ");

/** The immutable financial event log, mapped to a human activity stream. */
export async function getActivity(limit = 12): Promise<ActivityItem[]> {
  const { org } = await getPaisa();
  const log = org.bus.audit(org.orgId);
  const skip = new Set(["journal.posted", "journal.reversed", "banking.needs_review"]);
  const dedupe = new Set(["recommendation.created", "rule.fired"]);
  const seen = new Set<string>();
  const out: ActivityItem[] = [];

  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (skip.has(e.type)) continue;
    const p = e.payload as Record<string, unknown>;
    const s = (k: string) => (p[k] == null ? "" : String(p[k]));
    let item: ActivityItem;

    switch (e.type) {
      case "ai.answered": {
        const tools = Array.isArray(p.tools) ? (p.tools as unknown[]).length : 0;
        item = { kind: "ai", title: `Answered “${s("query")}”`, detail: tools ? `verified · ${tools} tool${tools > 1 ? "s" : ""}` : "verified", tone: "blue", at: e.at, actor: e.actor };
        break;
      }
      case "recommendation.created":
        item = { kind: "rec", title: s("title") || "New recommendation", detail: "recommendation generated", tone: "purple", at: e.at, actor: e.actor };
        break;
      case "rule.fired":
        item = { kind: "rule", title: s("message") || "Policy rule fired", detail: `action · ${humanize(s("action"))}`, tone: "amber", at: e.at, actor: e.actor };
        break;
      case "trade.recorded":
        item = { kind: "trade", title: `${s("side")} ${s("symbol")}`, detail: `cash ${s("cash")}`, tone: s("side") === "BUY" ? "blue" : "emerald", at: e.at, actor: e.actor };
        break;
      case "price.marked":
        item = { kind: "mark", title: `Marked ${s("symbol")} @ ${s("price")}`, detail: `source · ${s("source") || "—"}`, tone: "cyan", at: e.at, actor: e.actor };
        break;
      case "invoice.created":
      case "invoice.sent":
      case "invoice.payment":
      case "invoice.cancelled": {
        const verb = e.type.split(".")[1];
        item = { kind: "invoice", title: `Invoice ${s("number")} ${verb}`.trim(), detail: s("customer") || "posted to the ledger", tone: verb === "payment" ? "emerald" : verb === "cancelled" ? "rose" : "blue", at: e.at, actor: e.actor };
        break;
      }
      case "banking.imported":
        item = { kind: "bank", title: "Bank statement imported", detail: p.count != null ? `${s("count")} lines` : "auto-categorised", tone: "muted", at: e.at, actor: e.actor };
        break;
      case "banking.categorized":
        item = { kind: "bank", title: "Transaction categorised", detail: s("label") || "posted to the ledger", tone: "muted", at: e.at, actor: e.actor };
        break;
      default:
        item = { kind: "event", title: humanize(e.type), detail: "", tone: "muted", at: e.at, actor: e.actor };
    }

    if (dedupe.has(e.type)) {
      const key = `${e.type}|${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

/** Financial-health breakdown for the dashboard gauge. */
export async function getHealth() {
  const b = await getBrief();
  return b.health;
}

/* ---------------- connected banks (Account Aggregator) ---------------- */

export async function getConnections() {
  return (await listConnections()).map((c) => ({
    id: c.id,
    fipName: c.fipName,
    maskedAccount: c.maskedAccount,
    status: c.status,
    connectedAt: c.connectedAt,
    lastSyncedAt: c.lastSyncedAt,
    txnCount: c.txnCount,
  }));
}
