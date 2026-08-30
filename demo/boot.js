/**
 * Boot — one path to a running Paisa, durable or not.
 *
 * The runtime is always a PaisaRuntime, so the seed and every later
 * mutation travel the same command path whether they are being persisted
 * or not. Two boot paths would drift the way two copies of a balance
 * calculation drift; there is one.
 *
 *   PAISA_DATABASE_URL set  → Postgres action log, state survives restarts
 *   absent                  → in-memory action log, seeded fresh per process
 *
 * The seed is itself a sequence of commands, so on a configured database it
 * is written once and replayed thereafter — a second instance rebuilds the
 * same books rather than seeding a second copy of them.
 */

import {
  PaisaRuntime,
  MemoryActionStore,
  PostgresActionStore,
  createPostgresDb,
  resolveDatabaseUrl,
} from "../dist/src/index.js";

export const AS_OF = "2026-07-02";
export const PERIOD_FROM = "2026-01-01";
export const ORG_ID = "org_nimbus";
export const ORG_NAME = "Nimbus Labs Pvt Ltd";

const openStore = async () => {
  const url = resolveDatabaseUrl();
  if (!url) return { store: new MemoryActionStore(), mode: "memory", detail: "in-memory (set PAISA_DATABASE_URL to persist)" };
  try {
    const db = await createPostgresDb(url);
    return { store: new PostgresActionStore(db), mode: "postgres", detail: "postgres action log" };
  } catch (err) {
    // A database that was configured but cannot be reached is a fact worth
    // stating loudly, not a reason to silently serve a different dataset.
    console.error(`[paisa] PAISA_DATABASE_URL is set but unusable: ${err.message}`);
    console.error("[paisa] falling back to in-memory — this instance's writes will not persist");
    return { store: new MemoryActionStore(), mode: "memory-fallback", detail: `postgres unreachable: ${err.message}` };
  }
};

let booted = null;

/**
 * @param {(exec: (type: string, payload: object, actor?: string) => Promise<any>, ctx: object) => Promise<void>} seed
 */
export const boot = (seed) => {
  booted ??= (async () => {
    const { store, mode, detail } = await openStore();
    const runtime = await PaisaRuntime.open({
      orgId: ORG_ID,
      name: ORG_NAME,
      firstPeriod: "2026-01",
      store,
      approvalPolicy: { limits: new Map([["junior", 5000000n]]), segregationOfDuties: true },
    });

    // Several instances can cold start at once and all see an empty log, so
    // the right to seed is claimed atomically rather than inferred from it.
    const shouldSeed = runtime.appliedThrough() === 0 && (await store.claimSeed(ORG_ID));
    if (shouldSeed) {
      const exec = async (type, payload, actor = "adarsh") => {
        const { result } = await runtime.execute(type, payload, actor);
        return result;
      };
      await seed(exec, runtime);
    } else if (runtime.appliedThrough() === 0) {
      // Another instance won the claim and is seeding right now. Wait for its
      // work to land rather than serving empty books.
      for (let attempt = 0; attempt < 40 && runtime.appliedThrough() === 0; attempt++) {
        await new Promise((r) => setTimeout(r, 250));
        await runtime.sync();
      }
    }

    const skipped = runtime.skippedActions();
    if (skipped.length) {
      console.warn(`[paisa] ${skipped.length} logged action(s) could not be applied on replay:`);
      for (const s of skipped) console.warn(`  seq ${s.seq} ${s.type} — ${s.reason}`);
    }

    return {
      runtime,
      org: runtime.org,
      erp: runtime.erp,
      persistence: { mode, detail, seeded: shouldSeed, appliedThrough: runtime.appliedThrough() },
    };
  })();
  return booted;
};

/** Pull in anything other instances have written since we last looked. */
export const sync = async () => {
  if (!booted) return { applied: 0 };
  const { runtime } = await booted;
  return runtime.sync();
};
