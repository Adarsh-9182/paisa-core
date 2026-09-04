/**
 * Plaid bank feed connector.
 *
 * Split the same way as the billing connectors: `mapTransaction` is pure and
 * takes an already-fetched record, so every mapping rule below is testable
 * against fixtures without a network or a token, and `fetchTransactions` is
 * the only part that talks to Plaid.
 *
 * Two rules make this file careful rather than short.
 *
 *  1. **Sign.** Plaid reports a positive `amount` for money *leaving* a
 *     depository account and a negative one for money arriving — the
 *     opposite of the signed convention `BankLineIn` uses, where positive is
 *     cash in. The sign is flipped here, once, at the boundary. A feed that
 *     gets this backwards reconciles perfectly against a balance that is
 *     wrong by twice every transaction.
 *
 *  2. **Settlement.** A pending transaction is not cash that has moved; the
 *     amount and even the counterparty can still change before it posts, and
 *     the posted copy arrives with a different `transaction_id`. Ingesting
 *     both double-counts the same payment. Pending records are withheld with
 *     a reason rather than dropped, so a sync can explain the gap between
 *     what the bank shows and what the ledger took.
 *
 * Currency follows the rule the Stripe connector set: Plaid reports amounts
 * in major units, and a non-INR account is rejected by name rather than
 * converted at a rate nobody supplied.
 */

import { Paise, paise } from "../money.js";
import { BankLineIn, MappingRejection } from "./connectors.js";

export class PlaidError extends Error {
  override name = "PlaidError";
}

/** The subset of Plaid's Transaction object this connector reads. */
export interface PlaidTransaction {
  readonly transaction_id: string;
  readonly account_id: string;
  /** Major units (rupees), positive when money leaves the account. */
  readonly amount: number;
  readonly iso_currency_code: string | null;
  readonly unofficial_currency_code?: string | null;
  /** Posted date, "YYYY-MM-DD". */
  readonly date: string;
  readonly name: string;
  readonly merchant_name?: string | null;
  readonly pending: boolean;
  /** Set on a posted record that supersedes an earlier pending one. */
  readonly pending_transaction_id?: string | null;
}

export interface PlaidTransactionsPage {
  readonly transactions: readonly PlaidTransaction[];
  readonly total_transactions: number;
}

