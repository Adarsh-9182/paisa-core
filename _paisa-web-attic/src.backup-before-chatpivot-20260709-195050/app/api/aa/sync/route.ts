import { NextResponse } from "next/server";
import { getAaProvider } from "@/lib/account-aggregator";
import { importAaTransactions } from "@/lib/aa-ingest";
import { getConnection, updateConnection } from "@/lib/connections";

/** POST { connectionId } — re-fetch on the standing consent; dedupe imports new lines only. */
export async function POST(request: Request) {
  const { connectionId } = (await request.json().catch(() => ({}))) as { connectionId?: string };
  const conn = connectionId ? await getConnection(connectionId) : null;
  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 404 });
  if (conn.status !== "active") return NextResponse.json({ error: "Connection is revoked" }, { status: 400 });

  const aa = getAaProvider();
  try {
    const accounts = await aa.fetchData(conn.consentId);
    // Match the specific account this connection tracks (or the sole one).
    const match = accounts.find((a) => a.account.maskedAccountNumber === conn.maskedAccount) ?? accounts[0];
    if (!match) return NextResponse.json({ error: "No data returned" }, { status: 400 });

    const summary = await importAaTransactions(conn.accountId, match.transactions);
    const updated = await updateConnection(conn.id, {
      lastSyncedAt: new Date().toISOString(),
      txnCount: conn.txnCount + summary.posted + summary.needsReview,
    });
    return NextResponse.json({ ok: true, summary, connection: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 400 });
  }
}
