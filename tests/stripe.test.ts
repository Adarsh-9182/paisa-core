/**
 * Stripe connector — mapping and transport.
 *
 * The mapping half is pure, so every currency and status case is checked
 * against fixtures. The transport half is checked with an injected fetch,
 * so pagination and error handling are covered without a key or a network.
 */

import { describe, it, expect } from "vitest";
import { formatINR } from "../src/money.js";
import {
  mapCharge,
  mapCharges,
  fetchCharges,
  fetchBillingRecords,
  toBankLines,
  StripeError,
  type StripeCharge,
} from "../src/erp/stripe.js";

const charge = (over: Partial<StripeCharge> = {}): StripeCharge => ({
  id: "ch_1",
  amount: 12_50_000, // ₹12,500.00 in paise
  currency: "inr",
  created: Math.floor(Date.parse("2026-07-14T09:30:00Z") / 1000),
  status: "succeeded",
  description: "Platform subscription",
  billing_details: { name: "Meridian Retail" },
  ...over,
});

const asRecord = (c: StripeCharge) => {
  const out = mapCharge(c);
  if ("reason" in out) throw new Error(`expected a record, got rejection: ${out.reason}`);
  return out;
};

const asRejection = (c: StripeCharge) => {
  const out = mapCharge(c);
  if (!("reason" in out)) throw new Error("expected a rejection, got a record");
  return out;
};

describe("mapCharge", () => {
  it("maps a paid INR charge, keeping the amount exact", () => {
    const r = asRecord(charge());
    expect(r.externalId).toBe("ch_1");
    expect(r.customer).toBe("Meridian Retail");
    expect(r.date).toBe("2026-07-14");
    expect(r.status).toBe("paid");
    expect(formatINR(r.amount)).toBe("₹12,500.00");
  });

  it("refuses a non-INR charge rather than converting it", () => {
    // Stripe reports cents here, not paise. Booking 12_50_000 as paise would
    // be wrong by an exchange rate while still balancing.
    const r = asRejection(charge({ id: "ch_usd", currency: "usd" }));
    expect(r.externalId).toBe("ch_usd");
    expect(r.reason).toContain("USD");
    expect(r.reason).toContain("not INR");
  });

  it("treats a fully refunded charge as refunded, a partial refund as still paid", () => {
    expect(asRecord(charge({ refunded: true })).status).toBe("refunded");
    expect(asRecord(charge({ refunded: false, amount_refunded: 5000 })).status).toBe("paid");
  });

  it("maps pending to open and failed to void", () => {
    expect(asRecord(charge({ status: "pending" })).status).toBe("open");
    expect(asRecord(charge({ status: "failed" })).status).toBe("void");
  });

  it("falls back through name, email, then customer id — never inventing a customer", () => {
    expect(asRecord(charge({ billing_details: { email: "ops@meridian.in" } })).customer).toBe("ops@meridian.in");
    expect(asRecord(charge({ billing_details: null, customer: "cus_42" })).customer).toBe("cus_42");
    expect(asRecord(charge({ billing_details: null, customer: null })).customer).toBe("Unknown customer");
  });

  it("rejects negative and fractional amounts", () => {
    expect(asRejection(charge({ amount: -100 })).reason).toContain("negative");
    expect(asRejection(charge({ amount: 10.5 })).reason).toContain("not an integer");
  });

  it("keeps rejections beside records instead of dropping them", () => {
    const { records, rejected } = mapCharges([
      charge({ id: "ch_ok" }),
      charge({ id: "ch_eur", currency: "eur" }),
    ]);
    expect(records.map((r) => r.externalId)).toEqual(["ch_ok"]);
    expect(rejected.map((r) => r.externalId)).toEqual(["ch_eur"]);
  });
});

