/**
 * Banking Ingestion — bank feed → duplicate detection → categorization →
 * journal posting.
 *
 * Lines the categorizer recognizes are auto-posted through the same
 * journal.post() every other module uses; lines it cannot classify go to a
 * review queue instead of being guessed into an account. Re-importing the
 * same statement is idempotent: previously seen lines are reported as
 * duplicates, never double-posted.
 */

import { Paise, abs } from "./money.js";
import { ChartOfAccounts } from "./accounts.js";
import { JournalEngine, JournalEntry } from "./journal.js";
import { EventBus } from "./events.js";

export interface BankStatementLine {
  readonly date: string; // ISO date
  readonly description: string;
  readonly amount: Paise; // signed: positive = money in, negative = money out
  readonly reference: string; // bank's own reference / UTR — part of the dedupe key
}

export interface CategorizationRule {
  readonly keyword: string; // matched case-insensitively against the description
  readonly accountId: string; // expense account for outflows, revenue account for inflows
  readonly label: string;
  /**
   * True when a person taught this rule, false for the ones shipped as
   * defaults.
   *
   * This used to be implicit in array position — defaults were constructed
   * first, taught rules appended after, and `match` let the later of two
   * equally specific rules win to encode "a human outranks a default". That
   * works right up until two *taught* rules are equally specific and point at
   * different accounts, at which point the winner is whichever was added
   * last, and adding a rule silently re-books descriptions that already
   * matched another one. Recording the origin makes the intended rule
   * explicit and leaves genuine ties detectable instead of resolved by
   * accident.
   */
  readonly taught?: boolean;
}

/** Why a line is waiting for a person. */
export type ReviewReason =
  | { readonly kind: "no_rule" }
  | { readonly kind: "ambiguous"; readonly accounts: readonly string[]; readonly keywords: readonly string[] }
  /** A rule matched, but money went the wrong way for its account. */
  | { readonly kind: "direction"; readonly accountId: string; readonly keyword: string }
  /** A rule matched, but a word in the line says money is moving between balances. */
  | { readonly kind: "movement"; readonly accountId: string; readonly keyword: string; readonly word: string }
  /** Policy 3: a rule Paisa ships proposes this account; a person confirms it. */
  | { readonly kind: "suggested"; readonly accountId: string; readonly keyword: string; readonly label: string }
  /** Policy 4: a learned rule matched, but the amount is far outside what it was confirmed on. */
  | {
      readonly kind: "unusual_amount";
      readonly accountId: string;
      readonly keyword: string;
      readonly usualMin: Paise;
      readonly usualMax: Paise;
    };

/**
 * Which categorizer rules an import ran under.
 *
 * 1 — keyword rules only; a match books wherever it points.
 * 2 — adds the direction guard, movement words and staple rules.
 * 3 — suggest-only: the rules Paisa ships propose an account instead of
 *     booking it. Only rules a company taught itself and format staples book.
 *     Measured against 2 on the held-out set: precision 76.5% to 100%, wrong
 *     bookings 4 to 0, with lines cleared in one tap or none 36.1% to 38.9%.
 * 4 — a rule learned from confirmations remembers the amounts it was
 *     confirmed on, and a line far outside them goes to review instead of
 *     booking. Two small stationery orders do not make a ₹46,000 monitor
 *     stationery.
 *
 * Recorded on every import command, because what an import booked depends on
 * the rules in force when it ran. Replaying last year's import under today's
 * rules would quietly rewrite last year's books.
 */
export type ImportPolicy = 1 | 2 | 3 | 4;

export interface ImportResult {
  readonly posted: readonly { line: BankStatementLine; entry: JournalEntry; label: string }[];
  readonly duplicates: readonly BankStatementLine[];
  readonly needsReview: readonly BankStatementLine[];
}

/**
 * An account a model proposed for a line in review, recorded as data.
 *
 * Kept in the log rather than asked for again on replay: a model answers
 * differently from one day to the next, and books rebuilt from the log must
 * come out identical. `accountId` is null when the model was asked and had no
 * usable answer, so the same line is not paid for twice.
 */
export interface ModelSuggestion {
  readonly accountId: string | null;
  readonly model: string;
}

/** Balance-sheet accounts a bank line plausibly lands in. */
const BALANCE_SHEET_TARGETS = new Set(["acc_cash", "acc_gst_payable", "acc_taxes_payable", "acc_loans", "acc_capital"]);

/** Income and expense accounts no bank line should be booked to directly. */
const NOT_FROM_BANK_LINES = new Set([
  "acc_realized_gains",
  "acc_realized_losses",
  "acc_depreciation_expense",
  "acc_amortization_expense",
  "acc_fx_gain",
  "acc_fx_loss",
  "acc_subscription_revenue",
  "acc_usage_revenue",
]);

