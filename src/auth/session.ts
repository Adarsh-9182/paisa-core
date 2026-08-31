/**
 * Sessions — a signed, expiring cookie value. No server-side session table.
 *
 * The token carries the claims and an HMAC over them, so any tampering
 * invalidates it. That keeps a stateless serverless deployment from needing
 * a session lookup on every request.
 *
 * The trade-off, stated rather than hidden: a token stays valid until it
 * expires, so "log out everywhere" would need a revocation list. Expiry is
 * therefore short enough that the exposure is bounded, and the secret can be
 * rotated to invalidate every session at once.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export interface SessionClaims {
  readonly userId: string;
  readonly orgId: string;
  /** Seconds since epoch. */
  readonly exp: number;
}

export class SessionError extends Error {
  override name = "SessionError";
}

export const SESSION_COOKIE = "paisa_session";
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/**
 * A secret must be configured in production. Generating one per process
 * would silently log everyone out on every deploy, and worse, differ
 * between concurrent instances — so an absent secret is an error, not a
 * default.
 */
export const resolveSessionSecret = (
  env: Record<string, string | undefined> = process.env,
): string => {
  const secret = env.PAISA_SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (env.NODE_ENV === "production" || env.VERCEL)
    throw new SessionError(
      "PAISA_SESSION_SECRET must be set (at least 16 characters) — refusing to sign sessions with a throwaway key",
    );
  return "dev-only-insecure-secret-" + randomBytes(8).toString("hex");
};

export const issueSession = (
  userId: string,
  orgId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string => {
  const claims: SessionClaims = {
    userId,
    orgId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
};

/** Returns null for anything not currently valid — never throws on input. */
export const readSession = (token: string | undefined, secret: string): SessionClaims | null => {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(provided, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(unb64(payload)) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.userId !== "string" || typeof claims.orgId !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  return claims;
};

export const sessionCookie = (token: string, secure: boolean, ttlSeconds = DEFAULT_TTL_SECONDS): string =>
  [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ttlSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");

export const clearCookie = (secure: boolean): string =>
  [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
};
