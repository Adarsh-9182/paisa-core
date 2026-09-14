#!/usr/bin/env node
/**
 * Score a model at suggesting accounts for bank lines no rule could place.
 *
 *   npm run eval:suggest
 *   PAISA_SUGGEST_MODEL=gemini-3.7-flash npm run eval:suggest
 *   PAISA_RATE_IN=0.10 PAISA_RATE_OUT=0.40 npm run eval:suggest   # USD per million tokens
 *
 * Real API calls, so it costs a little and can hit a free tier's rate limit.
 * Calls are paced (PAISA_EVAL_PACE_MS, default 1500ms) and any line whose
 * batch failed is reported as unreached rather than folded into the score.
 *
 * Rates are passed in, never baked in: provider prices change, and a stale
 * constant would quietly misreport cost.
 */

import { Platform, OpenAIProvider, AnthropicProvider } from "../dist/src/index.js";
import { scoreModelSuggestions, formatModelSuggestReport } from "../dist/src/ai/suggest-eval.js";
import { CATEGORIZE_CASES } from "../dist/src/ai/categorize-cases.js";
import { CATEGORIZE_HOLDOUT } from "../dist/src/ai/categorize-holdout.js";

const pickModel = () => {
  const which = process.env.PAISA_SUGGEST_PROVIDER;
  const model = process.env.PAISA_SUGGEST_MODEL;
  if (which === "anthropic" || (!which && process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY))
    return new AnthropicProvider(model);
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL)
    return new OpenAIProvider(model ? { model } : {});
  console.error("No model configured. Set OPENAI_API_KEY (with OPENAI_BASE_URL for Gemini) or ANTHROPIC_API_KEY.");
  process.exit(2);
};

const rates =
  process.env.PAISA_RATE_IN && process.env.PAISA_RATE_OUT
    ? { inputPerMillion: Number(process.env.PAISA_RATE_IN), outputPerMillion: Number(process.env.PAISA_RATE_OUT) }
    : undefined;

const model = pickModel();
const paceMs = Number(process.env.PAISA_EVAL_PACE_MS ?? 1500);
let n = 0;
const books = () => new Platform().createOrganization(`suggest_eval_${n++}`, "Eval Traders");

let anyUnreached = false;
for (const [name, cases] of [["HELD-OUT", CATEGORIZE_HOLDOUT], ["DEVELOPMENT", CATEGORIZE_CASES]]) {
  console.log(`\n=== ${name} ===`);
  const report = await scoreModelSuggestions(cases, books, model, { batchSize: 20, paceMs });
  console.log(formatModelSuggestReport(report, rates));
  anyUnreached ||= report.unreached > 0;
}
if (anyUnreached) process.exitCode = 1;
