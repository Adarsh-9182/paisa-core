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
}

export interface ImportResult {
  readonly posted: readonly { line: BankStatementLine; entry: JournalEntry; label: string }[];
  readonly duplicates: readonly BankStatementLine[];
  readonly needsReview: readonly BankStatementLine[];
}

export class BankingError extends Error {
  override name = "BankingError";
}

export class BankFeedEngine {
  private seen = new Set<string>(); // dedupe keys of every line ever ingested
  // Queued lines remember the bank account they were imported against, so
  // categorization posts the counter-entry to the right account, not a default.
  private reviewQueue: { line: BankStatementLine; bankAccountId: string }[] = [];
  private rules: CategorizationRule[];
  /** Lifetime tallies behind stats() — the auto-book rate is a trend, not a snapshot. */
  private totals = { posted: 0, needsReview: 0, duplicates: 0 };
  private resolved = 0;
  private learned = 0;

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

  addRule(rule: CategorizationRule): void {
    this.chart.get(rule.accountId); // throws if unknown
    this.rules.push(rule);
  }

  allRules(): readonly CategorizationRule[] {
    return this.rules;
  }

  pendingReview(): readonly BankStatementLine[] {
    return this.reviewQueue.map((q) => q.line);
  }

  importStatement(lines: readonly BankStatementLine[], actor: string, bankAccountId = "acc_bank"): ImportResult {
    this.chart.get(bankAccountId);
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

      const rule = this.match(line.description);
      if (!rule) {
        this.reviewQueue.push({ line, bankAccountId });
        needsReview.push(line);
        this.emit("banking.needs_review", actor, { reference: line.reference, description: line.description });
        continue;
      }

      const amount = abs(line.amount);
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
      sourceModule: "banking",
      referenceId: line.reference,
      createdBy: actor,
    });
    this.reviewQueue.splice(idx, 1);
    this.resolved++;
    if (keyword !== undefined) {
      this.rules.push({ keyword, accountId, label: account.name });
      this.learned++;
      this.emit("banking.rule_learned", actor, { keyword, accountId, from: line.description });
    }
    this.emit("banking.categorized", actor, { reference, accountId });
    return entry;
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
   * knows the most about a description is the one that books it. On equal
   * specificity the later rule wins, because rules are added in order of
   * authority: a keyword a person taught this engine outranks the built-in
   * default it was correcting, which is the whole point of teaching it.
   */
  private match(description: string): CategorizationRule | null {
    let best: CategorizationRule | null = null;
    for (const rule of this.rules) {
      if (!patternFor(rule.keyword).test(description)) continue;
      if (!best || rule.keyword.length >= best.keyword.length) best = rule;
    }
    return best;
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}

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
    w.text.length >= 3 && !RAIL_WORDS.has(w.text) && !/^\d+$/.test(w.text);

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
