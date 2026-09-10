/**
 * The durable directory: who may open which books, surviving a restart.
 *
 * A fresh `DurableDirectory.open(store)` on the same store is a cold start —
 * a new serverless instance with nothing in memory. Every case asks whether
 * that instance ends up believing the same thing as the one that made the
 * change.
 */
import { describe, expect, it } from "vitest";
import { MemoryActionStore } from "../src/persistence/store.js";
import { DIRECTORY_STREAM, DurableDirectory } from "../src/tenancy/directory.js";
import { AccountError } from "../src/tenancy/accounts.js";
import { AccessError } from "../src/tenancy/members.js";

const PW = "correct-horse-battery";

const withOwner = async () => {
  const store = new MemoryActionStore();
  const dir = await DurableDirectory.open(store);
  const owner = await dir.register("owner@acme.in", PW, "Owner");
  await dir.found("org_acme", "Acme Traders", owner.userId);
  return { store, dir, owner, ownerCtx: () => dir.members.authorize(owner.userId, "org_acme") };
};

describe("a cold start", () => {
  it("remembers an account someone signed up with", async () => {
    const store = new MemoryActionStore();
    const made = await (await DurableDirectory.open(store)).register("new@shop.in", PW, "New");

    const restarted = await DurableDirectory.open(store);
    const back = await restarted.accounts.authenticate("new@shop.in", PW);
    expect(back?.userId).toBe(made.userId);
  });

  it("remembers workspaces, their names, members and roles", async () => {
    const { store, dir, ownerCtx } = await withOwner();
    const staff = await dir.register("staff@acme.in", PW);
    await dir.add(ownerCtx(), staff.userId, "viewer");
    await dir.changeRole(ownerCtx(), staff.userId, "accountant");

    const restarted = await DurableDirectory.open(store);
    expect(restarted.members.authorize(staff.userId, "org_acme").role).toBe("accountant");
    expect(restarted.workspaceName("org_acme")).toBe("Acme Traders");
  });

  it("remembers a removal, so a removed member stays out", async () => {
    const { store, dir, ownerCtx } = await withOwner();
    const staff = await dir.register("gone@acme.in", PW);
    await dir.add(ownerCtx(), staff.userId, "viewer");
    await dir.remove(ownerCtx(), staff.userId);

    const restarted = await DurableDirectory.open(store);
    expect(() => restarted.members.authorize(staff.userId, "org_acme")).toThrow(AccessError);
  });

  it("remembers a password change, and the old password stops working", async () => {
    const store = new MemoryActionStore();
    const dir = await DurableDirectory.open(store);
    const me = await dir.register("me@shop.in", PW);
    await dir.changePassword(me.userId, PW, "a-brand-new-password");

    const restarted = await DurableDirectory.open(store);
    expect(await restarted.accounts.authenticate("me@shop.in", PW)).toBeNull();
    expect(await restarted.accounts.authenticate("me@shop.in", "a-brand-new-password")).not.toBeNull();
  });
});

