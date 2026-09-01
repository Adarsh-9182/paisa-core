/**
 * Accounts, and the one thing a login form is actually for getting right:
 * not telling strangers who has an account.
 *
 * For a finance product the account list is the customer list. An endpoint
 * that answers "is there an account for this address" — by message, by status
 * code, or by taking two milliseconds instead of eighty — hands it over.
 */
import { describe, expect, it } from "vitest";
import { AccountDirectory, AccountError, isEmailShaped, normalizeEmail } from "../src/tenancy/accounts.js";

const PASSWORD = "correct-horse-battery";

const withAccount = async () => {
  const d = new AccountDirectory();
  const a = await d.register("Adarsh@Example.com", PASSWORD, "Adarsh");
  return { d, a };
};

describe("registering", () => {
  it("normalises the email so case is not a second account", async () => {
    const { d, a } = await withAccount();
    expect(a.email).toBe("adarsh@example.com");
    expect(d.findByEmail("  ADARSH@EXAMPLE.COM ")?.userId).toBe(a.userId);
  });

  it("does not treat dots or +tags as the same mailbox", async () => {
    // Gmail's behaviour, not the internet's. Applying it universally merges
    // two genuinely different addresses into one account elsewhere.
    const d = new AccountDirectory();
    await d.register("a.b@example.com", PASSWORD);
    await d.register("ab@example.com", PASSWORD);
    await d.register("ab+work@example.com", PASSWORD);
    expect(d.size).toBe(3);
  });

  it("refuses a duplicate", async () => {
    const { d } = await withAccount();
    await expect(d.register("adarsh@example.com", PASSWORD)).rejects.toThrow(/already exists/);
  });

  it("rejects a weak password before doing any hashing work", async () => {
    const d = new AccountDirectory();
    await expect(d.register("x@example.com", "short")).rejects.toThrow(/at least 10 characters/);
    expect(d.size).toBe(0);
  });

  it("rejects things that are not shaped like an address", async () => {
    const d = new AccountDirectory();
    for (const bad of ["nope", "a@b", "a b@example.com", "@example.com", "a@.com", ""]) {
      await expect(d.register(bad, PASSWORD)).rejects.toThrow(AccountError);
    }
    expect(isEmailShaped("a@b.co")).toBe(true);
  });

  it("defaults a display name rather than showing a blank", async () => {
    const d = new AccountDirectory();
    expect((await d.register("finance@nimbus.io", PASSWORD)).displayName).toBe("finance");
    expect((await d.register("x@nimbus.io", PASSWORD, "  Ada  ")).displayName).toBe("Ada");
  });

  it("never hands back a password hash", async () => {
    const { d, a } = await withAccount();
    expect(JSON.stringify(a)).not.toMatch(/scrypt/);
    expect(JSON.stringify(d.all())).not.toMatch(/scrypt/);
    expect(JSON.stringify(d.get(a.userId))).not.toMatch(/scrypt/);
  });
});

describe("authenticating", () => {
  it("accepts the right password", async () => {
    const { d, a } = await withAccount();
    expect((await d.authenticate("adarsh@example.com", PASSWORD))?.userId).toBe(a.userId);
  });

  it("accepts it regardless of how the email was typed", async () => {
    const { d } = await withAccount();
    expect(await d.authenticate("  ADARSH@Example.com  ", PASSWORD)).not.toBeNull();
  });

  it("rejects the wrong password", async () => {
    const { d } = await withAccount();
    expect(await d.authenticate("adarsh@example.com", "wrong-password-here")).toBeNull();
  });

  it("answers the same way for an unknown address as for a wrong password", async () => {
    const { d } = await withAccount();
    expect(await d.authenticate("nobody@example.com", PASSWORD)).toBeNull();
    expect(await d.authenticate("adarsh@example.com", "wrong-password-here")).toBeNull();
  });

  it("takes comparable time whether the account exists or not", async () => {
    /*
     * The failure this prevents: an early `return null` for an unknown
     * address skips scrypt entirely and comes back in microseconds, while a
     * wrong password pays the full derivation cost. The two are then
     * trivially distinguishable with a stopwatch, and a stopwatch is all it
     * takes to enumerate a customer list.
     *
     * Timing is noisy, so this asserts the same order of magnitude rather
     * than a tight bound — enough to catch a missing decoy hash, which is a
     * 100x gap, without failing on a busy machine.
     */
    const { d } = await withAccount();
    const time = async (fn: () => Promise<unknown>) => {
      const t = Date.now();
      await fn();
      return Date.now() - t;
    };
    const unknown = await time(() => d.authenticate("nobody@example.com", PASSWORD));
    const wrong = await time(() => d.authenticate("adarsh@example.com", "wrong-password-here"));
    const slower = Math.max(unknown, wrong) + 1;
    const faster = Math.min(unknown, wrong) + 1;
    expect(slower / faster).toBeLessThan(10);
  });

  it("does not throw on rubbish input", async () => {
    const { d } = await withAccount();
    // A login form is the most hostile input surface there is; it must
    // answer "no", not 500.
    expect(await d.authenticate("adarsh@example.com", undefined as unknown as string)).toBeNull();
    expect(await d.authenticate("", "")).toBeNull();
  });
});

describe("changing a password", () => {
  it("requires the current one even though the session already proves who you are", async () => {
    // A session can be a borrowed laptop. The current password is what stops
    // that becoming a stolen account.
    const { d, a } = await withAccount();
    await expect(d.changePassword(a.userId, "not-the-password", "a-brand-new-one")).rejects.toThrow(
      /Current password is incorrect/,
    );
  });

  it("applies immediately: the old password stops working, the new one starts", async () => {
    const { d, a } = await withAccount();
    await d.changePassword(a.userId, PASSWORD, "a-brand-new-one");
    expect(await d.authenticate(a.email, PASSWORD)).toBeNull();
    expect(await d.authenticate(a.email, "a-brand-new-one")).not.toBeNull();
  });

  it("holds the new password to the same standard as the first", async () => {
    const { d, a } = await withAccount();
    await expect(d.changePassword(a.userId, PASSWORD, "short")).rejects.toThrow(/at least 10 characters/);
    expect(await d.authenticate(a.email, PASSWORD)).not.toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and does nothing clever", () => {
    expect(normalizeEmail("  A.B+x@Example.COM ")).toBe("a.b+x@example.com");
  });
});
