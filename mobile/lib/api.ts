/**
 * Thin client to the paisa server (spec 002). One brain — the phone never
 * computes a figure; every number arrives display-ready from the ledger.
 *
 * API_BASE must be your Mac's LAN address so a phone on the same wifi can
 * reach the dev server (`npm run dev` in web/). `npx expo start` prints the
 * LAN IP it serves from — keep this in sync if your network changes.
 */

export const API_BASE = "http://192.168.1.10:3000";

let sessionCookie: string | null = null;
export const isAuthed = (): boolean => sessionCookie !== null;
export const signOut = (): void => {
  sessionCookie = null;
};

export async function login(user: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Login failed — check username and password" };
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return { ok: false, error: "Server returned no session" };
  sessionCookie = setCookie.split(";")[0]!;
  return { ok: true };
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: sessionCookie ?? "", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

/* ---- shapes mirrored from /api/mobile/summary (display-ready strings) ---- */

export interface Summary {
  brief: {
    asOf: string;
    headline: string;
    health: { score: number; grade: string };
    cash: string;
  };
  metrics: {
    monthLabel: string;
    revenue: { value: string; full: string; changePct: number | null };
    expenses: { value: string; full: string; changePct: number | null };
    profit: { value: string; full: string; marginPct: number | null };
    runway: { days: number | null; positive: boolean };
  };
  transactions: {
    rows: { date: string; narration: string; category: string; amount: string; direction: "in" | "out" }[];
    needsReview: number;
  };
  recommendations: { id: string; title: string; reason: string; requiredAction: string; status: string }[];
}

export const fetchSummary = (): Promise<Summary> => authedFetch<Summary>("/api/mobile/summary");

export interface ChatReply {
  answer: string;
  tools?: string[];
}

export const askPaisa = (message: string, history: { role: "user" | "assistant"; text: string }[]): Promise<ChatReply> =>
  authedFetch<ChatReply>("/api/chat", { method: "POST", body: JSON.stringify({ message, history }) });
