/**
 * User accounts — append-only philosophy, scrypt-hashed passwords.
 *
 * Two backends behind one async API (spec 001):
 *   PAISA_DATABASE_URL set → Postgres `users` table, queried directly on every
 *                            read so all server instances agree (no cache to
 *                            go stale — a signup on one instance must be able
 *                            to log in on another immediately).
 *   otherwise             → original JSONL file + instance cache; on read-only
 *                            filesystems signups live for the instance.
 *
 * The env demo user (PAISA_USER/PAISA_PASSWORD) keeps working alongside
 * registered accounts in both modes.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { dataDir } from "./store";
import { getDb, usingPostgres, type SqlRow } from "./db";

export interface UserRecord {
  readonly username: string; // lowercase, unique
  readonly name: string; // display name
  readonly passwordHash: string; // "<saltHex>.<hashHex>", or "oauth:google" for OAuth-only accounts
  readonly createdAt: string;
  readonly email?: string; // set for OAuth accounts
  readonly googleId?: string; // Google "sub" — stable per account, the OAuth join key
}

const usersPath = (): string => join(dataDir(), "users.jsonl");

/* ---------------- file backend (unchanged behavior) ---------------- */

/** Instance-local cache; also the only store when the FS is read-only. */
let cache: Map<string, UserRecord> | null = null;

function load(): Map<string, UserRecord> {
  if (cache) return cache;
  cache = new Map();
  try {
    for (const line of readFileSync(usersPath(), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const u = JSON.parse(line) as UserRecord;
      cache.set(u.username, u); // later lines win, but usernames are never reused
    }
  } catch {
    // no file yet
  }
  return cache;
}

/** Cache + append one record; returns false when the filesystem refuses (serverless). */
function writeUserToFile(user: UserRecord): boolean {
  load().set(user.username, user);
  try {
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
    appendFileSync(usersPath(), JSON.stringify(user) + "\n", "utf8");
    return true;
  } catch {
    return false; // read-only FS — account lives for this instance
  }
}

/* ---------------- postgres backend ---------------- */

const rowToUser = (r: SqlRow): UserRecord => ({
  username: r.username as string,
  name: r.name as string,
  passwordHash: r.password_hash as string,
  createdAt: new Date(r.created_at as string).toISOString(),
  ...(r.email ? { email: r.email as string } : {}),
  ...(r.google_sub ? { googleId: r.google_sub as string } : {}),
});

/** Insert; false when the username was taken in a race. */
async function insertUser(user: UserRecord): Promise<boolean> {
  const db = await getDb();
  const { rows } = await db.query(
    `INSERT INTO users (username, name, password_hash, email, google_sub, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (username) DO NOTHING
     RETURNING username`,
    [user.username, user.name, user.passwordHash, user.email ?? null, user.googleId ?? null, user.createdAt],
  );
  return rows.length > 0;
}

/* ---------------- password hashing ---------------- */

const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}.${hash.toString("hex")}`;
};

const checkPassword = (password: string, stored: string): boolean => {
  const [saltHex, hashHex] = stored.split(".");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
};

/* ---------------- public API (async, backend-agnostic) ---------------- */

export async function findUser(username: string): Promise<UserRecord | null> {
  const uname = username.trim().toLowerCase();
  if (usingPostgres()) {
    const db = await getDb();
    const { rows } = await db.query("SELECT * FROM users WHERE username = $1", [uname]);
    return rows.length ? rowToUser(rows[0]) : null;
  }
  return load().get(uname) ?? null;
}

export async function createUser(
  username: string,
  name: string,
  password: string,
): Promise<{ ok: true; user: UserRecord; persisted: boolean } | { ok: false; error: string }> {
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(uname))
    return { ok: false, error: "Username must be 3–32 characters: letters, digits, dots, dashes, underscores" };
  if (name.trim().length === 0) return { ok: false, error: "Name is required" };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (uname === (process.env.PAISA_USER ?? "adarsh") || (await findUser(uname)))
    return { ok: false, error: "That username is already taken" };

  const user: UserRecord = {
    username: uname,
    name: name.trim(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  if (usingPostgres()) {
    const inserted = await insertUser(user);
    if (!inserted) return { ok: false, error: "That username is already taken" };
    return { ok: true, user, persisted: true };
  }
  return { ok: true, user, persisted: writeUserToFile(user) };
}

/* ---------------- Google / OAuth accounts ---------------- */

export async function findByGoogleId(googleId: string): Promise<UserRecord | null> {
  if (usingPostgres()) {
    const db = await getDb();
    const { rows } = await db.query("SELECT * FROM users WHERE google_sub = $1", [googleId]);
    return rows.length ? rowToUser(rows[0]) : null;
  }
  for (const u of load().values()) if (u.googleId === googleId) return u;
  return null;
}

const sanitizeUsername = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");

/** A valid, unique username derived from `base`, avoiding the demo user and collisions. */
async function uniqueUsername(base: string): Promise<string> {
  const demo = process.env.PAISA_USER ?? "adarsh";
  let candidate = sanitizeUsername(base).slice(0, 32);
  if (candidate.length < 3) candidate = `paisa-${candidate}`.slice(0, 32);
  let uname = candidate;
  let n = 1;
  while (uname === demo || (await findUser(uname))) {
    const suffix = `-${n++}`;
    uname = candidate.slice(0, 32 - suffix.length) + suffix;
  }
  return uname;
}

/**
 * Find-or-create the account for a verified Google profile, keyed by the
 * stable Google `sub`. OAuth accounts carry a sentinel passwordHash so they
 * can never be signed into with a password.
 */
export async function upsertGoogleUser(profile: { googleId: string; name: string; email?: string }): Promise<UserRecord> {
  const existing = await findByGoogleId(profile.googleId);
  if (existing) return existing;
  const emailLocal = profile.email ? sanitizeUsername(profile.email.split("@")[0]) : "";
  const username = await uniqueUsername(emailLocal.length >= 3 ? emailLocal : `g-${profile.googleId}`);
  const user: UserRecord = {
    username,
    name: profile.name.trim() || profile.email || username,
    passwordHash: "oauth:google",
    createdAt: new Date().toISOString(),
    email: profile.email,
    googleId: profile.googleId,
  };
  if (usingPostgres()) {
    const inserted = await insertUser(user);
    // Race on the same Google account (double callback): the winner's row is truth.
    if (!inserted) return (await findByGoogleId(profile.googleId)) ?? user;
    return user;
  }
  writeUserToFile(user);
  return user;
}

/** Registered users first, then the env demo credentials. */
export async function authenticate(username: string, password: string): Promise<{ username: string; name: string } | null> {
  const uname = username.trim().toLowerCase();
  const record = await findUser(uname);
  if (record) return checkPassword(password, record.passwordHash) ? { username: record.username, name: record.name } : null;
  const demoUser = process.env.PAISA_USER ?? "adarsh";
  const demoPassword = process.env.PAISA_PASSWORD ?? "paisa123";
  // Constant-time comparison so response timing doesn't leak how much of the
  // credential matched.
  const a = Buffer.from(`${uname}\0${password}`);
  const b = Buffer.from(`${demoUser}\0${demoPassword}`);
  if (a.length === b.length && timingSafeEqual(a, b)) return { username: demoUser, name: "Adarsh Kumar" };
  return null;
}

/** Display name for a session's username. */
export async function displayName(username: string): Promise<string> {
  const record = await findUser(username);
  if (record) return record.name;
  if (username === (process.env.PAISA_USER ?? "adarsh")) return "Adarsh Kumar";
  return username;
}
