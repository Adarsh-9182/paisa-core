# Spec 008 — Design-handoff app shell ("Paisa App.dc.html")

**Status:** Shipped (2026-07-12)
**Source:** `Paisa AI CFO Design System-handoff.zip` (claude.ai/design export, Adarsh, 2026-07-12) — primary design `Paisa App.dc.html`, tokens + 13-component bundle under `_ds/`.

## What this is — and the pivot it reverses

The handoff design is a full **app shell**: collapsible grouped sidebar (Overview / Money / Compliance / Operations), topbar with ⌘K command palette, and routed views — Dashboard, AI Assistant, Invoices, GST workspace, plus designed empty states for nine future areas. Implementing it **reverses spec 003's chat-only pivot**: the conversation is now one view of an operating surface, not the whole product. That is Adarsh's product call, made through design; recorded here so spec 003 reads as an era, not an error. The chat kept everything that made it Paisa (verifier, tool badges, uploads).

## Fidelity rules followed

- **Pixel-faithful, structure-free** (per the handoff README): the prototype's `sc-if`/`sc-for` SPA became Next.js routes + server components; visual output matches the design.
- **Real data only.** The prototype's demo content (Ananya/Meraki Textiles, ₹19.6L revenue, scripted `aiReply`) was **not** implemented. Every figure on every view comes from `lib/data.ts` engine getters; the scripted chat is replaced by the real verified `/api/chat`. Where the demo ledger has no data, the views say so honestly (₹0.00 GST, empty invoice table) rather than showing pretty fakes.
- **Design deviations, deliberate:** verified-badge + tool-name metadata under AI answers (the moat stays visible); theme toggle + sign-out in the topbar (existing features the mock omitted); the assistant's "Paisa remembers your business" footer replaced with the truthful verification line (no memory feature exists); reminder/invoice-creator buttons toast "coming soon" instead of pretending.

## Implementation map

- **Tokens** → `web/src/app/globals.css`: full handoff token system (orange/stone warm palette, light + dark via `[data-theme="dark"]`, radii/shadows/motion), with every legacy variable (`--ink`, `--blue`, `--line`…) aliased onto the new palette so pre-handoff surfaces (login/signup) rebrand instantly. Fonts → Plus Jakarta Sans + JetBrains Mono via `next/font`.
- **Components** → `components/ds/`: Button, IconButton, Badge, Avatar, StatCard, ScoreGauge — exact ports of the bundle specs.
- **Shell** → `components/shell/`: app-shell (sidebar/topbar), command-palette (⌘K; seeded with real open invoices), toast, icon vocabulary.
- **Views** → `(app)/page.tsx` dashboard (stats, in/out bars with hover tooltip, health gauge, recommendations with real confidence, deadlines, pending payments), `/assistant` (chat), `/invoices` (real table), `/gst` (position + filings + grounded explainer that hands off to the assistant), `[section]` (design's empty states verbatim).

## Verification

`tsc --noEmit` clean; all routes render on dev and production with live engine figures (real GSTR due dates, health score, month bars). Deployed 2026-07-12.

## Follow-ups

- Mobile responsiveness (design is desktop-first; sidebar collapse exists, no breakpoint work yet).
- The in-chat card vocabulary (figure/table/draft-approval cards) from the design discussion — this shell is its natural home.
- Rec dismiss/execute currently local + toast; wire to recommendation engine decisions when the approve-gate API lands.
