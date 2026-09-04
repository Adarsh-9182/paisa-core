/**
 * Gusto payroll connector.
 *
 * Same split as the billing and bank connectors: `mapPayroll` is pure and
 * takes an already-fetched record, so every rule below is testable against
 * fixtures without a network or a token, and `fetchPayrolls` is the only
 * part that talks to Gusto.
 *
 * Three rules make this file careful rather than short.
 *
 *  1. **Processed only.** Gusto exposes a payroll long before it runs, and
 *     the totals on an unprocessed one still move — an employee is added, a
 *     bonus is keyed in, a correction lands. A draft payroll is not a cash
 *     event, and booking one accrues a number that was never paid.
 *     Unprocessed runs are withheld with a reason, not dropped, so a sync
 *     can explain why the ledger is lighter than the payroll dashboard.
 *
 *  2. **Money is decimal text, never a float.** Gusto reports totals as
 *     decimal strings in major units ("18450.75"). Parsing those to a
 *     JS number and multiplying by 100 drifts — the conversion happens in
 *     string space, exactly.
 *
 *  3. **Currency is refused, not converted.** Gusto reports USD. A rupee
 *     ledger that takes a dollar figure at face value is wrong by an
 *     exchange rate while looking perfectly reconciled, so a non-INR run is
 *     rejected by name rather than converted at a rate nobody supplied.
 *     For Indian payroll this connector's mapping shape is what RazorpayX
 *     and Zoho Payroll feed into — the refusal is the boundary working, not
 *     a gap.
 */

import { Paise, paise } from "../money.js";
import { PayrollRunIn, MappingRejection } from "./connectors.js";

export class GustoError extends Error {
  override name = "GustoError";
}

/** The subset of Gusto's Payroll object this connector reads. */
export interface GustoPayroll {
  readonly payroll_uuid: string;
  /** The date employees are paid, "YYYY-MM-DD". */
  readonly check_date: string;
  readonly processed: boolean;
  readonly processed_date?: string | null;
  readonly totals?: {
    /** Decimal strings in major units. */
    readonly gross_pay?: string | null;
    readonly net_pay?: string | null;
    readonly employer_taxes?: string | null;
    readonly employee_taxes?: string | null;
  } | null;
  readonly employee_compensations?: readonly {
    readonly employee_uuid: string;
    readonly excluded?: boolean;
    readonly gross_pay?: string | null;
  }[];
  /** Gusto reports USD; carried so the refusal below can name it. */
  readonly currency?: string | null;
}

export interface GustoPayrollsPage {
  readonly payrolls: readonly GustoPayroll[];
}

