/**
 * Indian GST — the statutory core.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE WEDGE
 *
 * Rillet does not do tax. Its own integrations page hands tax to Avalara,
 * Anrok and Rise, and its accounting is ASC 606 and US GAAP. There is no
 * GST in it, no place-of-supply, no GSTR-1. That is not an oversight on
 * their part — it is a market choice — but it means the compliance work an
 * Indian finance team actually spends its month on is the one thing a
 * NetSuite-replacement cannot take off them.
 *
 * So this is not a feature. It is the reason to exist.
 *
 * WHAT WAS WRONG BEFORE THIS FILE
 *
 * src/gst.ts computed one lump `gstAmount` per invoice and credited it to a
 * single `acc_gst_payable`. Under Indian law there is no such tax. A supply
 * attracts either CGST + SGST (or UTGST) when it stays inside one state, or
 * IGST when it crosses a state line — three legally distinct levies, three
 * separate ledgers, and set-off rules between them that are not free. An
 * invoice booked as a single lump cannot be filed in GSTR-1, cannot be
 * matched to a supplier's GSTR-2B, and gives the wrong ITC. Every
 * interstate invoice the engine has ever produced was structurally wrong,
 * not slightly wrong.
 *
 * SOURCES, AND WHY THE RATES ARE DATED
 *
 * Tax rates are law, and law changes. On 22 September 2025 the slabs were
 * cut from four to two-plus-one: 12% and 28% were abolished, 40% was added
 * for demerit goods. The engine was still validating against
 * {0, 5, 12, 18, 28} a year later — accepting two rates that no longer
 * exist and rejecting three that do.
 *
 * The lesson is not "update the numbers". It is that a rate table with no
 * effective date silently misfiles every historical period the moment the
 * law moves. An invoice issued in August 2025 must still validate against
 * the slabs that were in force in August 2025. Hence RATE_SCHEDULES below,
 * ordered and dated, rather than a constant.
 *
 * Verified 2026-09-01 against: PIB press note on the September 2025
 * rationalisation, and secondary reporting (Fonoa, ClearTax, India
 * Briefing, Tally) which agree on nil / 3% / 5% / 18% / 40%.
 */

import { Paise, ZERO, add, mulRatio, sub, sum } from "../money.js";

export class TaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxError";
  }
}

// ------------------------------------------------------------
// RATES
//
// Basis points, not percent. 0.25% (rough precious stones) and 3% (gold and
// silver) are real slabs, so an integer percent cannot represent the rate
// table — and a float cannot be trusted anywhere near money.
// ------------------------------------------------------------

/** A GST rate in basis points: 1800 = 18%. */
export type RateBp = number;

export interface RateSchedule {
  /** ISO date this schedule takes effect. */
  readonly from: string;
  readonly slabs: readonly RateBp[];
  readonly note: string;
}

/**
 * Ordered oldest-first. A supply is validated against the schedule in force
 * on its own date of supply, never against "now".
 */
export const RATE_SCHEDULES: readonly RateSchedule[] = [
  {
    from: "2017-07-01",
    slabs: [0, 25, 300, 500, 1200, 1800, 2800],
    note: "Original four-slab structure (5/12/18/28) plus 0.25% rough stones and 3% precious metals.",
  },
  {
    from: "2025-09-22",
    slabs: [0, 300, 500, 1800, 4000],
    note:
      "GST rationalisation: 12% and 28% abolished, 40% demerit rate added. " +
      "0.25% on rough precious stones could not be confirmed as surviving the reform and is " +
      "therefore not accepted after this date — if a rough-stone supply is rejected, that is " +
      "this line to check, not a bug in the caller.",
  },
];

/** The rate schedule in force on a date. */
export function scheduleOn(dateISO: string): RateSchedule {
  let found: RateSchedule | undefined;
  for (const s of RATE_SCHEDULES) {
    if (dateISO >= s.from) found = s;
  }
  if (!found) throw new TaxError(`No GST rate schedule in force on ${dateISO} — GST began 2017-07-01`);
  return found;
}

/** Whether a rate was a lawful slab on the date of supply. */
export const isLawfulRate = (rateBp: RateBp, dateISO: string): boolean =>
  scheduleOn(dateISO).slabs.includes(rateBp);

