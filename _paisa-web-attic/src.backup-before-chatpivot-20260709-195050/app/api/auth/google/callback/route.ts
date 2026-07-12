import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { exchangeCodeForToken, fetchGoogleProfile } from "@/lib/google";
import { upsertGoogleUser } from "@/lib/users";
import { OAUTH_NEXT_COOKIE, OAUTH_STATE_COOKIE } from "../route";

function clearOauthCookies(res: NextResponse) {
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(OAUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
}

function fail(origin: string, code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
  clearOauthCookies(res);
  return res;
}

/** Google redirects back here with ?code&state — exchange, verify, and sign in. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { origin, searchParams } = url;

  if (searchParams.get("error")) return fail(origin, "google_denied");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const jar = await cookies();
  const savedState = jar.get(OAUTH_STATE_COOKIE)?.value;
  const next = jar.get(OAUTH_NEXT_COOKIE)?.value;

  if (!code || !state || !savedState || state !== savedState) return fail(origin, "google_state");

  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    const { access_token } = await exchangeCodeForToken(code, redirectUri);
    const profile = await fetchGoogleProfile(access_token);
    if (!profile.sub || profile.email_verified === false) return fail(origin, "google_email");

    const user = await upsertGoogleUser({
      googleId: profile.sub,
      name: profile.name ?? profile.email ?? "Paisa user",
      email: profile.email,
    });

    const token = await createSessionToken(user.username);
    const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    const res = NextResponse.redirect(new URL(dest, origin));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    clearOauthCookies(res);
    return res;
  } catch {
    return fail(origin, "google_failed");
  }
}
