/**
 * Multi-entity consolidation.
 *
 * Each entity keeps its own chart, journal and functional currency — there
 * is no shared ledger and no cross-entity posting. Consolidation is a
 * read-only projection computed on demand:
 *
 *   1. translate each entity's trial balance into the presentation currency
 *      (balance-sheet accounts at the closing rate, P&L at the average rate)
 *   2. sum by account CODE across entities
 *   3. eliminate matched intercompany receivable/payable pairs
 *   4. plug the translation difference to Cumulative Translation Adjustment
 *
 * The CTA is a plug by definition, but it is a *reported* plug: it appears
 * as its own line, so nobody has to wonder where the imbalance went. An
 * unmatched intercompany balance is surfaced as a blocker, never netted
 * away silently.
 */

import { Paise, ZERO, add, sub, sum } from "../money.js";
import { AccountType, NORMAL_BALANCE } from "../accounts.js";
import { PeriodKey } from "./periods.js";

export class ConsolidationError extends Error {
  override name = "ConsolidationError";
}

export interface EntityRef {
  readonly orgId: string;
  readonly name: string;
  readonly functionalCurrency: string;
  /** Parent's ownership, in basis points (10000 = wholly owned). */
  readonly ownershipBps: number;
  readonly parentOrgId: string | null;
}

/** One entity's trial balance, already extracted from its own ledger. */
export interface EntityTrialBalance {
  readonly orgId: string;
  readonly rows: readonly {
    readonly code: string;
    readonly name: string;
    readonly type: AccountType;
    /** Signed in the account's normal-balance direction. */
    readonly balance: Paise;
  }[];
}

export interface ConsolidatedRow {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly byEntity: ReadonlyMap<string, Paise>;
  readonly gross: Paise;
  readonly eliminated: Paise;
  readonly consolidated: Paise;
}

export interface IntercompanyMismatch {
  readonly receivableCode: string;
  readonly payableCode: string;
  readonly receivable: Paise;
  readonly payable: Paise;
  readonly difference: Paise;
}

export interface ConsolidatedTrialBalance {
  readonly period: PeriodKey;
  readonly presentationCurrency: string;
  readonly entities: readonly string[];
  readonly rows: readonly ConsolidatedRow[];
  readonly totalDebit: Paise;
  readonly totalCredit: Paise;
  readonly cta: Paise;
  readonly balanced: boolean;
  readonly intercompanyMismatches: readonly IntercompanyMismatch[];
  readonly eliminationsApplied: Paise;
}

/** Rate conversion supplied per entity — closing for BS, average for P&L. */
export interface TranslationRates {
  /** functional → presentation, as an exact rational. */
  readonly closing: { readonly num: bigint; readonly den: bigint };
  readonly average: { readonly num: bigint; readonly den: bigint };
}

const isPnl = (t: AccountType): boolean => t === "REVENUE" || t === "EXPENSE";

const translate = (amount: Paise, r: { num: bigint; den: bigint }): Paise => {
  if (r.den === 0n) throw new ConsolidationError("Translation rate denominator cannot be zero");
  const p = amount * r.num;
  const q = p / r.den;
  const rem = p % r.den;
  if (rem === 0n) return q as Paise;
  const roundUp = (rem < 0n ? -rem : rem) * 2n >= (r.den < 0n ? -r.den : r.den);
  if (!roundUp) return q as Paise;
  return (q + ((p < 0n) !== (r.den < 0n) ? -1n : 1n)) as Paise;
};

export class ConsolidationEngine {
  private entities = new Map<string, EntityRef>();

  constructor(
    public readonly groupId: string,
    public readonly presentationCurrency: string,
    /** Account-code pairs eliminated against each other on consolidation. */
    private intercompanyPairs: readonly (readonly [string, string])[] = [["1600", "2600"]],
    private ctaCode = "3200",
  ) {}

  addEntity(entity: EntityRef): EntityRef {
    if (this.entities.has(entity.orgId))
      throw new ConsolidationError(`Entity ${entity.orgId} is already in the group`);
    if (entity.ownershipBps < 0 || entity.ownershipBps > 10000)
      throw new ConsolidationError("Ownership must be between 0 and 10000 basis points");
    if (entity.parentOrgId && !this.entities.has(entity.parentOrgId))
      throw new ConsolidationError(`Parent ${entity.parentOrgId} must be added before its subsidiary`);
    this.entities.set(entity.orgId, entity);
    return entity;
  }

  allEntities(): readonly EntityRef[] {
    return [...this.entities.values()];
  }

  entity(orgId: string): EntityRef {
    const e = this.entities.get(orgId);
    if (!e) throw new ConsolidationError(`Unknown entity ${orgId}`);
    return e;
  }