describe("several instances at once", () => {
  it("shows one instance's sign-up to another after it syncs", async () => {
    const store = new MemoryActionStore();
    const a = await DurableDirectory.open(store);
    const b = await DurableDirectory.open(store);

    await a.register("seen@shop.in", PW);
    expect(b.accounts.findByEmail("seen@shop.in")).toBeUndefined();
    await b.sync();
    expect(b.accounts.findByEmail("seen@shop.in")).toBeDefined();
  });

  it("gives a contested address to exactly one of two simultaneous sign-ups", async () => {
    const store = new MemoryActionStore();
    const a = await DurableDirectory.open(store);
    const b = await DurableDirectory.open(store);

    const results = await Promise.allSettled([a.register("race@shop.in", PW), b.register("race@shop.in", PW)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(AccountError);

    await a.sync();
    await b.sync();
    expect(a.accounts.findByEmail("race@shop.in")!.userId).toBe(b.accounts.findByEmail("race@shop.in")!.userId);
  });

  it("creates one founding owner no matter how many instances boot together", async () => {
    const store = new MemoryActionStore();
    const boot = { email: "founder@paisa.in", password: PW, orgId: "org_main", orgName: "Main" };
    const instances = await Promise.all([1, 2, 3].map(() => DurableDirectory.open(store)));

    const owners = await Promise.all(instances.map((d) => d.ensureOwner(boot)));
    expect(new Set(owners.map((o) => o.userId)).size).toBe(1);

    const restarted = await DurableDirectory.open(store);
    expect(restarted.accounts.all()).toHaveLength(1);
    expect(restarted.members.listOrg("org_main")).toHaveLength(1);
  });

  it("lets the environment rotate the owner's password on the next boot", async () => {
    const store = new MemoryActionStore();
    const boot = { email: "founder@paisa.in", orgId: "org_main", orgName: "Main" };
    await (await DurableDirectory.open(store)).ensureOwner({ ...boot, password: PW });
    await (await DurableDirectory.open(store)).ensureOwner({ ...boot, password: "rotated-password-2026" });

    const restarted = await DurableDirectory.open(store);
    expect(await restarted.accounts.authenticate("founder@paisa.in", PW)).toBeNull();
    expect(await restarted.accounts.authenticate("founder@paisa.in", "rotated-password-2026")).not.toBeNull();
  });
});

describe("authority still holds", () => {
  it("refuses a write the caller's role does not carry, and records nothing", async () => {
    const { store, dir, ownerCtx } = await withOwner();
    const viewer = await dir.register("viewer@acme.in", PW);
    const outsider = await dir.register("outsider@acme.in", PW);
    await dir.add(ownerCtx(), viewer.userId, "viewer");
    const before = store.all().length;

    await expect(dir.add(dir.members.authorize(viewer.userId, "org_acme"), outsider.userId, "viewer"))
      .rejects.toThrow(AccessError);
    expect(store.all().length).toBe(before);
    expect(dir.members.find(outsider.userId, "org_acme")).toBeUndefined();
  });

  it("judges a write by the caller's role now, not the one in a stale context", async () => {
    const { dir, ownerCtx } = await withOwner();
    const admin = await dir.register("admin@acme.in", PW);
    const newcomer = await dir.register("newcomer@acme.in", PW);
    await dir.add(ownerCtx(), admin.userId, "admin");
    const staleAdmin = dir.members.authorize(admin.userId, "org_acme");

    await dir.changeRole(ownerCtx(), admin.userId, "viewer");
    await expect(dir.add(staleAdmin, newcomer.userId, "viewer")).rejects.toThrow(AccessError);
  });

  it("will not seat someone who has no account", async () => {
    const { dir, ownerCtx } = await withOwner();
    await expect(dir.add(ownerCtx(), "u_nobody", "viewer")).rejects.toThrow(AccessError);
  });
});

describe("what the log holds", () => {
  it("never hands a password hash to anything that reads accounts", async () => {
    const { dir } = await withOwner();
    for (const account of dir.accounts.all()) expect(account).not.toHaveProperty("passwordHash");
  });

  it("keeps directory events out of every organization's own stream", async () => {
    const { store } = await withOwner();
    expect(await store.after("org_acme", 0)).toHaveLength(0);
    expect((await store.after(DIRECTORY_STREAM, 0)).length).toBeGreaterThan(0);
  });
});

describe("a company's own facts", () => {
  it("remembers when a company's books begin, through a cold start", async () => {
    const store = new MemoryActionStore();
    const dir = await DurableDirectory.open(store);
    const owner = await dir.register("owner@kirana.in", PW);
    await dir.found("org_kirana", "Kirana Stores", owner.userId, "2026-04");

    const restarted = await DurableDirectory.open(store);
    expect(restarted.workspace("org_kirana")).toEqual({ name: "Kirana Stores", firstPeriod: "2026-04" });
  });

  it("lists every founded company, for work that runs across all of them", async () => {
    const store = new MemoryActionStore();
    const dir = await DurableDirectory.open(store);
    const a = await dir.register("a@one.in", PW);
    const b = await dir.register("b@two.in", PW);
    await dir.found("org_one", "One", a.userId, "2026-04");
    await dir.found("org_two", "Two", b.userId, "2026-04");

    expect([...(await DurableDirectory.open(store)).workspaceIds()].sort()).toEqual(["org_one", "org_two"]);
  });

  it("refuses a first period that is not a month, before writing anything", async () => {
    const store = new MemoryActionStore();
    const dir = await DurableDirectory.open(store);
    const owner = await dir.register("owner@bad.in", PW);
    const before = store.all().length;

    await expect(dir.found("org_bad", "Bad", owner.userId, "April 2026")).rejects.toThrow(/YYYY-MM/);
    expect(store.all().length).toBe(before);
  });
});
