import { NextResponse } from "next/server";
import { getPaisa, ACTOR } from "@/lib/engine";
import { appendAction } from "@/lib/store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (action !== "approve" && action !== "dismiss") {
    return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
  }
  const { org } = await getPaisa();
  try {
    const rec = action === "approve" ? org.recommendations.approve(id, ACTOR) : org.recommendations.dismiss(id, ACTOR);
    await appendAction({ type: "recommendation", id, action, actor: ACTOR, at: new Date().toISOString() });
    return NextResponse.json({ ok: true, id: rec.id, status: rec.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