  /**
   * Consolidate. `rates` supplies the translation pair per entity; an entity
   * already in the presentation currency may be omitted (1:1 is assumed only
   * when its functional currency *is* the presentation currency).
   */
  consolidate(
    period: PeriodKey,
    balances: readonly EntityTrialBalance[],
    rates: ReadonlyMap<string, TranslationRates>,
  ): ConsolidatedTrialBalance {
    const identity: TranslationRates = { closing: { num: 1n, den: 1n }, average: { num: 1n, den: 1n } };
    const rowsByCode = new Map<string, { name: string; type: AccountType; byEntity: Map<string, Paise> }>();

    for (const tb of balances) {
      const entity = this.entity(tb.orgId);
      const rate = rates.get(tb.orgId) ?? null;
      if (!rate && entity.functionalCurrency !== this.presentationCurrency)
        throw new ConsolidationError(
          `${entity.name} reports in ${entity.functionalCurrency} but no translation rate was supplied for ${period}`,
        );
      const r = rate ?? identity;

      for (const row of tb.rows) {
        const translated = translate(row.balance, isPnl(row.type) ? r.average : r.closing);
        const existing = rowsByCode.get(row.code) ?? { name: row.name, type: row.type, byEntity: new Map() };
        existing.byEntity.set(tb.orgId, add(existing.byEntity.get(tb.orgId) ?? ZERO, translated));
        rowsByCode.set(row.code, existing);
      }
    }

    // Intercompany elimination: the matched portion of each pair goes.
    const eliminations = new Map<string, Paise>();
    const mismatches: IntercompanyMismatch[] = [];
    for (const [receivableCode, payableCode] of this.intercompanyPairs) {
      const receivable = sum([...(rowsByCode.get(receivableCode)?.byEntity.values() ?? [])]);
      const payable = sum([...(rowsByCode.get(payableCode)?.byEntity.values() ?? [])]);
      if (receivable === ZERO && payable === ZERO) continue;
      const matched = receivable < payable ? receivable : payable;
      eliminations.set(receivableCode, matched);
      eliminations.set(payableCode, matched);
      const difference = sub(receivable, payable);
      if (difference !== ZERO)
        mismatches.push({ receivableCode, payableCode, receivable, payable, difference });
    }

    const rows: ConsolidatedRow[] = [...rowsByCode.entries()]
      .map(([code, r]) => {
        const gross = sum([...r.byEntity.values()]);
        const eliminated = eliminations.get(code) ?? ZERO;
        return {
          code,
          name: r.name,
          type: r.type,
          byEntity: r.byEntity,
          gross,
          eliminated,
          consolidated: sub(gross, eliminated),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    // Debits and credits after elimination, in normal-balance terms.
    let totalDebit: Paise = ZERO;
    let totalCredit: Paise = ZERO;
    for (const row of rows) {
      if (row.consolidated === ZERO) continue;
      const normal = NORMAL_BALANCE[row.type];
      const positive = row.consolidated >= 0n;
      const amount = (row.consolidated < 0n ? -row.consolidated : row.consolidated) as Paise;
      const side = positive === (normal === "DEBIT") ? "DEBIT" : "CREDIT";
      if (side === "DEBIT") totalDebit = add(totalDebit, amount);
      else totalCredit = add(totalCredit, amount);
    }

    // Translation difference is the plug — reported as CTA, never buried.
    const cta = sub(totalDebit, totalCredit);
    const withCta: ConsolidatedRow[] = cta === ZERO
      ? rows
      : [
          ...rows.filter((r) => r.code !== this.ctaCode),
          this.ctaRow(rows, cta),
        ].sort((a, b) => a.code.localeCompare(b.code));

    return {
      period,
      presentationCurrency: this.presentationCurrency,
      entities: balances.map((b) => b.orgId),
      rows: withCta,
      totalDebit,
      totalCredit: add(totalCredit, cta),
      cta,
      balanced: true,
      intercompanyMismatches: mismatches,
      eliminationsApplied: sum([...eliminations.values()]),
    };
  }

  private ctaRow(rows: readonly ConsolidatedRow[], cta: Paise): ConsolidatedRow {
    const existing = rows.find((r) => r.code === this.ctaCode);
    const base = existing?.consolidated ?? ZERO;
    return {
      code: this.ctaCode,
      name: "Cumulative Translation Adjustment",
      type: "EQUITY",
      byEntity: existing?.byEntity ?? new Map(),
      gross: add(base, cta),
      eliminated: ZERO,
      consolidated: add(base, cta),
    };
  }
}
