#!/usr/bin/env node
/**
 * Score the bank-line categorizer.
 *
 *   npm run eval:categorize
 *
 * Imports every labelled line into fresh books and reports precision (of what
 * booked itself, how much was right) and coverage (of what could be booked,
 * how much was). Precision is the number that has to stay near 100%.
 *
 * Two sets. The development set is what fixes are designed while looking at;
 * the held-out set was committed before them and is the one that says whether
 * a fix generalises. Read the held-out numbers first.
 */

import { Platform } from "../dist/src/index.js";
import { scoreCategorizer, formatCategorizeReport } from "../dist/src/ai/categorize-eval.js";
import { CATEGORIZE_CASES } from "../dist/src/ai/categorize-cases.js";
import { CATEGORIZE_HOLDOUT } from "../dist/src/ai/categorize-holdout.js";

let n = 0;
const books = () => new Platform().createOrganization(`cat_eval_${n++}`, "Eval Traders");

for (const [name, cases] of [["HELD-OUT", CATEGORIZE_HOLDOUT], ["DEVELOPMENT", CATEGORIZE_CASES]]) {
  console.log(`\n=== ${name} ===`);
  console.log(formatCategorizeReport(scoreCategorizer(cases, books)));
}
