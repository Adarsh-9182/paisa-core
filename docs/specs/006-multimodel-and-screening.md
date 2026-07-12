# Spec 006 — Multi-model chain, transaction screening, and the misrouting fix

**Status:** Shipped (2026-07-11)
**Bible check:** ONE JOB intact. Two new capabilities (a second frontier model behind the same interface; deterministic fraud screening over the ledger) and one bug fix. Capability ladder: still See/Advise.

## Why (the "hallucination" report)

The live site was reported "hallucinating." Root cause was **not** a model inventing facts — production had no `ANTHROPIC_API_KEY`, so every answer came from the offline keyword planner, and the planner's GST route matched bare `/itc/`… which matches **b-itc-oin**. "What will the bitcoin price be next month?" was answered, confidently, with GST filings. A misroute that quotes real figures reads exactly like a hallucination to the user.

Three fixes, in layers:

1. **Routing** — word-boundaries on short tokens (`\bitc\b`), a market-question route that answers honestly ("no live market feed; here are your explicit marks"), and a fallback intro that admits when no tool matched instead of silently dumping the morning brief.
2. **Prompt** — a hard system-prompt rule for the LLM path: never state, estimate, or predict a market price; portfolio values come only from `get_portfolio` marks. (The figure-verifier can't catch a wrong *qualitative* claim, so market-price predictions are banned at the prompt layer and starved at the tool layer — there is no price-feed tool to hallucinate from.)
3. **Provider quality** — `ANTHROPIC_API_KEY` promoted to production, so the live brain is Fable 5 with the verifier, not the keyword planner.

## Multi-model: Fable 5 → GPT-5.6 → planner

`src/ai/openai.ts` adds `OpenAIProvider` behind the same `LanguageModelProvider` interface (this is the payoff of the Bible's "provider interface, not multi-model routing" decision — the second model is ~100 lines and a config change):

- Default model `gpt-5.6` (the alias for `gpt-5.6-sol`, OpenAI's flagship, GA 2026-07-09); override with `PAISA_OPENAI_MODEL`.
- Chat Completions + function calling over plain `fetch` — no SDK dependency; `fetchFn` injectable for deterministic tests.
- Web chain (`web/src/lib/engine.ts`): Fable 5 primary, GPT-5.6 second, offline planner last. Each activates only when its key is present; refusals and outages degrade down the chain. **Same orchestrator, same tools, same `verifyNarration` regardless of which model answered.**

## Transaction screening (`src/anomalies.ts`, tool `screen_transactions`)

Deterministic fraud/anomaly rules over the org's own journal — auditable, named-entry findings, no black box:

- **duplicate_payment** (high): same normalized narration + same amount posted ≥2× within 7 days. Reversed/corrected entries are never re-flagged.
- **amount_outlier** (medium): an expense debit ≥5× the account's median charge in the 90-day window, above a ₹10,000 floor, minimum 5 samples before an account has a "typical" charge.

The planner routes fraud/suspicious/duplicate questions here; the system prompt tells the LLM to report findings with severity + exact entries, and that zero findings is a report, not a guarantee.

## The fine-tuning decision (recorded so it stays decided)

The request was to fine-tune Fable 5 / GPT-5.6 on public tabular datasets (credit-card fraud, bank marketing, financial distress, NYSE, S&P 500, bitcoin prices). Not done, for three load-bearing reasons:

1. **Not offered:** neither Anthropic nor OpenAI exposes fine-tuning of these frontier models to customers.
2. **Category error:** those are tabular/time-series datasets for training *classifiers and forecasters* (XGBoost/logistic/LSTM territory), not instruction corpora for LLMs. Fine-tuning a language model on price series teaches it to *memorize and extrapolate numbers* — which is the one behaviour Paisa's whole architecture exists to prevent.
3. **Wrong layer:** each dataset's *intent* already has an architecture-correct home —

| Dataset asked for | What it trains | Where that capability lives in Paisa |
|---|---|---|
| Credit-card fraud | anomaly classifier | `screen_transactions` (this spec); a real classifier can later back the same tool |
| Financial distress | distress predictor | health score + burn/runway + cash forecast (deterministic, shipped) |
| NYSE / S&P 500 / BTC history | price forecasting | **nowhere, on purpose** — prices enter only as explicit portfolio marks; a live market-data *feed tool* is future integration work, not training |
| Bank marketing | term-deposit propensity | out of scope — marketing propensity, not finance ops |

If a trained model ever joins the system (e.g. a fraud classifier on real labelled data), it runs as a **deterministic-at-inference tool** whose output enters the audit log — never as weights inside the narrating LLM.

## Tests

15 in `tests/screening.test.ts`: screening rules (duplicates, monthly-recurring not flagged, outliers, minimum-history guard, reversal skip, clean report), tool formatting, the bitcoin→GST regression, law-vs-position routing, and the OpenAI provider (scripted-fetch tool loop through the verifier, keyless fallback to planner, API-error surfacing). 135 total across 9 suites.
