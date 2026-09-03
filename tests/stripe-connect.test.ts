/**
 * Stripe Connect — the OAuth handshake.
 *
 * The state token and the authorize URL are pure, so they are asserted
 * directly. The two network steps use an injected fetch, so the exchange, its
 * refusals, and revocation are covered without a client id or a network.
 */

import { describe, it, expect } from "vitest";
import {
  buildAuthorization,
  exchangeCode,
  deauthorize,
  issueState,
  readState,
  redact,
  readOptionsFor,
  resolveConnectConfig,
  ConnectError,
  READ_ONLY_SCOPE,
  DEFAULT_STATE_TTL_SECONDS,
  type ConnectConfig,
  type StripeConnection,
} from "../src/erp/connect.js";

const cfg = (over: Partial<ConnectConfig> = {}): ConnectConfig => ({
  clientId: "ca_test_platform",
  secretKey: "sk_test_platform",
  redirectUri: "https://app.paisa.test/connect/stripe/callback",
  stateSecret: "a-secret-at-least-16-chars",
  baseUrls: {
    authorize: "https://stub/oauth/authorize",
    token: "https://stub/oauth/token",
    deauthorize: "https://stub/oauth/deauthorize",
  },
  ...over,
});

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

const connection = (over: Partial<StripeConnection> = {}): StripeConnection => ({
  workspaceId: "ws_1",
  accountId: "acct_1",
  accessToken: "sk_test_connected",
  scope: READ_ONLY_SCOPE,
  livemode: false,
  connectedAt: "2026-09-03T10:00:00.000Z",
  ...over,
});

describe("state", () => {
  const secret = "a-secret-at-least-16-chars";

  it("round-trips the workspace that started the handshake", () => {
    const claims = readState(issueState("ws_1", secret), secret);
    expect(claims?.workspaceId).toBe("ws_1");
  });

  it("rejects a state signed with a different secret", () => {
    expect(readState(issueState("ws_1", secret), "some-other-secret-value")).toBeNull();
  });

  it("rejects a tampered payload — the point is that the workspace cannot be swapped", () => {
    const token = issueState("ws_1", secret);
    const forged = Buffer.from(JSON.stringify({ workspaceId: "ws_victim", nonce: "x", exp: 9e9 }), "utf8")
      .toString("base64url");
    expect(readState(`${forged}.${token.slice(token.lastIndexOf(".") + 1)}`, secret)).toBeNull();
  });

  it("expires, so an abandoned handshake cannot be completed later", () => {
    const now = Date.parse("2026-09-03T10:00:00Z");
    const token = issueState("ws_1", secret, 600, now);
    expect(readState(token, secret, now + 599_000)).not.toBeNull();
    expect(readState(token, secret, now + 601_000)).toBeNull();
  });

  it("returns null rather than throwing on junk input", () => {
    expect(readState(undefined, secret)).toBeNull();
    expect(readState("", secret)).toBeNull();
    expect(readState("not-a-token", secret)).toBeNull();
    expect(readState("a.b", secret)).toBeNull();
  });

  it("gives two handshakes for one workspace different states", () => {
    expect(issueState("ws_1", secret)).not.toBe(issueState("ws_1", secret));
  });
});

describe("buildAuthorization", () => {
  it("asks Stripe for read_only and nothing wider", () => {
    const { url } = buildAuthorization(cfg(), "ws_1");
    expect(new URL(url).searchParams.get("scope")).toBe(READ_ONLY_SCOPE);
    expect(new URL(url).searchParams.get("response_type")).toBe("code");
  });

  it("carries the client id and redirect uri Stripe will check against", () => {
    const p = new URL(buildAuthorization(cfg(), "ws_1").url).searchParams;
    expect(p.get("client_id")).toBe("ca_test_platform");
    expect(p.get("redirect_uri")).toBe("https://app.paisa.test/connect/stripe/callback");
  });

  it("puts a verifiable state in the URL", () => {
    const { url, state } = buildAuthorization(cfg(), "ws_1");
    expect(new URL(url).searchParams.get("state")).toBe(state);
    expect(readState(state, cfg().stateSecret)?.workspaceId).toBe("ws_1");
  });

  it("never puts the platform secret key in a URL the browser will follow", () => {
    expect(buildAuthorization(cfg(), "ws_1").url).not.toContain("sk_test_platform");
  });

  it("refuses a secret key given where the client id belongs", () => {
    expect(() => buildAuthorization(cfg({ clientId: "sk_test_oops" }), "ws_1")).toThrow(ConnectError);
  });

  it("reports when the handshake window closes", () => {
    const now = Date.parse("2026-09-03T10:00:00Z");
    const { expiresAt } = buildAuthorization(cfg(), "ws_1", { now });
    expect(expiresAt).toBe(Math.floor(now / 1000) + DEFAULT_STATE_TTL_SECONDS);
  });
});

