/**
 * THE CFO AGENT — the thing that runs when nobody asked.
 *
 * Everything else here answers a question. `workTheClose` was the first
 * exception: it takes a goal and holds the thread itself. This generalises
 * that one step further — a standing agent that wakes up, looks at the whole
 * finance surface rather than one month's checklist, does the parts it is
 * already permitted to do, and reports once.
 *
 * Three rules carried over from `close-agent.ts`, because they are the
 * reason that one is safe to run at all:
 *
 *   1. IT INVENTS NO AUTHORITY. Every act here is one someone already
 *      granted in writing — a standing authority, or a draft that expires
 *      unapproved. Nothing in this file can post to the ledger directly.
 *   2. NO MODEL DECIDES ANYTHING. Plays are deterministic; the same books
 *      produce the same run. A model may read the digest afterwards and put
 *      it in a sentence, and that is the whole of its role.
 *   3. IT REPORTS WHAT HAPPENED, NEVER WHAT IT INTENDS.
 *
 * And one rule this file adds, which only matters once something runs on a
 * schedule: A PLAY THAT HAS NOTHING NEW TO SAY SAYS NOTHING. An agent that
 * repeats yesterday's summary every morning trains the person it reports to
 * to stop reading it, and then the one morning it matters is the morning
 * they skip. So each play fingerprints its own findings, and a run that
 * matches the last one is reported as unchanged rather than as news.
 */

import { Paise, formatINR } from "../money.js";
import { PeriodKey, periodOf, prevPeriod } from "./periods.js";
import { CloseAgentContext, workTheClose } from "./close-agent.js";
import { REMINDER_KIND, reminderSummary } from "../reminders.js";

/** Something the agent actually changed. Past tense, always. */
export type Did = string;

/** Something it could not do, and what a person has to do about it. */
export interface ForYou {
  readonly what: string;
  readonly why: string;
  readonly needs: string;
}

export interface PlayResult {
  readonly play: string;
  readonly title: string;
  /** One line, or null when this play has nothing worth a person's time. */
  readonly headline: string | null;
  readonly did: readonly Did[];
  readonly forYou: readonly ForYou[];
  /**
   * What makes this the same finding as last run. Two runs with the same
   * fingerprint are the same news, however differently it is worded.
   */
  readonly fingerprint: string;
  /** True when the fingerprint matched the previous run's. */
  readonly unchanged: boolean;
}

export interface CfoRun {
  readonly asOf: string;
  readonly period: PeriodKey;
  readonly actor: string;
  readonly ranAt: string;
  readonly plays: readonly PlayResult[];
  /** Plays that changed something. */
  readonly acted: number;
  /** Items left for a person, across every play. */
  readonly waiting: number;
  /** True when nothing happened and nothing is new — a quiet morning. */
  readonly quiet: boolean;
}

/**
 * What a play may look at and touch.
 *
 * Narrow hooks rather than the engines themselves, for the same reason
 * `AgentContextIn` is shaped this way: a play that can reach the whole
 * organization is a play whose blast radius is the whole organization.
 */
export interface CfoContext {
  /** The close checklist, its findings, and the grants that settle them. */
  readonly close: CloseAgentContext;
  readonly periods?: {
    readonly firstPeriod: PeriodKey;
    readonly status: (period: PeriodKey) => string;
  };
  readonly overdueInvoices: (asOf: string, minDaysOverdue: number) => readonly {
    readonly number: string;
    readonly customer: string;
    readonly outstanding: Paise;
    readonly daysOverdue: number;
  }[];
  /** Drafts already waiting on a person, so the agent never queues a second one. */
  readonly pendingDrafts: () => readonly { readonly kind: string; readonly summary: string }[];
  /** Draft a reminder for one invoice. Returns the summary a person will see. */
  readonly draftReminder: (invoiceNumber: string, asOf: string) => string;
  readonly cash: (asOf: string) => {
    readonly cash: Paise;
    readonly runwayDays: number | null;
    /** Null means missing history; a non-positive value means no net burn. */
    readonly monthlyNetBurn?: Paise | null;
    readonly note?: string;
  };
}

export interface CfoThresholds {
  /** Chase nothing younger than this — a week late is not late yet. */
  readonly chaseAfterDays: number;
  /** Most reminders one run may draft. A queue of thirty is a queue nobody opens. */
  readonly maxRemindersPerRun: number;
  /** Below this many days of runway, cash stops being a report and becomes news. */
  readonly runwayAlarmDays: number;
}

const DEFAULT_THRESHOLDS: CfoThresholds = {
  chaseAfterDays: 15,
  maxRemindersPerRun: 3,
  runwayAlarmDays: 90,
};

