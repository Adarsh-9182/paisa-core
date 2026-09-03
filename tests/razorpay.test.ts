/**
 * Razorpay connector — mapping, fees, and transport.
 *
 * The three differences from Stripe get the most attention here, because each
 * produces a plausible wrong number rather than an error: Basic auth instead
 * of a bearer token, an offset walk that can skip a record, and a fee that is
 * deducted before settlement.
 */

import { describe, it, expect } from "vitest";
import { formatINR } from "../src/money.js";
import {
  mapPayment,
  mapPayments,
  settlementOf,
  settlementTotals,
  fetchPayments,
  fetchRazorpayBillingRecords,
  RazorpayError,
  type RazorpayPayment,
} from "../src/erp/razorpay.js";

const payment = (over: Partial<RazorpayPayment> = {}): RazorpayPayment => ({
  id: "pay_1",
  amount: 12_50_000, // ₹12,500.00 in paise
  currency: "INR",
  status: "captured",
  created_at: Math.floor(Date.parse("2026-07-14T09:30:00Z") / 1000),
  description: "Platform subscription",
  email: "ops@meridian.in",
  ...over,
});

const asRecord = (p: RazorpayPayment) => {
  const out = mapPayment(p);
  if ("reason" in out) throw new Error(`expected a record, got rejection: ${out.reason}`);
  return out;
};

const asRejection = (p: RazorpayPayment) => {
  const out = mapPayment(p);
  if (!("reason" in out)) throw new Error("expected a rejection, got a record");
  return out;
};

describe("mapPayment", () => {
  it("maps a captured INR payment, keeping the amount exact", () => {
    const r = asRecord(payment({ notes: { customer_name: "Meridian Retail" } }));
    expect(r.externalId).toBe("pay_1");
    expect(r.customer).toBe("Meridian Retail");
    expect(r.date).toBe("2026-07-14");
    expect(r.status).toBe("paid");
    expect(formatINR(r.amount)).toBe("₹12,500.00");
  });

  it("refuses a non-INR payment rather than converting it", () => {
    const r = asRejection(payment({ id: "pay_usd", currency: "USD" }));
    expect(r.reason).toContain("USD");
    expect(r.reason).toContain("not INR");
  });

  it("treats an authorized payment as open — the money is held, not captured", () => {
    // Booking this as paid would count money that has not moved as cash.
    expect(asRecord(payment({ status: "authorized" })).status).toBe("open");
    expect(asRecord(payment({ status: "created" })).status).toBe("open");
  });

  it("maps failed to void and refunded to refunded", () => {
    expect(asRecord(payment({ status: "failed" })).status).toBe("void");
    expect(asRecord(payment({ status: "refunded" })).status).toBe("refunded");
  });

  it("treats a fully refunded capture as refunded even when the status still says captured", () => {
    expect(asRecord(payment({ status: "captured", amount_refunded: 12_50_000 })).status).toBe("refunded");
  });

  it("leaves a partial refund as paid, because the money did arrive", () => {
    expect(asRecord(payment({ status: "captured", amount_refunded: 5_000 })).status).toBe("paid");
  });

  it("falls back through notes, email, then contact — never inventing a customer", () => {
    expect(asRecord(payment({ notes: { customer_name: "Meridian" } })).customer).toBe("Meridian");
    expect(asRecord(payment({ notes: null })).customer).toBe("ops@meridian.in");
    expect(asRecord(payment({ notes: null, email: null, contact: "+919876543210" })).customer).toBe(
      "+919876543210",
    );
    expect(asRecord(payment({ notes: null, email: null, contact: null })).customer).toBe("Unknown customer");
  });

  it("rejects negative and fractional amounts", () => {
    expect(asRejection(payment({ amount: -100 })).reason).toContain("negative");
    expect(asRejection(payment({ amount: 10.5 })).reason).toContain("not an integer");
  });

  it("keeps rejections beside records instead of dropping them", () => {
    const { records, rejected } = mapPayments([payment({ id: "pay_ok" }), payment({ id: "pay_eur", currency: "EUR" })]);
    expect(records.map((r) => r.externalId)).toEqual(["pay_ok"]);
    expect(rejected.map((r) => r.externalId)).toEqual(["pay_eur"]);
  });
});

