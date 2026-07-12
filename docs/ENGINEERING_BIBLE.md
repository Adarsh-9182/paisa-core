# The PAISA Engineering Bible

**Version 1.0 — 2026-07-08. A living document: every feature is specified against it, every amendment is dated.**

This is the source of truth for PAISA. When code and Bible disagree, one of them is wrong — fix whichever it is, on purpose. Nothing ships that contradicts this document; the document changes only by deliberate, dated amendment.

---

## 1. Vision

**PAISA is an AI agent for money — Claude Code for your finances.** The full founding vision — the AI Financial Operating System — lives in [`VISION.md`](./VISION.md) (Adarsh, 2026-07-09). That document is the destination; this Bible is the path. When they seem to conflict, the Bible's phasing wins: the vision is earned rung by rung.

One agent, connected to a user's real financial life, that can *see* everything, *understand* it deeply, *advise* with numbers that are never invented, and eventually *act* — always with permission, always audited.

### The capability ladder

Every roadmap decision maps to one rung. We do not skip rungs.

| Level | Capability | Status |
|---|---|---|
| **L1 — See** | Read every account, statement, holding (AA, uploads) | ✅ Built |
| **L2 — Understand & advise** | P&L, cash flow, goals, "can I afford X?" — verbatim engine figures only | 🔨 90% built; needs DB + live AI key |
| **L3 — Act with approval** | Agent drafts the action, human taps Approve, licensed rail executes | Phase 4 |
| **L4 — Act autonomously** | Standing instructions with hard caps ("auto-pay electricity under ₹2,000") | Phase 5 — earned last |

Claude Code lives at L3, not L4. So will PAISA for a long time. Trust is the product.

### First persona (the beachhead)

An Indian earner with **salary + investments + bills** who wants one agent watching all of it. Not "everyone" — everyone is the destination, this person is the doorway. Freelancers/solo founders are the adjacent second ring (the engine already speaks GST and invoices).

### The MVP is one job (decided 2026-07-08)

**Help the user understand where their money goes, and tell them what to do next.** This sentence is the acceptance test for every Phase 1–2 feature: if it doesn't help answer "where did my money go?" or "what should I do now?", it waits. The existing SMB surfaces (invoices, GST, taxes) stay in the codebase but get no new work until the one job is nailed.

### Why PAISA wins

Most AI finance apps are a chat model bolted onto a spreadsheet — they hallucinate balances. PAISA's AI is architecturally **incapable of inventing a figure**: every number comes from a deterministic double-entry engine, every action is audited, misquotes are caught and retried. In a category where trust is everything, that is the moat. The second moat is **memory** (§6): the agent that already knows your salary, rent, EMIs, and goals is the one you return to.

---

## 2. Non-negotiable principles

These are constitutional. A PR that violates one is rejected regardless of how good it looks.

1. **Figures come from engines, never from the model.** The AI narrates and reasons; deterministic code computes. Verbatim-figure rules in the orchestrator are load-bearing.
2. **Append-only truth.** State is derived by replaying an action log through the engines. Nothing is updated in place; corrections are compensating entries. (This is also what makes L3 approvals and audit trivial.)
3. **Money is `bigint` paise.** No floating point ever touches a monetary amount.
4. **Every financial action has: permission → verification → audit → rollback where possible → explicit confirmation if irreversible.**
5. **Agents are tools, not committees.** One orchestrator, many tools. A "Cash Flow Agent" is a `cash_flow` tool. A separate sub-agent is justified only by genuine context isolation (e.g., a future Tax Agent digesting statutes), and requires a Bible amendment.
6. **Features are plugins.** A feature = engine module + tool exposure + UI surface. The AI core never hard-codes knowledge of a feature; it discovers capabilities through the tool registry.
7. **Evolve, don't rewrite.** One language (TypeScript) end to end. The big rewrite is how projects die.
8. **Spec first.** Every feature starts as a spec (§13) reviewed against this Bible before code.
9. **External information is quarantined.** Web search / market data tools may inform *context*, never *the user's own figures*, and their outputs are labeled by source.
10. **The user owns their memory.** Everything the AI remembers about a user is visible, editable, and deletable by that user.

