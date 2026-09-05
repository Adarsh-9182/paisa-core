/**
 * Sign-in rate limiting.
 *
 * The policy is a security control, so the questions asked here are the ones
 * that make it either work or backfire: does a sustained guess actually get
 * slower, does a real user's own mistake clear, can the counter be used to
 * lock somebody else out, and does it stay silent about which addresses have
 * accounts.
 */
import { describe, it, expect } from "vitest";
import { SignInThrottle, MemoryThrottleStore, WINDOW_SECONDS } from "../src/auth/throttle.js";

/** A clock the test moves by hand — no waiting, no flakiness. */
const clock = (start = 1_760_000_000_000) => {
  let now = start;
  return { now: () => now, advance: (seconds: number) => (now += seconds * 1000) };
};

const make = () => {
  const c = clock();
  return { throttle: new SignInThrottle(new MemoryThrottleStore(), c.now), clock: c };
};

const failTimes = async (t: SignInThrottle, n: number, email = "a@b.com", ip = "1.1.1.1") => {
  for (let i = 0; i < n; i++) await t.fail(email, ip);
};

describe("guessing gets slower", () => {
  it("allows a few mistakes, then makes the caller wait", async () => {
    const { throttle } = make();
    await failTimes(throttle, 4);
    expect((await throttle.check("a@b.com", "1.1.1.1")).allowed).toBe(true);

    await failTimes(throttle, 1);
    const locked = await throttle.check("a@b.com", "1.1.1.1");
    expect(locked.allowed).toBe(false);
    expect(locked.retryAfterSeconds).toBe(60);
  });

  it("escalates rather than repeating one fixed penalty", async () => {
    // A fixed lock is waited out; a doubling one makes a patient attacker
    // pay more for every attempt.
    const waits: number[] = [];
    for (const total of [5, 8, 12, 20]) {
      const t = make().throttle;
      await failTimes(t, total);
      waits.push((await t.check("a@b.com", "1.1.1.1")).retryAfterSeconds);
    }
    expect(waits).toEqual([60, 300, 1800, 7200]);
  });

  it("forgets failures once the window has passed, with no administrator", async () => {
    const { throttle, clock } = make();
    await failTimes(throttle, 6);
    expect((await throttle.check("a@b.com", "1.1.1.1")).allowed).toBe(false);

    clock.advance(WINDOW_SECONDS + 1);
    expect((await throttle.check("a@b.com", "1.1.1.1")).allowed).toBe(true);
  });

  it("clears on a success, so one good sign-in resets the count", async () => {
    const { throttle } = make();
    await failTimes(throttle, 4);
    await throttle.succeed("a@b.com", "1.1.1.1");
    await failTimes(throttle, 4);
    expect((await throttle.check("a@b.com", "1.1.1.1")).allowed).toBe(true);
  });
});

describe("the counter cannot be turned into a weapon", () => {
  it("does not let one attacker lock a real user out of their own account", async () => {
    // The whole reason the strict counter is keyed on (email, ip) rather than
    // on the email alone: otherwise anyone who knows an address can deny its
    // owner access by typing rubbish from anywhere.
    const throttle = make().throttle;
    await failTimes(throttle, 40, "victim@company.com", "9.9.9.9");

    const victim = await throttle.check("victim@company.com", "5.5.5.5");
    expect(victim.allowed).toBe(true);
  });

  it("still bounds a distributed guess at one address", async () => {
    const throttle = make().throttle;
    // A hundred failures spread across a hundred different sources.
    for (let i = 0; i < 100; i++) await throttle.fail("victim@company.com", `10.0.0.${i}`);
    expect((await throttle.check("victim@company.com", "10.1.1.1")).allowed).toBe(false);
  });

  it("catches one source spraying many accounts", async () => {
    const throttle = make().throttle;
    // Credential stuffing: each account sees only a couple of tries, so the
    // per-pair counter never fires. The per-source counter is what sees it.
    for (let i = 0; i < 30; i++) await throttle.fail(`user${i}@company.com`, "7.7.7.7");
    expect((await throttle.check("someone-else@company.com", "7.7.7.7")).allowed).toBe(false);
  });
});

describe("the counter says nothing about who has an account", () => {
  it("throttles an unknown address exactly like a known one", async () => {
    // A 429 that appeared only for real users would be a free membership
    // check for anyone holding a list of addresses.
    const known = make().throttle;
    const unknown = make().throttle;
    await failTimes(known, 5, "real@company.com", "2.2.2.2");
    await failTimes(unknown, 5, "nobody@nowhere.test", "2.2.2.2");

    expect(await known.check("real@company.com", "2.2.2.2")).toEqual(
      await unknown.check("nobody@nowhere.test", "2.2.2.2"),
    );
  });

  it("counts one address however it is capitalised or padded", async () => {
    const throttle = make().throttle;
    for (const variant of [" A@B.com", "a@b.COM ", "A@B.COM", "a@b.com", " a@b.com "])
      await throttle.fail(variant, "3.3.3.3");
    expect((await throttle.check("a@b.com", "3.3.3.3")).allowed).toBe(false);
  });
});

describe("the store cannot be made to exhaust the process", () => {
  it("stops taking new keys at its bound instead of growing without limit", async () => {
    const store = new MemoryThrottleStore(3);
    const now = Date.now();
    for (const key of ["a", "b", "c", "d", "e"]) await store.record(key, now);
    // The bound holds, and — importantly — the keys already counting are the
    // ones kept. Evicting them would let an attacker flush their own counter
    // by making noise under other keys.
    expect(await store.failures("a", now - 1000)).toBe(1);
    expect(await store.failures("e", now - 1000)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The route, not just the policy — the control only counts if it is
   actually asked before the password is checked.                      */

const { handle } = await import("../demo/app.js" as string);

const post = async (url: string, body: unknown, ip: string) => {
  const { Readable } = await import("node:stream");
  const req: any = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  req.url = url;
  req.headers = { host: "localhost:4000", "x-forwarded-for": ip };
  const headers = new Map<string, string>();
  let status = 200;
  let payload = "";
  const res: any = {
    set statusCode(c: number) { status = c; },
    get statusCode() { return status; },
    setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v),
    getHeader: (k: string) => headers.get(k.toLowerCase()),
    end: (chunk?: string) => { payload = chunk ?? ""; },
  };
  await handle(req, res);
  return { status, body: payload.startsWith("{") ? JSON.parse(payload) : payload, headers };
};

describe("/api/login stops answering an endless guess", () => {
  it("turns 401 into 429 once the ladder fires, and says how long to wait", async () => {
    const ip = "203.0.113.7";
    const attempt = (n: number) =>
      post("/api/login", { email: "owner@paisa.local", password: `wrong-${n}` }, ip);

    for (let i = 0; i < 5; i++) expect((await attempt(i)).status).toBe(401);

    const blocked = await attempt(99);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    // The refusal must not name the account, or it becomes a membership check.
    expect(JSON.stringify(blocked.body)).not.toContain("owner@paisa.local");
  });

  it("throttles an address that has no account, the same way", async () => {
    const ip = "203.0.113.8";
    for (let i = 0; i < 5; i++)
      expect((await post("/api/login", { email: "ghost@nowhere.test", password: `x${i}` }, ip)).status).toBe(401);
    expect((await post("/api/login", { email: "ghost@nowhere.test", password: "x" }, ip)).status).toBe(429);
  });
});
