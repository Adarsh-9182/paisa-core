/**
 * Tool routing — send the model the tools the question needs, not all of them.
 *
 * Every round ships the full tool schema set, and measured against a live
 * provider that is roughly 98% of each request: ~8,300 input tokens per
 * question, of which the user's actual words are about 25 characters. On a
 * free tier, where the budget is requests and tokens per day rather than
 * money, that fixed overhead is the difference between a product someone can
 * use all day and one that stops answering by lunchtime.
 *
 * It is also an accuracy problem. Twenty-three near-neighbours is a lot to
 * choose between — "how much do we spend on software each month" has at least
 * three plausible answers in the list — and small models pick worse as the
 * menu grows.
 *
 * The rule this file is built around: **recall beats precision, always.** A
 * tool that was needed and not offered is an answer the model cannot give, and
 * it will not say "I lacked a tool" — it will improvise, which is the failure
 * the whole architecture exists to prevent. Sending a handful of extra schemas
 * costs tokens. Withholding the right one costs correctness. So the router is
 * generous by construction: a core set always goes, matching is by topic
 * rather than exact phrase, and anything ambiguous falls back to everything.
 *
 * Deterministic on purpose — no model call. A router that needed an LLM to
 * decide which tools to send would spend a request to save a request, and
 * could not be tested without a network.
 */

import { toolNames } from "./tools.js";

/**
 * Tools worth having on hand for almost any financial question.
 *
 * Small, because "always" is expensive. Cash and the brief are here because
 * they are what an unqualified question ("how are we doing?") most often
 * means, and pending actions because the user may refer to something they
 * were already asked to approve.
 */
const CORE = ["get_cash_position", "get_morning_brief", "list_pending_actions"] as const;

/**
 * Topics, each a set of trigger words and the tools that answer them.
 *
 * Triggers are matched as word stems against the question, so "invoices",
 * "invoicing" and "invoice" all hit. They are deliberately over-inclusive:
 * a topic firing when it need not have costs a schema, and a topic failing
 * to fire costs the answer.
 */
interface Topic {
  readonly triggers: readonly string[];
  readonly tools: readonly string[];
}

const TOPICS: readonly Topic[] = [
  {
    triggers: ["cash", "bank", "balance", "money", "liquid", "reserve"],
    tools: ["get_cash_position", "get_balance_sheet", "get_cash_forecast", "get_account_balance"],
  },
  {
    triggers: ["burn", "runway", "survive", "last", "out of money", "afford", "hire", "hiring", "salary"],
    tools: ["get_burn_and_runway", "get_cash_position", "check_affordability", "simulate_scenario", "get_cash_forecast"],
  },
  {
    triggers: ["profit", "loss", "revenue", "income", "earn", "margin", "p&l", "pnl", "expense", "spend", "spending", "cost", "costs"],
    tools: ["get_profit_and_loss", "get_recurring_payments", "get_account_balance"],
  },
  {
    triggers: ["subscription", "subscriptions", "recurring", "vendor", "vendors", "saas", "cancel", "monthly"],
    tools: ["get_recurring_payments", "get_profit_and_loss"],
  },
  {
    triggers: ["invoice", "invoices", "overdue", "unpaid", "receivable", "receivables", "owe", "owes", "customer", "collect", "chase", "aging", "ageing", "debtor"],
    tools: ["list_overdue_invoices", "get_receivables_aging", "propose_payment_reminder"],
  },
  {
    triggers: ["gst", "tax", "taxes", "filing", "filings", "gstr", "return", "returns", "itc", "compliance", "deadline"],
    tools: ["get_gst_position", "get_upcoming_gst_filings", "lookup_regulation"],
  },
  {
    triggers: ["rate", "rates", "rule", "rules", "section", "law", "legal", "threshold", "eligible", "eligibility", "scheme", "act", "regulation", "allowed", "require", "required"],
    tools: ["lookup_regulation", "get_upcoming_gst_filings"],
  },
  {
    triggers: ["forecast", "project", "projection", "predict", "next month", "future", "scenario", "simulate", "what if", "what would"],
    tools: ["get_cash_forecast", "simulate_scenario", "get_burn_and_runway"],
  },
  {
    triggers: ["health", "score", "how are we", "doing", "performance", "overview", "summary", "brief", "status"],
    tools: ["get_health_score", "get_morning_brief", "get_profit_and_loss"],
  },
  {
    triggers: ["invest", "investment", "investments", "portfolio", "holding", "holdings", "stock", "stocks", "mutual", "shares"],
    tools: ["get_portfolio"],
  },
  {
    triggers: ["categorise", "categorize", "categorisation", "uncategorised", "uncategorized", "review", "queue", "classify", "unmatched"],
    tools: ["list_review_queue", "propose_categorization"],
  },
  {
    triggers: ["fraud", "suspicious", "duplicate", "duplicates", "anomaly", "anomalies", "unusual", "screen", "screening", "irregular"],
    tools: ["screen_transactions"],
  },
  {
    triggers: ["recommend", "recommendation", "recommendations", "suggest", "advice", "should i", "approve", "pending", "action", "actions"],
    tools: ["get_recommendations", "list_pending_actions"],
  },
  {
    triggers: ["asset", "assets", "liability", "liabilities", "equity", "net worth", "balance sheet"],
    tools: ["get_balance_sheet", "get_account_balance"],
  },
];

/** Word-ish stems of the question, lowercased, for trigger matching. */
const normalise = (question: string): string => ` ${question.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;

/**
 * Which tools to offer for a question.
 *
 * Returns every tool when nothing matches, because "I could not tell what
 * this is about" and "this needs no tools" are different conclusions and
 * only one of them is safe to act on.
 */
export const routeTools = (question: string, all: readonly string[] = toolNames()): readonly string[] => {
  const haystack = normalise(question);
  const known = new Set(all);
  const chosen = new Set<string>();

  for (const topic of TOPICS) {
    const hit = topic.triggers.some((t) =>
      t.includes(" ") ? haystack.includes(` ${t} `) || haystack.includes(`${t} `) : haystack.includes(` ${t} `),
    );
    if (!hit) continue;
    for (const tool of topic.tools) if (known.has(tool)) chosen.add(tool);
  }

  // Nothing recognised: this is the ambiguous case, and guessing narrowly
  // here is how a router turns into a source of wrong answers.
  if (chosen.size === 0) return all;

  for (const tool of CORE) if (known.has(tool)) chosen.add(tool);
  // Stable order, so two identical questions produce byte-identical requests
  // and a provider's prompt cache can actually hit.
  return all.filter((t) => chosen.has(t));
};