---

## 3. System architecture

### As it stands (all working today)

```
┌─────────────────────────────────────────────────────────┐
│  web/  — Next.js 16 (App Router, RSC) + Tailwind v4     │
│  Pages: dashboard · money · investments · invoices ·    │
│         taxes · reports · ask (chat) · settings         │
│  API:   auth · chat · banking · aa · portfolio ·        │
│         reports · recommendations                       │
└──────────────────────┬──────────────────────────────────┘
                       │  lib/engine.ts (org bootstrap + replay)
┌──────────────────────▼──────────────────────────────────┐
│  paisa-core  — deterministic TypeScript engine          │
│  journal · ledger · accounts · banking · statements ·   │
│  cashflow · forecast · portfolio · invoices · gst ·     │
│  recurring · rules · recommendations · health · brief · │
│  events (audit bus) · money (bigint INR)                │
│                                                         │
│  paisa-core/src/ai — the agent layer                    │
│  orchestrator (loop owner, executeTool, audit, retry) · │
│  provider (LanguageModelProvider interface) ·           │
│  anthropic (native tool_use loop) ·                     │
│  planner (offline CfoPlanner fallback) · tools          │
└─────────────────────────────────────────────────────────┘
  Persistence: .paisa-data/*.jsonl (action log, users,
  connections) — file-based, memory-only on serverless ⚠️
```

The ⚠️ is the biggest gap: on Vercel, all writes evaporate. §4 replaces the files with Postgres **without changing the replay philosophy**.

### Target additions (Phase 1–2)

- **Postgres (Neon, via Vercel marketplace)** — the action log, users, connections, conversations, documents, memories move from JSONL files to tables. Same append-only semantics; a table is just a JSONL file with superpowers.
- **pgvector** (Neon extension) — embeddings for memory recall (§6).
- **Vercel Blob** — uploaded statement files (PDF/CSV).
- **Sentry + PostHog** — added when first real users arrive (Phase 1.5), not before.
- **Background jobs (Inngest or similar)** — deferred until a parse takes >30s; inline first.

### Stack decisions and their reasons

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | One language for a solo builder; engine + AI layer already TS; Python/FastAPI adds a second runtime for zero capability |
| Frontend/backend | Next.js 16 (existing) | Working; RSC model fits engine-reads-on-server |
| Database | Neon Postgres + pgvector | Serverless-friendly, Vercel-native provisioning, one DB for relational + vectors |
| Auth | Keep custom (HMAC cookie + scrypt + Google OAuth) | It works, is audited code we understand, zero vendor lock. Revisit only when orgs/teams arrive |
| File storage | Vercel Blob | Simplest given Vercel deploy; swap-able behind one module |
| AI | Claude via existing `LanguageModelProvider` | Provider interface already abstracts vendors; multi-provider is a config change later, not an architecture change |
| SMS parsing | **Deferred to Android app** | Browsers cannot read SMS. On web: file upload + AA. SMS stays on the roadmap as the mobile killer feature |

---

## 4. Data & persistence

### Philosophy carried over

`store.ts` today: every user decision is one appended JSON line, replayed through engines on boot. Postgres version: **same design, table-shaped.** Engines remain the only source of derived state; the DB stores *events and documents*, not balances.

### Schema v1

