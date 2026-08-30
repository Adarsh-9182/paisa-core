import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { parseINR, ZERO } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { PostgresActionStore, SqlDb, migrate } from "../src/persistence/store.js";

/** PGlite is a real Postgres compiled to WASM — no mocks, no local install. */
const pgliteDb = async (): Promise<SqlDb> => {
  const db = new PGlite();
  await db.waitReady;
  return {
    async query(text, params) {
      const res = await db.query(text, params ? [...params] : undefined);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
};

const ACTOR = "adarsh";
const OPTS = { orgId: "org_pg", name: "Nimbus Labs", firstPeriod: "2026-01" };

describe("postgres action store", () => {
  it("migrates idempotently", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await migrate(db); // running twice must be a no-op, not an error
    const { rows } = await db.query("SELECT count(*)::int AS n FROM action_log");
    expect(rows[0]!.n).toBe(0);
  });

  it("appends in order and reads back after a sequence", async () => {
    const store = new PostgresActionStore(await pgliteDb());
    await store.ready();
    const a = await store.append("org_pg", { type: "journal.post", payload: { n: 1 }, actor: ACTOR });
    const b = await store.append("org_pg", { type: "journal.post", payload: { n: 2 }, actor: ACTOR });
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(await store.latestSeq("org_pg")).toBe(b.seq);
    const after = await store.after("org_pg", a.seq);
    expect(after.map((l) => l.seq)).toEqual([b.seq]);
  });

  it("keeps bigint amounts exact through the JSONB round trip", async () => {
    const store = new PostgresActionStore(await pgliteDb());
    const amount = parseINR("1,23,456.78");
    await store.append("org_pg", { type: "journal.post", payload: { amount }, actor: ACTOR });
    const [logged] = await store.after("org_pg", 0);
    expect(logged!.action.payload.amount).toBe(amount);
    expect(typeof logged!.action.payload.amount).toBe("bigint");
  });

  it("scopes the log by organization", async () => {
    const store = new PostgresActionStore(await pgliteDb());
    await store.append("org_a", { type: "journal.post", payload: {}, actor: ACTOR });
    await store.append("org_b", { type: "journal.post", payload: {}, actor: ACTOR });
    expect(await store.after("org_a", 0)).toHaveLength(1);
    expect(await store.after("org_b", 0)).toHaveLength(1);
  });
});

describe("a runtime backed by postgres", () => {
  it("rebuilds the whole ledger from the database after a cold start", async () => {
    const db = await pgliteDb();
    const store = new PostgresActionStore(db);

    const live = await PaisaRuntime.open({ ...OPTS, store });
    await live.execute("journal.post", {
      date: "2026-01-01",
      narration: "Founder capital",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("50,00,000") },
        { accountId: "acc_capital", side: "CREDIT", amount: parseINR("50,00,000") },
      ],
      sourceModule: "manual",
    }, ACTOR);

    const contract = await live.execute<{ id: string; billingSchedule: { id: string }[] }>("contract.create", {
      input: {
        number: "C-PG-1",
        customer: "Acme Pvt Ltd",
        signedDate: "2026-01-01",
        transactionPrice: parseINR("24,00,000"),
        obligations: [{
          description: "Subscription", ssp: parseINR("24,00,000"),
          startDate: "2026-01-01", endDate: "2026-12-31", method: "RATABLE_MONTHLY",
        }],
        billingFrequency: "ANNUAL",
      },
    }, ACTOR);
    await live.execute("contract.activate", { contractId: contract.result.id }, ACTOR);
    await live.execute("revrec.bill", {
      contractId: contract.result.id,
      billingEventId: contract.result.billingSchedule[0]!.id,
      gstRatePct: 18,
    }, ACTOR);
    await live.execute("revrec.recognize", { period: "2026-01" }, ACTOR);

    // Cold start: a brand new runtime, same database, nothing shared in memory.
    const restored = await PaisaRuntime.open({ ...OPTS, store: new PostgresActionStore(db) });

    expect(restored.org.ledger.balance("acc_bank", "2026-12-31"))
      .toBe(live.org.ledger.balance("acc_bank", "2026-12-31"));
    expect(restored.org.ledger.balance("acc_deferred_revenue", "2026-12-31"))
      .toBe(parseINR("22,00,000"));
    expect(restored.org.ledger.balance("acc_subscription_revenue", "2026-12-31"))
      .toBe(parseINR("2,00,000"));
    expect(restored.org.ledger.trialBalance("2026-12-31").balanced).toBe(true);
    expect(restored.erp.contracts.get(contract.result.id).customer).toBe("Acme Pvt Ltd");
    expect(restored.skippedActions()).toHaveLength(0);
  });

  it("lets a second instance see the first instance's writes", async () => {
    const db = await pgliteDb();
    const a = await PaisaRuntime.open({ ...OPTS, store: new PostgresActionStore(db) });
    const b = await PaisaRuntime.open({ ...OPTS, store: new PostgresActionStore(db) });

    await a.execute("journal.post", {
      date: "2026-02-01",
      narration: "Customer payment",
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR("3,00,000") },
        { accountId: "acc_sales", side: "CREDIT", amount: parseINR("3,00,000") },
      ],
      sourceModule: "manual",
    }, ACTOR);

    expect(b.org.ledger.balance("acc_bank", "2026-12-31")).toBe(ZERO);
    const report = await b.sync();
    expect(report.applied).toBe(1);
    expect(b.org.ledger.balance("acc_bank", "2026-12-31")).toBe(parseINR("3,00,000"));
  });
});
