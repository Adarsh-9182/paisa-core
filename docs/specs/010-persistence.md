# Spec 010 — Persistence by command sourcing

**Status:** Shipped (2026-08-30)
**Supersedes:** the storage half of spec 001, which targeted the pre-pivot `web/` app (now archived). The architecture it chose — append-only action log, incremental replay, dual backend — is the architecture here.
**Bible check:** ONE JOB intact. §2.2 append-only preserved (`action_log` never sees an UPDATE or DELETE) · §2.4 writes are awaited · §2.7 evolve-don't-rewrite — no engine was modified.

## The decision

State is never serialised out. The log records **what was asked for**, and replaying those asks through the same command handlers rebuilds the state.

```
execute(cmd) →  append to action_log  →  apply through COMMANDS[cmd]
open()      →  read log from seq 0    →  apply through COMMANDS[cmd]
```

Both paths run the same handler. There is no separate "load" path that could disagree with the "apply" path, because there is only one path — a restored ledger is *arrived at* the same way the original was, not reconstructed from a snapshot that might have drifted.

This works only because the engines are deterministic, which they already were: ids come from ordered counters, balances are projections over the journal, and nothing depends on wall-clock time to be correct.

## What is enumerated, not inferred

`COMMANDS` lists every mutation that can reach the engines — 38 of them across the ledger, AR, AP, contracts, recognition, schedules, FX, reconciliation, close, agents and connectors. A command not in the registry is refused rather than executed, so the surface that survives a restart is a list you can read, not a property you have to trust.

## Design decisions that carried weight

**bigint is tagged, not stringified.** Money is a bigint everywhere; JSON has none. Amounts serialise as `{"$paise":"12345"}` rather than a bare string, because a bare string is indistinguishable from a legitimate string field and that ambiguity surfaces as a wrong number years later.

**Failed commands stay in the log.** `execute()` appends first, then applies. A command that throws — a closed period, an unbalanced entry — is already recorded, and replay skips it by the same rule that rejected it. The caller still gets the error. This keeps a restored ledger *identical* to the live one rather than quietly better, and the log doubles as a record of what was attempted.

**In-memory is a real mode, not a test fixture.** `MemoryActionStore` and `PostgresActionStore` implement one interface and are exercised by the same tests. The demo and offline development run on memory; a bug cannot hide in the gap between them.

**The SQL surface is three lines.** `SqlDb { query(text, params) }` is the whole driver contract, so the store runs unchanged against pooled Postgres in production and in-process PGlite in tests — no mocking of the thing under test.

**`pg` is imported lazily.** A deployment that never sets a database URL never loads the driver.

## Known limitation, stated plainly

Metadata timestamps (`createdAt` on a journal entry, `raisedAt` on a proposal) are regenerated at replay time and therefore reflect the replay, not the original moment. The accounting date — the one that matters — is in the payload and is exact. `action_log.created_at` is the audit record for when something actually happened.

## Verification

16 tests. The load-bearing one takes a driven runtime, opens a **cold** runtime against the same log, and asserts the trial balance, every account balance, every journal entry id, every bill id, the contract state and MRR are identical. Others cover: the deferred roll-forward still tying after a restart; a locked period still refusing a post after a restart; a failed command being skipped on replay with state still matching; unknown commands refused; and two instances converging via `sync()`.

Postgres is tested against **real Postgres** — PGlite, compiled to WASM, in process. Migration is idempotent, JSONB round-trips bigints exactly, and the log is scoped by organisation.

`node demo/persistence.js` records one month per invocation into an on-disk PGlite database and rebuilds the books from the log each time. Run it repeatedly: the books grow across processes, the trial balance stays balanced, and nothing is ever written out as state.

## Out of scope

Users and authentication, conversations and memories, documents, background jobs, multi-org sessions. `org_id` is on every row and every query filters on it, so multi-org is a session change rather than a schema change.
