# Spec: Reliable daily CFO work for Indian SMBs and agencies

Date: 2026-09-09. Status: in progress.

## Problem

The daily CFO sweep must keep progressing through collections and must report
work still awaiting a person. Currently it selects the oldest invoices before
excluding pending reminders, starving later invoices. Its digest counts only
new reminders, so existing approvals can disappear from the report. Missing
cash history also shares the same quiet path as a healthy runway. Separately,
the model evaluation command can exit successfully when an outage excluded
cases from scoring, and existing test fixtures fail strict typechecking.

## User story

As the owner of an Indian SMB or agency, I want Paisa to prepare overdue
collections work each day, keep outstanding approvals visible, and tell me
when it cannot assess cash risk, so I can trust its daily report.

## Success criteria

- Five overdue invoices progress over consecutive runs even while the first
  three reminder drafts remain pending; no duplicate pending reminder appears.
- Each run respects the reminder attempt limit, reports actual draft successes
  and failures, and states what remains. Failed drafts are never called done.
- Pending reminder approvals remain visible on unchanged runs and after replay.
- Material changes to outstanding invoice amounts are new findings.
- Insufficient cash history is stated explicitly; known non-burning cash flow
  remains distinguishable from unavailable runway information.
- Daily sweeps never initiate close on the current month. They work the last
  completed month, skipping periods before the books began or already closed.
- The scheduler captures the current India business date once per run and
  persists it. It refuses to execute without durable storage and reports an
  HTTP error when execution fails. Demo dates remain stable.
- New CFO commands carry a behavior version. Historical unversioned commands
  replay under their original rules, preserving journal and draft identities.
- An evaluation with any unreached or failing case cannot pass a release gate.
- Unit tests, strict typecheck, production build, and offline evaluation pass.

## Engine changes

Update `src/erp/cfo-agent.ts` and its narrow cash context in `src/erp/suite.ts`.
Version CFO commands in the runtime and command registry; add the scheduled
entry point in `src/erp/cfo-schedule.ts` and wire it into `demo/app.js`.
Add regression coverage to `tests/cfo-agent.test.ts`. Correct branded-money
types in existing test fixtures. Add a tested evaluation acceptance predicate
in `src/ai/eval.ts`, used by `scripts/eval.mjs`.

## Data changes

No schema changes. CFO runs continue through the existing append-only command
log. Replay must preserve pending drafts and finding suppression.

## API, tools, and UI

Existing CFO run/read endpoints and digest surface receive the corrected
results. No new endpoint or financial execution permission is introduced.
Reminder preparation remains a draft; it does not send an email or move money.

## Out of scope

Production deployment, customer outreach, payment execution, new accounting
integrations, and tax-law changes. The initial local implementation is reviewed
through its diff and regression results.

## Bible check

The user chose Indian SMBs and agencies on 2026-09-09, superseding the older
consumer-first sequencing. This work retains deterministic figures, bounded
authority, append-only replay, one orchestrator, and the existing stack.
