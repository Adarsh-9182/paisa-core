import { describe, expect, it } from "vitest";
import { parseINR, ZERO, formatINR } from "../src/money.js";
import {
  GST_STATES,
  RATE_SCHEDULES,
  addSplits,
  assertLawfulRate,
  gstinCheckDigit,
  isLawfulRate,
  isValidGstin,
  parseGstin,
  pct,
  scheduleOn,
  setOff,
  splitTax,
  taxPostings,
  OUTPUT_TAX_ACCOUNTS,
} from "../src/tax/india.js";

describe("rate schedules are dated, because tax law moves", () => {
  it("accepts 12% before the 2025 rationalisation and refuses it after", () => {
    // The engine was still validating against {0,5,12,18,28} a year after
    // 12% and 28% were abolished — accepting two rates that no longer exist.
    expect(isLawfulRate(1200, "2025-09-21")).toBe(true);
    expect(isLawfulRate(1200, "2025-09-22")).toBe(false);
    expect(isLawfulRate(2800, "2025-09-21")).toBe(true);
    expect(isLawfulRate(2800, "2026-01-01")).toBe(false);
  });

  it("accepts the 40% demerit rate only from the day it existed", () => {
    expect(isLawfulRate(4000, "2025-09-21")).toBe(false);
    expect(isLawfulRate(4000, "2025-09-22")).toBe(true);
  });

  it("keeps the rates that survived", () => {
    for (const date of ["2020-06-30", "2026-09-01"]) {
      for (const bp of [0, 500, 1800]) expect(isLawfulRate(bp, date)).toBe(true);
    }
  });

  it("refuses a date before GST existed rather than guessing a schedule", () => {
    expect(() => scheduleOn("2017-06-30")).toThrow(/GST began/);
  });

  it("names the lawful slabs when it rejects one, so the error is actionable", () => {
    expect(() => assertLawfulRate(1200, "2026-09-01")).toThrow(/12% was not a GST slab.*5%, 18%, 40%/s);
  });

  it("rejects a rate that is not a whole number of basis points", () => {
    expect(() => assertLawfulRate(18.5, "2026-09-01")).toThrow(/whole number/);
  });

  it("renders fractional slabs correctly — the reason rates are basis points", () => {
    expect(pct(1800)).toBe("18%");
    expect(pct(0)).toBe("0%");
    expect(pct(300)).toBe("3%");
    expect(pct(25)).toBe("0.25%");
  });

  it("is ordered oldest-first, which scheduleOn relies on", () => {
    const froms = RATE_SCHEDULES.map((s) => s.from);
    expect([...froms].sort()).toEqual(froms);
  });
});

describe("GSTIN", () => {
  /*
   * Sourced GSTINs, not recalled ones. An earlier pass at this checksum
   * "validated" against six numbers written from memory; four of them were
   * not real GSTINs at all, and the two genuine ones were the only evidence
   * in the whole exercise. These are from published references.
   */
  const REAL = ["27AABCU9603R1ZN", "27AAPFU0939F1ZV", "09AAACH7409R1ZZ"];

  it("computes the published check digit for known GSTINs", () => {
    for (const g of REAL) expect(gstinCheckDigit(g.slice(0, 14))).toBe(g[14]);
  });

  it("weights 1,2 from the left — the direction that is silently wrong", () => {
    // 2,1 produces a plausible check digit that is simply not the right one.
    // Pinning a known-good value stops a future "simplification" flipping it.
    expect(gstinCheckDigit("27AABCU9603R1")).not.toBe("N");
    expect(gstinCheckDigit("27AABCU9603R1Z")).toBe("N");
  });

  it("parses out the state and the embedded PAN", () => {
    const g = parseGstin("27AABCU9603R1ZN");
    expect(g.stateCode).toBe("27");
    expect(g.state.name).toBe("Maharashtra");
    expect(g.pan).toBe("AABCU9603R");
    expect(g.entityCode).toBe("1");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(parseGstin("  27aabcu9603r1zn ").value).toBe("27AABCU9603R1ZN");
  });

  it("rejects a single transposed character", () => {
    // The whole point of a check digit: a typo must not pass.
    expect(isValidGstin("27AABCU9036R1ZN")).toBe(false);
  });

  it("says which check failed, rather than a generic invalid", () => {
    expect(() => parseGstin("27AABCU9603R1ZX")).toThrow(/fails its checksum/);
    expect(() => parseGstin("00AABCU9603R1ZN")).toThrow(/not a GST state code/);
    expect(() => parseGstin("27AABCU9603R1ZNX")).toThrow(/15 characters/);
    expect(() => parseGstin("27AABC09603R1ZN")).toThrow(/not shaped like a GSTIN/);
  });
});

