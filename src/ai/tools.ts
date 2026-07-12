/**
 * Engine-bound tools — the ONLY source of numbers the AI CFO may narrate.
 * Each tool calls the deterministic core and returns a structured string.
 * The orchestrator later verifies that every figure in the narration is
 * traceable to one of these outputs.
 *
 * TOOL_SPECS carries the description + JSON schema for each tool so real
 * LLM providers (Anthropic etc.) can expose them via native tool use.
 */

import { formatINR, parseINR, sub, sum } from "../money.js";
import { formatQty } from "../portfolio.js";
import { searchKnowledge } from "../knowledge.js";
import { screenTransactions } from "../anomalies.js";
import { Organization } from "../organization.js";

export type ToolFn = (org: Organization, args: Record<string, unknown>) => string;

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.length === 0) throw new Error(`Tool arg "${name}" must be a non-empty string`);
  return v;
};

const optStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export const TOOLS: Record<string, ToolFn> = {
  get_cash_position: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const cash = org.cashflow.cashOnHand(asOf);
    return `cash_on_hand=${formatINR(cash)} as_of=${asOf}`;
  },

  get_burn_and_runway: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const m = org.cashflow.metrics(asOf);
    const burn = m.monthlyNetBurn === null ? "unavailable" : formatINR(m.monthlyNetBurn);
    const runway = m.runwayDays === null ? "unavailable" : `${m.runwayDays} days`;
    return `monthly_net_burn=${burn} runway=${runway} basis_months=${m.basisMonths} note="${m.note}"`;
  },

  get_profit_and_loss: (org, args) => {
    const from = str(args.from, "from");
    const to = str(args.to, "to");
    const pl = org.statements.profitAndLoss(from, to);
    const exp = pl.expenses.map((e) => `${e.name}=${formatINR(e.amount)}`).join(" ");
    return `revenue=${formatINR(pl.totalRevenue)} expenses=${formatINR(pl.totalExpenses)} net_profit=${formatINR(pl.netProfit)} breakdown: ${exp}`;
  },

  get_balance_sheet: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const bs = org.statements.balanceSheet(asOf);
    return `assets=${formatINR(bs.totalAssets)} liabilities=${formatINR(bs.totalLiabilities)} equity=${formatINR(bs.totalEquity)} equation_holds=${bs.equationHolds}`;
  },

  get_health_score: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const from = str(args.periodFrom, "periodFrom");
    const h = org.health.score(asOf, from);
    const comps = h.components
      .filter((c) => c.dataAvailable)
      .map((c) => `${c.name}=${c.score} (${c.detail})`)
      .join("; ");
    const missing = h.missing.length ? ` missing: ${h.missing.join(", ")}` : "";
    return `health_score=${h.score}/100 grade=${h.grade} components: ${comps}${missing}`;
  },

  get_account_balance: (org, args) => {
    const code = str(args.accountCode, "accountCode");
    const asOf = str(args.asOf, "asOf");
    const acct = org.chart.getByCode(code);
    const bal = org.ledger.balance(acct.id, asOf);
    return `account="${acct.name}" balance=${formatINR(bal)} as_of=${asOf}`;
  },

  check_affordability: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const amountStr = str(args.amountINR, "amountINR");
    const amount = parseINR(amountStr);
    const cash = org.cashflow.cashOnHand(asOf);
    const m = org.cashflow.metrics(asOf);
    const after = sub(cash, amount);
    const affordable = after > 0n;
    const runwayNote =
      m.monthlyNetBurn === null
        ? "burn history unavailable"
        : m.monthlyNetBurn <= 0n
          ? "cash-flow positive"
          : `current runway ${m.runwayDays ?? "unavailable"} days`;
    return `purchase=${formatINR(amount)} cash_before=${formatINR(cash)} cash_after=${formatINR(after)} affordable=${affordable} context="${runwayNote}"`;
  },

  list_overdue_invoices: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const overdue = org.invoices.overdue(asOf);
    if (overdue.length === 0) return `overdue_count=0 note="No overdue invoices — receivables are clean."`;
    const total = sum(overdue.map((o) => o.outstanding));
    const rows = overdue
      .map((o) => `${o.invoice.number} customer="${o.invoice.customer}" outstanding=${formatINR(o.outstanding)} days_overdue=${o.daysOverdue}`)
      .join("; ");
    return `overdue_count=${overdue.length} total_overdue=${formatINR(total)} invoices: ${rows}`;
  },

  get_receivables_aging: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const aging = org.invoices.aging(asOf);
    const buckets = aging.buckets.map((b) => `"${b.label}"=${formatINR(b.amount)} (${b.count})`).join(" ");
    return `total_outstanding=${formatINR(aging.totalOutstanding)} buckets: ${buckets}`;
  },

  get_gst_position: (org, args) => {
    const from = str(args.from, "from");
    const to = str(args.to, "to");
    const p = org.gst.position(from, to);
    return `output_tax=${formatINR(p.outputTax)} input_tax_credit=${formatINR(p.inputTaxCredit)} net_payable=${formatINR(p.netPayable)} unused_credit=${formatINR(p.unusedCredit)} period=${from}..${to}`;
  },

  get_upcoming_gst_filings: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const filings = org.gst.upcomingFilings(asOf);
    const rows = filings
      .map((f) => `${f.form} period=${f.period} due=${f.dueDate} days_left=${f.daysLeft}`)
      .join("; ");
    return `filings: ${rows}`;
  },

  get_recurring_payments: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const s = org.recurring.summary(asOf);
    if (s.items.length === 0) return `recurring_count=0 note="No recurring payments detected yet (needs 3+ monthly occurrences)."`;
    const rows = s.items
      .map((i) => `"${i.name}" (${i.accountName}) monthly=${formatINR(i.monthlyAmount)} annualized=${formatINR(i.annualizedCost)}${i.isSubscription ? " subscription" : ""}`)
      .join("; ");
    return `recurring_count=${s.items.length} monthly_committed=${formatINR(s.monthlyCommitted)} annualized=${formatINR(s.annualizedCommitted)} subscription_monthly=${formatINR(s.subscriptionMonthly)} items: ${rows}`;
  },

  get_cash_forecast: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const f = org.forecast.cashForecast(asOf);
    const rows = f.points
      .map((p) => `${p.month} net=${formatINR(p.net)} closing=${formatINR(p.closingCash)} [${p.kind}]`)
      .join("; ");
    const depletion = f.depletionMonth ? ` cash_depletes=${f.depletionMonth}` : "";
    return `assumption="${f.assumption}"${depletion} months: ${rows}`;
  },

  simulate_scenario: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const label = str(args.label, "label");
    const revDelta = optStr(args.monthlyRevenueDeltaINR);
    const expDelta = optStr(args.monthlyExpenseDeltaINR);
    const oneTime = optStr(args.oneTimeCostINR);
    const result = org.forecast.scenario(asOf, {
      label,
      ...(revDelta ? { monthlyRevenueDelta: parseINR(revDelta) } : {}),
      ...(expDelta ? { monthlyExpenseDelta: parseINR(expDelta) } : {}),
      ...(oneTime ? { oneTimeCost: parseINR(oneTime) } : {}),
    });
    const baseBurn = result.baselineBurn === null ? "unavailable" : formatINR(result.baselineBurn);
    const baseRunway = result.baselineRunwayDays === null ? "n/a" : `${result.baselineRunwayDays} days`;
    const scenRunway = result.scenarioRunwayDays === null ? "cash-flow positive" : `${result.scenarioRunwayDays} days`;
    return `scenario="${result.label}" baseline_burn=${baseBurn} scenario_burn=${formatINR(result.scenarioBurn)} cash_now=${formatINR(result.cashNow)} cash_after_one_time=${formatINR(result.cashAfterOneTime)} baseline_runway=${baseRunway} scenario_runway=${scenRunway} verdict="${result.verdict}"`;
  },

  get_recommendations: (org) => {
    const pending = org.recommendations.pending();
    if (pending.length === 0) return `pending_count=0 note="No pending recommendations."`;
    const rows = pending
      .map(
        (r) =>
          `[${r.id}] "${r.title}" impact=${r.impact ? formatINR(r.impact) : "n/a"} savings=${r.estimatedSavings ? formatINR(r.estimatedSavings) : "n/a"} confidence=${r.confidence} risk=${r.risk}${r.requiresApproval ? " requires_approval" : ""}`,
      )
      .join("; ");
    return `pending_count=${pending.length} recommendations: ${rows}`;
  },

  get_portfolio: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const s = org.portfolio.summary(asOf);
    if (s.holdings.length === 0)
      return `holdings_count=0 realized_pnl=${formatINR(s.realizedPnl)} note="No open investment positions on the ledger."`;
    const rows = s.holdings
      .map((h) => {
        const value = h.marketValue !== null ? formatINR(h.marketValue) : "unmarked";
        const upnl = h.unrealizedPnl !== null ? formatINR(h.unrealizedPnl) : "unavailable";
        return `${h.symbol} "${h.name}" kind=${h.kind} qty=${formatQty(h.qty)} cost=${formatINR(h.costBasis)} value=${value} unrealized=${upnl}`;
      })
      .join("; ");
    const alloc = s.allocation.map((a) => `${a.kind}=${formatINR(a.value)} (${a.pct}%)`).join(" ");
    const unmarked = s.unmarkedSymbols.length
      ? ` unmarked_symbols="${s.unmarkedSymbols.join(",")}" note="Unmarked holdings carry no market value — Paisa never guesses a price."`
      : "";
    return `holdings_count=${s.holdings.length} invested=${formatINR(s.totalCostBasis)} marked_value=${formatINR(s.markedValue)} unrealized_pnl=${formatINR(s.unrealizedPnl)} realized_pnl=${formatINR(s.realizedPnl)} allocation: ${alloc} holdings: ${rows}${unmarked}`;
  },

  list_review_queue: (org) => {
    const lines = org.banking.pendingReview();
    if (lines.length === 0)
      return `review_count=0 note="Nothing awaits review — every imported line is categorised."`;
    const rows = lines
      .map(
        (l) =>
          `reference="${l.reference}" date=${l.date} description="${l.description}" amount=${formatINR(l.amount)} direction=${l.amount < 0n ? "out" : "in"}`,
      )
      .join("; ");
    return `review_count=${lines.length} lines: ${rows}`;
  },

  propose_categorization: (org, args) => {
    const reference = str(args.reference, "reference");
    const code = str(args.accountCode, "accountCode");
    const line = org.banking.pendingReview().find((l) => l.reference === reference);
    if (!line) throw new Error(`No line with reference ${reference} awaits review`);
    const acct = org.chart.getByCode(code);
    const direction = line.amount < 0n ? "out" : "in";
    if (direction === "out" && acct.type !== "EXPENSE")
      throw new Error(`"${acct.name}" is ${acct.type}; money going out must be categorised to an EXPENSE account`);
    if (direction === "in" && acct.type !== "REVENUE")
      throw new Error(`"${acct.name}" is ${acct.type}; money coming in must be categorised to a REVENUE account`);
    return `proposal=categorize reference="${reference}" account_code=${code} account="${acct.name}" description="${line.description}" amount=${formatINR(line.amount)} status="draft — posts only after the user approves"`;
  },

  screen_transactions: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const report = screenTransactions(org, asOf);
    if (report.findings.length === 0)
      return `entries_checked=${report.entriesChecked} period=${report.from}..${report.to} findings=0 note="No duplicate payments or amount outliers detected in this window."`;
    const rows = report.findings
      .map(
        (f, i) =>
          `[${i + 1}] kind=${f.kind} severity=${f.severity} date=${f.date} account="${f.accountName}" amount=${formatINR(f.amount)} narration="${f.narration}" entries="${f.entryIds.join(",")}" detail="${f.detail}"`,
      )
      .join("; ");
    return `entries_checked=${report.entriesChecked} period=${report.from}..${report.to} findings=${report.findings.length} items: ${rows}`;
  },

  lookup_regulation: (_org, args) => {
    const query = str(args.query, "query");
    const matches = searchKnowledge(query);
    if (matches.length === 0)
      return `matches=0 note="The regulation knowledge base has no entry covering this. Say so plainly and suggest confirming with a CA — do not answer from memory."`;
    const rows = matches
      .map(
        (m, i) =>
          `[${i + 1}] "${m.entry.title}" source="${m.entry.source}" verified_as_of=${m.entry.asOf} text="${m.entry.text}"`,
      )
      .join("; ");
    return `matches=${matches.length} entries: ${rows} note="Curated snapshot — cite the source and verified_as_of date with your answer; the law may have changed since."`;
  },

  get_morning_brief: (org, args) => {
    const asOf = str(args.asOf, "asOf");
    const periodFrom = str(args.periodFrom, "periodFrom");
    const b = org.brief.compose(asOf, periodFrom);
    const burn = b.monthlyNetBurn === null ? "unavailable" : formatINR(b.monthlyNetBurn);
    const runway = b.runwayDays === null ? "unavailable" : `${b.runwayDays} days`;
    const filing = b.nextFiling ? `${b.nextFiling.form} due=${b.nextFiling.dueDate} days_left=${b.nextFiling.daysLeft}` : "none";
    return [
      `health=${b.health.score}/100 grade=${b.health.grade}`,
      `cash=${formatINR(b.cashOnHand)} burn=${burn} runway=${runway}`,
      `month_revenue=${formatINR(b.revenue.current)} month_expenses=${formatINR(b.expenses.current)} month_profit=${formatINR(b.profit.current)}`,
      `overdue_invoices=${b.overdueCount} overdue_amount=${formatINR(b.overdueAmount)}`,
      `next_filing=${filing}`,
      `pending_recommendations=${b.pendingRecommendations.length} savings_identified=${formatINR(b.savingsIdentified)}`,
      `headline="${b.headline}"`,
    ].join(" ");
  },
};

