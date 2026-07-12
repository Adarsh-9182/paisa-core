import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { authenticate } from "@/lib/users";
import { clientKey, rateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (rateLimited(clientKey(request, "login"))) {
    return NextResponse.json({ error: "Too many attempts — try again in a minute" }, { status: 429 });
  }
  const { user, password } = (await request.json().catch(() => ({}))) as { user?: string; password?: string };
  const account = user && password ? await authenticate(user, password) : null;
  if (!account) {
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }
  const token = await createSessionToken(account.username);
  const res = NextResponse.json({ ok: true, name: account.name });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