```sql
-- Identity
users          (id, email UNIQUE, name, password_hash,        -- 'oauth:google' sentinel kept
                google_sub UNIQUE NULL, created_at)
orgs           (id, owner_id → users, name, created_at)        -- one org per user today; teams later

-- The truth
action_log     (id BIGSERIAL, org_id, seq, type, payload JSONB,
                actor, created_at)                             -- append-only; replayed on boot
                                                               -- types: recommendation | categorize |
                                                               -- add_account | import | trade | mark  (grows)

-- Connections & documents
connections    (id, org_id, provider, consent_ref, status, meta JSONB, created_at)
documents      (id, org_id, blob_url, filename, kind,          -- statement_pdf | statement_csv | other
                parse_status, parse_result JSONB, created_at)

-- Conversation & memory (§6)
conversations  (id, org_id, title, created_at)
messages       (id, conversation_id, role, content, tools_invoked JSONB, created_at)
memories       (id, org_id, kind, content TEXT,                -- kind: fact | goal | preference | obligation
                embedding VECTOR, source_message_id NULL,
                confidence, superseded_by NULL, created_at, updated_at)

-- Performance/history (derived, rebuildable — the ONE cache we allow)
net_worth_snapshots (org_id, as_of DATE, figures JSONB, PRIMARY KEY(org_id, as_of))
```

Rules: no `UPDATE` on `action_log` ever; `memories` supersede rather than overwrite (`superseded_by`); snapshots may be deleted and rebuilt at any time.

### Migration path

1. Add a `Store` interface with the current file implementation and a Postgres implementation behind it.
2. `PAISA_DATABASE_URL` present → Postgres; absent → files (local dev keeps working offline).
3. One-shot import script: existing `.paisa-data/*.jsonl` → tables.

---

## 5. The tool framework

The heart of "features are plugins." The orchestrator owns the loop; tools are the only way the model touches the world.

### Tool contract

Every tool registers:

```ts
{
  name: string;                  // snake_case, verb_noun: get_cashflow, draft_trade
  description: string;           // written for the model; includes when NOT to use it
  input: ZodSchema;              // validated before execution — always
  tier: "T0" | "T1" | "T2" | "T3";
  execute(ctx: AgentContext, input): ToolResult;  // figures formatted by engine, never by model
}
```

### Permission tiers

| Tier | Meaning | Examples | Gate |
|---|---|---|---|
| **T0** | Read | `get_cashflow`, `get_holdings`, `get_pnl` | none |
| **T1** | Write to PAISA's own records (reversible via compensating entries) | `categorize`, `add_account`, `record_trade` | logged + undoable |
| **T2** | External money movement or irreversible external effect | `place_order`, `pay_bill` | **explicit per-action user confirmation in UI**; the model can only *draft* |
| **T3** | Standing autonomous permission | auto-pay rules | Phase 5; per-rule opt-in with hard caps |

The orchestrator enforces tiers — a T2 tool physically cannot execute without a confirmation token minted by the UI. The model never sees or forges that token.

### Adding a tool (the plugin recipe)

1. Engine capability exists (or add a module to `paisa-core/src/`).
2. Register the tool in `src/ai/tools.ts` with schema + tier.
3. Orchestrator audit picks it up automatically (`toolsInvoked` already surfaces in chat UI).
4. Spec (§13) says which tier and why.

Phase 3 is *this list growing* — calculators, charts, goal planner, recurring detection, report generation — not new "agents."

---

## 6. Memory (the moat)

**Goal:** every conversation improves PAISA's model of the user. The agent that already knows your salary date, rent, EMIs, parents' support, emergency fund target, and risk tolerance is the one you can't leave.

### What gets remembered

`fact` (salary ₹X on the 1st, rent ₹Y), `obligation` (EMIs, insurance premiums, subscriptions), `goal` (emergency fund of 6 months by Dec), `preference` (risk tolerance, investment style, "don't suggest crypto").

### Pipeline