export function assertLawfulRate(rateBp: RateBp, dateISO: string): void {
  if (!Number.isInteger(rateBp) || rateBp < 0)
    throw new TaxError(`GST rate must be a non-negative whole number of basis points, got ${rateBp}`);
  if (!isLawfulRate(rateBp, dateISO)) {
    const slabs = scheduleOn(dateISO).slabs.map(pct).join(", ");
    throw new TaxError(`${pct(rateBp)} was not a GST slab on ${dateISO} — lawful slabs were ${slabs}`);
  }
}

/** 1800 → "18%", 25 → "0.25%". */
export const pct = (rateBp: RateBp): string => {
  const whole = Math.trunc(rateBp / 100);
  const frac = rateBp % 100;
  return frac === 0 ? `${whole}%` : `${(rateBp / 100).toFixed(2).replace(/0$/, "")}%`;
};

// ------------------------------------------------------------
// PLACE OF SUPPLY
// ------------------------------------------------------------

/**
 * Union Territories without a legislature levy UTGST instead of SGST
 * (CGST Act / UTGST Act). Delhi, Puducherry and Jammu & Kashmir have
 * legislatures and levy SGST like any state — a distinction that only
 * shows up as a wrong ledger line, never as an error.
 */
export type Jurisdiction = "state" | "ut";

export interface StateInfo {
  readonly code: string;
  readonly name: string;
  readonly jurisdiction: Jurisdiction;
  /**
   * Codes kept alive only for historical documents. 25 (Daman & Diu) and 28
   * (the old Andhra Pradesh) were superseded by 26 and 37 — a GSTIN on
   * either is not invalid, it is old, and rejecting it would refuse a
   * legitimate historical invoice.
   */
  readonly legacy?: true;
}

const S = (code: string, name: string, jurisdiction: Jurisdiction = "state", legacy?: true): StateInfo => ({
  code,
  name,
  jurisdiction,
  ...(legacy ? { legacy } : {}),
});

/** Verified 2026-09-01 against the published GST state-code table. */
export const GST_STATES: ReadonlyMap<string, StateInfo> = new Map(
  (
    [
      S("01", "Jammu & Kashmir"), // UT *with* legislature — levies SGST
      S("02", "Himachal Pradesh"),
      S("03", "Punjab"),
      S("04", "Chandigarh", "ut"),
      S("05", "Uttarakhand"),
      S("06", "Haryana"),
      S("07", "Delhi"), // UT with legislature — levies SGST
      S("08", "Rajasthan"),
      S("09", "Uttar Pradesh"),
      S("10", "Bihar"),
      S("11", "Sikkim"),
      S("12", "Arunachal Pradesh"),
      S("13", "Nagaland"),
      S("14", "Manipur"),
      S("15", "Mizoram"),
      S("16", "Tripura"),
      S("17", "Meghalaya"),
      S("18", "Assam"),
      S("19", "West Bengal"),
      S("20", "Jharkhand"),
      S("21", "Odisha"),
      S("22", "Chhattisgarh"),
      S("23", "Madhya Pradesh"),
      S("24", "Gujarat"),
      S("25", "Daman & Diu", "ut", true),
      S("26", "Dadra & Nagar Haveli and Daman & Diu", "ut"),
      S("27", "Maharashtra"),
      S("28", "Andhra Pradesh", "state", true),
      S("29", "Karnataka"),
      S("30", "Goa"),
      S("31", "Lakshadweep", "ut"),
      S("32", "Kerala"),
      S("33", "Tamil Nadu"),
      S("34", "Puducherry"), // UT with legislature — levies SGST
      S("35", "Andaman & Nicobar Islands", "ut"),
      S("36", "Telangana"),
      S("37", "Andhra Pradesh"),
      S("38", "Ladakh", "ut"),
      S("97", "Other Territory", "ut"),
      S("99", "Centre Jurisdiction", "ut"),
    ] as const
  ).map((s) => [s.code, s] as const),
);

export const stateName = (code: string): string => GST_STATES.get(code)?.name ?? `Unknown state code ${code}`;

// ------------------------------------------------------------
// GSTIN
// ------------------------------------------------------------

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The 15th character of a GSTIN is a Luhn mod-36 check over the first 14:
 * each character's value is weighted 1, 2, 1, 2 … from the left, each
 * product is reduced to floor(p/36) + p%36, and the check digit is whatever
 * makes the total a multiple of 36.
 *
 * The weighting direction is the part that is easy to get wrong and
 * impossible to notice: 2,1 instead of 1,2 produces a plausible-looking
 * check digit that is simply not the right one. Verified against published
 * GSTINs rather than against itself — see the test.
 */