describe("exchangeCode", () => {
  const okToken = (over: Record<string, unknown> = {}) =>
    json({
      access_token: "sk_test_connected",
      refresh_token: "rt_1",
      stripe_user_id: "acct_1",
      scope: READ_ONLY_SCOPE,
      livemode: false,
      ...over,
    });

  const start = (workspaceId = "ws_1") => buildAuthorization(cfg(), workspaceId).state;

  it("exchanges a code for a connection bound to the workspace", async () => {
    const conn = await exchangeCode({
      cfg: cfg(),
      params: { code: "ac_1", state: start() },
      workspaceId: "ws_1",
      fetchImpl: (async () => okToken()) as unknown as typeof fetch,
    });

    expect(conn.accountId).toBe("acct_1");
    expect(conn.workspaceId).toBe("ws_1");
    expect(conn.scope).toBe(READ_ONLY_SCOPE);
    expect(conn.refreshToken).toBe("rt_1");
  });

  it("posts the code and the platform secret as form data, never in the URL", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const fetchImpl = (async (url: string, init: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init.body);
      return okToken();
    }) as unknown as typeof fetch;

    await exchangeCode({ cfg: cfg(), params: { code: "ac_1", state: start() }, workspaceId: "ws_1", fetchImpl });

    expect(capturedUrl).not.toContain("sk_test_platform");
    expect(capturedUrl).not.toContain("ac_1");
    expect(capturedBody).toContain("grant_type=authorization_code");
    expect(capturedBody).toContain("client_secret=sk_test_platform");
  });

  it("refuses a forged state — this is the attack the signature exists for", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { code: "ac_attacker", state: "forged.state" },
        workspaceId: "ws_1",
        fetchImpl: (async () => okToken()) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/could not be verified/);
  });

  it("refuses a state issued for another workspace", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { code: "ac_1", state: start("ws_other") },
        workspaceId: "ws_1",
        fetchImpl: (async () => okToken()) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/different workspace/);
  });

  it("does not call Stripe at all when the state fails", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return okToken();
    }) as unknown as typeof fetch;

    await expect(
      exchangeCode({ cfg: cfg(), params: { code: "ac_1", state: "bad" }, workspaceId: "ws_1", fetchImpl }),
    ).rejects.toThrow(ConnectError);
    expect(called).toBe(false);
  });

  it("refuses a token wider than read_only, even though it would work", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { code: "ac_1", state: start() },
        workspaceId: "ws_1",
        fetchImpl: (async () => okToken({ scope: "read_write" })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/read_write.*refusing a token that can move/s);
  });

  it("refuses a token with no account id to attribute it to", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { code: "ac_1", state: start() },
        workspaceId: "ws_1",
        fetchImpl: (async () => okToken({ stripe_user_id: undefined })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unattributable/);
  });

  it("surfaces a declined authorisation from the query string", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { error: "access_denied", error_description: "The user denied the request" },
        workspaceId: "ws_1",
      }),
    ).rejects.toThrow(/denied the request/);
  });

  it("surfaces Stripe's own reason when the exchange fails", async () => {
    await expect(
      exchangeCode({
        cfg: cfg(),
        params: { code: "ac_used", state: start() },
        workspaceId: "ws_1",
        fetchImpl: (async () =>
          json({ error: "invalid_grant", error_description: "This authorization code has already been used" }, 400)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/already been used/);
  });

  it("records livemode as Stripe reports it, not as a default", async () => {
    const live = await exchangeCode({
      cfg: cfg(),
      params: { code: "ac_1", state: start() },
      workspaceId: "ws_1",
      fetchImpl: (async () => okToken({ livemode: true })) as unknown as typeof fetch,
    });
    expect(live.livemode).toBe(true);
  });
});

describe("deauthorize", () => {
  it("revokes with the platform key and the account id", async () => {
    let body = "";
    let auth = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      auth = String((init.headers as Record<string, string>).Authorization);
      return json({ stripe_user_id: "acct_1" });
    }) as unknown as typeof fetch;

    await deauthorize(cfg(), connection(), fetchImpl);
    expect(auth).toBe("Bearer sk_test_platform");
    expect(body).toContain("stripe_user_id=acct_1");
    expect(body).toContain("client_id=ca_test_platform");
  });

  it("reports a refusal rather than pretending the account was released", async () => {
    const fetchImpl = (async () => json({ error: "invalid_request" }, 400)) as unknown as typeof fetch;
    await expect(deauthorize(cfg(), connection(), fetchImpl)).rejects.toThrow(/refused to revoke acct_1/);
  });
});

describe("redact", () => {
  it("drops the credential so a connection can be logged or returned", () => {
    const shown = redact(connection()) as unknown as Record<string, unknown>;
    expect(shown.accountId).toBe("acct_1");
    expect(shown.accessToken).toBeUndefined();
    expect(shown.refreshToken).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain("sk_test_connected");
  });
});

describe("readOptionsFor", () => {
  it("hands the connected account's token to the existing charge reader", () => {
    expect(readOptionsFor(connection()).secretKey).toBe("sk_test_connected");
  });

  it("passes through the paging and date options fetchCharges already takes", () => {
    const opts = readOptionsFor(connection(), { since: "2026-04-01", maxPages: 2 });
    expect(opts.since).toBe("2026-04-01");
    expect(opts.maxPages).toBe(2);
  });

  it("refuses to read with a token that could also write", () => {
    expect(() => readOptionsFor(connection({ scope: "read_write" }))).toThrow(/does not move money/);
  });
});

describe("resolveConnectConfig", () => {
  const env = {
    STRIPE_CONNECT_CLIENT_ID: "ca_x",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_CONNECT_REDIRECT_URI: "https://app.paisa.test/cb",
    PAISA_SESSION_SECRET: "a-secret-at-least-16-chars",
  };

  it("reads a complete configuration", () => {
    expect(resolveConnectConfig(env).clientId).toBe("ca_x");
  });

  it("names every missing variable at once, not one per attempt", () => {
    expect(() => resolveConnectConfig({ STRIPE_SECRET_KEY: "sk_test_x" })).toThrow(
      /STRIPE_CONNECT_CLIENT_ID, STRIPE_CONNECT_REDIRECT_URI, PAISA_SESSION_SECRET/,
    );
  });

  it("fails at startup rather than at the callback, after the customer has authorised", () => {
    expect(() => resolveConnectConfig({})).toThrow(ConnectError);
  });
});
