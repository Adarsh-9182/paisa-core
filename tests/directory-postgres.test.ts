/**
 * The durable directory on a real Postgres.
 *
 * The memory-store cases prove the replay logic. These prove the part they
 * cannot: that directory events — password hashes, roles, workspace names —
 * survive the SQL insert and the JSONB round trip, and that separate
 * instances sharing one database agree. Each `PostgresActionStore` over the
 * same PGlite database stands in for a separate serverless instance.
 */
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgresActionStore, SqlDb } from "../src/persistence/store.js";
import { DurableDirectory } from "../src/tenancy/directory.js";

const PW = "correct-horse-battery";

const sharedDb = async (): Promise<SqlDb> => {
  const db = new PGlite();
  await db.waitReady;
  return {
    async query(text, params) {
      const res = await db.query(text, params ? [...params] : undefined);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
};

/** A new instance: its own store object, the same database. */
const instance = (db: SqlDb) => DurableDirectory.open(new PostgresActionStore(db));

describe("the directory on postgres", () => {
  it("keeps a sign-up through a cold start on another instance", async () => {
    const db = await sharedDb();
    const made = await (await instance(db)).register("new@shop.in", PW, "New Shop");

    const other = await instance(db);
    const back = await other.accounts.authenticate("new@shop.in", PW);
    expect(back?.userId).toBe(made.userId);
    expect(back?.displayName).toBe("New Shop");
  });

  it("keeps roles and workspace names through the JSONB round trip", async () => {
    const db = await sharedDb();
    const dir = await instance(db);
    const owner = await dir.register("owner@acme.in", PW);
    await dir.found("org_acme", "Acme Traders", owner.userId);
    const staff = await dir.register("staff@acme.in", PW);
    await dir.add(dir.members.authorize(owner.userId, "org_acme"), staff.userId, "viewer");
    await dir.changeRole(dir.members.authorize(owner.userId, "org_acme"), staff.userId, "accountant");

    const other = await instance(db);
    expect(other.members.authorize(staff.userId, "org_acme").role).toBe("accountant");
    expect(other.workspaceName("org_acme")).toBe("Acme Traders");
  });

  it("creates one owner when several instances boot on one database together", async () => {
    const db = await sharedDb();
    const boot = { email: "founder@paisa.in", password: PW, orgId: "org_main", orgName: "Main" };
    const instances = await Promise.all([1, 2, 3].map(() => instance(db)));

    const owners = await Promise.all(instances.map((d) => d.ensureOwner(boot)));
    expect(new Set(owners.map((o) => o.userId)).size).toBe(1);

    const fresh = await instance(db);
    expect(fresh.accounts.all()).toHaveLength(1);
    expect(fresh.members.listOrg("org_main")).toHaveLength(1);
  });

  it("does not mix directory events into an organization's books", async () => {
    const db = await sharedDb();
    const store = new PostgresActionStore(db);
    const dir = await DurableDirectory.open(store);
    const owner = await dir.register("owner@acme.in", PW);
    await dir.found("org_acme", "Acme Traders", owner.userId);

    expect(await store.after("org_acme", 0)).toHaveLength(0);
  });
});
