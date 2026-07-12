/**
 * Postgres — the one place SQL enters the web app (spec 001).
 *
 * PAISA_DATABASE_URL present → store/users/connections route through here;
 * absent → they keep using the original JSONL files and no pool is created.
 *
 * SqlDb is deliberately tiny so tests can back it with PGlite (in-process
 * Postgres, no server) and exercise the exact same SQL.
 */

import { Pool } from "pg";

export interface SqlRow {
  [column: string]: unknown;
}
export interface SqlDb {
  query(text: string, params?: unknown[]): Promise<{ rows: SqlRow[] }>;
}

/** Single-org until multi-tenancy; every query already filters on it. */
export const ORG_ID = "org_nimbus";

// Idempotent DDL, one statement per entry (PGlite runs single statements).
const MIGRATION: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email         TEXT,
    google_sub    TEXT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS action_log (
    seq        BIGSERIAL PRIMARY KEY,
    org_id     TEXT NOT NULL,
    type       TEXT NOT NULL,
    payload    JSONB NOT NULL,
    actor      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS action_log_org_seq ON action_log (org_id, seq)`,
  `CREATE TABLE IF NOT EXISTS connections (
    id         TEXT PRIMARY KEY,
    org_id     TEXT NOT NULL,
    payload    JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export async function migrate(db: SqlDb): Promise<void> {
  for (const stmt of MIGRATION) await db.query(stmt);
}

/** Test seam: inject a PGlite-backed SqlDb; null restores env behavior. */
let testDb: Promise<SqlDb> | null = null;
export function setTestDb(db: SqlDb | null): void {
  testDb = db ? migrate(db).then(() => db) : null;
}

export const usingPostgres = (): boolean => testDb !== null || Boolean(process.env.PAISA_DATABASE_URL);

const g = globalThis as unknown as { __paisaPool?: Pool; __paisaDbReady?: Promise<SqlDb> };

/** The app's database, migrated exactly once per process. */
export function getDb(): Promise<SqlDb> {
  if (testDb) return testDb;
  if (!g.__paisaDbReady) {
    const connectionString = process.env.PAISA_DATABASE_URL;
    if (!connectionString) throw new Error("getDb() called without PAISA_DATABASE_URL");
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    g.__paisaPool = new Pool({ connectionString, max: 3, ssl: local ? undefined : { rejectUnauthorized: true } });
    const pool = g.__paisaPool;
    const db: SqlDb = {
      query: async (text, params) => {
        const res = await pool.query(text, (params ?? []) as never[]);
        return { rows: res.rows as SqlRow[] };
      },
    };
    g.__paisaDbReady = migrate(db).then(() => db);
  }
  return g.__paisaDbReady;
}