export function gstinCheckDigit(first14: string): string {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const value = CHARSET.indexOf(first14[i]!);
    if (value < 0) throw new TaxError(`GSTIN contains "${first14[i]}", which is not 0-9 or A-Z`);
    const product = value * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (total % 36)) % 36]!;
}

export interface Gstin {
  readonly value: string;
  readonly stateCode: string;
  readonly state: StateInfo;
  /** The holder's PAN, which is embedded in every GSTIN. */
  readonly pan: string;
  /** Registration count for this PAN within the state. */
  readonly entityCode: string;
}

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * Parse and fully validate a GSTIN, offline.
 *
 * Worth stating plainly: this proves the number is well-formed and
 * self-consistent, not that it is registered, active, or belongs to the
 * counterparty who gave it to you. Only the GST portal can say that. A
 * checksum that passes is a reason to accept a document into the ledger; it
 * is not a reason to claim input tax credit against it.
 */
export function parseGstin(input: string): Gstin {
  const value = input.trim().toUpperCase();
  if (value.length !== 15) throw new TaxError(`A GSTIN is 15 characters; "${input}" is ${value.length}`);
  if (!GSTIN_SHAPE.test(value)) throw new TaxError(`"${input}" is not shaped like a GSTIN (SSPPPPPPPPPPEZC)`);

  const stateCode = value.slice(0, 2);
  const state = GST_STATES.get(stateCode);
  if (!state) throw new TaxError(`"${stateCode}" is not a GST state code`);

  const expected = gstinCheckDigit(value.slice(0, 14));
  if (value[14] !== expected)
    throw new TaxError(`GSTIN ${value} fails its checksum — expected "${expected}", found "${value[14]}"`);

  return { value, stateCode, state, pan: value.slice(2, 12), entityCode: value[12]! };
}

