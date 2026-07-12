import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { googleAuthUrl, googleConfigured } from "@/lib/google";

export const OAUTH_STATE_COOKIE = "paisa_oauth_state";
export const OAUTH_NEXT_COOKIE = "paisa_oauth_next";

const shortCookie = () =>
  ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes to complete the round-trip
  }) as const;

/** Start the Google sign-in round-trip: set a CSRF state cookie, redirect to consent. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google_unconfigured", url.origin));
  }

  const next = url.searchParams.get("next");
  const state = randomBytes(16).toString("hex");
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const res = NextResponse.redirect(googleAuthUrl(redirectUri, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, shortCookie());
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    res.cookies.set(OAUTH_NEXT_COOKIE, next, shortCookie());
  }
  return res;
}
