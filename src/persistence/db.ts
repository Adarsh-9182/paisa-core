/**
 * The SQL driver boundary.
 *
 * Paisa needs three lines of a database: run a statement, get rows back.
 * Keeping the surface that small means the same store code runs against a
 * pooled Postgres in production and an in-process PGlite in tests, with no
 * mocking of the thing under test.
 *
 * `pg` is imported lazily so a deployment that never sets a database URL
 * never loads the driver — and so this module stays importable in
 * environments where the native driver is not installed.
 */

import { SqlDb } from "./store.js";

export class DbError extends Error {
  override name = "DbError";
}

/**
 * A pooled Postgres connection. Works with any Postgres — Neon, RDS,
 * Supabase, a local server — since the connection string carries the
 * dialect-specific parts.
 */
export const createPostgresDb = async (connectionString: string): Promise<SqlDb> => {
  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    throw new DbError(
      'The "pg" driver is not installed. Run `npm install pg`, or supply your own SqlDb implementation.',
    );
  }
  const Pool = pg.default?.Pool ?? pg.Pool;
  const pool = new Pool({ connectionString });
  return {
    async query(text, params) {
      const res = await pool.query(text, params ? [...params] : undefined);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
};

/**
 * Resolve the configured backend. Absent URL means in-memory, which is a
 * real supported mode (local development, the demo) rather than a
 * degraded one — the store interface is identical either way.
 */
export const resolveDatabaseUrl = (env: Record<string, string | undefined> = process.env): string | null =>
  env.PAISA_DATABASE_URL ?? env.DATABASE_URL ?? null;