export function isValidGstin(input: string): boolean {
  try {
    parseGstin(input);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// THE SPLIT
// ------------------------------------------------------------

/** How a supply's tax breaks across the three levies. Exactly one shape is non-zero. */
export interface TaxSplit {
  readonly cgst: Paise;
  readonly sgst: Paise;
  readonly utgst: Paise;
  readonly igst: Paise;
  readonly total: Paise;
  readonly interState: boolean;
  readonly rateBp: RateBp;
}

export const EMPTY_SPLIT: Omit<TaxSplit, "rateBp" | "interState"> = {
  cgst: ZERO,
  sgst: ZERO,
  utgst: ZERO,
  igst: ZERO,
  total: ZERO,
};

export interface SupplyContext {
  /** The supplier's registered state code — where the invoice is raised from. */
  readonly supplierState: string;
  /** Where the supply is deemed to take place. For B2B, the recipient's state. */
  readonly placeOfSupply: string;
  /** Date of supply, which selects the rate schedule. */
  readonly date: string;
  /**
   * Zero-rated: exports and SEZ supplies. Treated as inter-state at a nil
   * effective rate under an LUT. Set this rather than passing rate 0 — the
   * distinction between "no tax due" and "zero-rated export" is the whole
   * of a refund claim, and GSTR-1 reports them in different tables.
   */
  readonly zeroRated?: boolean;
}

/**
 * Split the tax on a taxable value.
 *
 * Intra-state splits into CGST and SGST (or UTGST). Each half is computed at
 * half the rate and rounded on its own, which is how the law describes it.
 * At sub-rupee values that means the two heads together need not equal the
 * tax a single full-rate computation gives — and the gap runs in both
 * directions: 3 paise at 18% splits to 0 + 0 against an IGST equivalent of
 * 1, while 3 paise at 40% splits to 1 + 1 against the same 1.
 *
 * That difference must not be "fixed" by computing the total and halving
 * it. The two heads go to different governments, and the number reported
 * for each has to be the number the law defines for each.
 */
export function splitTax(taxableValue: Paise, rateBp: RateBp, ctx: SupplyContext): TaxSplit {
  assertLawfulRate(rateBp, ctx.date);

  const supplier = GST_STATES.get(ctx.supplierState);
  if (!supplier) throw new TaxError(`Supplier state "${ctx.supplierState}" is not a GST state code`);
  const pos = GST_STATES.get(ctx.placeOfSupply);
  if (!pos) throw new TaxError(`Place of supply "${ctx.placeOfSupply}" is not a GST state code`);

  if (ctx.zeroRated) {
    // Zero-rated supplies are inter-state by definition, whatever the codes say.
    return { ...EMPTY_SPLIT, interState: true, rateBp: 0 };
  }

  const interState = ctx.supplierState !== ctx.placeOfSupply;

  if (interState) {
    const igst = mulRatio(taxableValue, BigInt(rateBp), 10_000n);
    return { ...EMPTY_SPLIT, igst, total: igst, interState: true, rateBp };
  }

  const half = mulRatio(taxableValue, BigInt(rateBp), 20_000n);
  const isUt = pos.jurisdiction === "ut";
  return {
    cgst: half,
    sgst: isUt ? ZERO : half,
    utgst: isUt ? half : ZERO,
    igst: ZERO,
    total: add(half, half),
    interState: false,
    rateBp,
  };
}

/** Add splits together — for an invoice with lines at different rates. */
export function addSplits(splits: readonly TaxSplit[]): Omit<TaxSplit, "rateBp"> {
  return {
    cgst: sum(splits.map((s) => s.cgst)),
    sgst: sum(splits.map((s) => s.sgst)),
    utgst: sum(splits.map((s) => s.utgst)),
    igst: sum(splits.map((s) => s.igst)),
    total: sum(splits.map((s) => s.total)),
    interState: splits.some((s) => s.interState),
  };
}

/**
 * The ledger accounts each levy posts to.
 *
 * Separate accounts are not bookkeeping neatness. CGST credit cannot be set
 * off against SGST liability at all, and the IGST→CGST→SGST set-off order is
 * prescribed. Collapsing them into one "GST Payable" destroys the only
 * information needed to compute what is actually payable in cash.
 */
export const OUTPUT_TAX_ACCOUNTS = {
  cgst: "acc_gst_output_cgst",
  sgst: "acc_gst_output_sgst",
  utgst: "acc_gst_output_utgst",
  igst: "acc_gst_output_igst",
} as const;

export const INPUT_TAX_ACCOUNTS = {
  cgst: "acc_gst_itc_cgst",
  sgst: "acc_gst_itc_sgst",
  utgst: "acc_gst_itc_utgst",
  igst: "acc_gst_itc_igst",
} as const;

/** Non-zero levies as ledger postings, in a stable order. */
export function taxPostings(
  split: Omit<TaxSplit, "rateBp" | "interState">,
  accounts: typeof OUTPUT_TAX_ACCOUNTS | typeof INPUT_TAX_ACCOUNTS,
): readonly { accountId: string; amount: Paise }[] {
  return (["igst", "cgst", "sgst", "utgst"] as const)
    .map((levy) => ({ accountId: accounts[levy], amount: split[levy] }))
    .filter((p) => p.amount !== ZERO);
}

/**
 * What is payable in cash after set-off, per the prescribed order.
 *
 * IGST credit is used first, and must be exhausted against IGST liability
 * before it can touch CGST, then SGST. CGST and SGST credit can only be used
 * against their own head — a CGST surplus can never pay an SGST bill, which
 * is why a business can hold a large credit balance and still owe cash.
 */
export interface SetOff {
  readonly payable: { cgst: Paise; sgst: Paise; utgst: Paise; igst: Paise };
  readonly creditCarried: { cgst: Paise; sgst: Paise; utgst: Paise; igst: Paise };
  readonly cashPayable: Paise;
}

export function setOff(
  output: { cgst: Paise; sgst: Paise; utgst: Paise; igst: Paise },
  credit: { cgst: Paise; sgst: Paise; utgst: Paise; igst: Paise },
): SetOff {
  const use = (liability: Paise, available: Paise): [Paise, Paise, Paise] => {
    const applied = liability < available ? liability : available;
    return [sub(liability, applied), sub(available, applied), applied];
  };

  let [igstDue, igstCredit] = use(output.igst, credit.igst);
  let [cgstDue, cgstCredit] = use(output.cgst, credit.cgst);
  let [sgstDue, sgstCredit] = use(output.sgst, credit.sgst);
  const [utgstDue, utgstCredit] = use(output.utgst, credit.utgst);

  // Leftover IGST credit spills to CGST, then SGST — in that order, by rule.
  [cgstDue, igstCredit] = use(cgstDue, igstCredit);
  [sgstDue, igstCredit] = use(sgstDue, igstCredit);

  return {
    payable: { cgst: cgstDue, sgst: sgstDue, utgst: utgstDue, igst: igstDue },
    creditCarried: { cgst: cgstCredit, sgst: sgstCredit, utgst: utgstCredit, igst: igstCredit },
    cashPayable: sum([igstDue, cgstDue, sgstDue, utgstDue]),
  };
}
