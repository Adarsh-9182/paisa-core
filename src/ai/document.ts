/**
 * Uploaded documents for the chat (spec 004).
 *
 * A document reaches the agent as extracted TEXT, and that text is recorded
 * as a synthetic tool result (`read_attached_document`) so verifyNarration
 * can trace every figure the model quotes from it. CSV extraction is
 * deterministic (here); PDF/image extraction is a vision-model pass
 * (anthropic.ts) — auditable, not deterministic. See the spec's honesty
 * boundary.
 */

export type DocumentSource = "csv" | "pdf" | "image";

export interface UploadedDocument {
  readonly name: string;
  readonly source: DocumentSource;
  /** Extracted textual content — parsed CSV table or vision transcription. */
  readonly text: string;
}

/** Synthetic tool name under which a document's text enters the audit log. */
export const DOCUMENT_TOOL = "read_attached_document";

export const MAX_DOCUMENT_TEXT_CHARS = 20_000;

/** Cap extracted text so one upload can't blow out the model context. */
export const truncateDocumentText = (text: string): string =>
  text.length <= MAX_DOCUMENT_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_DOCUMENT_TEXT_CHARS)}\n[truncated]`;

/**
 * Parse one CSV line respecting double-quoted fields ("" escapes a quote).
 * No embedded-newline support — bank exports don't use them, and one bad
 * row degrading to text beats a stateful parser here.
 */
const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
};

/**
 * Deterministically normalize a CSV into a readable ` | `-separated table.
 * Figures pass through verbatim — same digits, commas, decimals — so the
 * narration verifier can match them exactly.
 */
export const parseCsvDocument = (name: string, raw: string): UploadedDocument => {
  const rows = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line).join(" | "));
  return {
    name,
    source: "csv",
    text: truncateDocumentText(rows.join("\n")),
  };
};
