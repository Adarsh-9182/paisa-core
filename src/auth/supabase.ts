/**
 * Supabase-issued access tokens, verified as a Paisa identity.
 *
 * Supabase Auth owns the sign-up, password and email-confirmation flows and
 * hands the browser a JWT. This module is the boundary where that token
 * becomes a Paisa identity — and it is the only place a Supabase claim is
 * trusted, so every check lives here rather than being spread across routes.
 *
 * Verification is deliberately pure: a token, a secret and a clock in, a
 * decided identity out. No network, so every rule below is testable against
 * fixtures, and a route cannot accidentally skip one.
 *
 * The rules are security rules, and each one is a real bypass if dropped:
 *
 *  1. **The algorithm is not negotiable.** A JWT header names its own
 *     algorithm, so a token that asks for `none` — or asks to be verified
 *     as RSA when the secret is an HMAC key — is a forgery attempt, not a
 *     token. The expected algorithm is fixed here and the header must match.
 *
 *  2. **Signature first, claims second.** Nothing in the payload is read
 *     until the HMAC verifies, and the comparison is constant-time. Reading
 *     claims from an unverified token is how "log in as anyone" happens.
 *
 *  3. **A token without an expiry is refused.** Supabase always sets one;
 *     a token that never expires is a permanent password in a cookie.
 *
 *  4. **`service_role` never logs anyone in.** That key bypasses row-level
 *     security and is meant for server-to-server calls. Accepting one as a
 *     session would hand full-database authority to whoever presented it.
 *     It is rejected by name.
 *
 *  5. **Unconfirmed email cannot hold a session.** Anyone can type someone
 *     else's address into a sign-up form. Until Supabase records it as
 *     confirmed, the address proves nothing about who is holding the token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export class SupabaseAuthError extends Error {
  override name = "SupabaseAuthError";
}

/** The subset of a Supabase access token this module reads. */
export interface SupabaseClaims {
  /** The Supabase user id (a uuid) — stable across email changes. */
  readonly sub: string;
  readonly email?: string;
  readonly aud?: string | readonly string[];
  readonly iss?: string;
  readonly role?: string;
  /** Seconds since epoch. */
  readonly exp?: number;
  readonly iat?: number;
  readonly nbf?: number;
  readonly email_confirmed_at?: string | null;
  readonly user_metadata?: { readonly full_name?: string | null; readonly name?: string | null } | null;
  readonly app_metadata?: { readonly provider?: string | null } | null;
}

/** What a verified Supabase token means to Paisa. */
export interface SupabaseIdentity {
  /** Namespaced so a Supabase uuid cannot collide with a local account id. */
  readonly externalId: string;
  readonly email: string;
  readonly name: string | null;
  readonly provider: string;
  readonly expiresAt: number;
}

export interface VerifyOptions {
  /** The project's JWT secret. Never the anon or service_role key. */
  readonly jwtSecret: string;
  /** Expected `iss`, e.g. "https://<ref>.supabase.co/auth/v1". Checked when given. */
  readonly issuer?: string;
  /** Expected audience; Supabase signs user tokens with "authenticated". */
  readonly audience?: string;
  /** Seconds of tolerance for clock skew between Supabase and this process. */
  readonly clockToleranceSeconds?: number;
  /** Injectable clock, in seconds since epoch. */
  readonly now?: number;
}

const DEFAULT_AUDIENCE = "authenticated";
const DEFAULT_SKEW = 60;

const decodeSegment = (segment: string, what: string): unknown => {
  let text: string;
  try {
    text = Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    throw new SupabaseAuthError(`Token ${what} is not valid base64url`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SupabaseAuthError(`Token ${what} is not valid JSON`);
  }
};

const audienceMatches = (aud: SupabaseClaims["aud"], expected: string): boolean =>
  Array.isArray(aud) ? aud.includes(expected) : aud === expected;

/**
 * Verify a Supabase access token and return its claims.
 *
 * Throws rather than returning null: every failure has a distinct reason,
 * and a caller that wants a soft failure can catch one error type instead
 * of guessing why a null appeared.
 */
export const verifySupabaseToken = (token: string | undefined, opts: VerifyOptions): SupabaseClaims => {
  if (!opts.jwtSecret || opts.jwtSecret.length < 16)
    throw new SupabaseAuthError("A Supabase JWT secret of at least 16 characters is required");
  if (!token) throw new SupabaseAuthError("No token presented");

  const parts = token.split(".");
  if (parts.length !== 3) throw new SupabaseAuthError("Token is not a three-part JWT");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Rule 1 — the algorithm is fixed here, never taken from the token.
  const header = decodeSegment(headerB64, "header") as { alg?: unknown; typ?: unknown };
  if (header.alg !== "HS256")
    throw new SupabaseAuthError(`Unsupported token algorithm: ${String(header.alg)} — only HS256 is accepted`);

  // Rule 2 — verify before reading anything in the payload.
  const expected = createHmac("sha256", opts.jwtSecret).update(`${headerB64}.${payloadB64}`).digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(signatureB64, "base64url");
  } catch {
    throw new SupabaseAuthError("Token signature is not valid base64url");
  }
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected))
    throw new SupabaseAuthError("Token signature does not verify");

  const claims = decodeSegment(payloadB64, "payload") as SupabaseClaims;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockToleranceSeconds ?? DEFAULT_SKEW;

  if (typeof claims.sub !== "string" || claims.sub.length === 0)
    throw new SupabaseAuthError("Token has no subject");

  // Rule 3 — no expiry is a permanent password.
  if (typeof claims.exp !== "number") throw new SupabaseAuthError("Token has no expiry");
  if (claims.exp + skew <= now) throw new SupabaseAuthError("Token has expired");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now)
    throw new SupabaseAuthError("Token is not valid yet");

  const audience = opts.audience ?? DEFAULT_AUDIENCE;
  if (!audienceMatches(claims.aud, audience))
    throw new SupabaseAuthError(`Token audience is not ${audience}`);
  if (opts.issuer && claims.iss !== opts.issuer)
    throw new SupabaseAuthError("Token issuer does not match this Supabase project");

  // Rule 4 — a service key is not a person.
  if (claims.role === "service_role")
    throw new SupabaseAuthError("Refusing a service_role token as a user session");

  return claims;
};

/**
 * Verified claims → the identity Paisa provisions against.
 *
 * Kept separate from verification so the mapping can be exercised without
 * minting a signed token, and so a route cannot map claims it never verified.
 */
export const identityFromClaims = (claims: SupabaseClaims): SupabaseIdentity => {
  const email = claims.email?.trim().toLowerCase();
  if (!email) throw new SupabaseAuthError("Token carries no email address");

  // Rule 5 — an unconfirmed address proves nothing about who holds the token.
  if (!claims.email_confirmed_at)
    throw new SupabaseAuthError("Email address is not confirmed — confirm it in Supabase before signing in");

  const name = claims.user_metadata?.full_name?.trim() || claims.user_metadata?.name?.trim() || null;

  return {
    externalId: `supabase:${claims.sub}`,
    email,
    name,
    provider: claims.app_metadata?.provider?.trim() || "email",
    expiresAt: claims.exp as number,
  };
};

/** Verify and map in one call — what a login route wants. */
export const identityFromToken = (token: string | undefined, opts: VerifyOptions): SupabaseIdentity =>
  identityFromClaims(verifySupabaseToken(token, opts));

/**
 * The bearer token from an Authorization header, if present and well-formed.
 * Returns undefined rather than throwing so a route can fall through to the
 * existing cookie session instead of failing outright.
 */
export const bearerToken = (authorization: string | undefined): string | undefined => {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1];
};
