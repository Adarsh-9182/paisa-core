/**
 * Revenue contracts — ASC 606 steps 1 to 4.
 *
 *   1. Identify the contract          → Contract
 *   2. Identify performance obligations → PerformanceObligation[]
 *   3. Determine the transaction price  → Contract.transactionPrice
 *   4. Allocate the price to the POs    → relative standalone-selling-price
 *
 * Step 5 (recognise as obligations are satisfied) lives in revrec.ts.
 *
 * Allocation is exact integer arithmetic: the allocated amounts always sum
 * to the transaction price to the last paisa, with the rounding remainder
 * assigned to the largest obligation. A contract whose parts don't sum to
 * the whole is a restatement waiting to happen, so it is impossible here.
 *
 * Modifications are versioned, never edited in place: amend() supersedes a
 * contract with a new version and the old one stays readable for audit.
 */

import { Paise, ZERO, add, sub, sum, cmp, mulRatio } from "../money.js";
import { EventBus } from "../events.js";
import { daysBetween } from "../invoices.js";

export type RecognitionMethod =
  /** Straight-line over the service period, prorated by day. */
  | "RATABLE_DAILY"
  /** Straight-line over the service period, equal per calendar month. */
  | "RATABLE_MONTHLY"
  /** Recognised in full on the delivery date (setup fee, hardware, licence). */
  | "POINT_IN_TIME"
  /** Recognised as usage is reported (metered/consumption revenue). */
  | "USAGE"
  /** Recognised when a named milestone is marked delivered. */
  | "MILESTONE";

export type BillingFrequency = "UPFRONT" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ON_USAGE" | "MILESTONE";

export type ContractStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED" | "CANCELLED";

export interface PerformanceObligation {
  readonly id: string;
  readonly description: string;
  /** Standalone selling price — the basis for step-4 allocation. */
  readonly ssp: Paise;
  /** Service period. endDate is null for POINT_IN_TIME / MILESTONE / USAGE. */
  readonly startDate: string;
  readonly endDate: string | null;
  readonly method: RecognitionMethod;
  readonly revenueAccountId: string;
  /** Step-4 output: this PO's share of the transaction price. */
  readonly allocated: Paise;
}

export interface BillingEvent {
  readonly id: string;
  readonly dueDate: string;
  readonly amount: Paise;
  /** The service window this instalment covers (for the invoice narrative). */
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly invoiceId: string | null; // set once billed
}

export interface Contract {
  readonly id: string;
  readonly orgId: string;
  readonly number: string;
  readonly customer: string;
  readonly signedDate: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly currency: string;
  readonly transactionPrice: Paise;
  readonly obligations: readonly PerformanceObligation[];
  readonly billingFrequency: BillingFrequency;
  readonly billingSchedule: readonly BillingEvent[];
  readonly status: ContractStatus;
  readonly version: number;
  /** id of the contract version this one replaced. */
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
}

export class ContractError extends Error {
  override name = "ContractError";
}

export interface ObligationInput {
  description: string;
  ssp: Paise;
  startDate: string;
  endDate?: string | null;
  method: RecognitionMethod;
  revenueAccountId?: string;
}

export interface CreateContractInput {
  number: string;
  customer: string;
  signedDate: string;
  transactionPrice: Paise;
  obligations: readonly ObligationInput[];
  billingFrequency: BillingFrequency;
  currency?: string;
}

const MONTHS_PER: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

const addMonths = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
};