export interface MappedPayrolls {
  readonly runs: readonly PayrollRunIn[];
  readonly rejected: readonly MappingRejection[];
  /** Deliberately kept out — unprocessed, with the reason. */
  readonly withheld: readonly MappingRejection[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Decimal major units → paise, in string space.
 *
 * `18450.75 * 100` is not 1845075 in IEEE-754, and a payroll that lands a
 * paise off will not tie out against the bank debit that paid it.
 */
const toPaise = (text: string): Paise => {
  const t = text.trim();
  if (!DECIMAL.test(t)) throw new GustoError(`Amount is not a decimal number: ${text}`);
  const negative = t.startsWith("-");
  const [whole = "0", frac = ""] = t.replace(/^-/, "").split(".");
  const magnitude = BigInt(whole) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return paise(negative ? -magnitude : magnitude);
};

/** Employees actually paid on this run — an excluded or zero-pay row is not headcount. */
const headcountOf = (p: GustoPayroll): number => {
  const rows = p.employee_compensations ?? [];
  const paid = new Set<string>();
  for (const r of rows) {
    if (r.excluded === true) continue;
    const gross = (r.gross_pay ?? "").trim();
    if (!gross || !DECIMAL.test(gross) || toPaise(gross) === 0n) continue;
    paid.add(r.employee_uuid);
  }
  return paid.size;
};

/**
 * One Gusto payroll → one payroll run, a rejection, or a withholding.
 * Pure: no network, no clock, no token.
 */
export const mapPayroll = (
  p: GustoPayroll,
): { readonly run: PayrollRunIn } | { readonly rejected: MappingRejection } | { readonly withheld: MappingRejection } => {
  if (!p.payroll_uuid) return { rejected: { externalId: "(missing id)", reason: "payroll has no payroll_uuid" } };
  const id = p.payroll_uuid;

  if (!p.processed) {
    return {
      withheld: {
        externalId: id,
        reason: "not processed — a draft payroll's totals still move, and none of it has been paid",
      },
    };
  }
  if (!ISO_DATE.test(p.check_date ?? "")) return { rejected: { externalId: id, reason: `unusable check_date: ${p.check_date}` } };

  const currency = (p.currency ?? "INR").toUpperCase();
  if (currency !== "INR") {
    return {
      rejected: {
        externalId: id,
        reason: `currency is ${currency}, not INR — refusing to convert at a rate nobody supplied`,
      },
    };
  }

  const totals = p.totals ?? {};
  let grossPay: Paise;
  let netPay: Paise;
  let employerTaxes: Paise;
  try {
    if (!totals.gross_pay) return { rejected: { externalId: id, reason: "payroll has no gross_pay total" } };
    if (!totals.net_pay) return { rejected: { externalId: id, reason: "payroll has no net_pay total" } };
    grossPay = toPaise(totals.gross_pay);
    netPay = toPaise(totals.net_pay);
    employerTaxes = toPaise(totals.employer_taxes ?? "0");
  } catch (e) {
    return { rejected: { externalId: id, reason: e instanceof Error ? e.message : String(e) } };
  }

  if (grossPay <= 0n) return { rejected: { externalId: id, reason: "gross pay must be positive" } };
  if (netPay < 0n) return { rejected: { externalId: id, reason: "net pay cannot be negative" } };
  // Net is gross minus what was withheld, so net above gross means the totals
  // disagree with each other — book that and the payroll expense is wrong.
  if (netPay > grossPay) {
    return { rejected: { externalId: id, reason: "net pay exceeds gross pay — totals disagree" } };
  }
  if (employerTaxes < 0n) return { rejected: { externalId: id, reason: "employer taxes cannot be negative" } };

  return {
    run: {
      // Namespaced so a Gusto id can never collide with another connector's.
      externalId: `gusto:${id}`,
      payDate: p.check_date,
      grossPay,
      employerTaxes,
      netPay,
      headcount: headcountOf(p),
    },
  };
};

export const mapPayrolls = (payrolls: readonly GustoPayroll[]): MappedPayrolls => {
  const runs: PayrollRunIn[] = [];
  const rejected: MappingRejection[] = [];
  const withheld: MappingRejection[] = [];

  for (const p of payrolls) {
    const outcome = mapPayroll(p);
    if ("run" in outcome) runs.push(outcome.run);
    else if ("withheld" in outcome) withheld.push(outcome.withheld);
    else rejected.push(outcome.rejected);
  }

  return { runs, rejected, withheld };
};

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export type GustoEnvironment = "demo" | "production";

export interface FetchPayrollsOptions {
  readonly accessToken: string;
  readonly companyId: string;
  readonly environment?: GustoEnvironment;
  readonly startDate: string;
  readonly endDate: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const GUSTO_HOST: Record<GustoEnvironment, string> = {
  demo: "https://api.gusto-demo.com",
  production: "https://api.gusto.com",
};

/**
 * Fetch the processed payrolls in a date range.
 *
 * The token is sent as a bearer credential and never logged — errors quote
 * Gusto's own message and status, never the request headers.
 */
export const fetchPayrolls = async (opts: FetchPayrollsOptions): Promise<readonly GustoPayroll[]> => {
  if (!opts.accessToken) throw new GustoError("A Gusto access token is required");
  if (!opts.companyId) throw new GustoError("A Gusto company id is required");

  const environment = opts.environment ?? "demo";
  if (environment === "production") {
    throw new GustoError(
      "Refusing to run against Gusto production. Use the demo environment until this connector has been reconciled against a real close.",
    );
  }
  for (const [field, value] of [
    ["startDate", opts.startDate],
    ["endDate", opts.endDate],
  ] as const) {
    if (!ISO_DATE.test(value ?? "")) throw new GustoError(`Invalid "${field}" date: ${value}`);
  }
  if (opts.startDate > opts.endDate) throw new GustoError("startDate is after endDate");

  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? GUSTO_HOST[environment];
  const qs = new URLSearchParams({
    start_date: opts.startDate,
    end_date: opts.endDate,
    processing_statuses: "processed",
  });

  const res = await doFetch(`${base}/v1/companies/${encodeURIComponent(opts.companyId)}/payrolls?${qs}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.message ?? parsed?.error_message ?? detail;
    } catch {
      /* keep the raw excerpt */
    }
    throw new GustoError(`Gusto returned ${res.status}: ${detail}`);
  }

  const parsed = (await res.json()) as GustoPayroll[] | GustoPayrollsPage;
  return Array.isArray(parsed) ? parsed : (parsed.payrolls ?? []);
};

/** Fetch and map in one call — what a sync route wants. */
export const fetchPayrollRuns = async (opts: FetchPayrollsOptions): Promise<MappedPayrolls> =>
  mapPayrolls(await fetchPayrolls(opts));
