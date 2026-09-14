#!/usr/bin/env node
/**
 * Score the bank-line categorizer.
 *
 *   npm run eval:categorize
 *
 * Imports every labelled line into fresh books and reports precision (of what
 * booked itself, how much was right) and coverage (of what could be booked,
 * how much was). Precision is the number that has to stay near 100%.
 */

import { Platform } from "../dist/src/index.js";
import { scoreCategorizer, formatCategorizeReport } from "../dist/src/ai/categorize-eval.js";
import { CATEGORIZE_CASES } from "../dist/src/ai/categorize-cases.js";

let n = 0;
const report = scoreCategorizer(CATEGORIZE_CASES, () => new Platform().createOrganization(`cat_eval_${n++}`, "Eval Traders"));
console.log(formatCategorizeReport(report));
