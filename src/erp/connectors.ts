/**
 * Integration layer — Salesforce/HubSpot, Stripe, banks, payroll.
 *
 * Two rules make this safe to point at a live system:
 *
 *  1. Ingestion is idempotent. Every inbound record carries an external id;
 *     replaying a sync creates nothing new. Webhooks retry, exports overlap,
 *     and a finance system that double-books on a retry is worse than one
 *     that never synced at all.
 *
 *  2. Nothing posts to the ledger on arrival. A closed-won deal becomes a
 *     DRAFT contract for a human to review and activate — the revenue
 *     treatment of a deal is an accounting judgement, not a CRM field.
 *     Bank and billing records land in queues the existing engines own.
 *
 * The connectors here are transport-agnostic on purpose: each takes already-
 * fetched records, so the same code paths run against a live API, a nightly
 * file, or a test fixture.
 */

import { Paise } from "../money.js";
import { EventBus } from "../events.js";
import { ContractEngine, RecognitionMethod, BillingFrequency } from "./contracts.js";

export type ConnectorKind = "CRM" | "BILLING" | "BANK" | "PAYROLL" | "EXPENSE";

export class ConnectorError extends Error {
  override name = "ConnectorError";
}

export interface SyncOutcome<T> {
  readonly source: string;
  readonly received: number;
  readonly created: readonly T[];
  /** Already seen on an earlier sync — the idempotency win. */
  readonly duplicates: readonly string[];
  readonly rejected: readonly { readonly externalId: string; readonly reason: string }[];
  readonly at: string;
}

/* ------------------------------------------------------------------ */
/* CRM — closed-won deals become draft revenue contracts               */
/* ------------------------------------------------------------------ */

export interface CrmDeal {
  readonly externalId: string;
  readonly name: string;
  readonly accountName: string;
  readonly closeDate: string;
  readonly amount: Paise;
  readonly startDate: string;
  readonly endDate: string;
  readonly billingFrequency: BillingFrequency;
  /** Optional split; when absent the whole deal is one ratable obligation. */
  readonly lineItems?: readonly {
    readonly description: string;
    readonly ssp: Paise;
    readonly method: RecognitionMethod;
    readonly startDate?: string;
    readonly endDate?: string | null;
    readonly revenueAccountId?: string;
  }[];
}

/* ------------------------------------------------------------------ */
/* Billing — Stripe-shaped charges and invoices                        */
/* ------------------------------------------------------------------ */

export interface BillingRecordIn {
  readonly externalId: string;
  readonly customer: string;
  readonly date: string;
  readonly amount: Paise;
  readonly description: string;
  readonly status: "paid" | "open" | "void" | "refunded";
}

/* ------------------------------------------------------------------ */
/* Bank — statement lines                                              */
/* ------------------------------------------------------------------ */

export interface BankLineIn {
  readonly externalId: string;
  readonly date: string;
  readonly description: string;
  readonly amount: Paise; // signed
  readonly accountRef: string;
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export interface PayrollRunIn {
  readonly externalId: string;
  readonly payDate: string;
  readonly grossPay: Paise;
  readonly employerTaxes: Paise;
  readonly netPay: Paise;
  readonly headcount: number;
}

export interface ConnectorStatus {
  readonly source: string;
  readonly kind: ConnectorKind;
  readonly lastSyncAt: string | null;
  readonly recordsIngested: number;
  readonly duplicatesSkipped: number;
  readonly rejected: number;
  readonly connected: boolean;
}

export class ConnectorHub {
  /** "source|externalId" — the idempotency ledger. */
  private seen = new Set<string>();
  private stats = new Map<string, ConnectorStatus>();

  constructor(
    public readonly orgId: string,
    private contracts: ContractEngine,
    private bus: EventBus,
  ) {}

  register(source: string, kind: ConnectorKind): ConnectorStatus {
    if (this.stats.has(source)) throw new ConnectorError(`Connector ${source} is already registered`);
    const status: ConnectorStatus = {
      source,
      kind,
      lastSyncAt: null,
      recordsIngested: 0,
      duplicatesSkipped: 0,
      rejected: 0,
      connected: true,
    };
    this.stats.set(source, status);
    return status;
  }

