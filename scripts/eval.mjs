#!/usr/bin/env node
/**
 * Score a model on the job Paisa actually gives it.
 *
 *   npm run eval                                    # whatever is configured
 *   PAISA_OPENAI_MODEL=qwen3.7-flash npm run eval   # any OpenAI-compatible model
 *   OPENAI_BASE_URL=http://localhost:11434/v1 npm run eval   # a local one
 *
 * The point is comparison. Two models, same seven questions, same ledger:
 * tool recall, precision, grounding, rounds, tokens and — when the provider
 * reports usage and a rate is given — money.
 *
 * Rates are passed in, never baked in. Provider pricing changes monthly and
 * a stale constant in the repository would quietly misreport cost, which is
 * a worse failure than reporting none:
 *
 *   PAISA_RATE_IN=0.03 PAISA_RATE_OUT=0.13 npm run eval
 */

import { AnthropicProvider } from "../dist/src/ai/anthropic.js";
import { OpenAIProvider } from "../dist/src/ai/openai.js";
import { CfoPlanner } from "../dist/src/ai/planner.js";
import { GOLDEN_CASES, formatReport, passesEvalReleaseGate, runEval } from "../dist/src/ai/eval.js";
import { PaisaRuntime } from "../dist/src/index.js";
import { seedAll } from "../demo/seed.js";

const AS_OF = process.env.PAISA_EVAL_ASOF ?? "2026-07-02";

/**
 * Every case gets its own freshly seeded books.
 *
 * Sharing one ledger would let a case that queues an action or categorises a
 * line change the answer to the next one, and the eval would drift depending
 * on the order it happened to run in.
 */
let n = 0;
async function makeOrg() {
  const runtime = await PaisaRuntime.open({
    orgId: `eval_${n++}`,
    name: "Nimbus Labs Pvt Ltd",
    firstPeriod: "2026-01",
  });
  const exec = async (type, payload, actor = "eval") => (await runtime.execute(type, payload, actor)).result;
  await seedAll(exec, runtime);
  return runtime.org;
}

function pickProvider() {
  // The planner is deterministic and takes its dates by construction — it
  // has no model to infer them from.
  if (process.env.PAISA_EVAL_PROVIDER === "offline")
    return new CfoPlanner({ asOf: AS_OF, periodFrom: `${AS_OF.slice(0, 4)}-01-01` });
  if (process.env.ANTHROPIC_API_KEY && process.env.PAISA_EVAL_PROVIDER !== "openai") return new AnthropicProvider();
  if (process.env.OPENAI_API_KEY) return new OpenAIProvider();
  // Deliberately not a silent fallback: an eval that scores the offline
  // planner while you believed you were scoring a model is worse than one
  // that refuses to start.
  console.error(
    "No model configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY,\n" +
      "or PAISA_EVAL_PROVIDER=offline to score the deterministic planner on purpose.",
  );
  process.exit(2);
}

const rates =
  process.env.PAISA_RATE_IN && process.env.PAISA_RATE_OUT
    ? {
        inputPerMillion: Number(process.env.PAISA_RATE_IN),
        outputPerMillion: Number(process.env.PAISA_RATE_OUT),
        ...(process.env.PAISA_RATE_CACHED ? { cachedInputPerMillion: Number(process.env.PAISA_RATE_CACHED) } : {}),
      }
    : undefined;

/*
 * Hill-climbing one case does not need the other twenty-seven.
 *
 *   PAISA_EVAL_ONLY=question-is-not-an-instruction npm run eval
 *
 * A comma-separated list of case ids, matched as substrings so a prefix is
 * enough. The full set stays the thing you trust before shipping — a fix
 * measured only on the case it targeted is a fix that may have broken two
 * others.
 */
const only = (process.env.PAISA_EVAL_ONLY ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const cases = only.length
  ? GOLDEN_CASES.filter((c) => only.some((o) => c.id.includes(o)))
  : GOLDEN_CASES;

if (only.length && cases.length === 0) {
  console.error(`No case id matches ${only.join(", ")}`);
  process.exit(2);
}

const provider = pickProvider();
console.log(`model=${provider.model ?? provider.name} cases=${cases.length}${only.length ? ` (filtered from ${GOLDEN_CASES.length})` : ""} asOf=${AS_OF}\n`);

const report = await runEval(provider, cases, {
  makeOrg,
  user: { userId: "u_eval", orgId: "eval", permissions: new Set(["access_ai_cfo"]) },
  dates: { asOf: AS_OF },
  onCase: (r) =>
    console.log(
      `  ${r.ok ? "pass" : "FAIL"}  ${r.id.padEnd(26)} ` +
        `${String(r.rounds).padStart(2)} rounds  ${String(r.ms).padStart(6)}ms  ${r.toolsCalled.join(",") || "(no tools)"}`,
    ),
});

console.log(`\n${formatReport(report, rates)}`);

// Outages are excluded from quality scores, but cannot pass a release gate.
process.exit(passesEvalReleaseGate(report, GOLDEN_CASES) ? 0 : 1);
