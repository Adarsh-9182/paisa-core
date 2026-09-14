/**
 * Demo sessions — a private set of books per visitor.
 *
 * The signed-in app runs on one shared runtime, which is right for one
 * company. It is wrong for a public demo: the visitor who categorises a bank
 * line would be categorising it for everyone else looking at the page.
 *
 * So every visitor gets their own runtime, seeded with the same demo company
 * and mutable without touching anyone else's. Building one takes about 25ms,
 * which is cheap enough to do on arrival.
 *
 * Two bounds keep this from being a way to exhaust the process: a cap on how
 * many sessions exist at once, and an idle timeout. Both are deliberately
 * small — this is a demo, not tenancy. Real multi-tenancy needs the store to
 * be per-tenant and durable, not a Map that dies with the process.
 *
 * On serverless the process is ephemeral, and the next request can land on a
 * different instance. So the seed is rebuilt in each instance's memory, and
 * only what the visitor does after it goes to the shared log (see
 * SeedOverlayStore). Every request syncs first, so a line confirmed on one
 * instance is not back in the queue on the next.
 */

import { PaisaRuntime, SeedOverlayStore } from "../dist/src/index.js";
import { sharedStore } from "./boot.js";
import { seedAll } from "./seed.js";

/** Enough to try everything; small enough that a crawler cannot exhaust us. */
const MAX_SESSIONS = 50;
/** Idle time before a visitor's books are released. */
const TTL_MS = 30 * 60 * 1000;

const sessions = new Map();

const evictExpired = (now) => {
  for (const [id, s] of sessions) if (now - s.lastSeen > TTL_MS) sessions.delete(id);
};

/** Drop the least recently used, so arriving visitors are never turned away. */
const evictOldest = () => {
  let oldestId = null;
  let oldestSeen = Infinity;
  for (const [id, s] of sessions) if (s.lastSeen < oldestSeen) ((oldestSeen = s.lastSeen), (oldestId = id));
  if (oldestId) sessions.delete(oldestId);
};

export const newDemoId = () =>
  `demo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Only ids this module could have issued — the cookie is caller-supplied. */
export const isDemoId = (id) => typeof id === "string" && /^demo_[a-z0-9]{8,24}$/.test(id);

const openSession = async (id, now) => {
  const { store: shared } = await sharedStore();
  const store = new SeedOverlayStore(shared);
  const runtime = await PaisaRuntime.open({
    orgId: id,
    name: "Nimbus Labs Pvt Ltd",
    firstPeriod: "2026-01",
    store,
    approvalPolicy: { limits: new Map([["junior", 5000000n]]), segregationOfDuties: true },
  });
  const exec = async (type, payload, actor = "demo") => (await runtime.execute(type, payload, actor)).result;
  await seedAll(exec, runtime);
  store.seal();
  // Whatever this visitor did on other instances, applied on top of the seed.
  await runtime.sync();
  return { id, runtime, org: runtime.org, erp: runtime.erp, createdAt: now, lastSeen: now };
};

/**
 * The books for this visitor, created on first use and brought up to date
 * with the shared log on every call.
 */
export const demoRuntime = async (id) => {
  const now = Date.now();
  evictExpired(now);

  let entry = sessions.get(id);
  if (!entry) {
    while (sessions.size >= MAX_SESSIONS) evictOldest();
    // The promise is stored, not the result, so two requests arriving at a
    // cold instance together share one seed instead of building two.
    entry = { lastSeen: now, session: openSession(id, now) };
    entry.session.catch(() => sessions.delete(id));
    sessions.set(id, entry);
  }
  entry.lastSeen = now;
  const session = await entry.session;
  await session.runtime.sync();
  return session;
};

export const demoStats = () => ({
  active: sessions.size,
  max: MAX_SESSIONS,
  ttlMinutes: TTL_MS / 60000,
});

/** Testing seam — drops every session. */
export const resetDemoSessions = () => sessions.clear();
