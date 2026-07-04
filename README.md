# paisa-core

The deterministic financial core of Paisa — the AI CFO for businesses. The LLM never originates a number; this package does.

## What's inside

```
src/
  money.ts          Paise as branded bigint · parseINR/formatINR (Indian grouping) · exact ratio math
  accounts.ts       Chart of accounts · account types fix normal-balance sides · default Indian SMB chart
  journal.ts        Double-entry engine · rejects unbalanced entries · append-only · reversal-based corrections
  ledger.ts         General ledger + trial balance as pure projections over the journal (can never disagree)
  statements.ts     Balance Sheet · P&L · Cash Flow — blocked if the trial balance is imbalanced
  cashflow.ts       Cash on hand · monthly net burn · runway — refuses to guess without history
  health.ts         0–100 Financial Health Score — liquidity, profitability, runway, debt,
                    receivables discipline, revenue growth — with explicit missing-data list
  rules.ts          Configurable IF/THEN policy engine (low cash, large expense, overdue invoice, short runway)
  events.ts         Financial event bus + immutable audit trail
  organization.ts   Multi-tenant boundary — one org, one isolated engine stack; membership-gated access

  invoices.ts       Invoice state machine (DRAFT→SENT→PARTIALLY_PAID→PAID) · GST per line ·
                    posts balanced journal entries on transitions · AR aging · overdue detection
  gst.ts            Output tax from invoices · input tax credit from the ledger · net payable ·
                    GSTR-1/GSTR-3B filing calendar as pure date arithmetic
  banking.ts        Bank feed → duplicate detection → keyword categorization → journal.post() ·
                    unknown lines go to a review queue, never guessed into an account
  recurring.ts      Recurring-payment detection (3+ occurrences, monthly cadence, stable amount) ·
                    subscription optimizer with annualized costs
  forecast.ts       Monthly cash history off the ledger · forward projection with the assumption stated ·
                    scenario simulator ("can I hire at ₹1L/month?")
  recommendations.ts Deterministic recommendation policies (overdue AR, GST due, short runway, subscription
                    review, idle cash, expense spikes) · every rec carries problem/impact/confidence/risk ·
                    approval queue — approve/dismiss survives regeneration, everything audited
  brief.ts          Morning Brief — health, cash, month deltas, filings, overdue AR, savings, headline
  portfolio.ts      Investment & trading ledger — buys/sells post balanced entries, weighted-average
                    cost basis, realized P&L to the ledger, marked-price valuation only (never guessed)

  ai/
    provider.ts     Provider-agnostic LLM interface · MockProvider · FallbackProvider chain
    tools.ts        17 engine-bound tools + JSON schemas — the ONLY number source the AI may narrate
    planner.ts      CfoPlanner — deterministic offline provider: keyword routing → tools → verbatim narration
    anthropic.ts    AnthropicProvider — Claude (claude-opus-4-8) behind the same interface
    orchestrator.ts Tool loop · AI permission layer · verifyNarration()
```

## Enforced invariants (in code, not convention)

1. **Every journal entry balances** — Σ debits === Σ credits or the engine throws; invoices and bank imports post through the same gate.
2. **Nothing is ever updated or deleted** — entries are frozen; corrections are linked reversal entries.
3. **All money is integer paise (`bigint`)** — floats never touch a figure.
4. **Imbalance blocks reports** — statement generation throws instead of producing a wrong report.
5. **Org isolation** — every engine instance is constructed for exactly one org.
6. **The LLM never originates a number** — `verifyNarration()` rejects any figure not traceable to a tool output.
7. **No payment tool exists** — the AI recommends; money movement and regulatory submission always require explicit human approval (`requiresApproval` on recommendations, approve/dismiss queue).
8. **Missing data is declared, not guessed** — burn/runway/health/forecast explicitly report what's unavailable; forecasts state their assumption.
9. **Everything is audited** — journal posts, invoice transitions, bank imports, recommendation decisions, and AI answers land on an immutable, org-scoped event log.

## The web app (`web/`)

Next.js app with login (HMAC-signed sessions, `PAISA_USER`/`PAISA_PASSWORD`/`PAISA_SESSION_SECRET`),
an append-only persistence log (`web/.paisa-data/actions.jsonl`, replayed through the engines on
boot), and a full Investments page (holdings, allocation, trade recording). Deployed on Vercel at
**https://paisa-coral.vercel.app** (demo login: adarsh / paisa123).

```
npm run build           # build paisa-core first
cd web && npm install && npm run build && npm start   # → http://localhost:3000
```

## The demo dashboard

```
npm install
npm run build
node demo/server.js     # → http://localhost:4000
```

Three-column AI-CFO dashboard (sidebar · morning brief + widgets · persistent chat), seeded with six
months of activity for a demo company. Every number on the page is computed by the engines; the chat
goes through the Orchestrator, so every figure in an answer is verified against tool outputs before
you see it. Works fully offline via `CfoPlanner`; set `ANTHROPIC_API_KEY` to route chat through
Claude with the planner as fallback.

## Usage

```ts
import { Platform, parseINR, Orchestrator, CfoPlanner } from "paisa-core";

const platform = new Platform();
const org = platform.createOrganization("org_abc", "ABC Technologies");

// Invoicing posts to the ledger for you
const inv = org.invoices.create({
  number: "INV-001", customer: "Acme", issueDate: "2026-06-01", dueDate: "2026-06-30",
  lines: [{ description: "Services", amount: parseINR("1,00,000"), gstRatePct: 18 }],
}, "adarsh");
org.invoices.send(inv.id, "adarsh");           // DR AR 1,18,000 / CR Services 1,00,000 / CR GST 18,000

org.gst.upcomingFilings("2026-07-02");         // GSTR-1 due 2026-07-11, 9 days left
org.forecast.scenario("2026-07-02", { label: "Hire", monthlyExpenseDelta: parseINR("1,00,000") });
org.recommendations.generate("2026-07-02", "2026-01-01");
org.brief.compose("2026-07-02", "2026-01-01"); // the morning-brief card, engine-computed

const ai = new Orchestrator(new CfoPlanner({ asOf: "2026-07-02", periodFrom: "2026-01-01" }));
await ai.ask(user, org, "Can I hire another engineer?"); // verified, tool-sourced answer
```

## Commands

```
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest — 59 tests / 4 suites
npm run build       # emit dist/ (required before running the demo)
```

## What sits on top (next layers, in order)

1. **Persistence** — swap in-memory arrays for Postgres append-only tables (the journal API is already write-once).
2. **Real bank feeds** — account-aggregator / statement parsers in front of `banking.importStatement()`.
3. **Payroll & TDS** — deterministic modules exposed as new AI tools, same pattern as GST.
4. **API layer** — every endpoint takes `(userId, orgId)` through `Platform.organization()` so tenant isolation is inherited.
5. **Notifications** — subscribe to the event bus (`rule.fired`, `recommendation.created`) and fan out to email/WhatsApp.
