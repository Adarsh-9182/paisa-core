/**
 * Razorpay billing connector.
 *
 * Same shape as the Stripe connector — a pure `mapPayment` over already-
 * fetched records, and a `fetchPayments` that is the only part touching the
 * network — but Razorpay differs from Stripe in three ways that each cause a
 * different wrong number if they are assumed away.
 *
 * 1. Authentication is HTTP Basic with `key_id:key_secret`, not a bearer
 *    token. A key pasted into an Authorization header as a bearer simply gets
 *    a 401, which is the harmless failure; the harmful one is putting the
 *    secret in a query string, so it is never built into a URL here.
 *
 * 2. Pagination is offset-based (`count` and `skip`), not a cursor. Offsets
 *    are only stable if the underlying list is, and a payments list is not —
 *    a payment captured mid-walk shifts every later page by one and a record
 *    is silently skipped. So the walk is anchored to a closed time window
 *    (`from`/`to`) rather than trusting the offset alone.
 *
 * 3. Razorpay deducts its fee and the GST on that fee *before* settling, so
 *    the amount of a payment is not the amount that reaches the bank. This is
 *    the one that quietly breaks a reconciliation: booking the gross against
 *    a bank line that is net leaves a difference equal to the fee, on every
 *    single transaction. `settlementOf` returns the net, and the fee and its
 *    GST are kept separately so they can be booked as the expense and input
 *    credit they actually are.
 *
 * The currency rule from the Stripe connector applies unchanged: `amount` is
 * the smallest unit of its own currency, so a non-INR payment is refused by
 * name rather than converted at a rate nobody supplied.
 */

import { Paise, paise, sub } from "../money.js";
import { BillingRecordIn, MappingRejection } from "./connectors.js";

export class RazorpayError extends Error {
  override name = "RazorpayError";
}

/** The subset of Razorpay's Payment object this connector reads. */
export interface RazorpayPayment {
  readonly id: string;
  /** Smallest unit of `currency` — paise when currency is "INR". */
  readonly amount: number;
  readonly currency: string;
  readonly status: "created" | "authorized" | "captured" | "refunded" | "failed";
  /** Unix seconds. */
  readonly created_at: number;
  readonly description?: string | null;
  readonly email?: string | null;
  readonly contact?: string | null;
  readonly amount_refunded?: number;
  /** Razorpay's cut, in the same unit as `amount`. */
  readonly fee?: number | null;
  /** GST charged on `fee`, already included in it. */
  readonly tax?: number | null;
  readonly notes?: Readonly<Record<string, string>> | null;
}

export interface RazorpayPage {
  readonly count: number;
  readonly items: readonly RazorpayPayment[];
}

export interface MappedPayments {
  readonly records: readonly BillingRecordIn[];
  readonly rejected: readonly MappingRejection[];
}

const isoDate = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * Razorpay's vocabulary translated into the four states the billing queue
 * understands.
 *
 * `authorized` is the one worth naming: the money is held on the customer's
 * card but has not been captured, so it is not cash and not yet revenue. It
 * maps to "open" — a receivable — rather than "paid", which is the same
 * distinction the Stripe connector draws for a pending charge.
 */
const mapStatus = (p: RazorpayPayment): BillingRecordIn["status"] => {
  if (p.status === "failed") return "void";
  if (p.status === "refunded") return "refunded";
  // A full refund can also arrive as a captured payment with the whole amount
  // refunded, so the amounts are checked rather than only the status word.
  if (p.status === "captured" && (p.amount_refunded ?? 0) >= p.amount) return "refunded";
  if (p.status === "captured") return "paid";
  return "open"; // created, authorized
};

/** Best available human label, falling back to the id rather than inventing one. */
const customerLabel = (p: RazorpayPayment): string =>
  p.notes?.["customer_name"]?.trim() ||
  p.email?.trim() ||
  p.contact?.trim() ||
  "Unknown customer";

