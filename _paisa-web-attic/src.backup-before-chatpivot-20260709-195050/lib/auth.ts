/**
 * Session auth — HMAC-signed expiring tokens via Web Crypto, so the same
 * code verifies in the edge proxy and in node route handlers.
 *
 * The signing secret comes from PAISA_SESSION_SECRET (demo default below);
 * credential checks live in users.ts (registered accounts + env demo user).
 */

export const SESSION_COOKIE = "paisa_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Shared cookie attributes for setting the session on a response. */
export const sessionCookieOptions = () =>
  ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  }) as const;

const secret = (): string => process.env.PAISA_SESSION_SECRET ?? "paisa-demo-secret-change-me";

const enc = new TextEncoder();

const hmacKey = (): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Token = "<user>.<expiryMs>.<hmac(user.expiryMs)>" */
export async function createSessionToken(user: string): Promise<string> {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = `${user}.${expiry}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload));
  return `${payload}.${toHex(sig)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const sigHex = token.slice(idx + 1);
  const [user, expiryStr] = [payload.slice(0, payload.lastIndexOf(".")), payload.slice(payload.lastIndexOf(".") + 1)];
  if (!user || !/^\d+$/.test(expiryStr)) return null;
  if (Number(expiryStr) < Date.now()) return null;
  const sigBytes = new Uint8Array((sigHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), sigBytes, enc.encode(payload));
  return ok ? user : null;
}
