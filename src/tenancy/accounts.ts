/**
 * Accounts — people, as distinct from their membership of any books.
 *
 * A person and their access are deliberately separate things. One account
 * can belong to several organizations (an accountant with three clients),
 * and losing access to one must not touch the account itself. Conflating
 * them is how "remove from workspace" ends up deleting a login.
 *
 * Everything here is about not leaking who exists. That is the whole risk
 * surface of a login form, and it is the part that is easy to get subtly
 * wrong: the same message from two code paths still leaks if one of them
 * returns in two milliseconds and the other in eighty.
 */

import { hashPassword, validatePassword, verifyPassword } from "../auth/password.js";

export class AccountError extends Error {
  override name = "AccountError";
}

/**
 * Named UserAccount, not Account. In an accounting product "account"
 * unambiguously means a ledger account — the chart of accounts exports one
 * already — and a login that shares that name is a collision waiting to be
 * imported by mistake.
 */
export interface UserAccount {
  readonly userId: string;
  /** Normalised: trimmed and lower-cased. The stored form is the key. */
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

/**
 * An account as the durable directory records it. Exported for that one
 * purpose; nothing that serves a request should ever hold one.
 */
export interface StoredAccountRecord extends UserAccount {
  readonly passwordHash: string;
}

type StoredAccount = StoredAccountRecord;

/**
 * Trim and lower-case, and nothing else.
 *
 * Deliberately not stripping dots or +tags. That is Gmail's behaviour, not
 * the internet's — applying it universally silently merges two different
 * mailboxes into one account on providers where they are genuinely
 * different addresses.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Structural only. The address is proved by delivering to it, not by a regex. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const isEmailShaped = (email: string): boolean =>
  EMAIL_SHAPE.test(email) && email.length <= 254;

let counter = 0;
export const newUserId = () => `u_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class AccountDirectory {
  private byEmail = new Map<string, StoredAccount>();
  private byId = new Map<string, StoredAccount>();

  /**
   * A hash of a value nobody knows, verified against when no account
   * matches, so a login attempt for an unknown address costs the same
   * scrypt work as one for a known address.
   *
   * Without this the two paths are distinguishable by a stopwatch, and a
   * stopwatch is all it takes to enumerate a customer list. Built lazily so
   * constructing a directory does not do key derivation.
   */
  private decoyHash: Promise<string> | null = null;
  private decoy(): Promise<string> {
    this.decoyHash ??= hashPassword(`decoy-${Math.random()}-${Date.now()}`);
    return this.decoyHash;
  }

  async register(email: string, password: string, displayName?: string): Promise<UserAccount> {
    const normalized = normalizeEmail(email);
    if (!isEmailShaped(normalized)) throw new AccountError("That does not look like an email address");
    // Validate before hashing: hashing first would spend scrypt work on a
    // password we are about to reject anyway.
    validatePassword(password);
    if (this.byEmail.has(normalized)) throw new AccountError("An account with that email already exists");

    const account: StoredAccount = {
      userId: newUserId(),
      email: normalized,
      displayName: displayName?.trim() || normalized.split("@")[0]!,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(password),
    };
    this.byEmail.set(normalized, account);
    this.byId.set(account.userId, account);
    return strip(account);
  }

  /**
   * Returns the account, or null. Never says which half was wrong.
   *
   * "No account with that email" is a free membership check for anyone with
   * a list of addresses, which for a finance product is a list of who banks
   * with you. The caller gets one answer and one message.
   */
  async authenticate(email: string, password: string): Promise<UserAccount | null> {
    const found = this.byEmail.get(normalizeEmail(email));
    if (!found) {
      // Same work, same wall-clock cost, no early return.
      await verifyPassword(typeof password === "string" ? password : "", await this.decoy());
      return null;
    }
    return (await verifyPassword(password, found.passwordHash)) ? strip(found) : null;
  }

  get(userId: string): UserAccount | undefined {
    const a = this.byId.get(userId);
    return a && strip(a);
  }

  findByEmail(email: string): UserAccount | undefined {
    const a = this.byEmail.get(normalizeEmail(email));
    return a && strip(a);
  }

  /**
   * Changing a password requires the current one even though the session
   * already proves who this is. A session can be a borrowed laptop; the
   * current password is the check that stops it becoming a stolen account.
   */
  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const account = this.byId.get(userId);
    if (!account) throw new AccountError("No such account");
    if (!(await verifyPassword(current, account.passwordHash)))
      throw new AccountError("Current password is incorrect");
    validatePassword(next);
    const updated: StoredAccount = { ...account, passwordHash: await hashPassword(next) };
    this.byEmail.set(account.email, updated);
    this.byId.set(account.userId, updated);
  }

  /**
   * Persistence seam: rebuild an account exactly as the log recorded it.
   *
   * No validation and no hashing — both happened when the record was
   * written. Returns false when the address or id is already taken, because
   * two instances can register the same address at the same moment and the
   * log, read in order, is the only fair judge of which one came first.
   */
  restore(record: StoredAccountRecord): boolean {
    const normalized = normalizeEmail(record.email);
    if (this.byEmail.has(normalized) || this.byId.has(record.userId)) return false;
    const account: StoredAccount = { ...record, email: normalized };
    this.byEmail.set(normalized, account);
    this.byId.set(account.userId, account);
    return true;
  }

  /** Persistence seam: apply a password change the log already verified. */
  setPasswordHash(userId: string, passwordHash: string): boolean {
    const account = this.byId.get(userId);
    if (!account) return false;
    const updated: StoredAccount = { ...account, passwordHash };
    this.byEmail.set(account.email, updated);
    this.byId.set(account.userId, updated);
    return true;
  }

  /** Testing and persistence seam. Never exposes a hash. */
  all(): readonly UserAccount[] {
    return [...this.byId.values()].map(strip);
  }

  get size(): number {
    return this.byId.size;
  }
}

const strip = ({ passwordHash: _ignored, ...rest }: StoredAccount): UserAccount => rest;
