/**
 * Stripe billing connector.
 *
 * Split in two on purpose, matching the rule the rest of connectors.ts
 * follows: `mapCharge` is pure and takes an already-fetched record, so the
 * mapping is testable against fixtures without a network or a key, and
 * `fetchCharges` is the only part that talks to Stripe.
 *
 * The currency rule is the reason this file is careful rather than short.
 * Stripe reports `amount` in the smallest unit of its own currency — paise
 * for INR, cents for USD. Paise and cents are not interchangeable, and a
 * ledger that treats one as the other is wrong by an exchange rate while
 * looking perfectly reconciled. So a charge in any currency other than INR
 * is rejected by name rather than converted at a rate nobody supplied.
 * Refusing is recoverable; a silently mis-booked charge is not.
 */

import { Paise, paise } from "../money.js";
import { BillingRecordIn } from "./connectors.js";

export class StripeError extends Error {
  override name = "StripeError";
}

/** The subset of Stripe's Charge object this connector reads. */
export interface StripeCharge {
  readonly id: string;
  /** Smallest unit of `currency` — paise when currency is "inr". */
  readonly amount: number;
  readonly currency: string;
  /** Unix seconds. */
  readonly created: number;
  readonly status: "succeeded" | "pending" | "failed";
  readonly refunded?: boolean;
  readonly amount_refunded?: number;
  readonly description?: string | null;
  readonly customer?: string | null;
  readonly billing_details?: { readonly name?: string | null; readonly email?: string | null } | null;
  readonly receipt_email?: string | null;
}

export interface StripePage {
  readonly data: readonly StripeCharge[];
  readonly has_more: boolean;
}

/** A charge that could not be mapped, kept with the reason rather than dropped. */
export interface MappingRejection {
  readonly externalId: string;
  readonly reason: string;
}

export interface MappedCharges {
  readonly records: readonly BillingRecordIn[];
  readonly rejected: readonly MappingRejection[];
}

const isoDate = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * Stripe's own vocabulary for where a charge stands, translated into the
 * four states the billing queue understands. A fully refunded charge is
 * "refunded"; a partial refund stays "paid", because the money did arrive
 * and the refund is its own movement.
 */
const mapStatus = (c: StripeCharge): BillingRecordIn["status"] => {
  if (c.refunded === true) return "refunded";
  if (c.status === "failed") return "void";
  if (c.status === "pending") return "open";
  return "paid";
};

/** Best available human label, falling back to the id rather than inventing one. */
const customerLabel = (c: StripeCharge): string =>
  c.billing_details?.name?.trim() ||
  c.billing_details?.email?.trim() ||
  c.receipt_email?.trim() ||
  c.customer ||
  "Unknown customer";

/**
 * One charge → one billing record, or a rejection explaining why not.
 * Pure: no network, no clock, no key.
 */
export const mapCharge = (c: StripeCharge): BillingRecordIn | MappingRejection => {
  if (!c.id) return { externalId: "(missing id)", reason: "charge has no id" };

  const currency = (c.currency ?? "").toLowerCase();
  if (currency !== "inr")
    return {
      externalId: c.id,
      reason:
        `charge is in ${currency.toUpperCase() || "an unknown currency"}, not INR — ` +
        "Stripe reports the smallest unit of its own currency, and converting it here " +
        "would put a rate nobody supplied into the ledger",
    };

  if (!Number.isInteger(c.amount))
    return { externalId: c.id, reason: `amount ${c.amount} is not an integer number of paise` };
  if (c.amount < 0)
    return { externalId: c.id, reason: `amount ${c.amount} is negative` };

  let amount: Paise;
  try {
    amount = paise(BigInt(c.amount));
  } catch (e) {
    return { externalId: c.id, reason: e instanceof Error ? e.message : String(e) };
  }

  return {
    externalId: c.id,
    customer: customerLabel(c),
    date: isoDate(c.created),
    amount,
    description: c.description?.trim() || "Stripe charge",
    status: mapStatus(c),
  };
};

const isRejection = (v: BillingRecordIn | MappingRejection): v is MappingRejection =>
  (v as MappingRejection).reason !== undefined;

