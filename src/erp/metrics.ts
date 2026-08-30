/**
 * SaaS operator metrics, derived from the revenue contracts — not typed
 * into a spreadsheet beside them. Same source as the GAAP numbers, so
 * "MRR" and "revenue" can be reconciled to each other on demand, which is
 * the whole reason to compute them inside the ERP.
 *
 * MRR here is normalised committed monthly revenue: an obligation's
 * allocated price divided by its term in months. That is deliberately not
 * the same as recognised revenue in a month (which varies with day count),
 * and the difference is reported rather than hidden.
 *
 * Movement classification per customer, per month:
 *   NEW           first revenue ever
 *   REACTIVATION  revenue returns after a gap
 *   EXPANSION     revenue up on an existing customer
 *   CONTRACTION   revenue down but still present
 *   CHURN         revenue falls to zero
 */

import { Paise, ZERO, add, sub, sum, mulRatio } from "../money.js";
import { ContractEngine } from "./contracts.js";
import { RevRecEngine } from "./revrec.js";
import { PeriodKey, periodRange, prevPeriod, nextPeriod } from "./periods.js";

export type MovementKind = "NEW" | "REACTIVATION" | "EXPANSION" | "CONTRACTION" | "CHURN" | "FLAT";

export interface CustomerMrr {
  readonly customer: string;
  readonly mrr: Paise;
}

export interface MrrMovement {
  readonly customer: string;
  readonly kind: MovementKind;
  readonly from: Paise;
  readonly to: Paise;
  readonly delta: Paise;
}

export interface MrrPeriod {
  readonly period: PeriodKey;
  readonly openingMrr: Paise;
  readonly newMrr: Paise;
  readonly reactivationMrr: Paise;
  readonly expansionMrr: Paise;
  readonly contractionMrr: Paise;
  readonly churnedMrr: Paise;
  readonly closingMrr: Paise;
  readonly arr: Paise;
  readonly customerCount: number;
  readonly movements: readonly MrrMovement[];
}

export interface RetentionSummary {
  readonly from: PeriodKey;
  readonly to: PeriodKey;
  readonly openingMrr: Paise;
  readonly expansion: Paise;
  readonly contraction: Paise;
  readonly churn: Paise;
  readonly closingMrr: Paise;
  /** Net revenue retention, in basis points to stay exact (10000 = 100%). */
  readonly nrrBps: number | null;
  /** Gross revenue retention, basis points. */
  readonly grrBps: number | null;
}

export class MetricsEngine {
  constructor(
    private contracts: ContractEngine,
    private revrec: RevRecEngine,
  ) {}

  /**
   * Committed MRR per customer for a period: every ratable obligation whose
   * schedule touches that period, at its normalised monthly rate.
   */
  customerMrr(period: PeriodKey): readonly CustomerMrr[] {
    const byCustomer = new Map<string, Paise>();
    for (const c of this.contracts.all()) {
      if (c.status !== "ACTIVE") continue;
      for (const po of c.obligations) {
        if (po.method !== "RATABLE_DAILY" && po.method !== "RATABLE_MONTHLY") continue;
        const lines = this.revrec.schedule(c.id).filter((l) => l.obligationId === po.id);
        if (lines.length === 0) continue;
        if (!lines.some((l) => l.period === period)) continue;
        const normalized = mulRatio(po.allocated, 1n, BigInt(lines.length));
        byCustomer.set(c.customer, add(byCustomer.get(c.customer) ?? ZERO, normalized));
      }
    }
    return [...byCustomer.entries()]
      .map(([customer, mrr]) => ({ customer, mrr }))
      .sort((a, b) => (b.mrr > a.mrr ? 1 : b.mrr < a.mrr ? -1 : a.customer.localeCompare(b.customer)));
  }

  mrr(period: PeriodKey): Paise {
    return sum(this.customerMrr(period).map((c) => c.mrr));
  }

  arr(period: PeriodKey): Paise {
    return mulRatio(this.mrr(period), 12n, 1n);
  }