/**
 * The accounts a model may propose for a bank line — the list it is shown,
 * and the list a recorded proposal is checked against. Here rather than beside
 * the model code so the engine can enforce it without depending on that code.
 */
export const suggestableAccounts = (chart: ChartOfAccounts): readonly ReturnType<ChartOfAccounts["all"]>[number][] =>
  chart
    .all()
    .filter(
      (a) =>
        a.active &&
        (((a.type === "EXPENSE" || a.type === "REVENUE") && !NOT_FROM_BANK_LINES.has(a.id)) ||
          BALANCE_SHEET_TARGETS.has(a.id)),
    );

export class BankingError extends Error {
  override name = "BankingError";
}

export class BankFeedEngine {
  private seen = new Set<string>(); // dedupe keys of every line ever ingested
  // Queued lines remember the bank account they were imported against, so
  // categorization posts the counter-entry to the right account, not a default.
  private reviewQueue: { line: BankStatementLine; bankAccountId: string; reason: ReviewReason }[] = [];
  private rules: CategorizationRule[];
  /** Lifetime tallies behind stats() — the auto-book rate is a trend, not a snapshot. */
  private totals = { posted: 0, needsReview: 0, duplicates: 0 };
  private resolved = 0;
  private learned = 0;
  private modelSuggestions = new Map<string, ModelSuggestion>();
  /** Confirmations counted towards a keyword that is not yet a rule. */
  private evidence = new Map<string, { accountId: string; count: number; conflicted: boolean; min: Paise; max: Paise }>();
  /** The amounts each learned rule has been confirmed or booked on. */
  private ranges = new Map<CategorizationRule, { min: Paise; max: Paise }>();

  constructor(
    public readonly orgId: string,
    private chart: ChartOfAccounts,
    private journal: JournalEngine,
    private bus: EventBus,
    rules?: readonly CategorizationRule[],
  ) {
    if (chart.orgId !== orgId) throw new BankingError("Chart of accounts belongs to a different organization");
    this.rules = [...(rules ?? defaultCategorizationRules())];
  }

  /** A rule added here was taught by someone, and outranks a default it ties with. */
  addRule(rule: CategorizationRule): void {
    rule = { ...rule, taught: rule.taught ?? true };
    this.chart.get(rule.accountId); // throws if unknown
    this.rules.push(rule);
  }

  allRules(): readonly CategorizationRule[] {
    return this.rules;
  }

  pendingReview(): readonly BankStatementLine[] {
    return this.reviewQueue.map((q) => q.line);
  }

  /**
   * The queue with the reason each line is in it.
   *
   * Separate from `pendingReview` rather than replacing it: six callers want
   * the lines and nothing else, and widening their return type to carry a
   * field they ignore would be churn. What needs the reason asks for it.
   */
  reviewQueueWithReasons(): readonly {
    line: BankStatementLine;
    reason: ReviewReason;
    /** Present once a model has been asked about the line. */
    modelSuggestion?: ModelSuggestion;
  }[] {
    return this.reviewQueue.map((q) => {
      const modelSuggestion = this.modelSuggestions.get(q.line.reference);
      return { line: q.line, reason: q.reason, ...(modelSuggestion ? { modelSuggestion } : {}) };
    });
  }

