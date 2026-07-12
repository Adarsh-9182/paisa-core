import { NextResponse } from "next/server";
import type { ChatTurn } from "paisa-core";
import { getPaisa } from "@/lib/engine";

const MAX_HISTORY_TURNS = 12;
const MAX_TURN_LENGTH = 4000;

/** Accept only well-formed prior turns; anything malformed is dropped, not trusted. */
function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is { role: "user" | "assistant"; text: string } =>
        typeof t === "object" &&
        t !== null &&
        ((t as { role?: unknown }).role === "user" || (t as { role?: unknown }).role === "assistant") &&
        typeof (t as { text?: unknown }).text === "string" &&
        (t as { text: string }).text.length > 0 &&
        (t as { text: string }).text.length <= MAX_TURN_LENGTH,
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, text: t.text }));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { message?: unknown; history?: unknown };
  const { message } = body;
  if (typeof message !== "string" || message.trim().length === 0)
    return NextResponse.json({ error: "message required" }, { status: 400 });
  if (message.length > 2000)
    return NextResponse.json({ error: "message too long (max 2000 characters)" }, { status: 400 });

  const history = sanitizeHistory(body.history);

  const { org, orchestrator, aiUser } = await getPaisa();
  try {
    const record = await orchestrator.ask(aiUser, org, message, history);
    return NextResponse.json({
      answer: record.finalAnswer,
      tools: record.toolsInvoked.map((t) => t.tool),
      verified: record.verified,
    });
  } catch (err) {
    return NextResponse.json({
      answer:
        "I couldn't verify every figure in my draft answer against the ledger, so I'm not sending it. Try rephrasing the question.",
      tools: [],
      verified: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
