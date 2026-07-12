/**
 * Bank connections — latest-state-wins records, same philosophy as the action
 * log and user store. The financial data itself lives in the engine (posted
 * via the banking gate); this only tracks the consent + link metadata the UI
 * needs to show and manage connections.
 *
 * Two backends behind one async API (spec 001):
 *   PAISA_DATABASE_URL set → Postgres `connections` table (payload = latest
 *                            full state), queried directly on every read.
 *   otherwise             → original JSONL (one line per state change, latest
 *                            line for an id wins) + instance cache.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "./store";
import { getDb, usingPostgres, ORG_ID } from "./db";

export interface BankConnection {
  id: string; // conn_<hex>
  fipId: string;
  fipName: string;
  maskedAccount: string;
  accountId: string; // chart account id the transactions post into
  consentId: string; // AA consent artefact id
  status: "active" | "revoked";
  connectedAt: string;
  lastSyncedAt: string;
  txnCount: number; // running count of imported transactions
}

const path = (): string => join(dataDir(), "connections.jsonl");

/* ---------------- file backend (unchanged behavior) ---------------- */

let cache: Map<string, BankConnection> | null = null;

function load(): Map<string, BankConnection> {
  if (cache) return cache;
  cache = new Map();
  try {
    for (const line of readFileSync(path(), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const c = JSON.parse(line) as BankConnection;
      cache.set(c.id, c); // later lines win
    }
  } catch {
    // no file yet
  }
  return cache;
}

function writeToFile(conn: BankConnection): void {
  load().set(conn.id, conn);
  try {
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
    appendFileSync(path(), JSON.stringify(conn) + "\n", "utf8");
  } catch {
    // read-only FS — lives for this instance
  }
}

/* ---------------- public API (async, backend-agnostic) ---------------- */

export const newConnectionId = (): string => "conn_" + randomBytes(6).toString("hex");

export async function saveConnection(conn: BankConnection): Promise<void> {
  if (usingPostgres()) {
    const db = await getDb();
    await db.query(
      `INSERT INTO connections (id, org_id, payload, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [conn.id, ORG_ID, JSON.stringify(conn)],
    );
    return;
  }
  writeToFile(conn);
}

export async function getConnection(id: string): Promise<BankConnection | null> {
  if (usingPostgres()) {
    const db = await getDb();
    const { rows } = await db.query("SELECT payload FROM connections WHERE id = $1 AND org_id = $2", [id, ORG_ID]);
    if (!rows.length) return null;
    const p = rows[0].payload;
    return (typeof p === "string" ? JSON.parse(p) : p) as BankConnection;
  }
  return load().get(id) ?? null;
}

/** Newest first; active connections only unless `includeRevoked`. */
export async function listConnections(includeRevoked = false): Promise<BankConnection[]> {
  let all: BankConnection[];
  if (usingPostgres()) {
    const db = await getDb();
    const { rows } = await db.query("SELECT payload FROM connections WHERE org_id = $1", [ORG_ID]);
    all = rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as BankConnection);
  } else {
    all = [...load().values()];
  }
  return all
    .filter((c) => includeRevoked || c.status === "active")
    .sort((a, b) => (a.connectedAt < b.connectedAt ? 1 : -1));
}

export async function updateConnection(id: string, patch: Partial<BankConnection>): Promise<BankConnection | null> {
  const existing = await getConnection(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await saveConnection(next);
  return next;
}
