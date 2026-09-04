/**
 * Plaid bank feed connector — mapping and transport.
 *
 * The mapping half is pure, so the sign, settlement and currency rules are
 * checked against fixtures. The transport half is checked with an injected
 * fetch, so pagination and error handling are covered without a token or a
 * network.
 */

import { describe, it, expect } from "vitest";
import { formatINR } from "../src/money.js";
import {
  mapTransaction,
  mapTransactions,
  fetchTransactions,
  fetchBankLines,
  PlaidError,
  type PlaidTransaction,
} from "../src/erp/plaid.js";

const txn = (over: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
  transaction_id: "txn_1",
  account_id: "acc_1",
  amount: 12_500.0, // rupees, positive = money leaving the account
  iso_currency_code: "INR",
  date: "2026-07-14",
  name: "AWS EMEA",
  merchant_name: "Amazon Web Services",
  pending: false,
  ...over,
});

const ok = (t: PlaidTransaction) => {
  const r = mapTransaction(t);
  if (!("line" in r)) throw new Error(`expected a line, got ${JSON.stringify(r)}`);
  return r.line;
};

describe("mapTransaction — sign", () => {
  it("flips Plaid's outflow-positive into the feed's cash-in-positive", () => {
    const line = ok(txn({ amount: 12_500.0 }));
    expect(line.amount).toBe(-1_250_000n);
    expect(formatINR(line.amount)).toContain("12,500");
  });

  it("treats a negative Plaid amount as money arriving", () => {
    expect(ok(txn({ amount: -40_000.0 })).amount).toBe(4_000_000n);
  });
});

describe("mapTransaction — money", () => {
  it("converts fractional rupees exactly, without float drift", () => {
    // 12.35 * 100 is 1234.9999999999998 in IEEE-754.
    expect(ok(txn({ amount: -12.35 })).amount).toBe(1_235n);
  });

  it("rejects a zero-amount transaction", () => {
    expect(mapTransaction(txn({ amount: 0 }))).toMatchObject({ rejected: { reason: /zero-amount/ } });
  });

  it("rejects a non-finite amount", () => {
    expect(mapTransaction(txn({ amount: Number.NaN }))).toMatchObject({ rejected: {} });
  });
});

describe("mapTransaction — settlement", () => {
  it("withholds a pending transaction rather than dropping it", () => {
    const r = mapTransaction(txn({ pending: true }));
    expect(r).toMatchObject({ withheld: { externalId: "txn_1", reason: /pending/ } });
  });

  it("takes the posted copy of the same payment", () => {
    const line = ok(txn({ transaction_id: "txn_2", pending: false, pending_transaction_id: "txn_1" }));
    expect(line.externalId).toBe("plaid:txn_2");
  });
});

describe("mapTransaction — currency", () => {
  it("rejects a non-INR transaction by name instead of converting it", () => {
    expect(mapTransaction(txn({ iso_currency_code: "USD" }))).toMatchObject({
      rejected: { reason: /USD/ },
    });
  });

  it("rejects a transaction with no currency at all", () => {
    expect(mapTransaction(txn({ iso_currency_code: null }))).toMatchObject({
      rejected: { reason: /no currency/ },
    });
  });
});

describe("mapTransaction — identity", () => {
  it("namespaces the id so it cannot collide with a Stripe id or a bank UTR", () => {
    expect(ok(txn()).externalId).toBe("plaid:txn_1");
  });

  it("prefers the merchant name, and falls back rather than inventing one", () => {
    expect(ok(txn()).description).toBe("Amazon Web Services");
    expect(ok(txn({ merchant_name: null })).description).toBe("AWS EMEA");
    expect(ok(txn({ merchant_name: null, name: "" })).description).toBe("(no description)");
  });

  it("rejects an unusable date", () => {
    expect(mapTransaction(txn({ date: "14/07/2026" }))).toMatchObject({ rejected: { reason: /date/ } });
  });
});

