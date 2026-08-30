# Spec 009 — The ERP layer (Rillet-class finance, Paisa-shaped)

**Status:** Shipped (2026-08-30)
**Bible check:** ONE JOB intact. The LLM still originates no number — every ERP module is a deterministic engine, and the ten new AI tools are read-only projections over them. The AI can tell you the close is blocked and why; it cannot close the month, approve a bill, or post an accrual.

## What this adds

Paisa's core answers "how is my business doing?" for a small business. This layer adds what a finance *team* needs — the module set an AI-native ERP is expected to cover:

| Capability | Module | Notes |
|---|---|---|
| Accounting periods & close lock | `erp/periods.ts` | OPEN → SOFT_CLOSED → CLOSED, enforced by a journal `PostingGuard` |
| Revenue contracts (ASC 606 steps 1–4) | `erp/contracts.ts` | Performance obligations, relative-SSP allocation, billing schedules, versioned amendments |
| Revenue recognition (step 5) | `erp/revrec.ts` | Schedules, contract asset/liability pair, waterfall, roll-forward |
| Accounts payable | `erp/bills.ts` | Approval limits, segregation of duties, ITC handling, aging |
| Accruals / prepaids / depreciation | `erp/schedules.ts` | Straight-line, idempotent, auto-reversing accruals |
| Multi-currency | `erp/fx.ts` | Exact rational rates, period-end revaluation |
| Bank reconciliation | `erp/reconciliation.ts` | Tiered matching, zero-difference gate |
| SaaS metrics | `erp/metrics.ts` | MRR movement bridge, NRR/GRR, backlog |
| Multi-entity consolidation | `erp/consolidation.ts` | Translation, IC elimination, CTA as a *reported* plug |
| Close management | `erp/close.ts` | Checklist of executable checks, flux analysis, attributed waivers |
| Continuous agents | `erp/agents.ts` | Exceptions raised as proposals; humans approve |
| Integrations | `erp/connectors.ts` | Idempotent ingestion; CRM deals land as DRAFT |
| AI surface | `erp/tools.ts` | Ten read-only tools for the orchestrator |

## Design decisions that carried weight

**The close lock is real.** A `PostingGuard` registered on `JournalEngine` makes a closed period *unpostable*, rather than merely discouraged. `SOFT_CLOSED` freezes subledgers while still admitting close adjustments (accruals, revrec, FX, manual), which is the state the checklist runs in. Closing is sequential; reopening demands a stated reason and is logged.

**Exact allocation, always.** Relative-SSP allocation and every straight-line schedule sum to the amount being spread, to the paisa, with the rounding remainder assigned deterministically (largest SSP; final period). A contract whose parts don't sum to the whole is a restatement waiting to happen, so it is made impossible rather than tested for.

**The contract asset/liability pair is modelled properly.** Recognising ahead of billing debits *Unbilled Receivable*; billing ahead of recognition credits *Deferred Revenue*; a billing clears any unbilled balance before creating deferred revenue. Without this the deferred roll-forward needs a plug — with it, `opening + billed − recognised = closing` ties to the general ledger by construction.

> A regression test pins this: recognition before any billing must leave the roll-forward tying at zero. The first implementation moved the *whole* recognised amount through deferred revenue and reported a phantom difference; the test caught it.

**Idempotence everywhere the close touches.** Recognition, amortisation and depreciation are keyed by (item, period). Re-running a close after a correction posts nothing twice, which is what makes an automated close safe to re-run at all.

**Agents propose; humans dispose.** Every agent finding is a `Proposal` with an explicit status. Approving one is what posts the entry, and the entry is attributed to the approver, not the agent. There is no code path where an agent writes to the ledger unattended — the difference between automation a controller switches on and automation they switch off after the first surprise.

**Integrations never post on arrival.** A closed-won CRM deal becomes a DRAFT contract. The revenue treatment of a deal is an accounting judgement, not a CRM field. Ingestion is idempotent by external id, because webhooks retry and a finance system that double-books on a retry is worse than one that never synced.

**Flux analysis skips the first period.** There is nothing to vary from before the business has traded. Demanding an explanation for every line in month one is noise, not control.

## What is deliberately absent

- **No cross-entity posting.** Consolidation is a read-only projection; each entity keeps its own journal. Intercompany mismatches are surfaced, never netted away.
- **No AI-initiated money movement.** No payment tool exists, in the core or here.
- **No rate interpolation.** A missing FX rate throws rather than carrying a stale number forward.
- **Straight-line depreciation only.** WDV and component depreciation are real needs, but neither is guessable — they arrive when a user's books require them.
- **Still in-memory.** Postgres persistence (spec 001) remains the gating dependency for any of this being a product rather than an engine.

## Verification

`attachErp(org, …)` layers the suite onto an existing `Organization` without touching `organization.ts` — the SMB core is unchanged and its 140 tests still pass. 47 new tests cover allocation exactness, schedule totals, idempotence, the close gate, subledger tie-outs, FX refusal, consolidation elimination and the agent approval boundary.

`node demo/erp-close.js` runs a full quarter — CRM sync → contract → billing → recognition → subledgers → agents → close → lock — and prints the checklist, the tie-outs and the waterfall.
