# PAISA — North Star ("Cursor for Finance")

*Adarsh's master build vision, recorded 2026-07-09. This is the **destination**. The [Engineering Bible](./ENGINEERING_BIBLE.md) is the **path**, and [VISION.md](./VISION.md) is the human-language manifesto. When this document and the Bible seem to conflict, the Bible's decisions win — they are deliberate, reasoned, and dated. This file is the mountain; the Bible is the trail up it.*

---

## Reconciliation — what's already true, what's next, what's deliberately deferred

The vision below is excellent and largely **matches what paisa already is or plans to be.** Mapping it honestly:

### Already built (2026-07)
- **Grounded AI that never hallucinates + cites its source** — the verifier rejects any figure not traceable to a tool result. This is the doc's "Never hallucinate financial information. Always cite the data source" — *done, and it's paisa's moat.*
- **AI chat** — the whole app, shipped 2026-07-09.
- **Auth (email + Google)** — passkeys/Apple/2FA/biometric are roadmap.
- **Account Aggregator** integration — built (sandbox verified).
- **Immutable transaction history + audit logs + event sourcing** — the append-only action log *is* event sourcing.
- **Persistence (Postgres) ready for encryption at rest** — built (spec 001).
- **Premium dark-first design system** — built (Tailwind v4, Framer Motion, hand-authored primitives).
- **Phased roadmap** — the Bible's Phases 1–5.

### Deliberate stack decisions that OVERRIDE this doc (with reasons — Bible §3)
- **TypeScript end-to-end, NOT Python/FastAPI.** Everything in this doc works in TS; a Python rewrite = the "big rewrite" that kills projects, months lost, two languages to maintain for zero capability gained. **Kept: TypeScript.**
- **Fable 5 behind a provider interface, NOT multi-model routing now.** The `LanguageModelProvider` interface already abstracts vendors — adding OpenAI/Gemini/local later is a config change, not an architecture. Building multi-model routing for zero users is premature. **Deferred.**
- **Hand-authored Radix + CVA primitives, NOT `shadcn init`.** shadcn's init fights Tailwind v4 / Next 16 (Bible §8). **Kept: hand-authored.**
- **Kafka / Celery / GraphQL / microservices / "millions of users, horizontal scale" — DEFERRED until there is scale to justify them.** Building for millions before you have ten real users is the single most common startup-killer. Postgres + the current server handle the first thousands of users comfortably. These become *good problems to have* — and a week of work each — when traffic demands them. Adding them now is pure delay. **Deferred, on purpose.**

### Roadmap alignment (this doc's phases → Bible phases)
- Doc Phase 1 (auth, chat, analytics, budgets, goals, reports) ≈ **Bible Phase 1** (the Financial Brain) — in progress.
- Doc Phase 2 (bank/AA, investments, loans, insurance, tax) ≈ **Bible Phase 1.3 + Phase 3**.
- Doc Phase 3 (copilot, memory, cash-flow prediction) ≈ **Bible Phase 2 (memory) + Phase 3 (tools)**.
- Doc Phase 4 (marketplace) — new, lands after trust is earned.
- Doc Phase 5 (AI CFO, autonomous) ≈ **Bible Phase 4–5** (approval-gated execution).

**The one rule that keeps this vision from killing the product: make it work for 10 users, then 1,000, then a million — in that order, never skipping.**

---

## Addendum 2026-07-11 — the "AI CA master prompt" reconciled

A second vision doc arrived (the "Paisa AI master prompt": CA + GST consultant + bookkeeper + CFO in one system). Reconciled the same way:

### Its core advice was already our architecture
"Knowledge + RAG + tools + reasoning **before** fine-tuning" — paisa went further: deterministic engine + verified tools. Its "never hallucinate financial laws / always cite" is our verifier, now extended to law (spec 005).

### Taken from it (shipped 2026-07-11, spec 005)
- **Compliance knowledge base** — `src/knowledge.ts`: curated, cited, dated corpus of GST + income-tax provisions; 20th tool `lookup_regulation`; retrieved passages enter the verifier corpus, so legal figures obey the same no-LLM-numbers invariant as ledger figures. Zero match → say so, never answer law from memory.
- **Eval benchmark before deployment** — golden retrieval benchmark in `tests/knowledge.test.ts`, extended with every corpus change.
- **Compliance answer shape** — short answer → rule + citation → assumptions → risks → action → confidence, in the system prompt.