/** One payment → one billing record, or a rejection explaining why not. Pure. */
export const mapPayment = (p: RazorpayPayment): BillingRecordIn | MappingRejection => {
  if (!p.id) return { externalId: "(missing id)", reason: "payment has no id" };

  const currency = (p.currency ?? "").toUpperCase();
  if (currency !== "INR")
    return {
      externalId: p.id,
      reason:
        `payment is in ${currency || "an unknown currency"}, not INR — ` +
        "Razorpay reports the smallest unit of its own currency, and converting it here " +
        "would put a rate nobody supplied into the ledger",
    };

  if (!Number.isInteger(p.amount))
    return { externalId: p.id, reason: `amount ${p.amount} is not an integer number of paise` };
  if (p.amount < 0) return { externalId: p.id, reason: `amount ${p.amount} is negative` };

  let amount: Paise;
  try {
    amount = paise(BigInt(p.amount));
  } catch (e) {
    return { externalId: p.id, reason: e instanceof Error ? e.message : String(e) };
  }

  return {
    externalId: p.id,
    customer: customerLabel(p),
    date: isoDate(p.created_at),
    amount,
    description: p.description?.trim() || "Razorpay payment",
    status: mapStatus(p),
  };
};

const isRejection = (v: BillingRecordIn | MappingRejection): v is MappingRejection =>
  (v as MappingRejection).reason !== undefined;

/** Map a batch, keeping the rejects alongside rather than silently dropping them. */
export const mapPayments = (payments: readonly RazorpayPayment[]): MappedPayments => {
  const records: BillingRecordIn[] = [];
  const rejected: MappingRejection[] = [];
  for (const p of payments) {
    const out = mapPayment(p);
    if (isRejection(out)) rejected.push(out);
    else records.push(out);
  }
  return { records, rejected };
};

/* ------------------------------------------------------------------ */
/* Fees and settlement                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a payment is actually worth once Razorpay has taken its cut.
 *
 * `fee` already includes `tax`: Razorpay reports the total deduction as the
 * fee and the GST component of it separately, so subtracting both would
 * double-count the tax. The gateway charge net of GST is `fee - tax`, and the
 * GST is input credit rather than an expense — booking the whole fee to
 * expense overstates the cost and throws away a claim.
 */
export interface PaymentSettlement {
  readonly externalId: string;
  /** What the customer paid. */
  readonly gross: Paise;
  /** Razorpay's charge, GST included. */
  readonly fee: Paise;
  /** The GST inside `fee` — input credit, not expense. */
  readonly gstOnFee: Paise;
  /** `fee - gstOnFee` — the gateway charge itself. */
  readonly feeExGst: Paise;
  /** `gross - fee` — what actually reaches the bank. */
  readonly net: Paise;
}

export const settlementOf = (p: RazorpayPayment): PaymentSettlement => {
  const gross = paise(BigInt(Math.trunc(p.amount)));
  const fee = paise(BigInt(Math.trunc(p.fee ?? 0)));
  const gstOnFee = paise(BigInt(Math.trunc(p.tax ?? 0)));
  if (gstOnFee > fee)
    throw new RazorpayError(
      `Payment ${p.id} reports GST (${gstOnFee}) larger than the fee (${fee}) it is part of`,
    );
  return {
    externalId: p.id,
    gross,
    fee,
    gstOnFee,
    feeExGst: sub(fee, gstOnFee),
    net: sub(gross, fee),
  };
};

/**
 * Why there is no `toBankLines` here, unlike the Stripe connector.
 *
 * Razorpay does not settle per payment. It batches a day's captures into one
 * transfer, so a bank statement carries one line for many payments and no
 * line matches any single payment's amount. Emitting a bank line per payment
 * would fill the reconciliation queue with lines that can never match, which
 * is worse than having none — the queue is only useful while everything in it
 * is expected to clear.
 *
 * Settlements come from Razorpay's own settlements endpoint and belong in a
 * connector of their own. Until that exists, these payments are billing
 * records only, and the bank side stays empty rather than wrong.
 */