describe("settlementOf — the fee is deducted before the money arrives", () => {
  // ₹12,500 charged, ₹236 fee of which ₹36 is GST.
  const withFee = payment({ amount: 12_50_000, fee: 23_600, tax: 3_600 });

  it("reports what actually reaches the bank, not what the customer paid", () => {
    const s = settlementOf(withFee);
    expect(formatINR(s.gross)).toBe("₹12,500.00");
    expect(formatINR(s.net)).toBe("₹12,264.00");
  });

  it("splits the GST out of the fee, because it is input credit and not expense", () => {
    // Booking the whole fee to expense overstates the cost and throws away a claim.
    const s = settlementOf(withFee);
    expect(formatINR(s.fee)).toBe("₹236.00");
    expect(formatINR(s.gstOnFee)).toBe("₹36.00");
    expect(formatINR(s.feeExGst)).toBe("₹200.00");
  });

  it("does not double-count the GST, which is already inside the fee", () => {
    const s = settlementOf(withFee);
    expect(s.feeExGst + s.gstOnFee).toBe(s.fee);
    expect(s.net + s.fee).toBe(s.gross);
  });

  it("handles a payment with no fee reported", () => {
    const s = settlementOf(payment({ fee: null, tax: null }));
    expect(s.net).toBe(s.gross);
  });

  it("refuses a payment claiming more GST than fee", () => {
    expect(() => settlementOf(payment({ fee: 100, tax: 500 }))).toThrow(RazorpayError);
  });
});

describe("settlementTotals", () => {
  it("totals only captured money, because authorized money has not moved", () => {
    const t = settlementTotals([
      payment({ id: "p1", amount: 10_00_000, fee: 20_000, tax: 3_000, status: "captured" }),
      payment({ id: "p2", amount: 10_00_000, fee: 20_000, tax: 3_000, status: "authorized" }),
      payment({ id: "p3", amount: 10_00_000, fee: 20_000, tax: 3_000, status: "failed" }),
    ]);
    expect(formatINR(t.gross)).toBe("₹10,000.00");
    expect(formatINR(t.fee)).toBe("₹200.00");
    expect(formatINR(t.net)).toBe("₹9,800.00");
  });

  it("nets to zero for an empty batch rather than throwing", () => {
    const t = settlementTotals([]);
    expect(t.gross).toBe(0n);
    expect(t.net).toBe(0n);
  });
});

describe("fetchPayments", () => {
  const ok = (items: RazorpayPayment[]) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ count: items.length, items }),
      text: async () => JSON.stringify({ items }),
    }) as Response;

  const creds = { keyId: "rzp_test_abc", keySecret: "secret_xyz" };

  it("refuses a live key outright", async () => {
    await expect(fetchPayments({ ...creds, keyId: "rzp_live_abc" })).rejects.toBeInstanceOf(RazorpayError);
  });

  it("requires both halves of the credential", async () => {
    await expect(fetchPayments({ keyId: "", keySecret: "x" })).rejects.toThrow(/required/i);
    await expect(fetchPayments({ keyId: "rzp_test_x", keySecret: "" })).rejects.toThrow(/required/i);
  });

  it("authenticates with Basic, not Bearer, and never puts the secret in the URL", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = String((init.headers as Record<string, string>).Authorization);
      return ok([]);
    }) as unknown as typeof fetch;

    await fetchPayments({ ...creds, fetchImpl });

    expect(capturedAuth).toBe(`Basic ${Buffer.from("rzp_test_abc:secret_xyz").toString("base64")}`);
    expect(capturedUrl).not.toContain("secret_xyz");
  });

  it("pins an upper bound on the window so an offset walk cannot skip a record", async () => {
    // Without `to`, a payment captured between page one and page two shifts
    // every later page by one and a record drops out of the walk entirely.
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return ok([]);
    }) as unknown as typeof fetch;

    await fetchPayments({ ...creds, fetchImpl, to: "2026-08-01" });
    expect(seen[0]).toContain(`to=${Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000)}`);
  });

  it("walks by offset and stops on a short page", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      const full = Array.from({ length: 100 }, (_, i) => payment({ id: `pay_${seen.length}_${i}` }));
      return seen.length === 1 ? ok(full) : ok([payment({ id: "pay_last" })]);
    }) as unknown as typeof fetch;

    const all = await fetchPayments({ ...creds, fetchImpl });
    expect(all).toHaveLength(101);
    expect(seen[0]).toContain("skip=0");
    expect(seen[1]).toContain("skip=100");
    expect(seen).toHaveLength(2);
  });

  it("stops at maxPages so one sync cannot run forever", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return ok(Array.from({ length: 100 }, (_, i) => payment({ id: `p_${calls}_${i}` })));
    }) as unknown as typeof fetch;

    await fetchPayments({ ...creds, fetchImpl, maxPages: 3 });
    expect(calls).toBe(3);
  });

  it("refuses a window that runs backwards", async () => {
    await expect(
      fetchPayments({ ...creds, from: "2026-08-01", to: "2026-07-01" }),
    ).rejects.toThrow(/is after/);
  });

  it("surfaces Razorpay's own description, not the raw body", async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { description: "Authentication failed" } }),
      }) as Response) as unknown as typeof fetch;

    await expect(fetchPayments({ ...creds, fetchImpl })).rejects.toThrow(/401.*Authentication failed/);
  });

  it("fetches and maps in one step", async () => {
    const fetchImpl = (async () =>
      ok([payment({ id: "pay_a" }), payment({ id: "pay_gbp", currency: "GBP" })])) as unknown as typeof fetch;

    const { records, rejected } = await fetchRazorpayBillingRecords({ ...creds, fetchImpl });
    expect(records).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
