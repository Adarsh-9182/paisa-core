/**
 * WORKING THE CLOSE — a goal, not a question.
 *
 * Everything else in this codebase answers when asked. `close.run()` reports
 * where the month stands, `agents.scan()` says what is wrong, `settle()`
 * clears what a grant covers. Each is one step, and a person holds the
 * thread between them: run the close, read the blockers, scan, settle,
 * run it again, read it again.
 *
 * That thread is the work. Holding it is what a controller actually spends
 * their month-end doing, and it is the part no tool here has ever done.
 *
 * So this takes a goal — get this period as close to closeable as it can
 * honestly get — and holds the thread itself: run, see what is blocked, do
 * what it is allowed to do about it, run again, and stop when it stops
 * making progress. Then say what it did, what is left, and what each
 * remaining blocker needs from a person.
 *
 * THE RULE THAT MATTERS MOST: IT NEVER WAIVES.
 *
 * `close.waive()` exists and would clear any blocker instantly. A waiver is
 * a person looking at a check the books failed and saying "I have seen this
 * and I accept it" — a judgement, recorded against their name. An agent
 * that may waive its own blockers is an agent that closes broken books and
 * reports success, which is worse than one that does nothing at all. Every
 * remaining blocker in the result is a blocker, and the only thing this
 * returns about it is what a human would need to do.
 *
 * What it *is* allowed to do is bounded by things people wrote down
 * elsewhere: `close.run()` moves automated tasks because those engines are
 * idempotent and were already approved as procedure, and settlement only
 * approves findings inside a standing authority. Nothing here invents a new
 * permission — it spends ones that already exist, in order, until they run
 * out.
 */

import type { PeriodKey } from "./periods.js";
import type { CloseEngine, CloseRun, CloseTaskState } from "./close.js";
import type { AgentEngine } from "./agents.js";
import type { AuthorityRegistry } from "./authority.js";

/** One thing the agent actually changed, in words a controller can check. */
export type Step = string;

export interface RemainingBlocker {
  readonly task: string;
  readonly why: string;
  /** What a person has to do. Never "waive it" — that is their call, not ours. */
  readonly needs: string;
}

export interface CloseAttempt {
  readonly period: PeriodKey;
  /** How many times it ran the checklist. Bounded; see MAX_ROUNDS. */
  readonly rounds: number;
  readonly before: { readonly passed: number; readonly blocked: number };
  readonly after: { readonly passed: number; readonly blocked: number };
  readonly did: readonly Step[];
  readonly remaining: readonly RemainingBlocker[];
  readonly readyToClose: boolean;
  /** True when it gave up because a round changed nothing, not because it finished. */
  readonly stalled: boolean;
  /** Why it could do no more, in words. Null when it simply finished. */
  readonly stallReason: string | null;
}

/**
 * Three is enough, and the bound is not a guess.
 *
 * A round is: run the checklist, scan for findings, settle what is covered.
 * The first round does the work; the second exists because settling can
 * unblock a task the first run had already evaluated; the third is slack for
 * one task unblocking another. Beyond that a round that changes nothing is
 * the signal to stop, and the loop below stops on that rather than on the
 * count — the count is only there so a bug cannot spin forever.
 */
const MAX_ROUNDS = 3;

export interface CloseAgentContext {
  readonly close: CloseEngine;
  readonly agents: AgentEngine;
  readonly authority: AuthorityRegistry;
}

/** A blocked task, turned into the sentence a person needs. */
function whatItNeeds(task: CloseTaskState): string {
  if (task.category === "REVIEW")
    return "someone to look at it and either fix the underlying entries or record a waiver in their own name";
  if (task.automated)
    return "the underlying data to change — this task runs itself, so it is blocked by the books rather than by a missing step";
  return "a person to resolve it; this check has no automated remedy";
}

/**
 * Work the close as far as it honestly goes.
 *
 * Deterministic end to end: no model is consulted, the same books produce the
 * same attempt, and every step it reports is one that already happened rather
 * than one it intends.
 */