1. **Extraction** — after each chat turn, a cheap model pass proposes memory candidates from the conversation + tool results. High-confidence facts also come from engines directly (recurring salary detected by `recurring.ts` → memory candidate).
2. **Storage** — `memories` row + embedding. Conflicts supersede (`superseded_by`), never silently overwrite.
3. **Recall** — before each agent run: all `obligation`/`goal` memories (they're few and vital) + top-k vector matches for the current question, injected into the system prompt as *context, clearly separated from engine figures*.
4. **Control** — a Memory page in Settings: view, edit, delete. Principle 10 is a feature, not a checkbox.

### Boundaries

Memories inform tone, context, and *what to compute* — never the numbers themselves. "You said your rent is ₹30,000" is a memory; the rent actually paid last month comes from the ledger.

---

## 7. Security model

- **Auth:** HMAC-SHA256 session cookie (Web Crypto), `secure` + `httpOnly` in production; scrypt password hashing; hand-rolled Google OAuth keyed by `sub`. Middleware gate with explicit `PUBLIC_PATHS`.
- **Secrets:** env only (`PAISA_SESSION_SECRET`, `ANTHROPIC_API_KEY`, `PAISA_DATABASE_URL`, AA + Google creds). Never in code, never logged, never in this repo. Production secrets live in Vercel env.
- **Tenancy:** every query is org-scoped; `org_id` comes from the session, never from the client.
- **AI safety rails:** verbatim-figure enforcement + one corrective retry; refusals fall back to the offline planner; T2+ actions require UI-minted confirmation tokens (§5); prompt-injection stance: tool outputs are data, not instructions — the orchestrator strips/labels external content.
- **Rate limiting:** existing `rate-limit.ts` on auth + chat routes.
- **Compliance posture (India):** DPDP Act applies — memory visibility/deletion (§6) doubles as our data-rights surface. AA data handled per consent artefacts (purpose-bound, revocable — `api/aa/revoke` exists). Execution rails (Phase 4) only via licensed partners: brokers (SEBI-regulated), BBPS/UPI (RBI-regulated). PAISA never holds funds.

---

## 8. Design system & UX principles

- **Identity:** dark-first cool graphite + electric blue (cyan/emerald/purple accents). Elegant light mode. Tokens are semantic CSS vars in `web/src/app/globals.css` (`:root` + `[data-theme="dark"]`), exposed via Tailwind `@theme inline` (`bg-surface`, `text-ink`, `border-line`, …). Never hard-code a color.
- **Theme:** `next-themes`, `attribute="data-theme"`, default dark.
- **Charts:** categorical vars `--chart-1..6` + `--chart-pos/neg/forecast/grid/axis`, theme-flipping, dataviz-validated. Re-validate if series colors change.
- **Primitives:** hand-authored on Radix + CVA in `components/ui/` (never `shadcn init` — it fights Tailwind v4/Next 16). Motion in `components/motion/`, all gated on `useReducedMotion`.
- **UX principles:** the agent shows its work (real `toolsInvoked`, verified state — "AI is alive" surfaces are grounded in the real audit bus, never faked); numbers are always attributable; destructive/irreversible actions get friction, everything else gets none; empty states teach.

---

## 9. API conventions

Existing surface: `api/auth/{login,signup,logout,google,google/callback}`, `api/chat`, `api/banking/{account,import,categorize}`, `api/aa/{connect,approve,sync,revoke,callback}`, `api/portfolio/{trade,mark}`, `api/reports/[name]`, `api/recommendations/[id]/[action]`.

Conventions for all routes, existing and new:

1. Session required unless in `PUBLIC_PATHS`; org resolved server-side.
2. Validate every body with a schema; malformed input → 400 with a terse message, no internals.
3. Mutations append to `action_log` and return the engine-derived result (never echo the request back as truth).
4. Chat accepts sanitized `history` (≤12 turns); the model's context is assembled server-side only.
5. Display-ready strings/numbers cross the API boundary — formatting happens server-side with engine formatters.

---

## 10. Coding standards

- **TypeScript strict.** No `any` without a dated comment explaining why.
- **Next 16 is not the Next you know:** consult `web/node_modules/next/dist/docs/` before using framework APIs (per `web/AGENTS.md`).
- **RSC boundary is load-bearing:** pages are server components reading `lib/data.ts`; only display-ready strings/numbers cross to client components. **Never pass a function prop from a server page to a client component** (known 500; pass a string key like `format="inr"` resolved client-side).
- **Money:** `bigint` paise via `money.ts` (`parseINR`/formatters). A `number` holding rupees is a bug.
- **Engine changes require engine tests** (Vitest; suite currently 74/74 — it stays green).
- **No duplicated components** — extend `components/ui/` primitives; check before creating.
- **No dead code, no "we'll fix it later" TODOs without an issue reference.**
- Comments state constraints the code can't express; not narration.

---

## 11. Testing strategy

| Layer | How | Gate |
|---|---|---|
| Engine (`paisa-core/src`) | Vitest unit tests per module; property-style tests for money math | Every engine PR |
| AI layer | Orchestrator tests with fake provider (exists: `tests/orchestrator.test.ts`); verbatim-figure + retry paths covered | Every AI PR |
| API | Route tests for auth gate + validation on new endpoints | New routes |
| Smoke | Demo login (`adarsh`/`paisa123`) → dashboard renders → chat answers with engine figures | Before every deploy |
| Manual | Feature's spec lists its "watch a real user do it" script | Phase 1.5 onward |

---

## 12. Roadmap

### Phase 1 — the Financial Brain (now)

North star: the one-job MVP (§1) — where does my money go, and what do I do next. The product must become incredibly good at *understanding* money before it touches any. Out of scope: payments, trading, execution, and new work on SMB surfaces (invoices/GST/taxes).

| # | Deliverable | Notes |
|---|---|---|
| 1.1 | **Postgres persistence** | §4 migration; kills the memory-only ⚠️. Non-negotiable before any real user |
| 1.2 | **Live AI** | `ANTHROPIC_API_KEY` in local + Vercel env; verify provider loop + fallback in prod |
| 1.3 | **File upload + statement parsing** | Vercel Blob + `documents` table; PDF/CSV → engine `statements.ts` → same `import` action as AA/manual (one ingestion gate, three sources) |
| 1.4 | **Monthly report + insights** | Builds on existing `reports` + `brief.ts`; the "wow" artefact users share |
| 1.5 | **First 5 real users** | Sentry + PostHog in; watch them; their confusion is the roadmap |

### Phase 2 — Memory (§6)

Extraction pipeline → recall injection → Memory page. Exit test: a returning user asks "can I afford a ₹40k phone?" and the answer uses their remembered salary, rent, and goals without being told.

### Phase 3 — Tool library growth (§5)

Financial calculators (SIP, EMI, tax estimate), charts-as-tool, goal planner, recurring/subscription surfacing, richer report generation. No new agents — new tools.

### Phase 4 — Execution rails (L3)

One rail at a time, approval-gated (T2): broker API first (Zerodha Kite — draft order → Approve → execute → verify → ledger), then BBPS bills. Requires partner/licensing work alongside code.

### Phase 5 — Autonomy (L4)

Standing instructions with hard caps and monthly statements of what the agent did. Only after Phase 4 has earned trust.

### Cadence

Daily tangible output, spec-first: each work session starts by writing/updating the feature's spec against this Bible, ends with something demonstrable. Order within Phase 1: 1.1 → 1.2 (same day) → 1.3 → 1.4 → 1.5.

---

## 13. Feature spec template

Every feature gets this, written *before* code, checked against §2:

```markdown
# Spec: <feature>            (date, status: draft|approved|built)
**Problem** — one paragraph, from the user's point of view.
**User story** — as <persona §1>, I want <x> so that <y>.
**Success criteria** — observable behaviors; how we demo it.
**Engine changes** — modules touched / added (+ tests).
**Data changes** — action_log types, tables, migrations.
**API contract** — routes, request/response shapes.
**Tool exposure** — tool name, tier (§5), description for the model.
**UI** — pages/components; which primitives reused.
**Out of scope** — what this deliberately does NOT do.
**Bible check** — which principles (§2) this touches and how it complies.
```

Specs live in `docs/specs/`, named `NNN-feature-name.md`, numbered in build order.

---

## 14. Working with Claude (prompt library)

When briefing Claude Code on a feature: reference the spec file and the Bible sections it touches; state what exists (don't let it rebuild); require engine tests green; forbid new dependencies unless the spec names them. Reusable prompt skeletons live in `docs/prompts/` as they prove themselves.

---

*Amendments: none yet. Propose one by PR editing this file with a dated entry here.*