### Overridden (same reasons as above)
- **Qwen/Llama + LoRA fine-tuning** — its own argument ("fine-tuning is not how you teach laws; they change and belong in an updatable knowledge base") is the argument against its plan. Corpus updates are file edits, not training runs. The provider interface already abstracts models. **Deferred.**
- **LangGraph/PydanticAI** — the Python rewrite in disguise; the TS orchestrator exists and is tested. **Kept: TypeScript.**
- **Qdrant/Weaviate/Milvus** — retrieval is deterministic keyword scoring today; upgrade path is pgvector inside spec-001 Postgres when the corpus demands it. **Deferred.**
- **PaddleOCR/Docling** — spec 004's vision-extraction path with its honesty boundary already covers documents. **Kept.**

### Open tension, deliberately unresolved
That doc is B2B (CA/SME/GST consultant); this file is consumer-first. The engine serves both — the knowledge layer pays off more in the B2B framing. Which audience the next quarter serves is a product call, recorded here so it gets made consciously, not by drift.

### Same-day follow-up — "Don't answer questions. Do work." + the laboratory rule
Third vision doc of 2026-07-11. Two things in it are load-bearing:

**The product thesis** — Paisa should *do the work* (prepare GSTR-1, draft journal entries from an uploaded balance sheet, compute "invest ₹70,000 in ELSS → save ≈₹21,000"), not explain concepts. This is the right north star for Phase 2+ and it extends the existing propose→approve pattern (`propose_categorization` is the template: the AI drafts, the human approves, the engine posts). The six "AI modules" (Tax Expert / Accountant / Auditor / CFO / Analyst / Compliance) are personas over the one tool set — CFO, Auditor (screening), Analyst (forecast/health), Tax Expert (knowledge base) and Compliance (filing calendar) already have their tools; the genuinely missing do-work capabilities are: **GSTR-1 draft preparation from the ledger, journal-entry drafting from uploaded documents, personalized tax computation (old-vs-new regime, 80C headroom), depreciation schedules, and reconciliation proposals.** All deterministic-engine work behind approve gates — no invariant bends.

**The stack section** re-proposes FastAPI/Python/Redis/vector-DB — already overridden above (TypeScript end-to-end; pgvector when needed). One amendment: **PyTorch "for experimentation" is IN — as a lab sidecar, never in the serving path.** Experiments live outside the product; what graduates into prod does so as a deterministic-at-inference tool.

**The first engineering rule** (recorded verbatim, binding on how Claude is used): *"We are not going to ask Claude to build Paisa while we watch... Claude can write repetitive code. It cannot learn on your behalf."* Feature work is split: Claude builds harnesses, plumbing, tests, and surface code; Adarsh hand-writes the learning-critical core (embeddings, extraction, eval methodology, agent policies). The eval benchmarks make his implementations measurable against baselines.

### Same-day follow-up (spec 007) — the Perplexity mapping
Perplexity's full pipeline mapped onto paisa (table in spec 007): index→engines, reformulation→tool-calling, hybrid retrieval→hit-score + BM25 tie-break (shipped), citations→verifier (shipped), and Sonar→**the narrator dataset pipeline** (shipped: `src/ai/dataset.ts`, seeded synthetic verified conversations + audit-record exporter, training-ready JSONL). Fine-tuning stays deferred with a recorded trigger: working provider in prod + ≥10k real-usage examples + an economic reason. Sonar's lesson, kept: fine-tune behaviour, never knowledge.

### Same-day follow-up (spec 006)
Multi-model shipped the Bible way: GPT-5.6 joined Fable 5 behind the existing provider interface (~100 lines, config change — exactly why fine-tuning/multi-model routing was deferred, not built early). A request to fine-tune on public tabular datasets (fraud/NYSE/S&P/BTC/bank-marketing) was declined and the reasoning recorded in spec 006's dataset table: frontier models don't offer it, tabular data is classifier fuel not LLM corpus, and teaching a language model to memorize prices is the exact failure mode the verifier exists to prevent. Each dataset's intent got an architecture-correct home instead (screening tool, health score, explicit marks).

---

## The vision (as written by Adarsh)

# PAISA OS MASTER BUILD PROMPT

Build **PAISA**, an AI-powered Financial Operating System for humans. This is NOT another budgeting app. The vision is the **Cursor for Finance** — the single place where every person's financial life exists. One application. One AI. One memory. One interface. The AI understands the user's complete financial life exactly like Cursor understands an entire codebase: instead of reading files it reads financial history; instead of editing code it improves financial decisions; instead of fixing bugs it fixes money problems.