describe("state codes", () => {
  it("covers 01 to 38 with no gaps, plus the two special jurisdictions", () => {
    for (let i = 1; i <= 38; i++) {
      const code = String(i).padStart(2, "0");
      expect(GST_STATES.has(code), `missing state code ${code}`).toBe(true);
    }
    expect(GST_STATES.get("97")?.name).toBe("Other Territory");
    expect(GST_STATES.get("99")?.name).toBe("Centre Jurisdiction");
  });

  it("keeps superseded codes readable instead of rejecting old documents", () => {
    // 25 and 28 were superseded by 26 and 37. A GSTIN on either is old, not
    // invalid, and refusing it would reject a legitimate historical invoice.
    expect(GST_STATES.get("25")?.legacy).toBe(true);
    expect(GST_STATES.get("28")?.legacy).toBe(true);
    expect(GST_STATES.get("27")?.legacy).toBeUndefined();
  });

  it("marks UTs without a legislature as UT, and the three with one as states", () => {
    // Delhi, Puducherry and J&K levy SGST like any state. Getting this wrong
    // never errors — it just posts to the wrong ledger for the rest of time.
    for (const code of ["07", "34", "01"]) expect(GST_STATES.get(code)!.jurisdiction).toBe("state");
    for (const code of ["04", "31", "35", "38", "26"]) expect(GST_STATES.get(code)!.jurisdiction).toBe("ut");
  });
});

describe("splitting the tax", () => {
  const ctx = (supplierState: string, placeOfSupply: string, extra = {}) => ({
    supplierState,
    placeOfSupply,
    date: "2026-09-01",
    ...extra,
  });

  it("charges IGST when the supply crosses a state line", () => {
    const s = splitTax(parseINR("1,00,000"), 1800, ctx("27", "29"));
    expect(s.interState).toBe(true);
    expect(formatINR(s.igst)).toBe("₹18,000.00");
    expect(s.cgst).toBe(ZERO);
    expect(s.sgst).toBe(ZERO);
  });

  it("splits into CGST and SGST when it stays inside one state", () => {
    const s = splitTax(parseINR("1,00,000"), 1800, ctx("27", "27"));
    expect(s.interState).toBe(false);
    expect(formatINR(s.cgst)).toBe("₹9,000.00");
    expect(formatINR(s.sgst)).toBe("₹9,000.00");
    expect(s.igst).toBe(ZERO);
    expect(formatINR(s.total)).toBe("₹18,000.00");
  });

  it("uses UTGST inside a Union Territory without a legislature", () => {
    const s = splitTax(parseINR("1,00,000"), 1800, ctx("04", "04")); // Chandigarh
    expect(formatINR(s.utgst)).toBe("₹9,000.00");
    expect(s.sgst).toBe(ZERO);
  });

  it("uses SGST inside Delhi, which is a UT with a legislature", () => {
    const s = splitTax(parseINR("1,00,000"), 1800, ctx("07", "07"));
    expect(formatINR(s.sgst)).toBe("₹9,000.00");
    expect(s.utgst).toBe(ZERO);
  });

  it("computes each half on its own, as the law defines it", () => {
    /*
     * Each half is computed at half the rate and rounded on its own, so at
     * sub-rupee values the two heads together need not equal the tax a
     * single full-rate computation gives — and the gap runs in *both*
     * directions, which is why it cannot be papered over with a correction.
     *
     * 3 paise at 18%: full rate is 0.54 paise → 1; each half is 0.27 → 0,
     * so the halves total 0 and the IGST equivalent is 1.
     * 3 paise at 40%: full rate is 1.2 → 1; each half is 0.6 → 1, so the
     * halves total 2 against an IGST equivalent of 1.
     *
     * The difference is real. The two halves go to different governments
     * and each must report the number its own rate produces; averaging it
     * away would be neater and wrong.
     */
    const three = parseINR("0.03");

    const low = splitTax(three, 1800, ctx("27", "27"));
    expect(low.cgst).toBe(low.sgst);
    expect(low.total).toBe(ZERO);
    expect(splitTax(three, 1800, ctx("27", "29")).igst - low.total).toBe(1n);

    const high = splitTax(three, 4000, ctx("27", "27"));
    expect(high.total - splitTax(three, 4000, ctx("27", "29")).igst).toBe(1n);
  });

  it("treats a zero-rated export as inter-state with no tax, not as rate zero", () => {
    // "No tax due" and "zero-rated export" are different things: only one of
    // them supports a refund claim, and GSTR-1 reports them in different
    // tables.
    const s = splitTax(parseINR("5,00,000"), 1800, ctx("27", "27", { zeroRated: true }));
    expect(s.interState).toBe(true);
    expect(s.total).toBe(ZERO);
    expect(s.rateBp).toBe(0);
  });

  it("refuses an unknown state code rather than guessing intra-state", () => {
    expect(() => splitTax(parseINR("100"), 1800, ctx("27", "50"))).toThrow(/Place of supply "50"/);
    expect(() => splitTax(parseINR("100"), 1800, ctx("50", "27"))).toThrow(/Supplier state "50"/);
  });

  it("refuses a rate that was not lawful on the date of supply", () => {
    expect(() => splitTax(parseINR("100"), 1200, ctx("27", "27"))).toThrow(/not a GST slab/);
  });

  it("adds up lines at different rates", () => {
    const lines = [
      splitTax(parseINR("1,00,000"), 1800, ctx("27", "27")),
      splitTax(parseINR("50,000"), 500, ctx("27", "27")),
    ];
    const t = addSplits(lines);
    expect(formatINR(t.cgst)).toBe("₹10,250.00"); // 9,000 + 1,250
    expect(formatINR(t.total)).toBe("₹20,500.00");
  });
});