  /** Full movement bridge from the prior period to this one. */
  movement(period: PeriodKey): MrrPeriod {
    const prior = prevPeriod(period);
    const before = new Map(this.customerMrr(prior).map((c) => [c.customer, c.mrr]));
    const after = new Map(this.customerMrr(period).map((c) => [c.customer, c.mrr]));
    const everBefore = this.customersEverBefore(prior);

    const movements: MrrMovement[] = [];
    let newMrr: Paise = ZERO;
    let reactivationMrr: Paise = ZERO;
    let expansionMrr: Paise = ZERO;
    let contractionMrr: Paise = ZERO;
    let churnedMrr: Paise = ZERO;

    for (const customer of new Set([...before.keys(), ...after.keys()])) {
      const from = before.get(customer) ?? ZERO;
      const to = after.get(customer) ?? ZERO;
      const delta = sub(to, from);
      let kind: MovementKind;
      if (from === ZERO && to > ZERO) {
        kind = everBefore.has(customer) ? "REACTIVATION" : "NEW";
        if (kind === "NEW") newMrr = add(newMrr, to);
        else reactivationMrr = add(reactivationMrr, to);
      } else if (from > ZERO && to === ZERO) {
        kind = "CHURN";
        churnedMrr = add(churnedMrr, from);
      } else if (delta > ZERO) {
        kind = "EXPANSION";
        expansionMrr = add(expansionMrr, delta);
      } else if (delta < ZERO) {
        kind = "CONTRACTION";
        contractionMrr = add(contractionMrr, (-delta) as Paise);
      } else {
        kind = "FLAT";
      }
      if (kind !== "FLAT") movements.push({ customer, kind, from, to, delta });
    }

    const openingMrr = sum([...before.values()]);
    const closingMrr = sum([...after.values()]);
    return {
      period,
      openingMrr,
      newMrr,
      reactivationMrr,
      expansionMrr,
      contractionMrr,
      churnedMrr,
      closingMrr,
      arr: mulRatio(closingMrr, 12n, 1n),
      customerCount: after.size,
      movements: movements.sort((a, b) => a.customer.localeCompare(b.customer)),
    };
  }

  /**
   * Net and gross revenue retention over a window. Both are reported in
   * basis points because a percentage float would quietly lose precision
   * on the exact figures everything else here guarantees.
   */
  retention(from: PeriodKey, to: PeriodKey): RetentionSummary {
    const periods = periodRange(nextPeriod(from), to);
    const openingMrr = this.mrr(from);
    let expansion: Paise = ZERO;
    let contraction: Paise = ZERO;
    let churn: Paise = ZERO;
    const cohort = new Set(this.customerMrr(from).map((c) => c.customer));

    for (const p of periods) {
      const m = this.movement(p);
      for (const mv of m.movements) {
        if (!cohort.has(mv.customer)) continue; // retention is cohort-only
        if (mv.kind === "EXPANSION") expansion = add(expansion, mv.delta);
        if (mv.kind === "CONTRACTION") contraction = add(contraction, (-mv.delta) as Paise);
        if (mv.kind === "CHURN") churn = add(churn, mv.from);
      }
    }

    const closingCohortMrr = sum(
      this.customerMrr(to)
        .filter((c) => cohort.has(c.customer))
        .map((c) => c.mrr),
    );
    const bps = (numerator: Paise): number | null =>
      openingMrr === ZERO ? null : Number((numerator * 10000n) / openingMrr);

    return {
      from,
      to,
      openingMrr,
      expansion,
      contraction,
      churn,
      closingMrr: closingCohortMrr,
      nrrBps: bps(closingCohortMrr),
      grrBps: bps(sub(sub(openingMrr, churn), contraction)),
    };
  }

  /** Remaining performance obligation — contracted revenue not yet earned. */
  backlog(): Paise {
    return this.revrec.remainingPerformanceObligation();
  }

  /** Average revenue per account for a period. */
  arpa(period: PeriodKey): Paise {
    const rows = this.customerMrr(period);
    if (rows.length === 0) return ZERO;
    return mulRatio(sum(rows.map((r) => r.mrr)), 1n, BigInt(rows.length));
  }

  private customersEverBefore(upTo: PeriodKey): ReadonlySet<string> {
    const seen = new Set<string>();
    for (const c of this.contracts.all()) {
      if (c.status === "DRAFT") continue;
      if (c.startDate.slice(0, 7) <= upTo) seen.add(c.customer);
    }
    return seen;
  }
}
