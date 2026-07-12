/**
 * Persistence — an append-only action log, the same philosophy as the journal.
 *
 * Every user decision (approve/dismiss a recommendation, categorise a bank
 * line, record a trade, mark a price) is appended as one JSON record and
 * replayed through the real engines. Nothing is ever updated in place; the
 * engines re-derive all state from the seed + the log.
 *
 * Two backends behind one async API (spec 001):
 *   PAISA_DATABASE_URL set → Postgres `action_log` table
 *   otherwise             → local JSONL file (PAISA_DATA_DIR overrides where);
 *                           on read-only filesystems writes degrade to
 *                           memory-only for the life of the instance.
 *
 * `fetchActionsAfter` + `applyActions` support incremental replay: the engine
 * singleton applies only actions it hasn't seen, so multiple server instances
 * converge on the same state (seq = line number in file mode).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Organization } from "paisa-core";
import { parseINR, parseQty, type InstrumentKind, type TradeSide } from "paisa-core";
import { getDb, usingPostgres, ORG_ID } from "./db";

export type PersistedAction =
  | { type: "recommendation"; id: string; action: "approve" | "dismiss"; actor: string; at: string }
  | { type: "categorize"; reference: string; accountId: string; actor: string; at: string }
  | {
      type: "add_account";
      id: string;
      code: string;
      name: string;
      openingINR?: string; // "1,50,000" — posts an opening balance entry on replay
      openingDate?: string;
      actor: string;
      at: string;
    }
  | {
      type: "import";
      bankAccountId: string;
      lines: { date: string; description: string; amountINR: string; reference: string }[];
      actor: string;
      at: string;
    }
  | {
      type: "trade";
      symbol: string;
      name: string;
      kind: InstrumentKind;
      side: TradeSide;
      date: string;
      qty: string; // "10.5" — parsed with parseQty on replay
      priceINR: string; // "250.00" — parsed with parseINR on replay
      feesINR?: string;
      actor: string;
      at: string;
    }
  | { type: "mark"; symbol: string; date: string; priceINR: string; source: string; actor: string; at: string };

export interface SeqAction {
  seq: number;
  action: PersistedAction;
}

export const dataDir = (): string => process.env.PAISA_DATA_DIR ?? join(process.cwd(), ".paisa-data");
const logPath = (): string => join(dataDir(), "actions.jsonl");

let writable: boolean | null = null;

/** Append one action; false only when the file backend's filesystem refuses. */
export async function appendAction(action: PersistedAction): Promise<boolean> {
  if (usingPostgres()) {
    const db = await getDb();
    await db.query("INSERT INTO action_log (org_id, type, payload, actor) VALUES ($1, $2, $3, $4)", [
      ORG_ID,
      action.type,
      JSON.stringify(action),
      action.actor,
    ]);
    return true;
  }
  if (writable === false) return false;
  try {
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
    appendFileSync(logPath(), JSON.stringify(action) + "\n", "utf8");
    writable = true;
    return true;
  } catch {
    writable = false;
    return false;
  }
}

/**
 * All actions with seq > afterSeq, in order. File mode: seq is the 1-based
 * non-empty line number (malformed lines keep their seq but aren't returned,
 * so numbering is stable).
 */
export async function fetchActionsAfter(afterSeq: number): Promise<SeqAction[]> {
  if (usingPostgres()) {
    const db = await getDb();
    const { rows } = await db.query("SELECT seq, payload FROM action_log WHERE org_id = $1 AND seq > $2 ORDER BY seq", [
      ORG_ID,
      afterSeq,
    ]);
    return rows.map((r) => ({
      seq: Number(r.seq),
      action: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as PersistedAction,
    }));
  }
  let raw: string;
  try {
    raw = readFileSync(logPath(), "utf8");
  } catch {
    return []; // no log yet
  }
  const out: SeqAction[] = [];
  let seq = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    seq++;
    if (seq <= afterSeq) continue;
    try {
      out.push({ seq, action: JSON.parse(line) as PersistedAction });
    } catch {
      // malformed line — seq consumed, action skipped
    }
  }
  return out;
}

export async function persistenceStatus(): Promise<{ mode: "postgres" | "disk" | "memory"; path: string }> {
  if (usingPostgres()) return { mode: "postgres", path: "action_log" };
  return writable === false ? { mode: "memory", path: logPath() } : { mode: "disk", path: logPath() };
}

/**
 * Apply actions through the same code paths the UI uses; failures (e.g. a
 * recommendation id that no longer regenerates) are skipped, never guessed
 * around.
 */
export function applyActions(org: Organization, actions: readonly PersistedAction[]): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  for (const a of actions) {
    try {
      switch (a.type) {
        case "recommendation":
          if (a.action === "approve") org.recommendations.approve(a.id, a.actor);
          else org.recommendations.dismiss(a.id, a.actor);
          break;
        case "categorize":
          org.banking.categorize(a.reference, a.accountId, a.actor);
          break;
        case "add_account":
          org.chart.add({
            id: a.id,
            code: a.code,
            name: a.name,
            type: "ASSET",
            parentId: null,
            isCashEquivalent: true,
            active: true,
          });
          if (a.openingINR && a.openingDate) {
            const amt = parseINR(a.openingINR);
            if (amt > 0n)
              org.journal.post({
                date: a.openingDate,
                narration: `Opening balance: ${a.name}`,
                lines: [
                  { accountId: a.id, side: "DEBIT", amount: amt },
                  { accountId: "acc_capital", side: "CREDIT", amount: amt },
                ],
                sourceModule: "manual",
                createdBy: a.actor,
              });
          }
          break;
        case "import":
          org.banking.importStatement(
            a.lines.map((l) => ({
              date: l.date,
              description: l.description,
              amount: parseINR(l.amountINR),
              reference: l.reference,
            })),
            a.actor,
            a.bankAccountId,
          );
          break;
        case "trade":
          org.portfolio.record(
            {
              symbol: a.symbol,
              name: a.name,
              kind: a.kind,
              side: a.side,
              date: a.date,
              qty: parseQty(a.qty),
              pricePerUnit: parseINR(a.priceINR),
              ...(a.feesINR ? { fees: parseINR(a.feesINR) } : {}),
            },
            a.actor,
          );
          break;
        case "mark":
          org.portfolio.mark(a.symbol, a.date, parseINR(a.priceINR), a.actor, a.source);
          break;
      }
      applied++;
    } catch {
      skipped++; // already applied, superseded, or malformed — declared, not forced
    }
  }
  return { applied, skipped };
}