  importStatement(
    lines: readonly BankStatementLine[],
    actor: string,
    bankAccountId = "acc_bank",
    policy: ImportPolicy = CURRENT_IMPORT_POLICY,
  ): ImportResult {
    this.chart.get(bankAccountId);

    // Policy 3 books far fewer lines itself, so far more reach review — and a
    // line cleared from review posts as close work, which a soft-closed period
    // still admits. Checked only at posting, the period lock would let a
    // statement imported after the freeze in through that door. So every new
    // line is checked against the lock before anything is recorded, and the
    // whole statement is refused if any line is. Older policies keep their
    // original behaviour, so their imports replay as they ran.
    if (policy >= 3)
      for (const line of lines) {
        if (line.amount === 0n || this.seen.has(dedupeKey(line))) continue;
        this.journal.assertPostable({ date: line.date, sourceModule: "banking", narration: line.description });
      }

    const posted: { line: BankStatementLine; entry: JournalEntry; label: string }[] = [];
    const duplicates: BankStatementLine[] = [];
    const needsReview: BankStatementLine[] = [];

    for (const line of lines) {
      if (line.amount === 0n) continue;
      const key = dedupeKey(line);
      if (this.seen.has(key)) {
        duplicates.push(line);
        continue;
      }
      this.seen.add(key);

      const outcome = this.match(line.description, policy);

      // No rule, or rules that disagree — both are questions for a person,
      // and the queue records which so the answer can be the right one. A
      // line nobody has a rule for needs a rule; a line two rules fight over
      // needs one of them narrowed.
      if (!outcome || "tie" in outcome) {
        const reason: ReviewReason = outcome
          ? {
              kind: "ambiguous",
              accounts: [...new Set(outcome.tie.map((r) => r.accountId))],
              keywords: outcome.tie.map((r) => r.keyword),
            }
          : (policy >= 3 ? this.suggest(line) : null) ?? { kind: "no_rule" };
        this.reviewQueue.push({ line, bankAccountId, reason });
        needsReview.push(line);
        this.emit("banking.needs_review", actor, {
          reference: line.reference,
          description: line.description,
          reason: reason.kind,
          ...(reason.kind === "ambiguous" ? { keywords: reason.keywords, accounts: reason.accounts } : {}),
          ...(reason.kind === "suggested" ? { keyword: reason.keyword, account: reason.accountId } : {}),
        });
        continue;
      }

      const rule = outcome.rule;

      // A keyword says who was paid. It cannot say whether that payment is
      // income, an expense or neither — so under policy 2 two checks it
      // cannot make on its own get a veto before anything posts.
      const refusal = policy >= 2 ? this.refuse(line, rule) : null;
      if (refusal) {
        this.reviewQueue.push({ line, bankAccountId, reason: refusal });
        needsReview.push(line);
        this.emit("banking.needs_review", actor, {
          reference: line.reference,
          description: line.description,
          reason: refusal.kind,
          keyword: rule.keyword,
          account: rule.accountId,
          ...(refusal.kind === "movement" ? { word: refusal.word } : {}),
        });
        continue;
      }

      const amount = abs(line.amount);
      const range = policy >= 4 ? this.ranges.get(rule) : undefined;
      if (range && (amount > range.max * AMOUNT_GUARD_FACTOR || amount * AMOUNT_GUARD_FACTOR < range.min)) {
        const reason: ReviewReason = {
          kind: "unusual_amount",
          accountId: rule.accountId,
          keyword: rule.keyword,
          usualMin: range.min,
          usualMax: range.max,
        };
        this.reviewQueue.push({ line, bankAccountId, reason });
        needsReview.push(line);
        this.emit("banking.needs_review", actor, {
          reference: line.reference,
          description: line.description,
          reason: reason.kind,
          keyword: rule.keyword,
          account: rule.accountId,
        });
        continue;
      }
      const entry = this.journal.post({
        date: line.date,
        narration: `${rule.label}: ${line.description}`,
        lines:
          line.amount < 0n
            ? [
                { accountId: rule.accountId, side: "DEBIT", amount },
                { accountId: bankAccountId, side: "CREDIT", amount },
              ]
            : [
                { accountId: bankAccountId, side: "DEBIT", amount },
                { accountId: rule.accountId, side: "CREDIT", amount },
              ],
        sourceModule: "banking",
        referenceId: line.reference,
        createdBy: actor,
      });
      posted.push({ line, entry, label: rule.label });
      // A booked line is inside the guard, so it only widens what is usual.
      if (range) {
        if (amount < range.min) range.min = amount;
        if (amount > range.max) range.max = amount;
      }
    }

    this.totals.posted += posted.length;
    this.totals.duplicates += duplicates.length;
    this.totals.needsReview += needsReview.length;

    this.emit("banking.imported", actor, {
      posted: posted.length,
      duplicates: duplicates.length,
      needsReview: needsReview.length,
      autoBookedPct: this.stats().autoBookedPct,
    });
    return { posted, duplicates, needsReview };
  }

