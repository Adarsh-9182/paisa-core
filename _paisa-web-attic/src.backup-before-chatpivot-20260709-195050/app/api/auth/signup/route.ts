import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { createUser } from "@/lib/users";
import { clientKey, rateLimited } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (rateLimited(clientKey(request, "signup"))) {
    return NextResponse.json({ error: "Too many attempts — try again in a minute" }, { status: 429 });
  }
  const { user, name, password } = (await request.json().catch(() => ({}))) as {
    user?: string;
    name?: string;
    password?: string;
  };
  if (!user || !name || !password) {
    return NextResponse.json({ error: "Name, username, and password are required" }, { status: 400 });
  }
  const result = await createUser(user, name, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const token = await createSessionToken(result.user.username);
  const res = NextResponse.json({ ok: true, name: result.user.name, persisted: result.persisted });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
