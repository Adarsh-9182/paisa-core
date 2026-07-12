# Spec 001: Postgres persistence

**2026-07-08 · status: approved · Bible: §2.2, §2.7, §4**

## Problem

All persistence is JSONL files under `.paisa-data/`. On Vercel the filesystem is read-only, so every signup, categorization, trade, and bank connection evaporates when the instance recycles. PAISA cannot hold a real user. (Bible Phase 1.1 — non-negotiable before anything else.)

## User story

As the first persona, I sign up, import a statement, categorize transactions — and everything is still there tomorrow, from any device.

## Success criteria

1. With `PAISA_DATABASE_URL` set: signup → restart server → login works; a categorize/trade action → restart → still applied.
2. Without the URL: behavior identical to today (files), local dev works offline.
3. Two concurrent server instances see each other's writes (incremental replay).
4. Core engine tests stay green; `tsc --noEmit` clean in web.

## Design decisions

- **Dual backend behind one async API.** `PAISA_DATABASE_URL` present → Postgres; absent → existing JSONL files. Selection lives inside `store`/`users`/`connections`; callers never know.
- **The whole read/write surface goes async.** `getPaisa()`, every `data.ts` getter, and every persistence function return Promises. Pages are RSC (can await); routes are async already. A sync cache facade was rejected: cross-instance staleness on Vercel would mean a user signs up on instance 1 and can't log in on instance 2 — silent data wrongness, worst kind.
- **Incremental replay.** Engine singleton tracks the last applied `action_log.seq`; each `getPaisa()` call fetches `WHERE seq > last` and applies through the same engine code paths. Append-only makes this cheap (indexed, usually empty) and exactly correct.
- **Identity reads go straight to the DB** in PG mode (`findUser`, `authenticate`, connections) — no cache to go stale.
- **Writes are awaited.** Never fire-and-forget for financial actions (Bible §2.4).
- **Driver:** `pg` Pool (works with Neon pooled connection string; portable to any Postgres). Adapter is a 3-line `SqlDb` interface so tests can back it with PGlite (in-process WASM Postgres — no local install).

## Data changes (schema v1.1 — the subset this phase uses)

```sql
CREATE TABLE IF NOT EXISTS users (
  username    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email       TEXT,
  google_sub  TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS action_log (
  seq         BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_log_org_seq ON action_log (org_id, seq);
CREATE TABLE IF NOT EXISTS connections (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  payload     JSONB NOT NULL,          -- latest full BankConnection state
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`orgs`, `conversations`, `messages`, `memories`, `documents`, `net_worth_snapshots` (Bible §4) arrive with their phases — no dead tables. `org_id` is constant (`org_nimbus`) until multi-org; every query already filters on it so multi-org is a session change, not a schema change.

## API contract

No route shapes change. Internal contracts:

- `store.ts`: `appendAction(a): Promise<boolean>` · `fetchActionsAfter(seq): Promise<{seq, action}[]>` · `persistenceStatus(): Promise<{mode: "postgres"|"disk"|"memory"}>`
- `users.ts` / `connections.ts`: same exports, all async.
- `engine.ts`: `getPaisa(): Promise<PaisaRuntime>` with incremental replay in PG mode.
- New `db.ts`: `SqlDb { query(text, params?): Promise<{rows}> }`, lazy `pg` Pool singleton, `migrate(db)` idempotent DDL.
- New `web/scripts/import-jsonl.mjs`: one-shot `.paisa-data/*.jsonl` → tables, idempotent (skips if action_log non-empty).

## Tool exposure

None — infrastructure phase; no new model-visible tools.

## UI

None visible. Settings' persistence status line shows `postgres` when live.

## Out of scope

Memory system tables (Phase 2), file uploads/documents (1.3), background jobs, Clerk/auth changes, multi-org.

## Bible check

§2.2 append-only preserved (action_log is the JSONL file, table-shaped; no UPDATE ever) · §2.4 awaited writes · §2.7 evolve-don't-rewrite (same replay architecture, storage swapped) · §4 schema is the Bible's, subset.
