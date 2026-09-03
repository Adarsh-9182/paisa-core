/**
 * Is the configured model actually usable for Paisa's narrator?
 *
 * A key that authenticates proves nothing on its own. The AI CFO only works
 * if the model will call tools and then answer from what they returned, so
 * this checks in that order and stops at the first thing that is untrue:
 *
 *   1. the endpoint answers at all
 *   2. the model exists and accepts a chat request
 *   3. it emits a tool call when tools are offered
 *   4. it produces a final answer after the tool result comes back
 *
 * Run: node --env-file-if-exists=.env scripts/check-model.mjs
 */

const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.PAISA_OPENAI_MODEL ?? "gpt-5.6";
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl);

const headers = { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };

console.log(`endpoint : ${baseUrl}`);
console.log(`model    : ${model}`);
console.log(`key      : ${apiKey ? `set (${apiKey.slice(0, 6)}…, ${apiKey.length} chars)` : isLocal ? "none needed (local)" : "MISSING"}`);
console.log("");

if (!apiKey && !isLocal) {
  console.error("No OPENAI_API_KEY and the endpoint is not local. Nothing to test.");
  process.exit(1);
}

/* ---- 1. what models does this endpoint offer? ---- */
try {
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (res.ok) {
    const body = await res.json();
    const ids = (body.data ?? []).map((m) => m.id.replace(/^models\//, ""));
    const shown = ids.filter((id) => !/embedding|imagen|veo|tts|image/i.test(id));
    console.log(`available: ${shown.length} chat-ish models`);
    console.log(shown.slice(0, 25).map((s) => "  " + s).join("\n"));
    if (ids.length && !ids.includes(model.replace(/^models\//, "")))
      console.log(`\n!! "${model}" is NOT in the list above — set PAISA_OPENAI_MODEL to one that is.`);
    console.log("");
  } else {
    console.log(`(models list unavailable: ${res.status} — not fatal)\n`);
  }
} catch (e) {
  console.log(`(models list failed: ${e.message} — not fatal)\n`);
}

/* ---- 2-4. can it actually drive a tool loop? ---- */
const tools = [{
  type: "function",
  function: {
    name: "get_cash_position",
    description: "The organisation's cash balance on a date. The ONLY source of a cash figure.",
    parameters: {
      type: "object",
      properties: { asOf: { type: "string", description: "ISO date, YYYY-MM-DD" } },
      required: ["asOf"],
    },
  },
}];

const messages = [
  { role: "system", content: "You are a CFO assistant. You must call a tool to obtain any figure. Never state a number that did not come from a tool result." },
  { role: "user", content: "How much cash do we have as of 2026-07-02?" },
];

const call = async (msgs) => {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: msgs, tools }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
};

try {
  const first = await call(messages);
  const msg = first.choices?.[0]?.message ?? {};
  const calls = msg.tool_calls ?? [];

  if (!calls.length) {
    console.log("TOOL CALLING: NO — the model answered without calling the tool.");
    console.log("  it said:", JSON.stringify(msg.content ?? "").slice(0, 200));
    console.log("\n  Unusable as-is: the narrator would invent figures instead of reading the ledger.");
    process.exit(2);
  }

  console.log(`TOOL CALLING: yes — asked for ${calls.map((c) => c.function.name).join(", ")}`);
  console.log(`  arguments: ${calls[0].function.arguments}`);

  const second = await call([
    ...messages,
    msg,
    ...calls.map((c) => ({
      role: "tool",
      tool_call_id: c.id,
      content: JSON.stringify({ asOf: "2026-07-02", cash: "₹30,00,000.00" }),
    })),
  ]);
  const answer = second.choices?.[0]?.message?.content ?? "";
  console.log(`\nFINAL ANSWER: ${answer.slice(0, 300)}`);

  const usedFigure = answer.includes("30,00,000");
  console.log(`\nquoted the tool's figure: ${usedFigure ? "yes" : "NO — it did not use the number it was given"}`);
  const u = second.usage ?? {};
  if (u.prompt_tokens) console.log(`tokens: ${u.prompt_tokens} in / ${u.completion_tokens} out`);
  console.log(`\n${usedFigure ? "USABLE — wire it in." : "RISKY — it ignored the tool result."}`);
  process.exit(usedFigure ? 0 : 2);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exit(1);
}
