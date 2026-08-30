/**
 * Password hashing — scrypt from node:crypto, no dependencies.
 *
 * scrypt is memory-hard, so a stolen hash costs an attacker RAM as well as
 * time. Parameters are stored inside the hash string, which means they can
 * be raised later without invalidating existing passwords: verification
 * reads the cost from the record it is checking.
 *
 * Comparison is timing-safe. A comparison that returns early on the first
 * differing byte leaks how much of a guess was correct.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP-aligned defaults: N=2^16, r=8, p=1. */
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 192 * 1024 * 1024;

export class PasswordError extends Error {
  override name = "PasswordError";
}

/** Minimum viable policy. Length beats character-class rules. */
export const validatePassword = (password: string): void => {
  if (typeof password !== "string" || password.length < 10)
    throw new PasswordError("Password must be at least 10 characters");
  if (password.length > 256) throw new PasswordError("Password must be at most 256 characters");
};

/** → "scrypt$N$r$p$salt$hash", all base64url. */
export const hashPassword = async (password: string): Promise<string> => {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return ["scrypt", N, R, P, salt.toString("base64url"), derived.toString("base64url")].join("$");
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
  } catch {
    return false;
  }
  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N: n, r, p, maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
};
