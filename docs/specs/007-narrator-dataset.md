# Spec 007 — The narrator dataset (Perplexity's process, Paisa-shaped)

**Status:** Shipped (2026-07-11)
**Bible check:** ONE JOB intact. No new user surface — this is the training-data layer for a future fine-tuned narrator, plus a retrieval refinement. Fine-tuning itself remains deferred (Bible §3); this spec makes the deferral *productive*: data accrues now, the trigger gets pulled when volume justifies it.

## The mapping

Perplexity's architecture, stage by stage, onto Paisa:

| Perplexity stage | Paisa equivalent | Status |
|---|---|---|
| Own web index + real-time search | Deterministic engines + regulation corpus | Shipped (core, spec 005) |
| Query understanding / reformulation | LLM tool-calling (Fable/GPT write the `lookup_regulation` query); keyword routes offline | Shipped |
| Hybrid retrieval + reranking | Field-weighted hit scoring + **BM25 tie-breaking** (this spec) | Shipped |
| Constrained generation with citations | `verifyNarration` + source/`verified_as_of` in every KB result | Shipped (specs 005/006) |
| **Sonar: fine-tuned narrator** | **This spec: the dataset pipeline** | Data shipping; training deferred |

## Retrieval upgrade

`searchKnowledge` keeps the spec-005 field-weighted hit score as the primary rank (the eval benchmark's pins hold by construction) and adds deterministic Okapi BM25 over entry bodies as the tie-breaker — graded term-frequency relevance instead of corpus order. No dependencies, no network. pgvector remains the upgrade path when the corpus outgrows keywords.

## "Fine-tune on financial data" — what that means here

Perplexity's lesson, applied precisely: **Sonar was fine-tuned on behaviour (cite, ground, be terse), never on knowledge (facts come from the index at query time).** The financial data a Paisa narrator trains on is therefore *verified Paisa conversations* — question + tool results → narration whose every figure passed `verifyNarration`. Not price series, not fraud tables: those teach a model to *originate* numbers, the one behaviour this product forbids.

`src/ai/dataset.ts`:

- **`generateSyntheticDataset(count, seed)`** — the deterministic engine as labeler. Seeded PRNG builds randomized small-business ledgers (6 months of revenue/expenses, coin-flip extras: overdue invoices with 18% GST, portfolio trades and marks, planted duplicate payments, deliberate empty states), asks route-varied questions through the same Orchestrator + verifier the product runs, and keeps only verified records. Same seed → byte-identical JSONL. 500 examples across 13 scenario families generate in ~100ms with zero discards.
- **`auditRecordToExample(record)`** — converts real chat audit records to the same format; refuses unverified records. This is the premium source once an LLM provider is live (usage → data, the Perplexity flywheel). Consent/persistence for real-conversation harvesting is future work — nothing is collected today.
- **Format** — one `{"messages":[system, user, assistant]}` per line; tool results are inlined in the user turn (train the narrator to generate only from provided context — Sonar-style), not function-call traces (tool-call *policy* training is a separate later dataset). Consumable by any open-weight SFT stack (Llama/Qwen chat templates).
- **`NARRATOR_SYSTEM`** — the distillation target: figures verbatim from tool results only, cite source + verified-as-of for law, name missing data, answer first.

## The pipeline as a bug-finder

Generating at scale immediately caught a routing mislabel: "How much GST do we **owe**?" matched the invoice route's bare `owes?\b` and was answered with receivables — same bug class as spec 006's b-ITC-oin. Fixed (`owes? (us|me)`); the dataset regenerated with 0 mislabeled GST examples. Every future generation run doubles as a routing audit.

## When to actually fine-tune (the recorded trigger)

Not before ALL of: (1) a working frontier-model provider in prod generating real verified conversations; (2) ≥10k high-quality examples with real-usage diversity, not synthetic-only; (3) an economic reason — latency or per-token cost that a LoRA'd open-weight model (Llama/Qwen class) served behind `LanguageModelProvider` would beat. The narrator slots in as a third provider in the existing chain; nothing else changes. Until then, the system prompt does what Sonar's fine-tune does, at zero training cost.

## Tests

6 in `tests/dataset.test.ts`: seed determinism (byte-identical), scenario coverage, self-grounding (every completion figure appears in its own prompt's tool results — the property the narrator must learn), valid JSONL, verified-only conversion, unverified refusal. 141 total across 10 suites.