export function workTheClose(ctx: CloseAgentContext, period: PeriodKey, actor: string): CloseAttempt {
  /*
   * ORDER MATTERS, AND IT IS THE OPPOSITE OF THE OBVIOUS ONE.
   *
   * The first version ran the checklist, read the blockers, then scanned and
   * settled. It settled nothing, ever, and the reason is a rule two files
   * away: `close.run()` soft-closes the period as its first act, and a
   * standing authority refuses to post into a period that is not OPEN —
   * because a controller mid-close is exactly when an unexpected posting
   * does the most damage.
   *
   * Both rules are right. The sequence was wrong. So the clearing happens
   * first, while the period is still open, and the checklist runs against
   * books that have already had everything settleable settled.
   *
   * A consequence worth stating: once the close has run, later rounds cannot
   * settle. That is not a limitation to work around — it is the guardrail
   * doing its job, and the report says so instead of stalling silently.
   */
  const priorRun = ctx.close.status(period);
  const before = priorRun
    ? { passed: priorRun.passed, blocked: priorRun.blocked }
    : { passed: 0, blocked: 0 };

  const did: Step[] = [];
  let stalled = false;
  let stallReason: string | null = null;

  const raised = ctx.agents.scan(period, actor);
  if (raised.length > 0)
    did.push(`Scanned ${period} and raised ${raised.length} finding${raised.length === 1 ? "" : "s"}`);

  const open = ctx.agents.open();
  if (open.length > 0) {
    const settled = ctx.authority.settle(open);
    if (settled.approved.length > 0)
      did.push(
        `Settled ${settled.approved.length} finding${settled.approved.length === 1 ? "" : "s"} under standing authority`,
      );
    else if (settled.refused.length > 0)
      stallReason = `nothing in the queue was covered by a standing authority (${settled.refused[0]!.reason})`;
  }

  let run: CloseRun = ctx.close.run(period, actor);
  let rounds = 1;

  // Further rounds exist only for tasks that unblock other tasks. They cannot
  // settle — the period is soft-closed now — so a round that moves nothing is
  // the end of what this can do.
  while (!run.readyToClose && rounds < MAX_ROUNDS) {
    const passedBefore = run.passed;
    run = ctx.close.run(period, actor);
    rounds += 1;
    if (run.passed <= passedBefore) {
      stalled = true;
      if (!stallReason) stallReason = "re-running the checklist changed nothing";
      break;
    }
  }

  const remaining = run.tasks
    .filter((t) => t.status === "BLOCKED")
    .map((t) => ({
      task: t.name,
      why: t.blockers.length > 0 ? t.blockers.join("; ") : t.detail,
      needs: whatItNeeds(t),
    }));

  return {
    period,
    rounds,
    before,
    after: { passed: run.passed, blocked: run.blocked },
    did,
    remaining,
    readyToClose: run.readyToClose,
    stalled,
    stallReason,
  };
}

/** One paragraph a controller can read without opening the object. */
export function describeAttempt(a: CloseAttempt): string {
  const moved = a.after.passed - a.before.passed;
  const head = a.readyToClose
    ? `${a.period} is ready to close.`
    : `${a.period} is not ready to close: ${a.after.blocked} task${a.after.blocked === 1 ? "" : "s"} still blocked.`;

  const work =
    a.did.length === 0
      ? "Nothing could be done without a person."
      : `${a.did.join(". ")}. ${moved > 0 ? `${moved} more task${moved === 1 ? "" : "s"} now passing.` : "No task changed status."}`;

  const left =
    a.remaining.length === 0
      ? ""
      : ` Left for you: ${a.remaining.map((r) => `${r.task} — ${r.why} (needs ${r.needs})`).join("; ")}.`;

  const why = a.stallReason && !a.readyToClose ? ` It could do no more because ${a.stallReason}.` : "";
  return `${head} ${work}${why}${left}`.trim();
}