  /**
   * Closed-won deals → DRAFT contracts. Deliberately not activated: a human
   * confirms the performance obligations and revenue treatment before
   * anything can reach the general ledger.
   */
  syncCrmDeals(source: string, deals: readonly CrmDeal[], actor: string): SyncOutcome<string> {
    this.assertRegistered(source, "CRM");
    const created: string[] = [];
    const duplicates: string[] = [];
    const rejected: { externalId: string; reason: string }[] = [];

    for (const deal of deals) {
      const key = `${source}|${deal.externalId}`;
      if (this.seen.has(key)) {
        duplicates.push(deal.externalId);
        continue;
      }
      try {
        if (deal.amount <= 0n) throw new ConnectorError("Deal amount must be positive");
        const obligations =
          deal.lineItems && deal.lineItems.length > 0
            ? deal.lineItems.map((li) => ({
                description: li.description,
                ssp: li.ssp,
                startDate: li.startDate ?? deal.startDate,
                endDate: li.endDate === undefined ? deal.endDate : li.endDate,
                method: li.method,
                ...(li.revenueAccountId ? { revenueAccountId: li.revenueAccountId } : {}),
              }))
            : [
                {
                  description: deal.name,
                  ssp: deal.amount,
                  startDate: deal.startDate,
                  endDate: deal.endDate,
                  method: "RATABLE_DAILY" as RecognitionMethod,
                },
              ];
        const contract = this.contracts.create(
          {
            number: `CRM-${deal.externalId}`,
            customer: deal.accountName,
            signedDate: deal.closeDate,
            transactionPrice: deal.amount,
            obligations,
            billingFrequency: deal.billingFrequency,
          },
          actor,
        );
        this.seen.add(key);
        created.push(contract.id);
      } catch (e) {
        rejected.push({ externalId: deal.externalId, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return this.finish(source, deals.length, created, duplicates, rejected, actor, {
      note: "Contracts land as DRAFT — activate after reviewing the revenue treatment",
    });
  }

  /** Billing records are deduplicated and handed back for review. */
  syncBilling(source: string, records: readonly BillingRecordIn[], actor: string): SyncOutcome<BillingRecordIn> {
    this.assertRegistered(source, "BILLING");
    const created: BillingRecordIn[] = [];
    const duplicates: string[] = [];
    const rejected: { externalId: string; reason: string }[] = [];
    for (const r of records) {
      const key = `${source}|${r.externalId}`;
      if (this.seen.has(key)) {
        duplicates.push(r.externalId);
        continue;
      }
      if (r.status === "void") {
        rejected.push({ externalId: r.externalId, reason: "voided at source" });
        continue;
      }
      this.seen.add(key);
      created.push(r);
    }
    return this.finish(source, records.length, created, duplicates, rejected, actor);
  }

  /** Bank lines, deduplicated. Categorisation stays with the bank feed engine. */
  syncBank(source: string, lines: readonly BankLineIn[], actor: string): SyncOutcome<BankLineIn> {
    this.assertRegistered(source, "BANK");
    const created: BankLineIn[] = [];
    const duplicates: string[] = [];
    for (const l of lines) {
      const key = `${source}|${l.externalId}`;
      if (this.seen.has(key)) {
        duplicates.push(l.externalId);
        continue;
      }
      this.seen.add(key);
      created.push(l);
    }
    return this.finish(source, lines.length, created, duplicates, [], actor);
  }

  syncPayroll(source: string, runs: readonly PayrollRunIn[], actor: string): SyncOutcome<PayrollRunIn> {
    this.assertRegistered(source, "PAYROLL");
    const created: PayrollRunIn[] = [];
    const duplicates: string[] = [];
    const rejected: { externalId: string; reason: string }[] = [];
    for (const r of runs) {
      const key = `${source}|${r.externalId}`;
      if (this.seen.has(key)) {
        duplicates.push(r.externalId);
        continue;
      }
      if (r.grossPay <= 0n) {
        rejected.push({ externalId: r.externalId, reason: "gross pay must be positive" });
        continue;
      }
      this.seen.add(key);
      created.push(r);
    }
    return this.finish(source, runs.length, created, duplicates, rejected, actor);
  }

  status(source: string): ConnectorStatus {
    const s = this.stats.get(source);
    if (!s) throw new ConnectorError(`Unknown connector ${source}`);
    return s;
  }

  all(): readonly ConnectorStatus[] {
    return [...this.stats.values()];
  }

  private assertRegistered(source: string, kind: ConnectorKind): void {
    const s = this.stats.get(source);
    if (!s) throw new ConnectorError(`Connector ${source} is not registered`);
    if (s.kind !== kind) throw new ConnectorError(`Connector ${source} is a ${s.kind} connector, not ${kind}`);
  }

  private finish<T>(
    source: string,
    received: number,
    created: readonly T[],
    duplicates: readonly string[],
    rejected: readonly { externalId: string; reason: string }[],
    actor: string,
    extra: Record<string, unknown> = {},
  ): SyncOutcome<T> {
    const at = new Date().toISOString();
    const prev = this.status(source);
    this.stats.set(source, {
      ...prev,
      lastSyncAt: at,
      recordsIngested: prev.recordsIngested + created.length,
      duplicatesSkipped: prev.duplicatesSkipped + duplicates.length,
      rejected: prev.rejected + rejected.length,
    });
    this.bus.emit({
      orgId: this.orgId,
      type: "connector.synced",
      at,
      actor,
      payload: {
        source,
        received,
        created: created.length,
        duplicates: duplicates.length,
        rejected: rejected.length,
        ...extra,
      },
    });
    return { source, received, created, duplicates, rejected, at };
  }
}