export const settlementTotals = (
  payments: readonly RazorpayPayment[],
): { readonly gross: Paise; readonly fee: Paise; readonly gstOnFee: Paise; readonly net: Paise } => {
  let gross = paise(0n);
  let fee = paise(0n);
  let gstOnFee = paise(0n);
  for (const p of payments) {
    // Only captured money settles; an authorized payment has not moved.
    if (p.status !== "captured") continue;
    const s = settlementOf(p);
    gross = paise(gross + s.gross);
    fee = paise(fee + s.fee);
    gstOnFee = paise(gstOnFee + s.gstOnFee);
  }
  return { gross, fee, gstOnFee, net: sub(gross, fee) };
};

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export interface FetchPaymentsOptions {
  readonly keyId: string;
  readonly keySecret: string;
  /** Page size; 100 is Razorpay's maximum. */
  readonly count?: number;
  readonly maxPages?: number;
  /** Inclusive lower bound on capture date. */
  readonly from?: string;
  /** Inclusive upper bound. Defaults to the start of today, see below. */
  readonly to?: string;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const RAZORPAY_API = "https://api.razorpay.com/v1";

const unixStart = (d: string): number => {
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new RazorpayError(`Invalid date: ${d}`);
  return Math.floor(ms / 1000);
};

/**
 * Walk Razorpay's offset pagination within a closed time window.
 *
 * The window is what makes an offset walk safe. `skip` counts from the newest
 * record, so a payment captured between page one and page two shifts every
 * later page by one and drops a record out of the walk entirely. Pinning `to`
 * means the set being paged cannot grow underneath the cursor.
 *
 * Credentials are sent as Basic auth and never logged — errors quote
 * Razorpay's own message and status, never the request headers.
 */
export const fetchPayments = async (opts: FetchPaymentsOptions): Promise<readonly RazorpayPayment[]> => {
  if (!opts.keyId || !opts.keySecret) throw new RazorpayError("A Razorpay key id and secret are required");
  if (opts.keyId.startsWith("rzp_live_"))
    throw new RazorpayError(
      "Refusing to run against a live Razorpay key. Use a test key (rzp_test_…) until this connector has been reconciled against a real close.",
    );

  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? RAZORPAY_API;
  const count = Math.min(Math.max(opts.count ?? 100, 1), 100);
  const maxPages = Math.max(opts.maxPages ?? 20, 1);
  const auth = Buffer.from(`${opts.keyId}:${opts.keySecret}`, "utf8").toString("base64");

  const to = opts.to ? unixStart(opts.to) : Math.floor(Date.now() / 1000);
  const from = opts.from ? unixStart(opts.from) : undefined;
  if (from !== undefined && from > to)
    throw new RazorpayError(`"from" (${opts.from}) is after "to" (${opts.to ?? "now"})`);

  const all: RazorpayPayment[] = [];
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ count: String(count), skip: String(page * count), to: String(to) });
    if (from !== undefined) qs.set("from", String(from));

    const res = await doFetch(`${base}/payments?${qs}`, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body.slice(0, 300);
      try {
        detail = JSON.parse(body)?.error?.description ?? detail;
      } catch {
        /* keep the raw excerpt */
      }
      throw new RazorpayError(`Razorpay returned ${res.status}: ${detail}`);
    }

    const body = (await res.json()) as RazorpayPage;
    const items = body.items ?? [];
    all.push(...items);
    // A short page is the last page: Razorpay has no has_more flag.
    if (items.length < count) break;
  }

  return all;
};

/** Fetch and map in one call — what a sync route wants. */
export const fetchRazorpayBillingRecords = async (opts: FetchPaymentsOptions): Promise<MappedPayments> =>
  mapPayments(await fetchPayments(opts));
