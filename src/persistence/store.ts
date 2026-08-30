/**
 * The action log — append-only, ordered, and the only durable state.
 *
 * Two backends behind one async interface, chosen by whether a database
 * URL is configured. The in-memory store is not a lesser mode for tests:
 * it is what the demo and offline development run on, and it must behave
 * identically so a bug cannot hide in the gap between them.
 *
 * There is deliberately no update or delete. A mistake is corrected by
 * appending its correction, exactly as the journal does.
 */

import { Action } from "./commands.js";
import { encode, decode } from "./serialize.js";

export interface LoggedAction {
  readonly seq: number;
  readonly orgId: string;
  readonly action: Action;
  readonly createdAt: string;
}

export interface ActionStore {
  readonly mode: "memory" | "postgres";
  append(orgId: string, action: Action): Promise<LoggedAction>;
  /** Everything after `seq`, oldest first. The replay primitive. */
  after(orgId: string, seq: number): Promise<readonly LoggedAction[]>;
  latestSeq(orgId: string): Promise<number>;
  ready(): Promise<void>;
}

export class MemoryActionStore implements ActionStore {
  readonly mode = "memory" as const;
  private log: LoggedAction[] = [];
  private seq = 0;

  async append(orgId: string, action: Action): Promise<LoggedAction> {
    const logged: LoggedAction = {
      seq: ++this.seq,
      orgId,
      action: { ...action, payload: decode(encode(action.payload)) as Record<string, unknown> },
      createdAt: new Date().toISOString(),
    };
    this.log.push(logged);
    return logged;
  }

  async after(orgId: string, seq: number): Promise<readonly LoggedAction[]> {
    return this.log.filter((l) => l.orgId === orgId && l.seq > seq);
  }

  async latestSeq(orgId: string): Promise<number> {
    return this.log.filter((l) => l.orgId === orgId).at(-1)?.seq ?? 0;
  }

  async ready(): Promise<void> {}

  /** Test/debug helper — the whole log, in order. */
  all(): readonly LoggedAction[] {
    return this.log;
  }
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

/** The three lines of a SQL driver Paisa actually needs. */
export interface SqlDb {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS action_log (
  seq         BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_log_org_seq ON action_log (org_id, seq);
`;

export const migrate = async (db: SqlDb): Promise<void> => {
  for (const stmt of MIGRATION_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
};

export class PostgresActionStore implements ActionStore {
  readonly mode = "postgres" as const;
  private migrated: Promise<void> | null = null;

  constructor(private db: SqlDb) {}

  async ready(): Promise<void> {
    this.migrated ??= migrate(this.db);
    await this.migrated;
  }

  async append(orgId: string, action: Action): Promise<LoggedAction> {
    await this.ready();
    const { rows } = await this.db.query(
      `INSERT INTO action_log (org_id, type, payload, actor)
       VALUES ($1, $2, $3, $4)
       RETURNING seq, created_at`,
      [orgId, action.type, JSON.stringify(encode(action.payload)), action.actor],
    );
    const row = rows[0]!;
    return {
      seq: Number(row.seq),
      orgId,
      action,
      createdAt: toIso(row.created_at),
    };
  }

  async after(orgId: string, seq: number): Promise<readonly LoggedAction[]> {
    await this.ready();
    const { rows } = await this.db.query(
      `SELECT seq, type, payload, actor, created_at
         FROM action_log
        WHERE org_id = $1 AND seq > $2
        ORDER BY seq ASC`,
      [orgId, seq],
    );
    return rows.map((r) => ({
      seq: Number(r.seq),
      orgId,
      action: {
        type: String(r.type),
        payload: decode(typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
        actor: String(r.actor),
      },
      createdAt: toIso(r.created_at),
    }));
  }

  async latestSeq(orgId: string): Promise<number> {
    await this.ready();
    const { rows } = await this.db.query(
      `SELECT COALESCE(MAX(seq), 0) AS seq FROM action_log WHERE org_id = $1`,
      [orgId],
    );
    return Number(rows[0]?.seq ?? 0);
  }
}

const toIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date().toISOString();