  /**
   * Resolve a queued line by naming the account it belongs to.
   *
   * Pass `learn` to also teach the categorizer, so the next line from the same
   * payee posts by itself. This is the only way the auto-book rate climbs:
   * every review that teaches nothing guarantees the same question next month.
   *
   * The keyword is supplied and validated rather than inferred, because a rule
   * derived from a guess quietly mis-books everything it later matches. A
   * person vouches for it once; `suggestKeyword` proposes what to vouch for.
   */
  categorize(reference: string, accountId: string, actor: string, learn?: string): JournalEntry {
    const idx = this.reviewQueue.findIndex((q) => q.line.reference === reference);
    if (idx === -1) throw new BankingError(`No line with reference ${reference} awaits review`);
    const { line, bankAccountId } = this.reviewQueue[idx]!;
    const account = this.chart.get(accountId);

    // Validated before anything posts, so a bad keyword fails the whole call
    // rather than leaving a booked entry beside a rejected rule.
    const keyword = learn?.trim();
    if (keyword !== undefined) {
      if (keyword.length < 3) throw new BankingError(`Keyword "${keyword}" is too short to be a rule`);
      if (!patternFor(keyword).test(line.description))
        throw new BankingError(`Keyword "${keyword}" does not appear in "${line.description}"`);
    }
    const amount = abs(line.amount);
    const entry = this.journal.post({
      date: line.date,
      narration: `${account.name}: ${line.description}`,
      lines:
        line.amount < 0n
          ? [
              { accountId, side: "DEBIT", amount },
              { accountId: bankAccountId, side: "CREDIT", amount },
            ]
          : [
              { accountId: bankAccountId, side: "DEBIT", amount },
              { accountId, side: "CREDIT", amount },
            ],
      // Not "banking": that is the feed posting itself, and it stays frozen
      // during a soft close. A human clearing a line the close is waiting on
      // is close work, and is allowed to land in the period being closed —
      // otherwise the checklist demands something the freeze forbids.
      sourceModule: "banking_review",
      referenceId: line.reference,
      createdBy: actor,
    });
    this.reviewQueue.splice(idx, 1);
    this.modelSuggestions.delete(reference);
    this.resolved++;
    if (keyword !== undefined) {
      this.rules.push({ keyword, accountId, label: account.name, taught: true });
      this.learned++;
      this.emit("banking.rule_learned", actor, { keyword, accountId, from: line.description });
    }
    this.emit("banking.categorized", actor, { reference, accountId });
    return entry;
  }

  /**
   * The one-tap path: book a line to the account a person chose, and count
   * that choice as evidence for a keyword.
   *
   * `categorize` with a keyword turns it into a rule immediately, on one
   * person's one confirmation. Measured over three months that books payees
   * whose purpose changes — an employee reimbursed for cabs one month and
   * lunch the next, a marketplace, a payment gateway — to last month's
   * account, with nobody asked. Here a keyword becomes a rule only when
   * `CONFIRMATIONS_TO_LEARN` confirmations agree on the account, and never
   * once two have disagreed. The rule remembers the amounts it was confirmed
   * on (see policy 4).
   *
   * A confirmation that contradicts a learned rule withdraws the rule: a
   * person just said it was wrong, and a rule that books wrongly until
   * someone deletes it by hand is the failure this is meant to prevent.
   */
  confirm(
    reference: string,
    accountId: string,
    actor: string,
    keyword?: string,
  ): { readonly entry: JournalEntry; readonly learned: boolean; readonly withdrawn: boolean } {
    const queued = this.reviewQueue.find((q) => q.line.reference === reference);
    if (!queued) throw new BankingError(`No line with reference ${reference} awaits review`);
    const kw = keyword?.trim().toLowerCase();
    // Checked before anything posts, like categorize.
    if (kw !== undefined) {
      if (kw.length < 3) throw new BankingError(`Keyword "${kw}" is too short to be a rule`);
      if (!patternFor(kw).test(queued.line.description))
        throw new BankingError(`Keyword "${kw}" does not appear in "${queued.line.description}"`);
    }
    const amount = abs(queued.line.amount);
    const entry = this.categorize(reference, accountId, actor);
    if (kw === undefined) return { entry, learned: false, withdrawn: false };

    const existing = this.rules.find((r) => r.taught && r.keyword.toLowerCase() === kw);
    if (existing) {
      if (existing.accountId === accountId) {
        const range = this.ranges.get(existing);
        if (range) {
          if (amount < range.min) range.min = amount;
          if (amount > range.max) range.max = amount;
        }
        return { entry, learned: false, withdrawn: false };
      }
      this.rules.splice(this.rules.indexOf(existing), 1);
      this.ranges.delete(existing);
      this.evidence.set(kw, { accountId, count: 0, conflicted: true, min: amount, max: amount });
      this.emit("banking.rule_withdrawn", actor, { keyword: kw, accountId: existing.accountId, contradictedBy: accountId });
      return { entry, learned: false, withdrawn: true };
    }

    let key = kw;
    let e = this.evidence.get(kw);
    if (!e) {
      const merged = this.mergeEvidence(kw, accountId);
      if (merged) ({ key, entry: e } = merged);
    }
    if (!e) {
      this.evidence.set(kw, { accountId, count: 1, conflicted: false, min: amount, max: amount });
    } else if (!e.conflicted) {
      if (e.accountId !== accountId) {
        e.conflicted = true;
        this.emit("banking.teaching_conflict", actor, { keyword: kw, accounts: [e.accountId, accountId] });
      } else {
        e.count++;
        if (amount < e.min) e.min = amount;
        if (amount > e.max) e.max = amount;
      }
    }
    if (!e || e.conflicted || e.count < CONFIRMATIONS_TO_LEARN) return { entry, learned: false, withdrawn: false };

    const rule: CategorizationRule = { keyword: key, accountId, label: this.chart.get(accountId).name, taught: true };
    this.rules.push(rule);
    this.ranges.set(rule, { min: e.min, max: e.max });
    this.evidence.delete(key);
    this.learned++;
    this.emit("banking.rule_learned", actor, { keyword: key, accountId, from: queued.line.description, confirmations: e.count });
    return { entry, learned: true, withdrawn: false };
  }

