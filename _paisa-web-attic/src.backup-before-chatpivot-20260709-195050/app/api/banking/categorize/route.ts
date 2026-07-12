import { NextResponse } from "next/server";
import { getPaisa, ACTOR } from "@/lib/engine";
import { appendAction } from "@/lib/store";

export async function POST(request: Request) {
  const { reference, accountId } = (await request.json().catch(() => ({}))) as {
    reference?: string;
    accountId?: string;
  };
  if (!reference || !accountId) {
    return NextResponse.json({ error: "reference and accountId required" }, { status: 400 });
  }
  const { org } = await getPaisa();
  try {
    const entry = org.banking.categorize(reference, accountId, ACTOR);
    await appendAction({ type: "categorize", reference, accountId, actor: ACTOR, at: new Date().toISOString() });
    return NextResponse.json({ ok: true, entryId: entry.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