interface Play {
  readonly id: string;
  readonly title: string;
  run(ctx: CfoContext, asOf: string, actor: string, t: CfoThresholds, version: 1 | 2): Omit<PlayResult, "play" | "title" | "unchanged">;
}

/* ------------------------------------------------------------------ */
/* The plays                                                           */
/* ------------------------------------------------------------------ */

/**
 * Get the month as close to closeable as it honestly gets.
 *
 * Delegates entirely to `workTheClose` — the close's definition of progress
 * lives there, and a second one here would be a second answer to one
 * question. This play's only job is turning that attempt into the shape the
 * digest speaks.
 */
const closePlay: Play = {
  id: "close",
  title: "Month-end close",
  run(ctx, asOf, actor, _t, version) {
    // Old recorded commands must freeze the same period on replay. New
    // sweeps only work a completed month; daily monitoring must leave this
    // month's incoming invoices and bank feeds open.
    const period = version === 1 ? periodOf(asOf) : prevPeriod(periodOf(asOf));
    if (version === 2 && ctx.periods &&
        (period < ctx.periods.firstPeriod || ctx.periods.status(period) === "CLOSED"))
      return { headline: null, did: [], forYou: [], fingerprint: `close|${period}|ineligible` };
    const attempt = workTheClose(ctx.close, period, actor);

    // Deliberately not `describeAttempt`: that paragraph ends with its own
    // "left for you" list, which the digest then prints again under
    // "waiting on you". One statement of what is outstanding, in one place.
    const headline = attempt.readyToClose
      ? `${period} is ready to close.`
      : `${period} is not ready to close: ${attempt.after.blocked} task` +
        `${attempt.after.blocked === 1 ? "" : "s"} still blocked` +
        (attempt.stallReason ? `, because ${attempt.stallReason}` : "") + ".";

    return {
      headline: attempt.did.length === 0 && attempt.remaining.length === 0 ? null : headline,
      did: attempt.did,
      forYou: attempt.remaining.map((r) => ({ what: r.task, why: r.why, needs: r.needs })),
      // The blockers themselves, not the count: four blockers becoming a
      // different four is news, and a count would hide it.
      fingerprint: `close|${period}|${attempt.readyToClose}|${attempt.remaining.map((r) => r.task).sort().join(",")}`,
    };
  },
};

/**
 * Chase what is genuinely late.
 *
 * Drafting is the whole of the action. Nothing is sent — Paisa has no mail
 * server, and an agent that claimed to have emailed a customer would be
 * lying about the one thing the person reading this cannot check. The draft
 * waits for approval like any other.
 */