export interface MappedTransactions {
  readonly lines: readonly BankLineIn[];
  readonly rejected: readonly MappingRejection[];
  /** Deliberately kept out of the feed — pending, with the reason. */
  readonly withheld: readonly MappingRejection[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rupees (major units, possibly fractional) → paise (minor units, exact).
 *
 * Done in string space rather than by multiplying a float: `12.35 * 100` is
 * 1234.9999999999998 in IEEE-754, and a ledger that rounds its way to a
 * one-paise drift on every line will not tie out to the bank.
 */
const toPaise = (rupees: number): Paise => {
  if (!Number.isFinite(rupees)) throw new PlaidError(`Amount is not a finite number: ${rupees}`);
  const [whole = "0", frac = ""] = Math.abs(rupees).toFixed(2).split(".");
  const magnitude = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return paise(rupees < 0 ? -magnitude : magnitude);
};

/** Best available human label, falling back to the raw name rather than inventing one. */
const label = (t: PlaidTransaction): string => t.merchant_name?.trim() || t.name?.trim() || "(no description)";

/**
 * One Plaid transaction → one bank line, a rejection, or a withholding.
 * Pure: no network, no clock, no token.
 */
export const mapTransaction = (
  t: PlaidTransaction,
): { readonly line: BankLineIn } | { readonly rejected: MappingRejection } | { readonly withheld: MappingRejection } => {
  if (!t.transaction_id) return { rejected: { externalId: "(missing id)", reason: "transaction has no transaction_id" } };
  const id = t.transaction_id;

  if (t.pending) {
    return {
      withheld: {
        externalId: id,
        reason: "pending — not settled cash, and the posted copy arrives under a different id",
      },
    };
  }
  if (!t.account_id) return { rejected: { externalId: id, reason: "transaction has no account_id" } };
  if (!ISO_DATE.test(t.date ?? "")) return { rejected: { externalId: id, reason: `unusable date: ${t.date}` } };

  const currency = t.iso_currency_code ?? t.unofficial_currency_code ?? null;
  if (currency === null) return { rejected: { externalId: id, reason: "transaction has no currency" } };
  if (currency.toUpperCase() !== "INR") {
    return {
      rejected: {
        externalId: id,
        reason: `currency is ${currency}, not INR — refusing to convert at a rate nobody supplied`,
      },
    };
  }

  let magnitude: Paise;
  try {
    magnitude = toPaise(t.amount);
  } catch (e) {
    return { rejected: { externalId: id, reason: e instanceof Error ? e.message : String(e) } };
  }
  if (magnitude === 0n) return { rejected: { externalId: id, reason: "zero-amount transaction" } };

  return {
    line: {
      // Namespaced so a Plaid id can never collide with a Stripe id or a bank's own UTR.
      externalId: `plaid:${id}`,
      date: t.date,
      description: label(t),
      // Rule 1: Plaid's positive is money out; the feed's positive is money in.
      amount: paise(-magnitude),
      accountRef: t.account_id,
    },
  };
};

export const mapTransactions = (txns: readonly PlaidTransaction[]): MappedTransactions => {
  const lines: BankLineIn[] = [];
  const rejected: MappingRejection[] = [];
  const withheld: MappingRejection[] = [];

  for (const t of txns) {
    const outcome = mapTransaction(t);
    if ("line" in outcome) lines.push(outcome.line);
    else if ("withheld" in outcome) withheld.push(outcome.withheld);
    else rejected.push(outcome.rejected);
  }

  return { lines, rejected, withheld };
};

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export type PlaidEnvironment = "sandbox" | "development" | "production";

export interface FetchTransactionsOptions {
  readonly clientId: string;
  readonly secret: string;
  /** The Item access token the bank link produced. */
  readonly accessToken: string;
  readonly environment?: PlaidEnvironment;
  readonly startDate: string;
  readonly endDate: string;
  /** Page size Plaid returns per request; 500 is Plaid's maximum. */
  readonly count?: number;
  /** Stop after this many pages, so a long history cannot hang a sync. */
  readonly maxPages?: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const PLAID_HOST: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

/**
 * Walk Plaid's offset pagination and return every posted transaction.
 *
 * Credentials go in the body as Plaid's API requires and are never logged —
 * errors quote Plaid's own `error_message` and status, never the request.
 */
export const fetchTransactions = async (
  opts: FetchTransactionsOptions,
): Promise<readonly PlaidTransaction[]> => {
  if (!opts.clientId || !opts.secret) throw new PlaidError("Plaid client id and secret are both required");
  if (!opts.accessToken) throw new PlaidError("A Plaid access token is required");

  const environment = opts.environment ?? "sandbox";
  if (environment === "production") {
    throw new PlaidError(
      "Refusing to run against Plaid production. Use sandbox until this connector has been reconciled against a real close.",
    );
  }
  for (const [field, value] of [
    ["startDate", opts.startDate],
    ["endDate", opts.endDate],
  ] as const) {
    if (!ISO_DATE.test(value ?? "")) throw new PlaidError(`Invalid "${field}" date: ${value}`);
  }
  if (opts.startDate > opts.endDate) throw new PlaidError("startDate is after endDate");

  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? PLAID_HOST[environment];
  const count = Math.min(Math.max(opts.count ?? 500, 1), 500);
  const maxPages = Math.max(opts.maxPages ?? 20, 1);

  const all: PlaidTransaction[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const res = await doFetch(`${base}/transactions/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: opts.clientId,
        secret: opts.secret,
        access_token: opts.accessToken,
        start_date: opts.startDate,
        end_date: opts.endDate,
        options: { count, offset },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body.slice(0, 300);
      try {
        detail = JSON.parse(body)?.error_message ?? detail;
      } catch {
        /* keep the raw excerpt */
      }
      throw new PlaidError(`Plaid returned ${res.status}: ${detail}`);
    }

    const pageBody = (await res.json()) as PlaidTransactionsPage;
    const data = pageBody.transactions ?? [];
    all.push(...data);
    offset += data.length;

    if (data.length === 0 || offset >= (pageBody.total_transactions ?? offset)) break;
  }

  return all;
};

/** Fetch and map in one call — what a sync route wants. */
export const fetchBankLines = async (opts: FetchTransactionsOptions): Promise<MappedTransactions> =>
  mapTransactions(await fetchTransactions(opts));
