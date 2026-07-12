/**
 * Emit the narrator training set (spec 007) in mlx-lm chat format.
 *
 * Usage:  node lab/generate-data.mjs [trainCount] [validCount]
 * Output: lab/data/train.jsonl, lab/data/valid.jsonl
 *
 * Seeds are fixed so runs are reproducible; the eval seed (424242) is
 * reserved in lab/eval.mjs and must never be trained on.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { generateSyntheticDataset } from "../dist/src/index.js";

const TRAIN_SEED = 2026;
const VALID_SEED = 9999;
const trainCount = Number(process.argv[2] ?? 4000);
const validCount = Number(process.argv[3] ?? 400);

const toMlxJsonl = (examples) =>
  examples.map((e) => JSON.stringify({ messages: e.messages })).join("\n") + "\n";

const t0 = Date.now();
const train = await generateSyntheticDataset(trainCount, TRAIN_SEED);
const valid = await generateSyntheticDataset(validCount, VALID_SEED);

mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
writeFileSync(new URL("./data/train.jsonl", import.meta.url), toMlxJsonl(train.examples));
writeFileSync(new URL("./data/valid.jsonl", import.meta.url), toMlxJsonl(valid.examples));

console.log(
  `train=${train.examples.length} valid=${valid.examples.length} discarded=${train.discarded + valid.discarded} in ${Date.now() - t0}ms`,
);
console.log("→ lab/data/train.jsonl, lab/data/valid.jsonl");
