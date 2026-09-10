/**
 * A company's own books, opened on demand.
 *
 * Every signed-in member used to be handed the one ledger this deployment
 * boots with, whichever company they belonged to. The storage was already
 * multi-tenant — the action log is scoped by org id — so the missing piece
 * was never persistence. It was a way to open the right company's books.
 *
 * A company's runtime is rebuilt from its own stream of the shared log on
 * first use and kept, because replaying on every request would be work
 * repeated for nothing. Keeping them is bounded: past the cap the least
 * recently used is dropped, which loses nothing, since the log is the books
 * and the next request simply replays it again.
 *
 * All companies share the one store, and so the one database pool. A
 * connection pool per company is how a few dozen customers exhaust the
 * database's connection limit.
 */

import { PaisaRuntime } from "../dist/src/index.js";
import { sharedStore } from "./boot.js";

/** Open runtimes kept at once. Small enough for one function instance's memory. */
const MAX_OPEN = 50;
/** How stale a kept runtime may be before it pulls another instance's writes. */
const SYNC_MS = 1000;

const open = new Map();

export const newOrgId = () =>
  `org_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** India's financial year begins on 1 April. */
export const financialYearStart = (isoDate) => {
  const [y, m] = isoDate.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};

/**
 * Where a new company's books begin: the start of the current financial
 * year, so this year's bank statements can be imported rather than refused
 * as predating the books.
 */
export const firstPeriodFor = (isoDate) => financialYearStart(isoDate).slice(0, 7);

const evictIdle = () => {
  while (open.size > MAX_OPEN) {
    let oldestId = null;
    let oldestSeen = Infinity;
    // Never one that is still opening: a request is waiting on it.
    for (const [id, entry] of open)
      if (entry.ready && entry.lastSeen < oldestSeen) ((oldestSeen = entry.lastSeen), (oldestId = id));
    if (!oldestId) return;
    open.delete(oldestId);
  }
};

/**
 * The runtime for one company.
 *
 * Concurrent first requests for the same company share one replay instead of
 * racing to build two copies of the same books.
 */
export const workspaceRuntime = async (orgId, { name, firstPeriod }) => {
  const now = Date.now();
  let entry = open.get(orgId);

  if (!entry) {
    entry = { lastSeen: now, syncedAt: now, ready: false, runtime: null };
    entry.runtime = (async () => {
      const { store } = await sharedStore();
      const runtime = await PaisaRuntime.open({
        orgId,
        name,
        firstPeriod,
        store,
        approvalPolicy: { limits: new Map([["junior", 5000000n]]), segregationOfDuties: true },
      });
      entry.ready = true;
      return runtime;
    })();
    // A failed open must not be cached, or the company stays unreachable
    // until this instance is recycled.
    entry.runtime.catch(() => open.delete(orgId));
    open.set(orgId, entry);
    evictIdle();
  }

  entry.lastSeen = now;
  const runtime = await entry.runtime;
  if (now - entry.syncedAt > SYNC_MS) {
    entry.syncedAt = now;
    await runtime.sync();
  }
  return runtime;
};

/** Testing seam — forget every opened company. */
export const resetWorkspaces = () => open.clear();