const dayBefore = (iso: string): string => {
  const t = Date.parse(iso + "T00:00:00Z") - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * Relative-SSP allocation (ASC 606-10-32-31). Exact: the parts sum to the
 * whole, remainder to the largest SSP.
 */
export const allocateByRelativeSsp = (
  transactionPrice: Paise,
  ssps: readonly Paise[],
): readonly Paise[] => {
  if (ssps.length === 0) throw new ContractError("Cannot allocate to zero obligations");
  const totalSsp = sum(ssps);
  if (totalSsp <= 0n) throw new ContractError("Total standalone selling price must be positive");
  const raw = ssps.map((s) => mulRatio(transactionPrice, s, totalSsp));
  const drift = sub(transactionPrice, sum(raw));
  if (drift === ZERO) return raw;
  // Largest SSP absorbs the rounding remainder.
  let biggest = 0;
  for (let i = 1; i < ssps.length; i++) if (cmp(ssps[i]!, ssps[biggest]!) > 0) biggest = i;
  return raw.map((a, i) => (i === biggest ? add(a, drift) : a));
};

export class ContractEngine {
  private contracts = new Map<string, Contract>();
  private counter = 0;

  constructor(
    public readonly orgId: string,
    private bus: EventBus,
  ) {}

  create(input: CreateContractInput, actor: string): Contract {
    if (input.obligations.length === 0)
      throw new ContractError("A contract needs at least one performance obligation");
    if (input.transactionPrice <= 0n)
      throw new ContractError("Transaction price must be positive");

    for (const o of input.obligations) {
      if (o.ssp <= 0n)
        throw new ContractError(`Standalone selling price must be positive ("${o.description}")`);
      const needsPeriod = o.method === "RATABLE_DAILY" || o.method === "RATABLE_MONTHLY";
      if (needsPeriod && !o.endDate)
        throw new ContractError(`"${o.description}" is ${o.method} and needs an end date`);
      if (o.endDate && o.endDate < o.startDate)
        throw new ContractError(`"${o.description}" ends before it starts`);
    }

    const allocations = allocateByRelativeSsp(
      input.transactionPrice,
      input.obligations.map((o) => o.ssp),
    );

    const id = `con_${this.orgId}_${++this.counter}`;
    const obligations: PerformanceObligation[] = input.obligations.map((o, i) => ({
      id: `${id}_po${i + 1}`,
      description: o.description,
      ssp: o.ssp,
      startDate: o.startDate,
      endDate: o.endDate ?? null,
      method: o.method,
      revenueAccountId: o.revenueAccountId ?? "acc_subscription_revenue",
      allocated: allocations[i]!,
    }));

    const startDate = obligations.reduce((min, o) => (o.startDate < min ? o.startDate : min), obligations[0]!.startDate);
    const endDate = obligations.reduce<string>(
      (max, o) => ((o.endDate ?? o.startDate) > max ? o.endDate ?? o.startDate : max),
      obligations[0]!.endDate ?? obligations[0]!.startDate,
    );

    const contract: Contract = {
      id,
      orgId: this.orgId,
      number: input.number,
      customer: input.customer,
      signedDate: input.signedDate,
      startDate,
      endDate,
      currency: input.currency ?? "INR",
      transactionPrice: input.transactionPrice,
      obligations,
      billingFrequency: input.billingFrequency,
      billingSchedule: this.buildBillingSchedule(id, input.billingFrequency, startDate, endDate, input.transactionPrice),
      status: "DRAFT",
      version: 1,
      supersedes: null,
      supersededBy: null,
    };
    this.contracts.set(id, contract);
    this.emit("contract.created", actor, {
      contractId: id,
      number: contract.number,
      customer: contract.customer,
      transactionPrice: contract.transactionPrice.toString(),
      obligations: obligations.length,
    });
    return contract;
  }

  /** DRAFT → ACTIVE. Only active contracts feed revenue recognition. */
  activate(contractId: string, actor: string): Contract {
    const c = this.get(contractId);
    if (c.status !== "DRAFT") throw new ContractError(`Only DRAFT contracts can be activated (${contractId} is ${c.status})`);
    const next: Contract = { ...c, status: "ACTIVE" };
    this.contracts.set(c.id, next);
    this.emit("contract.activated", actor, { contractId: c.id, number: c.number });
    return next;
  }

  /**
   * Contract modification, treated prospectively (ASC 606-10-25-13(a)):
   * the new version carries the revised price and obligations; the old
   * version is marked SUPERSEDED and kept intact for the audit trail.
   * Revenue already recognised under the old version is not disturbed —
   * revrec.ts picks up the new schedule from the modification date.
   */
  amend(contractId: string, input: CreateContractInput, actor: string, reason: string): Contract {
    const original = this.get(contractId);
    if (original.status !== "ACTIVE")
      throw new ContractError(`Only ACTIVE contracts can be amended (${contractId} is ${original.status})`);
    const next = this.create({ ...input, number: original.number }, actor);
    const versioned: Contract = {
      ...next,
      status: "ACTIVE",
      version: original.version + 1,
      supersedes: original.id,
    };
    this.contracts.set(versioned.id, versioned);
    this.contracts.set(original.id, { ...original, status: "SUPERSEDED", supersededBy: versioned.id });
    this.emit("contract.amended", actor, {
      contractId: versioned.id,
      supersedes: original.id,
      version: versioned.version,
      reason,
    });
    return versioned;
  }

  cancel(contractId: string, actor: string, reason: string): Contract {
    const c = this.get(contractId);
    if (c.status === "CANCELLED") throw new ContractError(`Contract ${contractId} is already cancelled`);
    const next: Contract = { ...c, status: "CANCELLED" };
    this.contracts.set(c.id, next);
    this.emit("contract.cancelled", actor, { contractId: c.id, reason });
    return next;
  }

  /** Mark a billing instalment as invoiced (revrec posts the entry). */
  markBilled(contractId: string, billingEventId: string, invoiceId: string): Contract {
    const c = this.get(contractId);
    const schedule = c.billingSchedule.map((b) =>
      b.id === billingEventId ? { ...b, invoiceId } : b,
    );
    if (!schedule.some((b) => b.id === billingEventId))
      throw new ContractError(`Unknown billing event ${billingEventId} on ${contractId}`);
    const next: Contract = { ...c, billingSchedule: schedule };
    this.contracts.set(c.id, next);
    return next;
  }

  get(contractId: string): Contract {
    const c = this.contracts.get(contractId);
    if (!c) throw new ContractError(`Unknown contract ${contractId}`);
    return c;
  }

  all(): readonly Contract[] {
    return [...this.contracts.values()];
  }

  active(): readonly Contract[] {
    return this.all().filter((c) => c.status === "ACTIVE");
  }

  /** Billing events due on or before a date that have not been invoiced. */
  dueForBilling(asOf: string): readonly { contract: Contract; event: BillingEvent }[] {
    const out: { contract: Contract; event: BillingEvent }[] = [];
    for (const c of this.active()) {
      for (const e of c.billingSchedule) {
        if (e.invoiceId === null && e.dueDate <= asOf) out.push({ contract: c, event: e });
      }
    }
    return out.sort((a, b) => a.event.dueDate.localeCompare(b.event.dueDate));
  }

  /**
   * Billing schedule: instalments that sum exactly to the transaction price.
   * Usage- and milestone-billed contracts get no schedule — those bill when
   * the usage is reported or the milestone lands.
   */
  private buildBillingSchedule(
    contractId: string,
    frequency: BillingFrequency,
    startDate: string,
    endDate: string,
    transactionPrice: Paise,
  ): readonly BillingEvent[] {
    if (frequency === "ON_USAGE" || frequency === "MILESTONE") return [];
    if (frequency === "UPFRONT")
      return [
        {
          id: `${contractId}_bill1`,
          dueDate: startDate,
          amount: transactionPrice,
          periodFrom: startDate,
          periodTo: endDate,
          invoiceId: null,
        },
      ];

    const step = MONTHS_PER[frequency]!;
    const boundaries: string[] = [];
    let cursor = startDate;
    while (cursor <= endDate) {
      boundaries.push(cursor);
      cursor = addMonths(cursor, step);
    }
    const n = boundaries.length;
    const per = mulRatio(transactionPrice, 1n, BigInt(n));
    const amounts = Array.from({ length: n }, () => per);
    const drift = sub(transactionPrice, sum(amounts));
    amounts[n - 1] = add(amounts[n - 1]!, drift); // last instalment absorbs rounding

    return boundaries.map((due, i) => {
      const nextBoundary = i + 1 < n ? boundaries[i + 1]! : null;
      return {
        id: `${contractId}_bill${i + 1}`,
        dueDate: due,
        amount: amounts[i]!,
        periodFrom: due,
        periodTo: nextBoundary ? dayBefore(nextBoundary) : endDate,
        invoiceId: null,
      };
    });
  }

  private emit(type: string, actor: string, payload: Record<string, unknown>): void {
    this.bus.emit({ orgId: this.orgId, type, at: new Date().toISOString(), actor, payload });
  }
}

/** Contract term in whole days, inclusive of both ends. */
export const termDays = (startDate: string, endDate: string): number =>
  daysBetween(startDate, endDate) + 1;