  /**
   * The same payee printed with a different tail — another outlet, another
   * city — confirmed to the same account as before: the words the two
   * keywords share become the keyword the confirmations count towards.
   *
   * At least two whole leading words, so two people who share a first name
   * never pool their confirmations, and only for the same account, so two
   * businesses that share a prefix but not a purpose stay apart.
   */
  private mergeEvidence(
    kw: string,
    accountId: string,
  ): { key: string; entry: { accountId: string; count: number; conflicted: boolean; min: Paise; max: Paise } } | null {
    for (const [other, o] of this.evidence) {
      if (o.conflicted || o.accountId !== accountId) continue;
      const shared = sharedLeadingWords(other, kw);
      if (shared === null || this.rules.some((r) => r.taught && r.keyword.toLowerCase() === shared)) continue;
      const target = this.evidence.get(shared);
      if (target && (target.conflicted || target.accountId !== accountId)) continue;
      this.evidence.delete(other);
      if (target) {
        target.count = Math.max(target.count, o.count);
        if (o.min < target.min) target.min = o.min;
        if (o.max > target.max) target.max = o.max;
        return { key: shared, entry: target };
      }
      const entry = { ...o };
      this.evidence.set(shared, entry);
      return { key: shared, entry };
    }
    return null;
  }

  /**
   * Record what a model proposed for lines in review. Never books anything.
   *
   * The proposals arrive from outside the engine, so they are checked again
   * here rather than trusted because the caller checked them: the account
   * must be one a bank line can land in, and must pass the same direction and
   * movement checks a rule would. A proposal that fails is kept as "asked, no
   * usable answer" — the line was paid for once and should not be again.
   *
   * Lines no longer waiting, and lines a rule already proposes, are skipped:
   * a person may have cleared the line while the model was thinking, and a
   * rule someone can read beats a model's guess.
   */
  recordModelSuggestions(
    suggestions: readonly { reference: string; accountId: string | null; model: string }[],
    actor: string,
  ): { readonly recorded: number; readonly discarded: number; readonly skipped: number } {
    const allowed = new Set(suggestableAccounts(this.chart).map((a) => a.id));
    let recorded = 0;
    let discarded = 0;
    for (const s of suggestions) {
      const queued = this.reviewQueue.find((q) => q.line.reference === s.reference);
      if (!queued || queued.reason.kind === "suggested") continue;
      const usable =
        typeof s.accountId === "string" &&
        allowed.has(s.accountId) &&
        this.refuse(queued.line, { keyword: "", accountId: s.accountId, label: "" }) === null;
      if (s.accountId !== null && !usable) discarded++;
      this.modelSuggestions.set(s.reference, { accountId: usable ? s.accountId : null, model: String(s.model) });
      recorded++;
    }
    const skipped = suggestions.length - recorded;
    if (recorded) this.emit("banking.suggestions_recorded", actor, { recorded, discarded, skipped });
    return { recorded, discarded, skipped };
  }

  /**
   * How much of the feed books itself.
   *
   * The number this product is judged on: an AI CFO that leaves half the
   * statement in a review queue is a spreadsheet with extra steps. Counted
   * over the engine's lifetime, not per import, because the rate only means
   * something once rules have had time to learn.
   *
   * `resolved` and `learned` are the leading indicators — reviews that taught
   * the categorizer something are the ones that lift the rate from here.
   */
  stats(): {
    readonly posted: number;
    readonly needsReview: number;
    readonly duplicates: number;
    readonly resolved: number;
    readonly learned: number;
    readonly considered: number;
    readonly autoBookedPct: number | null;
  } {
    const considered = this.totals.posted + this.totals.needsReview;
    return {
      ...this.totals,
      resolved: this.resolved,
      learned: this.learned,
      considered,
      // Null rather than 0 or 100 on an empty feed: "no data" and "nothing
      // books itself" are different answers to the same question.
      autoBookedPct: considered === 0 ? null : Math.round((this.totals.posted / considered) * 1000) / 10,
    };
  }