describe("toBankLines", () => {
  const rec = (over: Partial<ReturnType<typeof asRecord>> = {}) => ({ ...asRecord(charge()), ...over });

  it("turns a settled charge into money arriving, namespaced so it cannot collide with a bank UTR", () => {
    const { lines } = toBankLines([rec()]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.reference).toBe("stripe:ch_1");
    expect(lines[0]!.description).toBe("Meridian Retail — Platform subscription");
    expect(formatINR(lines[0]!.amount)).toBe("₹12,500.00");
    expect(lines[0]!.amount > 0n).toBe(true);
  });

  it("reverses the sign on a refund, because that is cash leaving", () => {
    const { lines } = toBankLines([rec({ status: "refunded" })]);
    expect(lines[0]!.amount < 0n).toBe(true);
    expect(formatINR(lines[0]!.amount)).toBe("-₹12,500.00");
  });

  it("keeps an unsettled charge out of the bank feed — it is a receivable, not cash", () => {
    const { lines, withheld } = toBankLines([rec({ status: "open" })]);
    expect(lines).toHaveLength(0);
    expect(withheld[0]!.reason).toContain("receivable");
  });

  it("withholds rather than drops, so nothing vanishes without a reason", () => {
    const { lines, withheld } = toBankLines([
      rec({ externalId: "ch_paid" }),
      rec({ externalId: "ch_open", status: "open" }),
      rec({ externalId: "ch_void", status: "void" }),
    ]);
    expect(lines.map((l) => l.reference)).toEqual(["stripe:ch_paid"]);
    expect(withheld.map((w) => w.externalId)).toEqual(["ch_open", "ch_void"]);
  });
});

describe("fetchCharges", () => {
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

  it("refuses a live key outright", async () => {
    await expect(fetchCharges({ secretKey: "sk_live_abc" })).rejects.toBeInstanceOf(StripeError);
  });

  it("requires a key", async () => {
    await expect(fetchCharges({ secretKey: "" })).rejects.toThrow(/required/i);
  });

  it("follows the cursor until has_more is false", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(String(url));
      return String(url).includes("starting_after=ch_2")
        ? ok({ data: [charge({ id: "ch_3" })], has_more: false })
        : ok({ data: [charge({ id: "ch_1" }), charge({ id: "ch_2" })], has_more: true });
    }) as unknown as typeof fetch;

    const all = await fetchCharges({ secretKey: "sk_test_x", fetchImpl, baseUrl: "https://stub/v1" });
    expect(all.map((c) => c.id)).toEqual(["ch_1", "ch_2", "ch_3"]);
    expect(seen[1]).toContain("starting_after=ch_2");
  });

  it("stops at maxPages so one sync cannot run forever", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return ok({ data: [charge({ id: `ch_${calls}` })], has_more: true });
    }) as unknown as typeof fetch;

    await fetchCharges({ secretKey: "sk_test_x", fetchImpl, maxPages: 3 });
    expect(calls).toBe(3);
  });

  it("sends the key as a bearer token and never in the URL", async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = String((init.headers as Record<string, string>).Authorization);
      return ok({ data: [], has_more: false });
    }) as unknown as typeof fetch;

    await fetchCharges({ secretKey: "sk_test_secret", fetchImpl });
    expect(capturedUrl).not.toContain("sk_test_secret");
    expect(capturedAuth).toBe("Bearer sk_test_secret");
  });

  it("surfaces Stripe's own error message, not the raw body", async () => {
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: "Invalid API Key provided" } }),
      }) as Response) as unknown as typeof fetch;

    await expect(fetchCharges({ secretKey: "sk_test_bad", fetchImpl })).rejects.toThrow(/401.*Invalid API Key/);
  });

  it("fetches and maps in one step", async () => {
    const fetchImpl = (async () =>
      ok({ data: [charge({ id: "ch_a" }), charge({ id: "ch_gbp", currency: "gbp" })], has_more: false })) as unknown as typeof fetch;

    const { records, rejected } = await fetchBillingRecords({ secretKey: "sk_test_x", fetchImpl });
    expect(records).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
