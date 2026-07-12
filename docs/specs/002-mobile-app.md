# Spec 002: Mobile app (slice 1 — thin client)

**2026-07-09 · status: approved · Bible: §2.6, §2.7, §3, §12 Phase 1**

## Problem

The one-job MVP lives on the web, but the persona lives on their phone — CRED-generation users experience money apps as phone apps. PAISA needs a mobile surface without forking the brain.

## User story

As the first persona, I open paisa on my phone, sign in, see where my money went this month, and ask the AI what to do next.

## Design decisions

- **Thin client, one brain.** The Expo app calls the existing Next.js server (auth, engine, orchestrator). No engine code ships on the device; no figures are computed client-side (Bible §2.1). The web server gains JSON endpoints under `/api/mobile/*` that reuse the same `data.ts` getters pages use.
- **Session = the same HMAC cookie.** Mobile logs in via `POST /api/auth/login`, captures the `Set-Cookie` value, and replays it as a `Cookie` header (in-memory for slice 1; secure storage later).
- **Expo + TypeScript, minimal deps.** No navigation library in slice 1 — state-based screens (Login → Home | Ask tabs). Dark theme matching the web design tokens.
- **Dev networking:** the app targets the Mac's LAN address (`http://192.168.1.10:3000`) so a phone on the same wifi reaches the dev server; configurable in `mobile/lib/api.ts`.

## Success criteria

1. `GET /api/mobile/summary` (session-gated) returns brief + metrics + transactions + recommendations as JSON.
2. Mobile: demo login works; Home shows Income/Spending/Saved + recent transactions + next-step recommendations; Ask returns engine-grounded answers.
3. `tsc --noEmit` clean in `mobile/`.

## Data / API changes

- New route `web/src/app/api/mobile/summary/route.ts` (GET, auth-gated by middleware): `{ brief, metrics, transactions, recommendations }` — display-ready strings only (§9.5). Chat reuses the existing `/api/chat`.

## Out of scope (slice 1)

Push notifications, SMS parsing (Android, later phase), biometric auth, secure token storage, connect-bank flow in-app (Money page stays web for now), app store builds.

## Bible check

§2.6 features-as-plugins (mobile is a surface, not a second brain) · §2.7 evolve-don't-rewrite (reuses engine/API) · §9 display-ready data across the boundary.