  /**
   * The most specific rule the description satisfies, or null.
   *
   * Two properties matter here, and plain substring matching had neither.
   *
   * Bounded: a keyword must sit on a word boundary. "rent" inside "CURRENT
   * ACCOUNT TRANSFER" is not rent, "ads" inside "THREADS" is not marketing,
   * and "ola" inside "CHOCOLATE" is not a cab. Those are not hypotheticals —
   * bank narrations are dense, abbreviated strings, and a substring match
   * books them to a confidently wrong account. A line in review is a question;
   * a line posted to the wrong account is a misstatement someone has to find.
   *
   * Longest-wins: "google cloud" must beat a "google" rule, so the rule that
   * knows the most about a description is the one that books it.
   *
   * Then taught-beats-default at equal length, which is what array order used
   * to stand in for. Stating it directly means it still holds if the rules are
   * ever reordered, deduplicated, or loaded from somewhere that does not
   * preserve insertion order.
   *
   * And when that still leaves a tie between rules that disagree about the
   * account, this returns the tie rather than picking. Two people taught two
   * equally specific rules and a line satisfies both: there is no fact here
   * that says which is right, and the engine inventing one books money to an
   * account nobody chose. A line in review is a question; a line posted to
   * the wrong account is a misstatement someone has to find.
   */
  private match(
    description: string,
    policy: ImportPolicy = CURRENT_IMPORT_POLICY,
  ): { rule: CategorizationRule } | { tie: readonly CategorizationRule[] } | null {
    // Policy 3: only rules this company taught may book. The ones Paisa ships
    // are consulted by suggest(), after nothing here could book the line.
    const bookers = policy >= 3 ? this.rules.filter((r) => r.taught) : this.rules;
    let matched = bookers.filter((r) => patternFor(r.keyword).test(description));
    // Staples name a format — a bank's own fee, a tax challan, an ATM — not a
    // payee. They are consulted only when no payee rule matched, so a vendor's
    // "delivery charges" stays with the vendor rather than becoming a bank fee.
    if (matched.length === 0 && policy >= 2)
      matched = STAPLE_RULES.filter((r) => this.hasAccount(r.accountId) && patternFor(r.keyword).test(description));
    if (matched.length === 0) return null;

    const rank = (r: CategorizationRule): number => r.keyword.length * 2 + (r.taught ? 1 : 0);
    const top = Math.max(...matched.map(rank));
    const finalists = matched.filter((r) => rank(r) === top);

    // Agreeing on the account is not a tie worth stopping for — two keywords
    // can both be right about the same expense.
    const accounts = new Set(finalists.map((r) => r.accountId));
    if (accounts.size === 1) return { rule: finalists[0]! };
    return { tie: finalists };
  }

  /**
   * Why a matched rule may still not book this line, or null if it may.
   *
   * Direction: money out cannot be income, money in cannot be an expense.
   * "INTEREST DEBITED" matched the interest-income rule and lowered income;
   * "RENT RECEIVED" matched office rent and credited an expense.
   *
   * Movement: an advance, a refund, a reversal, a deposit or a wallet load
   * moves money between balances. Booking one to income or expense misstates
   * the P&L even when the direction is right — a salary advance is money the
   * employee owes back, not salary. Balance-sheet accounts are exempt: a cash
   * deposit belongs in cash.
   */
  private refuse(line: BankStatementLine, rule: CategorizationRule): ReviewReason | null {
    const type = this.chart.get(rule.accountId).type;
    const out = line.amount < 0n;
    if ((out && type === "REVENUE") || (!out && type === "EXPENSE"))
      return { kind: "direction", accountId: rule.accountId, keyword: rule.keyword };
    if (type === "REVENUE" || type === "EXPENSE") {
      const word = MOVEMENT_WORDS.find((w) => patternFor(w).test(line.description));
      if (word) return { kind: "movement", accountId: rule.accountId, keyword: rule.keyword, word };
    }
    return null;
  }

  /**
   * Where a shipped rule would have booked this line, offered for a person to
   * confirm (policy 3).
   *
   * Never a suggestion policy 2 would have refused — money going the wrong way
   * for the account, or a movement word — and never a guess between two
   * equally specific shipped rules that disagree.
   */
  private suggest(line: BankStatementLine): ReviewReason | null {
    const shipped = this.rules.filter((r) => !r.taught && patternFor(r.keyword).test(line.description));
    if (shipped.length === 0) return null;
    const longest = Math.max(...shipped.map((r) => r.keyword.length));
    const finalists = shipped.filter((r) => r.keyword.length === longest);
    if (new Set(finalists.map((r) => r.accountId)).size > 1) return null;
    const rule = finalists[0]!;
    if (!this.hasAccount(rule.accountId) || this.refuse(line, rule)) return null;
    return { kind: "suggested", accountId: rule.accountId, keyword: rule.keyword, label: rule.label };
  }

