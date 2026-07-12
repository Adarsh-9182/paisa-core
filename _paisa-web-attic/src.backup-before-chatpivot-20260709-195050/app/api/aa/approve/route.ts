import { NextResponse } from "next/server";
import { getAaProvider, decodeHandle, fipName } from "@/lib/account-aggregator";
import { connectAccounts } from "@/lib/aa-ingest";

/**
 * POST { handle } — the in-app (sandbox) consent was approved. Exchange it for
 * FI data, post it through the banking gate, and record the connection(s).
 * (Real Setu uses the redirect callback instead.)
 */
export async function POST(request: Request) {
  const { handle } = (await request.json().catch(() => ({}))) as { handle?: string };
  const decoded = handle ? decodeHandle(handle) : null;
  if (!decoded) return NextResponse.json({ error: "Invalid or expired consent" }, { status: 400 });

  const aa = getAaProvider();
  try {
    const status = await aa.consentStatus(handle!);
    if (status !== "ACTIVE") return NextResponse.json({ error: `Consent is ${status.toLowerCase()}` }, { status: 400 });

    const accounts = await aa.fetchData(handle!);
    const { summary, connections } = await connectAccounts(handle!, decoded.fipId, fipName(decoded.fipId), accounts);
    return NextResponse.json({ ok: true, connection: connections[0], summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not fetch bank data" }, { status: 400 });
  }
}
