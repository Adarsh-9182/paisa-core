/**
 * Narrator eval — grades a locally served model with Paisa's own verifier.
 *
 * The grader is the product's grader: a completion PASSES only if every
 * figure it states appears in the tool results it was given
 * (verifyNarration). This is the metric the fine-tune must move.
 *
 * Usage:
 *   1. Serve a model:  lab/.venv/bin/mlx_lm.server --model <id> [--adapter-path lab/adapters/...] --port 8080
 *   2. node lab/eval.mjs [count]
 *
 * SKELETON ONLY — extending this (per-scenario breakdown, citation checks,
 * style scoring, baseline-vs-adapter comparison) is the lab exercise.
 * Uses eval seed 424242: never train on it.
 */

import { generateSyntheticDataset, verifyNarration, extractFigures } from "../dist/src/index.js";

const EVAL_SEED = 424242;
const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:8080/v1";
const count = Number(process.argv[2] ?? 40);

const { examples } = await generateSyntheticDataset(count, EVAL_SEED);

let pass = 0;
const failures = [];
for (const [i, ex] of examples.entries()) {
  const [system, user] = ex.messages;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "paisa-narrator",
      messages: [system, user],
      max_tokens: 400,
      temperature: 0,
    }),
  });
  if (!res.ok) {
    console.error(`API error ${res.status} — is mlx_lm.server running on ${BASE_URL}?`);
    process.exit(1);
  }
  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content ?? "";
  try {
    // The tool results live inside the user turn; grade against them.
    verifyNarration(answer, [user.content]);
    pass++;
  } catch (err) {
    if (failures.length < 5)
      failures.push({ i, scenario: ex.meta.scenario, error: String(err.message).slice(0, 120), answer: answer.slice(0, 160) });
  }
  process.stdout.write(`\r${i + 1}/${examples.length} graded…`);
}

console.log(`\n\nverifier pass rate: ${pass}/${examples.length} (${((pass / examples.length) * 100).toFixed(1)}%)`);
console.log(`figures per answer (sample): ${extractFigures(examples[0].messages[2].content).length} in the reference narration`);
if (failures.length) {
  console.log("\nfirst failures:");
  for (const f of failures) console.log(`  [#${f.i} ${f.scenario}] ${f.error}\n    → "${f.answer}"`);
}
