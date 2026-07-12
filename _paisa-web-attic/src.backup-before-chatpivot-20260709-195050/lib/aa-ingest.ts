/**
 * Bridges Account-Aggregator data into the engine through the SAME gates the
 * manual importer uses: chart.add + a persisted `add_account`, then
 * banking.importStatement + a persisted `import`. So AA data is deduped,
 * categorised, review-queued, and replayed on boot exactly like any other bank
 * feed — nothing downstream knows or cares that the source was an AA.
 */

import { parseINR, type Paise } from "paisa-core";
import { getPaisa, ACTOR } from "./engine";
import { appendAction } from "./store";
import { newConnectionId, saveConnection, type BankConnection } from "./connections";
import type { AaTransaction, FiAccountData } from "./account-aggregator";

function nextBankCode(used: Set<string>): string {
  for (let n = 1011; n <= 1099; n++) if (!used.has(String(n))) return String(n);
  for (let n = 1600; n <= 1999; n++) if (!used.has(String(n))) return String(n);
  throw new Error("No free account code available");
}

/** Create a cash-equivalent bank account for a connected FIP; returns its id. */
export async function createBankAccount(name: string, openingINR?: string, openingDate?: string): Promise<string> {
  const { org } = await getPaisa();
  const code = nextBankCode(new Set(org.chart.all().map((a) => a.code)));
  const id = `acc_bank_${code}`;
  org.chart.add({ id, code, name, type: "ASSET", parentId: null, isCashEquivalent: true, active: true });

  const opening: Paise | null = openingINR ? parseINR(openingINR) : null;
  const hasOpening = opening !== null && opening > 0n && Boolean(openingDate);
  if (hasOpening) {
    org.journal.post({
      date: openingDate!,
      narration: `Opening balance: ${name}`,
      lines: [
        { accountId: id, side: "DEBIT", amount: opening! },
        { accountId: "acc_capital", side: "CREDIT", amount: opening! },
      ],
      sourceModule: "banking",
      createdBy: ACTOR,
    });
  }
  await appendAction({
    type: "add_account",
    id,
    code,
    name,
    ...(hasOpening ? { openingINR: openingINR!, openingDate: openingDate! } : {}),
    actor: ACTOR,
    at: new Date().toISOString(),
  });
  return id;
}

export interface ImportSummary {
  posted: number;
  duplicates: number;
  needsReview: number;
}

/** Import AA transactions into an existing account through the banking gate. */
export async function importAaTransactions(accountId: string, txns: AaTransaction[]): Promise<ImportSummary> {
  const { org } = await getPaisa();
  const result = org.banking.importStatement(
    txns.map((t) => ({ date: t.date, description: t.description, amount: parseINR(t.amountINR), reference: t.reference })),
    ACTOR,
    accountId,
  );
  await appendAction({
    type: "import",
    bankAccountId: accountId,
    lines: txns.map((t) => ({ date: t.date, description: t.description, amountINR: t.amountINR, reference: t.reference })),
    actor: ACTOR,
    at: new Date().toISOString(),
  });
  return { posted: result.posted.length, duplicates: result.duplicates.length, needsReview: result.needsReview.length };
}

/**
 * Turn fetched AA accounts into engine state: one bank account + imported
 * transactions per account, each recorded as a connection. Used by both the
 * in-app approve route and the redirect callback.
 */
export async function connectAccounts(
  ref: string,
  fipId: string,
  fipLabel: string,
  accounts: FiAccountData[],
): Promise<{ summary: ImportSummary; connections: BankConnection[] }> {
  const total: ImportSummary = { posted: 0, duplicates: 0, needsReview: 0 };
  const connections: BankConnection[] = [];
  for (const { account, transactions } of accounts) {
    const name = `${fipLabel} ${account.maskedAccountNumber}`.trim();
    const accountId = await createBankAccount(name, account.openingBalance, account.openingDate);
    const s = await importAaTransactions(accountId, transactions);
    total.posted += s.posted;
    total.duplicates += s.duplicates;
    total.needsReview += s.needsReview;
    const now = new Date().toISOString();
    const conn: BankConnection = {
      id: newConnectionId(),
      fipId,
      fipName: fipLabel,
      maskedAccount: account.maskedAccountNumber,
      accountId,
      consentId: ref,
      status: "active",
      connectedAt: now,
      lastSyncedAt: now,
      txnCount: s.posted + s.needsReview,
    };
    await saveConnection(conn);
    connections.push(conn);
  }
  return { summary: total, connections };
}

/** The consent window: three trailing months up to the engine's as-of date. */
export function consentWindow(asOf: string): { from: string; to: string } {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) - 3;
  const fy = Math.floor(total / 12);
  const fm = String((total % 12) + 1).padStart(2, "0");
  return { from: `${fy}-${fm}-01`, to: asOf };
}