const dateArg = (desc: string) => ({ type: "string", description: `${desc} (ISO date, YYYY-MM-DD)` });

export const TOOL_SPECS: readonly ToolSpec[] = [
  { name: "get_cash_position", description: "Total cash and bank balance as of a date.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_burn_and_runway", description: "Monthly net burn rate and runway in days, from trailing ledger history.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_profit_and_loss", description: "Revenue, expenses, and net profit for a period, with per-account expense breakdown.", inputSchema: { type: "object", properties: { from: dateArg("Period start"), to: dateArg("Period end") }, required: ["from", "to"], additionalProperties: false } },
  { name: "get_balance_sheet", description: "Assets, liabilities, and equity as of a date.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_health_score", description: "The 0-100 financial health score with explained components.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date"), periodFrom: dateArg("Period start for profitability") }, required: ["asOf", "periodFrom"], additionalProperties: false } },
  { name: "get_account_balance", description: "Balance of a single ledger account by its chart code (e.g. 5300 for Software).", inputSchema: { type: "object", properties: { accountCode: { type: "string", description: "Chart of accounts code" }, asOf: dateArg("As-of date") }, required: ["accountCode", "asOf"], additionalProperties: false } },
  { name: "check_affordability", description: "Whether a one-time purchase is affordable given current cash and burn.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date"), amountINR: { type: "string", description: "Amount in INR, e.g. '2,50,000'" } }, required: ["asOf", "amountINR"], additionalProperties: false } },
  { name: "list_overdue_invoices", description: "All overdue invoices with customer, outstanding amount, and days overdue.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_receivables_aging", description: "Accounts-receivable aging buckets (current, 1-30, 31-60, 60+ days).", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_gst_position", description: "GST output tax, input tax credit, and net payable for a period.", inputSchema: { type: "object", properties: { from: dateArg("Period start"), to: dateArg("Period end") }, required: ["from", "to"], additionalProperties: false } },
  { name: "get_upcoming_gst_filings", description: "Upcoming (and recently overdue) GSTR-1 and GSTR-3B filing deadlines.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_recurring_payments", description: "Detected recurring payments and subscriptions with monthly and annualized cost.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "get_cash_forecast", description: "Monthly cash history plus a forward projection at trailing-average burn.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "simulate_scenario", description: "Simulate a change (hire, new client, big purchase) and see the effect on burn and runway.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date"), label: { type: "string", description: "Short scenario name" }, monthlyRevenueDeltaINR: { type: "string", description: "Monthly revenue change in INR (optional)" }, monthlyExpenseDeltaINR: { type: "string", description: "Monthly expense change in INR (optional)" }, oneTimeCostINR: { type: "string", description: "One-time cost in INR (optional)" } }, required: ["asOf", "label"], additionalProperties: false } },
  { name: "get_recommendations", description: "Pending AI-CFO recommendations with impact, confidence, and risk.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_portfolio", description: "Investment portfolio: holdings with cost basis and marked market value, unrealized/realized P&L, and allocation by instrument kind. Unmarked holdings are declared, never priced by guesswork.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "list_review_queue", description: "Bank statement lines awaiting human categorisation (the review queue): reference, date, description, amount, direction. Check this before proposing categorisations.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "propose_categorization", description: "Draft a categorisation for ONE review-queue line. This never posts anything — the user gets an Approve button and the journal entry is created only after their explicit approval. Money out needs an EXPENSE account code, money in a REVENUE code (e.g. 5300 Software, 5400 Travel, 4000 Sales).", inputSchema: { type: "object", properties: { reference: { type: "string", description: "The line's bank reference, exactly as list_review_queue printed it" }, accountCode: { type: "string", description: "Chart of accounts code to categorise into" } }, required: ["reference", "accountCode"], additionalProperties: false } },
  { name: "get_morning_brief", description: "The full morning brief: health, cash, month metrics, overdue invoices, filings, recommendations.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date"), periodFrom: dateArg("Period start") }, required: ["asOf", "periodFrom"], additionalProperties: false } },
  { name: "screen_transactions", description: "Deterministic fraud/anomaly screening over the last 90 days of the ledger: duplicate payments (same narration + amount within a week) and expense charges far above the account's own median. Every finding names the exact journal entries and the rule that fired. Use for questions about fraud, suspicious activity, duplicates, or unusual spending.", inputSchema: { type: "object", properties: { asOf: dateArg("As-of date") }, required: ["asOf"], additionalProperties: false } },
  { name: "lookup_regulation", description: "Search Paisa's curated Indian tax & GST regulation knowledge base: GST rates and registration, ITC conditions and blocked credits, composition scheme, return due-date rules, e-invoicing, reverse charge, income-tax slabs, 44AD/44ADA presumptive schemes, 80C/80D deductions, TDS sections, advance tax. Returns cited passages with a verified-as-of date. Use for ANY question about what the law says — a rate, threshold, section, or eligibility — and never answer such questions from memory.", inputSchema: { type: "object", properties: { query: { type: "string", description: "The legal question or topic, e.g. 'GST rate on software services' or 'ITC on food'" } }, required: ["query"], additionalProperties: false } },
];

export const toolNames = (): readonly string[] => Object.keys(TOOLS);
