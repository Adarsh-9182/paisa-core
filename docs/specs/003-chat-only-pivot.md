# Spec 003: Chat-only pivot — paisa becomes a grounded financial AI

**2026-07-09 · status: approved · Bible: §1, §2.1, §2.7, §12**

## Decision

paisa's entire product surface becomes **one thing: a conversational financial AI**, grounded in the user's real financial data. The chatbot is the whole app. Every other screen (dashboard, money, invoices, taxes, investments, reports, settings) is removed from the product.

This is a **scope cut, not a rewrite.** The deterministic engine, the AI orchestrator, `/api/chat`, auth, and the data-ingestion routes all stay — they are the "brain" that makes the chatbot's answers real. Only the extra *UI surfaces* are removed.

## Why grounded, not general

A financial-advice chatbot with no access to the user's money is ChatGPT with a system prompt — no moat, infinite competitors. paisa's one durable advantage (Bible §1) is that its AI **never invents a number**: every figure comes from the engine, verified. The chat therefore stays wired to the engine; "Can I afford X?" is answered from the real ledger.

## What changes

**Kept (the brain + the door):**
- `paisa-core` engine, `src/ai/` orchestrator + Fable 5 provider
- `POST /api/chat` (the grounded, verified chat endpoint)
- Auth (`/login`, `/signup`, session middleware), `/welcome`
- Data-ingestion API routes (`api/aa/*`, `api/banking/*`) — so the chat can be about *real* money later
- Persistence layer (spec 001)

**Removed from the product (archived, not deleted — moved to `web/_archived/`):**
- Route pages: `money`, `invoices`, `taxes`, `investments`, `reports`, `settings`, `ask`
- The dashboard home (`(app)/page.tsx` → replaced by the chat)
- Sidebar, top-bar-with-embedded-chat, mobile tab bar, command palette (no longer routed)

**New:**
- `components/chat/conversation.tsx` — the full-screen chat (client), reusing the proven `/api/chat` logic from the old top bar
- `(app)/page.tsx` → renders the conversation; chat is now the home
- `(app)/layout.tsx` → minimal chat shell (brand · theme toggle · sign out), no nav

## Success criteria

1. Logging in lands directly on a full-screen chat.
2. Asking "where did my money go last month?" returns a verified, engine-grounded answer.
3. No dead links; the removed pages 404; nothing 500s.
4. `tsc --noEmit` clean; engine tests stay green.

## Safety

`web/src/` was backed up to `src.backup-before-chatpivot-*` before any change (web is not in git). Removed pages are *moved* to `web/_archived/`, recoverable.

## Bible check

§1 (the one-job MVP, now literally the only job) · §2.1 (figures from the engine, never the model — preserved) · §2.7 (evolve, don't rewrite — engine + API untouched) · §12 (Phase 1 brain, sharpened to its core).