  private hasAccount(id: string): boolean {
    try {
      this.chart.get(id);
      return true;
    } catch {
      return false;
    }
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}

/** The whole words two keywords start with, if there are at least two of them. */
const sharedLeadingWords = (a: string, b: string): string | null => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let prefix = a.slice(0, i);
  const endsWord = (s: string): boolean => i >= s.length || !/[a-z0-9]/.test(s[i]!);
  if (!(endsWord(a) && endsWord(b))) prefix = prefix.replace(/[a-z0-9]+$/, "");
  prefix = prefix.replace(/[^a-z0-9]+$/, "");
  const words = prefix.match(/[a-z0-9]+/g) ?? [];
  return words.length >= 2 ? prefix : null;
};

const dedupeKey = (l: BankStatementLine): string => `${l.date}|${l.amount}|${l.reference}`;

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compiled once per keyword rather than per line — a sync is thousands of lines. */
const patternCache = new Map<string, RegExp>();

const patternFor = (keyword: string): RegExp => {
  let re = patternCache.get(keyword);
  if (!re) {
    // Bounded by anything that is not a letter or digit, so hyphens, slashes
    // and the run-together fields of a real bank narration still count as
    // boundaries — "NEFT DR-AWS INDIA-0042" matches "aws", "THREADS" does not
    // match "ads".
    re = new RegExp(`(?<![a-z0-9])${escapeRegex(keyword.toLowerCase())}(?![a-z0-9])`, "i");
    patternCache.set(keyword, re);
  }
  return re;
};

/**
 * Banking noise that names a payment rail, not a payee — never a useful rule.
 * Learning "neft" would book every transfer to one account.
 */
const RAIL_WORDS = new Set([
  "neft", "imps", "rtgs", "upi", "ach", "nach", "emi", "dr", "cr", "ref", "txn", "trf",
  "transfer", "payment", "paid", "debit", "credit", "card", "pos", "atm", "chq", "cheque",
  "bank", "account", "acc", "ltd", "pvt", "india", "inr", "to", "from", "the", "and", "for",
]);

/**
 * The token in a description most likely to name the payee.
 *
 * A suggestion for a human to confirm, never a rule on its own — the whole
 * point of learning is that a person vouched for the keyword once.
 */
export const suggestKeyword = (description: string): string | null => {
  // Words are kept with their positions so a multi-word suggestion can be cut
  // out of the original text, separator and all. A keyword is matched against
  // the description verbatim, so "chai point" must not be handed back when the
  // statement actually said "CHAI-POINT" — the rule would never fire again.
  const words: { text: string; start: number; end: number }[] = [];
  const scan = /[a-z0-9]+/gi;
  for (let m = scan.exec(description); m; m = scan.exec(description))
    words.push({ text: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });

  const usable = (w: { text: string }): boolean =>
    w.text.length >= 3 &&
    !RAIL_WORDS.has(w.text) &&
    !/^\d+$/.test(w.text) &&
    // Letters and digits together are a code, not a name: an IFSC, a masked
    // card or account number, a UTR, a cheque serial. Some change every
    // month, so a keyword carrying one never matches the next statement.
    !(/[a-z]/.test(w.text) && /\d/.test(w.text));

  // The longest unbroken run of payee-ish words: "IMPS 4032 CHAI POINT" should
  // suggest "CHAI POINT", not "point" — a single common word is exactly the
  // kind of keyword that later books someone else's invoice to this account.
  let best: string | null = null;
  let run: typeof words = [];
  const flush = (): void => {
    if (run.length) {
      const span = run.slice(0, 3); // three words is specific enough to be safe
      const text = description.slice(span[0]!.start, span[span.length - 1]!.end);
      if (!best || text.length > best.length) best = text;
    }
    run = [];
  };
  for (const w of words) {
    if (usable(w)) run.push(w);
    else flush();
  }
  flush();

  return best === null ? null : (best as string).toLowerCase();
};

