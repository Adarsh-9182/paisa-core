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
  private reviewQueue: BankStatementLine[] = [];
  private rules: CategorizationRule[];

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
    return this.reviewQueue;
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
        this.reviewQueue.push(line);
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

    this.emit("banking.imported", actor, {
      posted: posted.length,
      duplicates: duplicates.length,
      needsReview: needsReview.length,
    });
    return { posted, duplicates, needsReview };
  }

  /** Resolve a queued line by naming the account it belongs to. */
  categorize(reference: string, accountId: string, actor: string, bankAccountId = "acc_bank"): JournalEntry {
    const idx = this.reviewQueue.findIndex((l) => l.reference === reference);
    if (idx === -1) throw new BankingError(`No line with reference ${reference} awaits review`);
    const line = this.reviewQueue[idx]!;
    const account = this.chart.get(accountId);
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
    this.emit("banking.categorized", actor, { reference, accountId });
    return entry;
  }

  private match(description: string): CategorizationRule | null {
    const lower = description.toLowerCase();
    return this.rules.find((r) => lower.includes(r.keyword.toLowerCase())) ?? null;
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}

const dedupeKey = (l: BankStatementLine): string => `${l.date}|${l.amount}|${l.reference}`;

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