const receivablesPlay: Play = {
  id: "receivables",
  title: "Receivables",
  run(ctx, asOf, _actor, t, version) {
    const overdue = [...ctx.overdueInvoices(asOf, t.chaseAfterDays)].sort((a, b) => b.daysOverdue - a.daysOverdue);
    if (version === 1 && overdue.length === 0)
      return { headline: null, did: [], forYou: [], fingerprint: "receivables|none" };
    // A reminder already waiting on a person is a reminder. Drafting a
    // second one does not chase the customer any harder; it only makes the
    // queue look like work.
    const pending = ctx.pendingDrafts().filter((d) => d.kind === REMINDER_KIND);
    const alreadyDrafted = new Set(pending.map((d) => d.summary));
    const needsReminder = overdue.filter((invoice) =>
      !alreadyDrafted.has(reminderSummary(invoice.customer, invoice.number)),
    );
    // Version one is retained only for replay: changing its selection can
    // create extra historical drafts and shift later action identifiers.
    const attempted = version === 1
      ? overdue.slice(0, t.maxRemindersPerRun).filter((invoice) =>
          !alreadyDrafted.has(reminderSummary(invoice.customer, invoice.number)))
      : needsReminder.slice(0, t.maxRemindersPerRun);

    const did: Did[] = [];
    const failed: ForYou[] = [];
    // Apply the cap after excluding pending drafts, so later invoices can
    // advance on the next sweep. Failures still spend an attempt.
    for (const invoice of attempted) {
      try {
        ctx.draftReminder(invoice.number, asOf);
        did.push(`Drafted a reminder for ${invoice.customer} — ${invoice.number}, ${invoice.daysOverdue} days late`);
      } catch (err) {
        failed.push({
          what: `${invoice.number} (${invoice.customer})`,
          why: err instanceof Error ? err.message : String(err),
          needs: "someone to look at the invoice — the agent could not draft against it",
        });
      }
    }

    const total = overdue.reduce((acc, o) => acc + o.outstanding, 0n) as Paise;
    const waitingApproval = pending.length + did.length;
    const remaining = needsReminder.length - did.length;
    const deferred = needsReminder.length - attempted.length;

    if (version === 1) {
      const beyond = overdue.length - Math.min(overdue.length, t.maxRemindersPerRun);
      return {
        headline: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} past ${t.chaseAfterDays} days — ` +
          `${formatINR(total)} outstanding, oldest ${overdue[0]!.daysOverdue} days` +
          (beyond > 0 ? `. Drafted the ${t.maxRemindersPerRun} oldest; ${beyond} left for you.` : "."),
        did,
        forYou: [...failed, ...(did.length > 0 ? [{
          what: `${did.length} reminder${did.length === 1 ? "" : "s"} drafted`,
          why: "nothing is sent until a person approves it",
          needs: "approve or dismiss each draft",
        }] : [])],
        fingerprint: `receivables|${overdue.map((o) => `${o.number}@${o.daysOverdue}`).join(",")}`,
      };
    }

    if (overdue.length === 0 && waitingApproval === 0)
      return { headline: null, did: [], forYou: [], fingerprint: "receivables|none" };

    return {
      headline:
        (overdue.length > 0
          ? `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} past ${t.chaseAfterDays} days — ` +
            `${formatINR(total)} outstanding, oldest ${overdue[0]!.daysOverdue} days. `
          : "No invoices past the chase threshold. ") +
        `Drafted ${did.length} reminder${did.length === 1 ? "" : "s"} this run; ` +
        `${remaining} still need reminders; ${waitingApproval} awaiting approval.`,
      did,
      forYou: [
        ...failed,
        ...(waitingApproval > 0
          ? [{
              what: `${waitingApproval} reminder${waitingApproval === 1 ? "" : "s"} awaiting approval`,
              why: "nothing is sent until a person approves it",
              needs: "approve or dismiss each draft",
            }]
          : []),
        ...(deferred > 0
          ? [{
              what: `${deferred} overdue invoice${deferred === 1 ? "" : "s"} still need reminders`,
              why: "the reminder attempt limit was reached for this run",
              needs: "run another sweep or prepare the remaining reminders",
            }]
          : []),
      ],
      // Partial payments and pending decisions change the work even when
      // the invoice numbers and their age stay the same.
      fingerprint: `receivables|${overdue.map((o) => `${o.number}@${o.daysOverdue}@${o.outstanding}`).join(",")}|pending:${waitingApproval}|remaining:${remaining}`,
    };
  },
};

/**
 * Watch the runway, and only speak when it bites.
 *
 * A play with no hands on purpose. Nothing here can fix a short runway, and
 * an agent that "did something about it" would be inventing work; the
 * honest act is to say the number early enough to be worth knowing.
 */
const runwayPlay: Play = {
  id: "runway",
  title: "Cash runway",
  run(ctx, asOf, _actor, t, version) {
    const { cash, runwayDays, monthlyNetBurn, note } = ctx.cash(asOf);

    if (version === 1 && runwayDays === null)
      return { headline: null, did: [], forYou: [], fingerprint: "runway|ok" };

    if (runwayDays === null) {
      if (monthlyNetBurn !== undefined && monthlyNetBurn !== null && monthlyNetBurn <= 0n)
        return { headline: null, did: [], forYou: [], fingerprint: "runway|not-burning" };

      const reason = note || "Insufficient cash-flow history to assess runway.";
      return {
        headline: `Cash runway is unavailable. ${reason}`,
        did: [],
        forYou: [{
          what: "Cash runway could not be assessed",
          why: reason,
          needs: "check connected accounts and import the missing transaction history",
        }],
        fingerprint: `runway|unavailable|${reason}`,
      };
    }

    if (runwayDays > t.runwayAlarmDays)
      return {
        headline: null,
        did: [],
        forYou: [],
        // Not the exact day count: runway wobbles daily, and a fingerprint
        // that moved every morning would make every morning "news".
        fingerprint: `runway|ok`,
      };

    // Bucketed for the same reason — 84 days becoming 83 is not a new fact,
    // dropping under 60 is.
    const bucket = runwayDays <= 30 ? "under-30" : runwayDays <= 60 ? "under-60" : "under-90";
    return {
      headline: `Runway is ${runwayDays} days on ${formatINR(cash)} of cash.`,
      did: [],
      forYou: [{
        what: `Runway under ${t.runwayAlarmDays} days`,
        why: `${runwayDays} days at the trailing burn rate`,
        needs: "a decision about spend or raise — the agent has no lever for this one",
      }],
      fingerprint: `runway|${bucket}`,
    };
  },
};

export const PLAYS: readonly Play[] = [closePlay, receivablesPlay, runwayPlay];

/* ------------------------------------------------------------------ */
/* The agent                                                           */
/* ------------------------------------------------------------------ */

/**
 * How many sweeps to keep.
 *
 * Enough to answer "what did it do this month" and no more. The action log
 * is the permanent record; this is a window, and an unbounded one would grow
 * forever in a process that is meant to run every morning.
 */
const HISTORY = 30;

export class CfoAgent {
  /** The last fingerprint each play produced — this is the agent's memory. */
  private seen = new Map<string, string>();
  private history: CfoRun[] = [];

  constructor(
    private ctx: CfoContext,
    private thresholds: CfoThresholds = DEFAULT_THRESHOLDS,
    private plays: readonly Play[] = PLAYS,
  ) {}

  /**
   * One sweep: every play, in order, each isolated from the others.
   *
   * A play that throws is reported as a play that threw and the sweep
   * continues. The alternative — one failing play taking the whole run down —
   * means a bug in receivables silently stops the close from being worked,
   * and the person only finds out at month-end.
   */
  run(asOf: string, actor: string, version: 1 | 2 = 2): CfoRun {
    if (version !== 1 && version !== 2) throw new Error(`Unsupported CFO sweep version: ${version}`);
    const results: PlayResult[] = [];

    for (const play of this.plays) {
      try {
        const outcome = play.run(this.ctx, asOf, actor, this.thresholds, version);
        const unchanged = this.seen.get(play.id) === outcome.fingerprint;
        this.seen.set(play.id, outcome.fingerprint);
        results.push({ play: play.id, title: play.title, ...outcome, unchanged });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          play: play.id,
          title: play.title,
          headline: `${play.title} could not run: ${message}`,
          did: [],
          forYou: [{
            what: `${play.title} failed`,
            why: message,
            needs: "someone to look at it — this run reported nothing about that part of the books",
          }],
          // Failures are news every time. Suppressing a repeated failure as
          // "unchanged" is how an agent goes quietly blind.
          fingerprint: `${play.id}|error|${Date.now()}`,
          unchanged: false,
        });
      }
    }

    const acted = results.filter((r) => r.did.length > 0).length;
    const waiting = results.reduce((n, r) => n + r.forYou.length, 0);

    const run: CfoRun = {
      asOf,
      period: version === 1 ? periodOf(asOf) : prevPeriod(periodOf(asOf)),
      actor,
      ranAt: new Date().toISOString(),
      plays: results,
      acted,
      waiting,
      quiet: acted === 0 && results.every((r) => r.headline === null || r.unchanged),
    };

    this.history.push(run);
    if (this.history.length > HISTORY) this.history.shift();
    return run;
  }

  /**
   * Past sweeps, oldest first.
   *
   * Both this and the fingerprint memory above are rebuilt by replaying the
   * action log, because a sweep is a recorded command like any other write.
   * That is the whole of the agent's durability: there is no second store to
   * keep in step, and a restarted process does not re-announce yesterday's
   * news or re-draft a reminder it already queued.
   */
  runs(): readonly CfoRun[] {
    return this.history;
  }

  last(): CfoRun | null {
    return this.history.length === 0 ? null : this.history[this.history.length - 1]!;
  }
}

/**
 * The digest — one message, not one per play.
 *
 * Unchanged plays are named but not re-explained. Somebody skimming this at
 * 9am needs to see what moved since yesterday, and be able to find the rest
 * if they want it.
 */
export function describeRun(run: CfoRun): string {
  if (run.quiet)
    return run.waiting === 0
      ? `Nothing new as of ${run.asOf}. Everything the agent watches is where you left it.`
      : // "Nothing new" is true and, on its own, misleading: five invoices
        // still waiting is not the same as nothing waiting, however long
        // they have been waiting.
        `Nothing new as of ${run.asOf}, but ${run.waiting} thing${run.waiting === 1 ? " is" : "s are"} ` +
        `still waiting on you: ${run.plays.flatMap((p) => p.forYou.map((f) => f.what)).join("; ")}.`;

  const news = run.plays.filter((p) => p.headline !== null && !p.unchanged);
  const same = run.plays.filter((p) => p.headline !== null && p.unchanged);
  const did = run.plays.flatMap((p) => p.did);

  const parts = [
    did.length === 0 ? "I changed nothing." : `I did: ${did.join("; ")}.`,
    ...news.map((p) => `${p.title}: ${p.headline}`),
    same.length === 0 ? "" : `Unchanged since the last run: ${same.map((p) => p.title).join(", ")}.`,
    run.waiting === 0
      ? "Nothing is waiting on you."
      : `Waiting on you (${run.waiting}): ${run.plays
          .flatMap((p) => p.forYou.map((f) => `${f.what} — ${f.needs}`))
          .join("; ")}.`,
  ];

  return parts.filter(Boolean).join(" ");
}