**Core philosophy:** the AI should never behave like a chatbot — it should behave like a financial operating system. Every screen should make the user feel "I finally understand my money."

**Product principles:** simplicity, hidden complexity, fast, beautiful, premium, minimal. Apple-level interaction, Linear-level animation, Stripe-level polish, Cursor-level intelligence, Notion-level simplicity. Every interaction intentional; no clutter, no ugly dashboards.

**Design system:** Next.js, React, TypeScript, TailwindCSS, Framer Motion, shadcn/ui. Glassmorphism where appropriate, rounded corners, soft shadows, fluid transitions, micro-interactions, dark-mode-first, responsive, mobile-first, desktop-optimized, 60 FPS.

**Authentication:** email, Google, Apple, passkeys, 2FA, biometric, session management, role-based permissions, device management.

**Financial data layer:** bank accounts, UPI, credit/debit cards, loans, mutual funds, stocks, insurance, FDs, EPF, NPS, salary accounts, subscriptions, bills, tax documents, PDF statements, emails, SMS, manual transactions, Account Aggregator, future Open Banking.

**Financial memory engine:** every financial event stored as structured knowledge (merchant, category, subcategory, location, time, payment method, recurrence, behavioral pattern, budget impact, goal impact, risk score; mood inference only at high confidence). Continuously builds long-term memory of the user's behavior.

**AI brain:** orchestration layer, multiple models (OpenAI, Claude, Gemini, local LLMs) with automatic routing (cheap models for simple queries, powerful for complex), conversation memory, RAG, tool calling, structured outputs, long-term memory, planning, reflection, self-correction before responding. Never hallucinate; always cite the data source for every insight.

**AI capabilities:** answer financial questions; analyze spending; detect waste; explain investments; forecast cash flow; predict expenses; create budgets; suggest savings; detect unusual transactions; compare products; recommend allocation; explain taxes/insurance/loans; track goals; build reports and monthly/annual summaries; financial health score; transparent recommendations with reasons.

**Agent system:** execute actions — pay bills, schedule payments, increase SIPs, pause subscriptions, create reminders, transfer money, generate tax reports, compare loans, recommend insurance, optimize savings. Every action requires explicit confirmation; never perform irreversible financial actions automatically.

**Knowledge graph:** represent relationships between income, expenses, assets, liabilities, goals, investments, insurance, loans, subscriptions, dependents, employers, tax records, products — reason over relationships, not isolated transactions.

**Backend:** Python, FastAPI, PostgreSQL, Redis, Celery, Kafka where appropriate, REST, GraphQL where beneficial, vector database, background workers, rate limiting, caching, event-driven, horizontally scalable.

**Database:** normalized records, immutable transaction history, event sourcing where appropriate, audit logs, soft deletes, version history, encryption at rest and in transit.

**AI memory:** short-term conversation + long-term financial memory, semantic search, embeddings, vector DB, hybrid search, memory compression/summarization, context prioritization.

**Security:** bank-grade, AES-256, TLS everywhere, secrets management, SOC2-ready, audit logs, least privilege, RBAC, fraud detection, prompt-injection protection, PII masking, rate limiting, security headers, input validation, OWASP, regular pen-testing.

**Compliance (design for future):** RBI guidelines, Account Aggregator ecosystem, PCI-DSS, GDPR, ISO 27001, data localization, consent management, privacy-first.

**Performance:** page load < 2s, API latency < 200ms where practical, millions of users, streaming responses, background processing, optimistic UI, offline support, incremental sync.

**Developer experience:** monorepo, clear structure, reusable components, testing, CI/CD, feature flags, observability, logging, metrics, tracing, documentation.

**Roadmap:**
- Phase 1 — auth, dashboard, manual transactions, AI chat, expense analytics, budgets, goals, reports.
- Phase 2 — bank integrations, Account Aggregator, investment/loan/insurance tracking, tax reports.
- Phase 3 — AI financial copilot, autonomous planning, cash-flow prediction, financial memory, investment intelligence.
- Phase 4 — marketplace (insurance, loans, mutual funds, advisors).
- Phase 5 — AI CFO, fully personalized financial operating system.

**Coding standards:** production-quality, no shortcuts, strong typing, scalable architecture, clean code, SOLID, repository pattern where appropriate, proper error handling, reusable components, accessibility, comprehensive testing. Every major architectural decision includes why it was chosen and its trade-offs. For each feature: technical design → production code → tests → documentation. Objective: the best AI-native financial operating system in the world — scalable, secure, intelligent, exceptional UX.
