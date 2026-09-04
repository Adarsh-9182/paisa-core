/**
 * Supabase access tokens → Paisa identities.
 *
 * Verification is pure, so every rule is exercised against minted fixtures:
 * the algorithm is fixed rather than read from the token, claims are only
 * read after the signature verifies, and the four claim rules that are real
 * bypasses if dropped each have a test.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifySupabaseToken,
  identityFromClaims,
  identityFromToken,
  bearerToken,
  SupabaseAuthError,
  type SupabaseClaims,
} from "../src/auth/supabase.js";

const SECRET = "super-secret-supabase-jwt-signing-key";
const NOW = 1_800_000_000;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

/** Mint a token the way Supabase would, so the tests exercise real verification. */
const mint = (claims: Partial<SupabaseClaims> = {}, header: Record<string, unknown> = {}, secret = SECRET): string => {
  const h = b64({ alg: "HS256", typ: "JWT", ...header });
  const p = b64({
    sub: "0f8b1e5a-1111-2222-3333-444455556666",
    email: "Founder@Example.com",
    aud: "authenticated",
    iss: "https://abcd.supabase.co/auth/v1",
    role: "authenticated",
    exp: NOW + 3600,
    iat: NOW - 10,
    email_confirmed_at: "2026-08-01T10:00:00Z",
    user_metadata: { full_name: "Adarsh B" },
    app_metadata: { provider: "email" },
    ...claims,
  });
  const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
};

const opts = { jwtSecret: SECRET, now: NOW } as const;

describe("verifySupabaseToken — happy path", () => {
  it("accepts a well-formed Supabase token", () => {
    const claims = verifySupabaseToken(mint(), opts);
    expect(claims.sub).toBe("0f8b1e5a-1111-2222-3333-444455556666");
  });
});

describe("verifySupabaseToken — the algorithm is not negotiable", () => {
  it('refuses alg "none"', () => {
    const h = b64({ alg: "none", typ: "JWT" });
    const p = b64({ sub: "x", exp: NOW + 60, aud: "authenticated" });
    expect(() => verifySupabaseToken(`${h}.${p}.`, opts)).toThrow(/only HS256/);
  });

  it("refuses an RS256 header signed with the HMAC secret (alg confusion)", () => {
    expect(() => verifySupabaseToken(mint({}, { alg: "RS256" }), opts)).toThrow(/only HS256/);
  });
});

describe("verifySupabaseToken — signature", () => {
  it("refuses a token signed with a different secret", () => {
    expect(() => verifySupabaseToken(mint({}, {}, "a-completely-different-key"), opts)).toThrow(/does not verify/);
  });

  it("refuses a payload edited after signing", () => {
    const [h, , s] = mint().split(".");
    const forged = `${h}.${b64({ sub: "attacker", exp: NOW + 3600, aud: "authenticated" })}.${s}`;
    expect(() => verifySupabaseToken(forged, opts)).toThrow(/does not verify/);
  });

  it("refuses a stripped signature", () => {
    const [h, p] = mint().split(".");
    expect(() => verifySupabaseToken(`${h}.${p}.`, opts)).toThrow(/does not verify/);
  });

  it("refuses anything that is not a three-part JWT", () => {
    expect(() => verifySupabaseToken("not.a.jwt.at.all", opts)).toThrow(/three-part/);
    expect(() => verifySupabaseToken("garbage", opts)).toThrow(/three-part/);
    expect(() => verifySupabaseToken(undefined, opts)).toThrow(/No token/);
  });
});

describe("verifySupabaseToken — time", () => {
  it("refuses a token with no expiry", () => {
    expect(() => verifySupabaseToken(mint({ exp: undefined as unknown as number }), opts)).toThrow(/no expiry/);
  });

  it("refuses an expired token", () => {
    expect(() => verifySupabaseToken(mint({ exp: NOW - 3600 }), opts)).toThrow(/expired/);
  });

  it("allows a little clock skew rather than failing on a second", () => {
    expect(() => verifySupabaseToken(mint({ exp: NOW - 10 }), opts)).not.toThrow();
  });

  it("refuses a token that is not valid yet", () => {
    expect(() => verifySupabaseToken(mint({ nbf: NOW + 3600 }), opts)).toThrow(/not valid yet/);
  });
});

describe("verifySupabaseToken — who the token is for", () => {
  it("refuses a wrong audience", () => {
    expect(() => verifySupabaseToken(mint({ aud: "anon" }), opts)).toThrow(/audience/);
  });

  it("accepts an array audience containing the expected one", () => {
    expect(() => verifySupabaseToken(mint({ aud: ["authenticated", "other"] }), opts)).not.toThrow();
  });

  it("refuses a token from another Supabase project when an issuer is configured", () => {
    expect(() =>
      verifySupabaseToken(mint(), { ...opts, issuer: "https://mine.supabase.co/auth/v1" }),
    ).toThrow(/issuer/);
  });

  it("refuses a service_role token as a session", () => {
    expect(() => verifySupabaseToken(mint({ role: "service_role" }), opts)).toThrow(/service_role/);
  });
});

describe("verifySupabaseToken — configuration", () => {
  it("refuses to run without a real secret", () => {
    expect(() => verifySupabaseToken(mint(), { jwtSecret: "short", now: NOW })).toThrow(SupabaseAuthError);
  });
});

describe("identityFromClaims", () => {
  const claims = (over: Partial<SupabaseClaims> = {}): SupabaseClaims =>
    verifySupabaseToken(mint(over), opts);

  it("normalises the email and namespaces the id", () => {
    const id = identityFromClaims(claims());
    expect(id.email).toBe("founder@example.com");
    expect(id.externalId).toBe("supabase:0f8b1e5a-1111-2222-3333-444455556666");
    expect(id.name).toBe("Adarsh B");
    expect(id.provider).toBe("email");
  });

  it("refuses an unconfirmed email address", () => {
    expect(() => identityFromClaims(claims({ email_confirmed_at: null }))).toThrow(/not confirmed/);
  });

  it("refuses a token with no email at all", () => {
    expect(() => identityFromClaims(claims({ email: undefined as unknown as string }))).toThrow(/no email/);
  });

  it("falls back rather than inventing a name", () => {
    expect(identityFromClaims(claims({ user_metadata: {} })).name).toBeNull();
  });
});

describe("identityFromToken", () => {
  it("verifies and maps in one call", () => {
    expect(identityFromToken(mint(), opts).email).toBe("founder@example.com");
  });
});

describe("bearerToken", () => {
  it("reads a well-formed Authorization header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns undefined so a route can fall through to the cookie session", () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken("Bearer")).toBeUndefined();
  });
});
