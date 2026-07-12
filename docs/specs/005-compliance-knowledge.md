# Spec 005 — Compliance knowledge base (`lookup_regulation`)

**Status:** Shipped (2026-07-11)
**Bible check:** ONE JOB — "understand where money goes + what to do next." Tax questions ARE money questions; today the agent can state *your* GST position but not *the law's* position. Capability ladder: still **See/Advise** — the knowledge base informs answers, it never posts or files anything.

## Why

Users ask "can I claim ITC on this?", "what rate applies to software?", "when is advance tax due?" — questions about the law itself, not their ledger. Before this spec the model either refused or (worse, with a weaker prompt) answered from memory. This spec gives it a citable, versioned source of law, wired through the same verifier as ledger figures.

## The Golden Rule extended to law

The invariant "the LLM never originates a number" now covers rates, thresholds, and section references:

- `lookup_regulation` searches a **curated corpus** (`src/knowledge.ts`) and returns matching passages as a tool result. Retrieved text joins the verifier corpus, so a narrated "18%" or "₹1,50,000" is traceable to a cited entry — a rate the tool never returned is rejected by `verifyNarration` like any invented balance.
- Every entry carries `source` (act, section, notification) and `asOf` (the date the entry was verified). The tool output instructs the model to surface both.
- **Zero-match honesty:** if retrieval finds nothing, the tool says so and the system prompt forbids answering from memory — the model must say the knowledge base doesn't cover it and point to a CA.
- **Honesty boundary:** the corpus is a snapshot, not a live feed of Gazette notifications. The guarantee is *"every legal figure is traceable to a dated, cited entry"* — not *"the entry is the law as of this morning."* Amendments are shipped by editing `knowledge.ts`, exactly as the master-prompt doc argued: law belongs in an updatable knowledge layer, not in model weights.

## Retrieval — deterministic, no embeddings

Tokenized keyword scoring: tag hit 3, title hit 2, body hit 1, summed over query tokens; score < 2 is noise and dropped; ties break by corpus order. No vector DB, no network, no nondeterminism — the same question always retrieves the same law, and the eval benchmark can pin exact rankings. When the corpus outgrows keyword search (hundreds of entries), the upgrade path is pgvector inside the Postgres from spec 001 — not a new service.

## Corpus v1 (15 entries)

GST: registration thresholds, two-slab rate structure (2025-09-22), software/IT services rate + export zero-rating, s.16 ITC conditions, s.17(5) blocked credits, composition scheme, return due dates, e-invoicing, reverse charge. Income tax: 44ADA, 44AD, new-regime slabs FY 2025-26, 80C/80CCD(1B)/80D, TDS (194J/194C/194-I), advance tax.

Formatting rule (test-enforced): no double quotes inside title/source/text — entries embed in `key="value"` tool output.

## Routing

- **AnthropicProvider:** the system prompt directs any question about the law itself to `lookup_regulation`, with a fixed compliance answer shape: short answer → rule + citation → assumptions → risks → next action → confidence (high/medium/low).
- **Offline planner:** a new first-position route matches law-shaped questions (rates, thresholds, sections, ITC eligibility, scheme names, TDS, advance tax…) and quotes retrieved entries verbatim. Questions about *this business's* position ("what's my GST position?") still fall through to `get_gst_position` / `get_upcoming_gst_filings` — live tools beat static law when the user means their own numbers.

## The eval benchmark

`tests/knowledge.test.ts` carries a golden benchmark: real user questions pinned to the entry that must answer them (mostly strict top-1). **Every corpus change must extend the benchmark.** It is the regression net that lets the corpus grow without retrieval rotting — and the seed of the master-prompt doc's "build a benchmark before deploying any model."

## Non-goals (v1)

- No live ingestion of CBIC/CBDT notifications — curation is manual and deliberate.
- No case law, no rulings, no state-specific variations beyond special-category thresholds.
- No Hindi corpus yet (the model may translate; the citations stay as-is).
- Not a substitute for a CA — the prompt labels judgment calls as advice warranting sign-off.

## Tests

33 in `tests/knowledge.test.ts`: corpus hygiene (cited, dated, format-safe), 20-case retrieval benchmark, determinism, zero-match behaviour, tool output format, verifier accept/reject integration, planner routing (law → knowledge base, own-position → live tools).