describe("postings", () => {
  it("posts each levy to its own account and omits the zero ones", () => {
    // Collapsing the levies into one "GST Payable" destroys the only
    // information needed to compute what is payable in cash.
    const s = splitTax(parseINR("1,00,000"), 1800, { supplierState: "27", placeOfSupply: "27", date: "2026-09-01" });
    const posts = taxPostings(s, OUTPUT_TAX_ACCOUNTS);
    expect(posts.map((p) => p.accountId)).toEqual(["acc_gst_output_cgst", "acc_gst_output_sgst"]);
  });

  it("puts IGST first, so an inter-state invoice reads in set-off order", () => {
    const s = splitTax(parseINR("1,00,000"), 1800, { supplierState: "27", placeOfSupply: "29", date: "2026-09-01" });
    expect(taxPostings(s, OUTPUT_TAX_ACCOUNTS)[0]!.accountId).toBe("acc_gst_output_igst");
  });
});

describe("set-off", () => {
  const M = (cgst: string, sgst: string, igst: string, utgst = "0") => ({
    cgst: parseINR(cgst),
    sgst: parseINR(sgst),
    utgst: parseINR(utgst),
    igst: parseINR(igst),
  });

  it("uses each head against itself first", () => {
    const r = setOff(M("10,000", "10,000", "0"), M("4,000", "4,000", "0"));
    expect(formatINR(r.payable.cgst)).toBe("₹6,000.00");
    expect(formatINR(r.payable.sgst)).toBe("₹6,000.00");
    expect(formatINR(r.cashPayable)).toBe("₹12,000.00");
  });

  it("spills surplus IGST credit to CGST, then SGST, in that order", () => {
    // ₹15,000 of IGST credit against ₹10,000 CGST and ₹10,000 SGST: CGST is
    // cleared first, and only the ₹5,000 left over reaches SGST.
    const r = setOff(M("10,000", "10,000", "0"), M("0", "0", "15,000"));
    expect(formatINR(r.payable.cgst)).toBe("₹0.00");
    expect(formatINR(r.payable.sgst)).toBe("₹5,000.00");
    expect(formatINR(r.cashPayable)).toBe("₹5,000.00");
  });

  it("never pays an SGST bill with CGST credit", () => {
    // The case that surprises people: a business can hold a large credit
    // balance and still owe cash, because these heads do not cross.
    const r = setOff(M("0", "10,000", "0"), M("50,000", "0", "0"));
    expect(formatINR(r.payable.sgst)).toBe("₹10,000.00");
    expect(formatINR(r.cashPayable)).toBe("₹10,000.00");
    expect(formatINR(r.creditCarried.cgst)).toBe("₹50,000.00");
  });

  it("exhausts IGST liability before letting IGST credit touch anything else", () => {
    const r = setOff(M("5,000", "5,000", "8,000"), M("0", "0", "10,000"));
    expect(formatINR(r.payable.igst)).toBe("₹0.00");
    expect(formatINR(r.payable.cgst)).toBe("₹3,000.00"); // only ₹2,000 spilled over
    expect(formatINR(r.payable.sgst)).toBe("₹5,000.00");
  });

  it("carries unused credit forward rather than dropping it", () => {
    const r = setOff(M("1,000", "1,000", "0"), M("5,000", "5,000", "0"));
    expect(formatINR(r.creditCarried.cgst)).toBe("₹4,000.00");
    expect(formatINR(r.creditCarried.sgst)).toBe("₹4,000.00");
    expect(r.cashPayable).toBe(ZERO);
  });
});
