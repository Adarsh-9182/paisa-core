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
 * On serverless the process is ephemeral, so a returning visitor can land on
 * a cold instance and find their session gone. They get fresh books rather
 * than an error, which for a demo is the right failure.
 */

import { PaisaRuntime } from "../dist/src/index.js";
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

/**
 * The books for this visitor, created on first use. Returns the same runtime
 * for the same id until it expires.
 */
export const demoRuntime = async (id) => {
  const now = Date.now();
  evictExpired(now);

  const existing = sessions.get(id);
  if (existing) {
    existing.lastSeen = now;
    return existing;
  }

  while (sessions.size >= MAX_SESSIONS) evictOldest();

  const runtime = await PaisaRuntime.open({
    orgId: id,
    name: "Nimbus Labs Pvt Ltd",
    firstPeriod: "2026-01",
    approvalPolicy: { limits: new Map([["junior", 5000000n]]), segregationOfDuties: true },
  });
  const exec = async (type, payload, actor = "demo") => (await runtime.execute(type, payload, actor)).result;
  await seedAll(exec, runtime);

  const session = { id, runtime, org: runtime.org, erp: runtime.erp, createdAt: now, lastSeen: now };
  sessions.set(id, session);
  return session;
};

export const demoStats = () => ({
  active: sessions.size,
  max: MAX_SESSIONS,
  ttlMinutes: TTL_MS / 60000,
});

/** Testing seam — drops every session. */
export const resetDemoSessions = () => sessions.clear();
