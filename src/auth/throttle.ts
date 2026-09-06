/**
 * Brute-force protection for sign-in.
 *
 * Before this, /api/login would answer an unlimited number of guesses at full
 * speed. scrypt makes each guess expensive for an attacker who has stolen the
 * hashes, but it does nothing about an attacker who simply asks the server —
 * and a password that survives a stolen database still falls to a few million
 * online attempts. OWASP ASVS 2.2.1 asks for exactly this control.
 *
 * Three counters, because "too many attempts" means three different attacks:
 *
 *   pair   one attacker, one account — the ordinary password guess.
 *   ip     one source, many accounts — credential stuffing from a breach dump.
 *   email  many sources, one account — a distributed guess at one target.
 *
 * The thresholds differ on purpose, and the reason is a denial of service
 * rather than a guess. Locking an account on its email alone would let anyone
 * who knows an address lock its owner out by typing rubbish, which turns a
 * security control into an attack. So the strict counter is keyed on the pair,
 * the per-email counter sits high enough that a real user's own mistakes never
 * reach it, and it exists only to bound the distributed case.
 *
 * A lock is a delay, never a permanent state: every counter is measured inside
 * a rolling window, so an attacker who stops is forgotten and a locked-out
 * user gets in again without an administrator.
 *
 * **The counter must not become an oracle.** An address with no account is
 * throttled exactly like one with an account, and the caller is told the same
 * thing either way. A 429 that only ever appears for real users is a membership
 * check for anyone holding a list of addresses — which for a finance product
 * is a list of who banks with you, the same reason /api/login has one message
 * for a wrong email and a wrong password.
 */

export interface ThrottleStore {
  /** How many failures are recorded for `key` at or after `since` (ms). */
  failures(key: string, since: number): Promise<number>;
  record(key: string, at: number): Promise<void>;
  /** Forget this key — called on a success, so one good sign-in resets it. */
  clear(key: string): Promise<void>;
}

export interface ThrottleDecision {
  readonly allowed: boolean;
  /** Seconds the caller must wait before trying again. 0 when allowed. */
  readonly retryAfterSeconds: number;
}

/** A step on the ladder: at `failures` within the window, wait `lockSeconds`. */
interface Step {
  readonly failures: number;
  readonly lockSeconds: number;
}

/**
 * Escalating, not binary.
 *
 * A fixed "5 strikes then 15 minutes" is both too harsh for someone mistyping
 * a password twice and too soft against a patient attacker, who simply waits
 * out each lock. Doubling the wait means a sustained attack pays more for
 * every attempt while a real user's third try costs them a minute.
 */
const PAIR_LADDER: readonly Step[] = [
  { failures: 5, lockSeconds: 60 },
  { failures: 8, lockSeconds: 5 * 60 },
  { failures: 12, lockSeconds: 30 * 60 },
  { failures: 20, lockSeconds: 2 * 60 * 60 },
];

/** One source, many accounts. Higher, because an office shares an address. */
const IP_LADDER: readonly Step[] = [
  { failures: 30, lockSeconds: 5 * 60 },
  { failures: 60, lockSeconds: 60 * 60 },
];

/**
 * Many sources, one account. Highest of the three, and deliberately so: this
 * is the counter an attacker could use to lock a real user out, so it must sit
 * far above anything that user's own mistakes could reach.
 */
const EMAIL_LADDER: readonly Step[] = [{ failures: 100, lockSeconds: 15 * 60 }];

/** Failures older than this are forgotten, so a lock always ends by itself. */
export const WINDOW_SECONDS = 60 * 60;

/** The longest wait any ladder can impose — what a caller is asked to wait. */
const lockFor = (ladder: readonly Step[], failures: number): number => {
  let seconds = 0;
  for (const step of ladder) if (failures >= step.failures) seconds = step.lockSeconds;
  return seconds;
};

/**
 * Normalised so that "A@B.com" and "a@b.com " share a counter. Sign-in itself
 * normalises the address before looking it up; a counter that did not would be
 * bypassed by changing the capitalisation of every guess.
 */
const normalize = (value: string): string => value.trim().toLowerCase();

export class SignInThrottle {
  constructor(
    private readonly store: ThrottleStore,
    private readonly now: () => number = Date.now,
  ) {}

  private keys(email: string, ip: string) {
    const e = normalize(email);
    const i = normalize(ip);
    return {
      pair: `pair:${e}:${i}`,
      ip: `ip:${i}`,
      email: `email:${e}`,
    };
  }

  /**
   * May this attempt proceed?
   *
   * Checked before the password is verified, so a locked-out caller does not
   * even spend the server's scrypt work — which is what makes this a defence
   * against exhaustion as well as against guessing.
   */
  async check(email: string, ip: string): Promise<ThrottleDecision> {
    const since = this.now() - WINDOW_SECONDS * 1000;
    const k = this.keys(email, ip);

    const [pair, byIp, byEmail] = await Promise.all([
      this.store.failures(k.pair, since),
      this.store.failures(k.ip, since),
      this.store.failures(k.email, since),
    ]);

    const wait = Math.max(
      lockFor(PAIR_LADDER, pair),
      lockFor(IP_LADDER, byIp),
      lockFor(EMAIL_LADDER, byEmail),
    );
    return wait > 0
      ? { allowed: false, retryAfterSeconds: wait }
      : { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record a failed attempt against all three counters. */
  async fail(email: string, ip: string): Promise<void> {
    const at = this.now();
    const k = this.keys(email, ip);
    await Promise.all([
      this.store.record(k.pair, at),
      this.store.record(k.ip, at),
      this.store.record(k.email, at),
    ]);
  }

  /**
   * Record a success, which forgets this caller's failures.
   *
   * The per-email counter is cleared too: whoever just proved they hold the
   * password is the owner, and leaving a distributed attack's count against
   * their address would lock them out of their own account minutes later.
   */
  async succeed(email: string, ip: string): Promise<void> {
    const k = this.keys(email, ip);
    await Promise.all([this.store.clear(k.pair), this.store.clear(k.ip), this.store.clear(k.email)]);
  }
}

/**
 * The default store: a Map, bounded and self-pruning.
 *
 * Stated plainly, because it is a real limit rather than an oversight — on
 * serverless each instance counts on its own, so an attacker spread across
 * enough cold starts sees a higher effective threshold than the ladder names.
 * That is still far better than no limit at all, and the interface above is
 * the seam: a Postgres-backed store makes the counters global without any
 * route changing, the same way ActionStore made the ledger durable.
 */
export class MemoryThrottleStore implements ThrottleStore {
  private hits = new Map<string, number[]>();

  /** Bounds the memory an attacker can make this process spend. */
  constructor(private readonly maxKeys = 10_000) {}

  private prune(key: string, since: number): number[] {
    const kept = (this.hits.get(key) ?? []).filter((at) => at >= since);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  async failures(key: string, since: number): Promise<number> {
    return this.prune(key, since).length;
  }

  async record(key: string, at: number): Promise<void> {
    const since = at - WINDOW_SECONDS * 1000;
    const kept = this.prune(key, since);
    // Evicting the oldest key is wrong here — it would let an attacker flush
    // their own counter by making noise under other keys. Refusing to grow is
    // the safe direction: existing counters keep counting.
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) return;
    kept.push(at);
    this.hits.set(key, kept);
  }

  async clear(key: string): Promise<void> {
    this.hits.delete(key);
  }
}