/** Map a batch, keeping the rejects alongside rather than silently dropping them. */
export const mapCharges = (charges: readonly StripeCharge[]): MappedCharges => {
  const records: BillingRecordIn[] = [];
  const rejected: MappingRejection[] = [];
  for (const c of charges) {
    const out = mapCharge(c);
    if (isRejection(out)) rejected.push(out);
    else records.push(out);
  }
  return { records, rejected };
};

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export interface FetchChargesOptions {
  readonly secretKey: string;
  /** Page size Stripe returns per request; 100 is Stripe's maximum. */
  readonly limit?: number;
  /** Stop after this many pages, so a huge account cannot hang a sync. */
  readonly maxPages?: number;
  /** Only charges created on or after this date (inclusive). */
  readonly since?: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Walk Stripe's cursor pagination and return every charge.
 *
 * The key is sent as a bearer token and never logged — errors quote
 * Stripe's message and status, never the request headers.
 */
export const fetchCharges = async (opts: FetchChargesOptions): Promise<readonly StripeCharge[]> => {
  if (!opts.secretKey) throw new StripeError("A Stripe secret key is required");
  if (opts.secretKey.startsWith("sk_live_"))
    throw new StripeError(
      "Refusing to run against a live Stripe key. Use a test key (sk_test_…) until this connector has been reconciled against a real close.",
    );

  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? STRIPE_API;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100);
  const maxPages = Math.max(opts.maxPages ?? 20, 1);

  const all: StripeCharge[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (startingAfter) qs.set("starting_after", startingAfter);
    if (opts.since) {
      const gte = Math.floor(new Date(`${opts.since}T00:00:00Z`).getTime() / 1000);
      if (!Number.isFinite(gte)) throw new StripeError(`Invalid "since" date: ${opts.since}`);
      qs.set("created[gte]", String(gte));
    }

    const res = await doFetch(`${base}/charges?${qs}`, {
      headers: { Authorization: `Bearer ${opts.secretKey}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body.slice(0, 300);
      try {
        detail = JSON.parse(body)?.error?.message ?? detail;
      } catch {
        /* keep the raw excerpt */
      }
      throw new StripeError(`Stripe returned ${res.status}: ${detail}`);
    }

    const pageBody = (await res.json()) as StripePage;
    const data = pageBody.data ?? [];
    all.push(...data);

    if (!pageBody.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1]?.id;
    if (!startingAfter) break;
  }

  return all;
};

/** Fetch and map in one call — what a sync route wants. */
export const fetchBillingRecords = async (opts: FetchChargesOptions): Promise<MappedCharges> =>
  mapCharges(await fetchCharges(opts));

/* ------------------------------------------------------------------ */
/* Billing records → the bank feed the AI CFO actually reads           */
/* ------------------------------------------------------------------ */

/**
 * A bank feed is a record of cash that has moved, so only settled charges
 * belong in one: `paid` is money in, `refunded` is money back out. An `open`
 * charge has not settled — it is a receivable, and putting it here would
 * overstate the bank balance, which is the same class of error as inventing
 * a figure. Those are returned separately rather than silently dropped.
 */
export interface BankFeedLines {
  readonly lines: readonly {
    readonly date: string;
    readonly description: string;
    readonly amount: Paise;
    readonly reference: string;
  }[];
  /** Records deliberately kept out of the bank feed, with the reason. */
  readonly withheld: readonly MappingRejection[];
}

export const toBankLines = (records: readonly BillingRecordIn[]): BankFeedLines => {
  const lines: BankFeedLines["lines"] = [];
  const withheld: MappingRejection[] = [];

  for (const r of records) {
    if (r.status === "open") {
      withheld.push({
        externalId: r.externalId,
        reason: "charge has not settled — a receivable, not cash in the bank",
      });
      continue;
    }
    if (r.status === "void") {
      withheld.push({ externalId: r.externalId, reason: "voided at source" });
      continue;
    }
    (lines as { date: string; description: string; amount: Paise; reference: string }[]).push({
      date: r.date,
      description: `${r.customer} — ${r.description}`,
      // Refunds are cash leaving, so they carry the opposite sign.
      amount: r.status === "refunded" ? paise(-r.amount) : r.amount,
      // Namespaced so a Stripe id can never collide with a bank's own UTR.
      reference: `stripe:${r.externalId}`,
    });
  }

  return { lines, withheld };
};