/** Sensible starting rules for an Indian SMB bank feed. */
export const defaultCategorizationRules = (): CategorizationRule[] => [
  { keyword: "salary", accountId: "acc_salary", label: "Payroll" },
  { keyword: "payroll", accountId: "acc_salary", label: "Payroll" },
  { keyword: "rent", accountId: "acc_rent", label: "Office Rent" },
  { keyword: "aws", accountId: "acc_software", label: "Software" },
  { keyword: "google cloud", accountId: "acc_software", label: "Software" },
  { keyword: "github", accountId: "acc_software", label: "Software" },
  { keyword: "figma", accountId: "acc_software", label: "Software" },
  { keyword: "slack", accountId: "acc_software", label: "Software" },
  { keyword: "notion", accountId: "acc_software", label: "Software" },
  { keyword: "zoho", accountId: "acc_software", label: "Software" },
  { keyword: "ads", accountId: "acc_marketing", label: "Marketing" },
  { keyword: "linkedin", accountId: "acc_marketing", label: "Marketing" },
  { keyword: "uber", accountId: "acc_travel", label: "Travel" },
  { keyword: "ola", accountId: "acc_travel", label: "Travel" },
  { keyword: "makemytrip", accountId: "acc_travel", label: "Travel" },
  { keyword: "electricity", accountId: "acc_utilities", label: "Utilities" },
  { keyword: "airtel", accountId: "acc_utilities", label: "Utilities" },
  { keyword: "jio", accountId: "acc_utilities", label: "Utilities" },
  { keyword: "ca fees", accountId: "acc_professional", label: "Professional Fees" },
  { keyword: "legal", accountId: "acc_professional", label: "Professional Fees" },
  { keyword: "interest", accountId: "acc_interest_income", label: "Interest Income" },
];

/** New imports run under this; see ImportPolicy. */
export const CURRENT_IMPORT_POLICY: ImportPolicy = 4;

/** Confirmations that must agree before a keyword becomes a rule that books. */
export const CONFIRMATIONS_TO_LEARN = 2;

/**
 * How far outside its confirmed amounts a learned rule still books: up to
 * three times the largest, down to a third of the smallest. Monthly bills,
 * payroll and tax challans drift well inside that; a marketplace order for
 * equipment after two for stationery does not.
 */
const AMOUNT_GUARD_FACTOR = 3n;

/**
 * Rules for what nearly every Indian business statement contains, consulted
 * only when no payee rule matches (policy 2).
 *
 * Deliberately formats and the most common merchants for the accounts every
 * statement needs — not a list grown by chasing individual lines. A rule added
 * because one eval line needed it improves that line and nothing else.
 */
export const STAPLE_RULES: readonly CategorizationRule[] = [
  // The bank's own fees.
  { keyword: "charges", accountId: "acc_bank_charges", label: "Bank Charges", taught: false },
  { keyword: "chrg", accountId: "acc_bank_charges", label: "Bank Charges", taught: false },
  { keyword: "chgs", accountId: "acc_bank_charges", label: "Bank Charges", taught: false },
  { keyword: "annual fee", accountId: "acc_bank_charges", label: "Bank Charges", taught: false },
  { keyword: "min bal", accountId: "acc_bank_charges", label: "Bank Charges", taught: false },
  // Tax paid — settling what is owed, not an expense.
  { keyword: "cpin", accountId: "acc_gst_payable", label: "GST Payment", taught: false },
  { keyword: "itns 281", accountId: "acc_taxes_payable", label: "TDS Payment", taught: false },
  { keyword: "itns 280", accountId: "acc_taxes_payable", label: "Advance Tax", taught: false },
  // Cash moving in and out of the bank.
  { keyword: "atm wdl", accountId: "acc_cash", label: "Cash Withdrawal", taught: false },
  { keyword: "cash dep", accountId: "acc_cash", label: "Cash Deposit", taught: false },
  { keyword: "cash deposit", accountId: "acc_cash", label: "Cash Deposit", taught: false },
  // The most common merchants for the accounts Indian statements need.
  { keyword: "swiggy", accountId: "acc_meals", label: "Meals", taught: false },
  { keyword: "zomato", accountId: "acc_meals", label: "Meals", taught: false },
  { keyword: "hpcl", accountId: "acc_vehicle_fuel", label: "Vehicle & Fuel", taught: false },
  { keyword: "bpcl", accountId: "acc_vehicle_fuel", label: "Vehicle & Fuel", taught: false },
  { keyword: "iocl", accountId: "acc_vehicle_fuel", label: "Vehicle & Fuel", taught: false },
  { keyword: "indian oil", accountId: "acc_vehicle_fuel", label: "Vehicle & Fuel", taught: false },
  { keyword: "lic of india", accountId: "acc_insurance", label: "Insurance", taught: false },
  { keyword: "irctc", accountId: "acc_travel", label: "Travel", taught: false },
];

/** Words that mean money is moving between balances rather than being earned or spent. */
export const MOVEMENT_WORDS: readonly string[] = ["advance", "refund", "reversal", "reversed", "deposit", "wallet"];
