#!/usr/bin/env node
/**
 * Step 4 scoreboard: three months of statements, a person who confirms every
 * line, and each way of learning from those confirmations.
 *
 *   npm run eval:teach
 *
 * No model and no network: the simulation is deterministic, so a change in
 * these numbers is a change in the code.
 */

import { Platform } from "../dist/src/index.js";
import { simulateTeaching, formatTeachReports, TEACH_STRATEGIES } from "../dist/src/ai/teach-eval.js";
import { TEACH_DEV } from "../dist/src/ai/teach-months.js";
import { TEACH_HOLDOUT } from "../dist/src/ai/teach-months-holdout.js";

let n = 0;
const books = () => new Platform().createOrganization(`teach_eval_${n++}`, "Teach Eval");

for (const [label, company] of [["HELD-OUT", TEACH_HOLDOUT], ["DEVELOPMENT", TEACH_DEV]]) {
  const lines = company.months.map((m) => m.length).join("/");
  console.log(`\n=== ${label} (${company.bank} format, lines per month ${lines}) ===`);
  console.log(formatTeachReports(TEACH_STRATEGIES.map((s) => simulateTeaching(company, books, s))));
}
