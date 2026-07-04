/**
 * CfoPlanner — a deterministic, offline LanguageModelProvider.
 *
 * Routes a natural-language question to engine tools by keyword, then
 * composes the answer by quoting tool outputs verbatim, so every figure
 * survives verifyNarration() by construction. No API key, no network,
 * no hallucination surface. Swap in AnthropicProvider for richer prose;
 * the tool layer and verification are identical either way.
 */

import { LanguageModelProvider, ModelContext, ModelTurn, ToolCallRequest } from "./provider.js";

export interface PlannerConfig {
  readonly asOf: string; // "today" for the engines
  readonly periodFrom: string; // start of the reporting period
}

interface Route {
  readonly match: RegExp;
  readonly calls: (cfg: PlannerConfig, query: string) => ToolCallRequest[];
  readonly intro: string; // no digits allowed here — narration figures must come from tools
}

const monthStart = (iso: string): string => iso.slice(0, 7) + "-01";

const previousMonthWindow = (iso: string): { from: string; to: string } => {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - 1;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};

/** Pull "₹1,00,000" or "1,00,000" or "50000" out of a question, if present. */
const extractAmount = (query: string): string | null => {
  const m = /₹?\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(lakh|lac|l\b|crore|cr\b|k\b)?/i.exec(query);
  if (!m || !m[1]) return null;
  const raw = m[1].replace(/,/g, "");
  const base = Number(raw);
  if (!Number.isFinite(base) || base === 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const value =
    unit.startsWith("cr") ? base * 10_000_000
    : unit.startsWith("l") ? base * 100_000
    : unit === "k" ? base * 1_000
    : base;
  return String(Math.round(value));
};

const ROUTES: readonly Route[] = [
  {
    match: /invoice|unpaid|overdue|receivable|collect|owes?\b|payment.*(late|pending)/i,
    calls: (cfg) => [
      { tool: "list_overdue_invoices", args: { asOf: cfg.asOf } },
      { tool: "get_receivables_aging", args: { asOf: cfg.asOf } },
    ],
    intro: "Here's where your receivables stand.",
  },
  {
    match: /gst|tax|filing|gstr|itc|input.*credit/i,
    calls: (cfg) => [
      { tool: "get_gst_position", args: { from: monthStart(cfg.asOf), to: cfg.asOf } },
      { tool: "get_upcoming_gst_filings", args: { asOf: cfg.asOf } },
    ],
    intro: "Here's your GST position and filing calendar.",
  },
  {
    match: /subscription|recurring|cancel|wast(e|ing)|saas/i,
    calls: (cfg) => [{ tool: "get_recurring_payments", args: { asOf: cfg.asOf } }],
    intro: "Here's your recurring spend.",
  },
  {
    match: /invest|portfolio|holding|stocks?\b|mutual fund|sip\b|shares?\b|traded?\b|nifty|etf\b/i,
    calls: (cfg) => [
      { tool: "get_portfolio", args: { asOf: cfg.asOf } },
      { tool: "get_cash_position", args: { asOf: cfg.asOf } },
    ],
    intro: "Here's your portfolio, straight from the trade ledger.",
  },
  {
    match: /hire|hiring|employee|afford|can (i|we) (buy|spend|pay)/i,
    calls: (cfg, query) => {
      const amount = extractAmount(query);
      if (/hire|hiring|employee/i.test(query)) {
        return [
          {
            tool: "simulate_scenario",
            args: {
              asOf: cfg.asOf,
              label: "New hire",
              monthlyExpenseDeltaINR: amount ?? "80,000",
            },
          },
        ];
      }
      return [{ tool: "check_affordability", args: { asOf: cfg.asOf, amountINR: amount ?? "1,00,000" } }];
    },
    intro: "I ran the numbers on that scenario.",
  },
  {
    match: /forecast|predict|next (quarter|month|year)|project/i,
    calls: (cfg) => [{ tool: "get_cash_forecast", args: { asOf: cfg.asOf } }],
    intro: "Here's the cash trajectory.",
  },
  {
    match: /runway|surviv|burn|how long|months? (of|left)/i,
    calls: (cfg) => [
      { tool: "get_burn_and_runway", args: { asOf: cfg.asOf } },
      { tool: "get_cash_position", args: { asOf: cfg.asOf } },
    ],
    intro: "Here's your burn and runway.",
  },
  {
    match: /recommend|save|saving|optimi[sz]e|reduce cost|cut/i,
    calls: () => [{ tool: "get_recommendations", args: {} }],
    intro: "These are the actions I'd take, in order.",
  },
  {
    match: /profit|revenue|earn|spend|spent|expense|last month|this month|margin|p&l|income/i,
    calls: (cfg, query) => {
      const window = /last month/i.test(query)
        ? previousMonthWindow(cfg.asOf)
        : /this month/i.test(query)
          ? { from: monthStart(cfg.asOf), to: cfg.asOf }
          : { from: cfg.periodFrom, to: cfg.asOf };
      return [{ tool: "get_profit_and_loss", args: window }];
    },
    intro: "Here's the profit and loss picture.",
  },
  {
    match: /cash|bank|balance|money.*(have|left)|position/i,
    calls: (cfg) => [
      { tool: "get_cash_position", args: { asOf: cfg.asOf } },
      { tool: "get_burn_and_runway", args: { asOf: cfg.asOf } },
    ],
    intro: "Here's your cash position.",
  },
  {
    match: /health|score|how (are we|is the business)|doing|status/i,
    calls: (cfg) => [{ tool: "get_health_score", args: { asOf: cfg.asOf, periodFrom: cfg.periodFrom } }],
    intro: "Here's your financial health.",
  },
];

const FALLBACK: Route = {
  match: /.*/,
  calls: (cfg) => [{ tool: "get_morning_brief", args: { asOf: cfg.asOf, periodFrom: cfg.periodFrom } }],
  intro: "Here's the overall picture.",
};

/** Turn a `key=value key2=value2` tool result into readable lines, keeping values verbatim. */
const prettify = (toolName: string, result: string): string => {
  if (result.startsWith("error=")) return `(${toolName} could not answer: ${result})`;
  const label = toolName.replace(/_/g, " ").replace(/^get /, "");
  // Split on "; " item separators first, then render key=value pairs as readable fragments.
  const body = result
    .split("; ")
    .map((chunk) =>
      chunk
        .replace(/(\w+)=/g, (_, k: string) => `${k.replace(/_/g, " ")}: `)
        .replace(/"/g, ""),
    )
    .join("\n  • ");
  return `**${label}** — ${body}`;
};

export class CfoPlanner implements LanguageModelProvider {
  readonly name = "cfo-planner";

  constructor(private cfg: PlannerConfig) {}

  async complete(ctx: ModelContext): Promise<ModelTurn> {
    if (ctx.toolResults.length === 0) {
      const route = ROUTES.find((r) => r.match.test(ctx.userQuery)) ?? FALLBACK;
      return { kind: "tool_calls", toolCalls: route.calls(this.cfg, ctx.userQuery) };
    }
    const route = ROUTES.find((r) => r.match.test(ctx.userQuery)) ?? FALLBACK;
    const sections = ctx.toolResults.map((t) => prettify(t.tool, t.result)).join("\n\n");
    const outro =
      "\n\n_Every figure above comes straight from your ledger — ask me to drill into any of them._";
    return { kind: "final", text: `${route.intro}\n\n${sections}${outro}` };
  }
}
