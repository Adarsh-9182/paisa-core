/**
 * Two server instances, one shared log: each rebuilds the seed in memory, and
 * only what a visitor does after it is shared.
 */
import { describe, it, expect } from "vitest";
import { parseINR } from "../src/index.js";
import { PaisaRuntime } from "../src/persistence/runtime.js";
import { MemoryActionStore } from "../src/persistence/store.js";
import { SeedOverlayStore } from "../src/persistence/overlay-store.js";

const ORG = "demo_overlaytest01";

const instance = async (shared: MemoryActionStore) => {
  const store = new SeedOverlayStore(shared);
  const runtime = await PaisaRuntime.open({ orgId: ORG, name: "Overlay Demo", firstPeriod: "2026-01", store });
  await runtime.execute(
    "banking.importStatement",
    {
      lines: [
        { reference: "L1", date: "2026-07-01", description: "IMPS 4032 Chai Point", amount: parseINR("-1250") },
        { reference: "L2", date: "2026-07-02", description: "UPI transfer to Rahul", amount: parseINR("-900") },
      ],
    },
    "seed",
  );
  store.seal();
  await runtime.sync();
  return { store, runtime };
};

describe("SeedOverlayStore", () => {
  it("keeps the seed out of the shared log", async () => {
    const shared = new MemoryActionStore();
    await instance(shared);
    expect(shared.all()).toHaveLength(0);
  });

  it("lets a second instance see what a visitor did on the first", async () => {
    const shared = new MemoryActionStore();
    const a = await instance(shared);
    await a.runtime.execute("banking.confirm", { reference: "L1", accountId: "acc_meals" }, "visitor");
    expect(shared.all()).toHaveLength(1);

    // A cold instance: builds the seed, then applies the visitor's action.
    const cold = await instance(shared);
    expect(cold.runtime.org.banking.pendingReview().map((l) => l.reference)).toEqual(["L2"]);
    expect(cold.runtime.org.journal.all().map((e) => e.id)).toEqual(a.runtime.org.journal.all().map((e) => e.id));
    expect(cold.runtime.skippedActions()).toEqual([]);

    // A warm instance picks it up on its next sync.
    const warm = await instance(new MemoryActionStore());
    expect(warm.runtime.org.banking.pendingReview()).toHaveLength(2);
    const b = await instance(shared);
    await a.runtime.execute("banking.confirm", { reference: "L2", accountId: "acc_travel" }, "visitor");
    expect(b.runtime.org.banking.pendingReview()).toHaveLength(1);
    await b.runtime.sync();
    expect(b.runtime.org.banking.pendingReview()).toHaveLength(0);
  });

  it("does not apply shared actions before the seed exists", async () => {
    const shared = new MemoryActionStore();
    await shared.append(ORG, { type: "banking.confirm", payload: { reference: "L1", accountId: "acc_meals" }, actor: "visitor" });
    const store = new SeedOverlayStore(shared);
    expect(await store.after(ORG, 0)).toEqual([]);
    store.seal();
    expect((await store.after(ORG, 0)).map((l) => l.seq)).toEqual([SeedOverlayStore.OFFSET + 1]);
  });
});
