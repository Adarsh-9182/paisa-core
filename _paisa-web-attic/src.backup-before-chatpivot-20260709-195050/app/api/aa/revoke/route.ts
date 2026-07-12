import { NextResponse } from "next/server";
import { getConnection, updateConnection } from "@/lib/connections";

/**
 * POST { connectionId } — revoke consent. Future fetches stop; already-posted
 * ledger entries stay (nothing is ever deleted — corrections are reversals).
 */
export async function POST(request: Request) {
  const { connectionId } = (await request.json().catch(() => ({}))) as { connectionId?: string };
  const conn = connectionId ? await getConnection(connectionId) : null;
  if (!conn) return NextResponse.json({ error: "Unknown connection" }, { status: 404 });

  await updateConnection(conn.id, { status: "revoked" });
  return NextResponse.json({ ok: true });
}