describe("mapTransactions", () => {
  it("separates lines, rejections and withholdings", () => {
    const out = mapTransactions([
      txn({ transaction_id: "a" }),
      txn({ transaction_id: "b", pending: true }),
      txn({ transaction_id: "c", iso_currency_code: "USD" }),
    ]);
    expect(out.lines.map((l) => l.externalId)).toEqual(["plaid:a"]);
    expect(out.withheld.map((w) => w.externalId)).toEqual(["b"]);
    expect(out.rejected.map((r) => r.externalId)).toEqual(["c"]);
  });
});

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const creds = {
  clientId: "cid",
  secret: "sec",
  accessToken: "access-sandbox-1",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
} as const;

const jsonResponse = (body: unknown, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json" } });

describe("fetchTransactions — guards", () => {
  it("refuses to run against Plaid production", async () => {
    await expect(fetchTransactions({ ...creds, environment: "production" })).rejects.toThrow(PlaidError);
  });

  it("requires both client id and secret", async () => {
    await expect(fetchTransactions({ ...creds, secret: "" })).rejects.toThrow(/client id and secret/);
  });

  it("requires an access token", async () => {
    await expect(fetchTransactions({ ...creds, accessToken: "" })).rejects.toThrow(/access token/);
  });

  it("rejects a malformed date and a backwards range", async () => {
    await expect(fetchTransactions({ ...creds, startDate: "July 1" })).rejects.toThrow(/startDate/);
    await expect(fetchTransactions({ ...creds, startDate: "2026-08-01" })).rejects.toThrow(/after endDate/);
  });
});

describe("fetchTransactions — pagination", () => {
  it("walks offset pages until total_transactions is reached", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const page = bodies.length;
      return jsonResponse({
        transactions: [txn({ transaction_id: `t${page}` })],
        total_transactions: 3,
      });
    }) as unknown as typeof fetch;

    const all = await fetchTransactions({ ...creds, fetchImpl });
    expect(all.map((t) => t.transaction_id)).toEqual(["t1", "t2", "t3"]);
    expect((bodies as { options: { offset: number } }[]).map((b) => b.options.offset)).toEqual([0, 1, 2]);
  });

  it("stops at maxPages so a long history cannot hang a sync", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ transactions: [txn({ transaction_id: `t${calls}` })], total_transactions: 9999 });
    }) as unknown as typeof fetch;

    await fetchTransactions({ ...creds, maxPages: 2, fetchImpl });
    expect(calls).toBe(2);
  });

  it("stops on an empty page", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return jsonResponse({ transactions: [], total_transactions: 9999 });
    }) as unknown as typeof fetch;

    expect(await fetchTransactions({ ...creds, fetchImpl })).toEqual([]);
    expect(calls).toBe(1);
  });
});

describe("fetchTransactions — errors", () => {
  it("quotes Plaid's own message, not the request", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error_message: "the access token is invalid" }, { status: 400 })) as unknown as typeof fetch;

    await expect(fetchTransactions({ ...creds, fetchImpl })).rejects.toThrow(/400: the access token is invalid/);
  });

  it("never puts the secret in the error text", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error_message: "boom" }, { status: 500 })) as unknown as typeof fetch;

    await expect(fetchTransactions({ ...creds, secret: "sk-super-secret", fetchImpl })).rejects.not.toThrow(
      /sk-super-secret/,
    );
  });

  it("survives a non-JSON error body", async () => {
    const fetchImpl = (async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchTransactions({ ...creds, fetchImpl })).rejects.toThrow(/502/);
  });
});

describe("fetchBankLines", () => {
  it("fetches and maps in one call", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        transactions: [txn({ transaction_id: "a" }), txn({ transaction_id: "b", pending: true })],
        total_transactions: 2,
      })) as unknown as typeof fetch;

    const out = await fetchBankLines({ ...creds, fetchImpl });
    expect(out.lines).toHaveLength(1);
    expect(out.withheld).toHaveLength(1);
  });
});
