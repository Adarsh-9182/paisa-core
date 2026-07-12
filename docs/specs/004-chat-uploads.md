# Spec 004 — Chat file & camera uploads

**Status:** In progress (2026-07-10)
**Bible check:** ONE JOB — "understand where money goes + what to do next." Uploads feed the chat more real data (statements, bills, receipts); they add no new surface. Capability ladder: still **See/Advise** — an upload never posts anything.

## Why

Phase 1.3 of the roadmap. Users hold their financial life in CSVs, PDF statements, and photos of receipts. Today the chat only sees the seeded ledger. This spec lets a user attach a document (or point their phone camera at one) and ask questions about it — with every quoted figure still machine-verified.

## The Golden Rule extension

The verifier (`verifyNarration`) requires every narrated figure to be traceable to a tool result. Uploads obey it by making the **extraction itself a recorded tool result**:

- The extracted document text is seeded into the turn's `toolsInvoked` as a synthetic record — tool name `read_attached_document`, result = the extracted text. It appears in the audit log like any engine tool call, and the verifier corpus includes it automatically.
- The document text is appended to the user turn as context, so both AnthropicProvider and the offline planner see it without needing a new callable tool.
- **Honesty boundary:** for PDFs/photos, extraction is done by the vision model, not a deterministic parser. The guarantee is therefore *"every figure is traceable to the recorded extraction"* — not *"the extraction is perfect."* The UI keeps the existing verified badge semantics; the audit trail shows exactly what was extracted.

## Parsing paths

| Type | Path | Works offline (no API key)? |
|------|------|------------------------------|
| CSV (`text/csv`) | Deterministic parse in core (`parseCsvDocument`) — quotes/commas handled, normalized to ` \| `-separated rows | Yes |
| PDF (`application/pdf`) | Claude vision extraction pass (`extractDocumentText`) — native document block, no pdf lib | No — friendly "connect the AI model" reply |
| Image (jpeg/png/webp/gif) | Same vision extraction pass, image block | No — same friendly reply |

Extraction prompt orders verbatim transcription: exact digits, commas, decimals, currency symbols; tables as ` | ` rows; no summarising, no computing.

## Verifier adjustment

CSV/extracted amounts often lack the ₹ symbol (e.g. `1,45,000`). The model naturally narrates them as `₹1,45,000`, which the strict corpus check would reject. `verifyNarration` gains one principled fallback: a ₹-prefixed figure also passes if its bare numeral form appears in the corpus. The digits are the fact; ₹ is presentation.

## Limits

- File cap **3 MB** (base64 ≈ 4 MB — stays under Vercel's 4.5 MB route body limit). Enforced client and server side.
- Extracted/parsed text truncated at **20,000 chars** with an explicit `[truncated]` marker.
- Allowed types: `text/csv`, `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`. Anything else → 400 with a readable message. (iOS Safari auto-converts HEIC → JPEG on upload.)

## API

`POST /api/chat` body gains optional
`attachment: { name: string, mediaType: string, dataBase64: string }`.
Server decodes, validates type + size, produces `UploadedDocument { name, source: "csv"|"pdf"|"image", text }`, passes it to `orchestrator.ask(...)`.

## UI (composer)

- **Paperclip** button → hidden `<input type="file" accept=".csv,application/pdf,image/*">`.
- **Camera** button → hidden `<input type="file" accept="image/*" capture="environment">` — opens the rear camera on mobile browsers; on desktop it degrades to a file picker (documented, accepted).
- Selected file shows as a removable chip above the textarea; sends with the next message; the user bubble shows a small attachment tag. Client-side size/type validation with an inline error line.

## Non-goals (v1)

- No document storage — the attachment lives only in the request (persistence is spec 001 / Phase 1.1 territory).
- No multi-file attach; one document per message.
- No OCR fallback without an API key.
- Statement *import* (posting to the ledger) stays with the existing importer/AA flows — chat uploads are read-only analysis.

## Tests

- Core: CSV parser (quotes, commas, blank lines, truncation); orchestrator with document — figure from doc verifies, foreign figure still rejected, synthetic audit record present; verifyNarration ₹-fallback.
- Web: tsc + manual smoke via dev server.
