/**
 * Stripe Connect — the OAuth handshake, so a customer never hands Paisa a key.
 *
 * The existing connector in `stripe.ts` reads charges from a secret key it is
 * given. That is fine for a fixture and impossible in production: no finance
 * team will paste their Stripe secret key into a third party, and they are
 * right not to. A key cannot be scoped, cannot be revoked without rotating
 * everything else that uses it, and grants the power to move money to a tool
 * that only needs to read.
 *
 * Connect replaces that ask. The customer authorises Paisa inside Stripe's own
 * UI, Stripe hands back a token scoped to one account, and the customer can
 * revoke it from their dashboard without telling us. This file owns that
 * exchange and nothing else — once a connection exists, reading charges is
 * still `fetchCharges`, unchanged.
 *
 * Two rules are enforced here rather than left to the caller, because both are
 * the kind of mistake that is invisible until it is expensive:
 *
 *   - Paisa asks for `read_only` and refuses a token that came back with
 *     anything wider, even though a wider token would work. An AI CFO that
 *     *could* move a customer's money is a different product with a different
 *     risk profile, and the scope is the only thing standing between the two.
 *   - The `state` parameter is signed and expiring, not a random value parked
 *     in a session. Without it, anyone can redirect a signed-in user through a
 *     callback carrying an attacker's `code` and quietly bind the attacker's
 *     Stripe account to the victim's workspace.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { FetchChargesOptions } from "./stripe.js";

export class ConnectError extends Error {
  override name = "ConnectError";
}

/** The only scope Paisa asks for. See the file header for why it is enforced. */
export const READ_ONLY_SCOPE = "read_only";

const AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";
const TOKEN_URL = "https://connect.stripe.com/oauth/token";
const DEAUTHORIZE_URL = "https://connect.stripe.com/oauth/deauthorize";

/**
 * A handshake is short-lived by design: the window between "user clicked
 * Connect" and "Stripe redirected back" is a page load, not a workday.
 */
export const DEFAULT_STATE_TTL_SECONDS = 10 * 60;

export interface ConnectConfig {
  /** The platform's Connect client id — `ca_…`, not a secret. */
  readonly clientId: string;
  /** The platform's own secret key. Used only to exchange a code for a token. */
  readonly secretKey: string;
  /** Must match a redirect URI registered in the Stripe dashboard, exactly. */
  readonly redirectUri: string;
  /** Signs the `state` parameter. */
  readonly stateSecret: string;
  /** Injectable for tests; defaults to the real endpoints. */
  readonly baseUrls?: {
    readonly authorize?: string;
    readonly token?: string;
    readonly deauthorize?: string;
  };
}

/** What the signed `state` carries across the redirect. */
export interface StateClaims {
  /** The workspace that started the handshake. */
  readonly workspaceId: string;
  /** Makes two handshakes for the same workspace distinguishable. */
  readonly nonce: string;
  /** Seconds since epoch. */
  readonly exp: number;
}

export interface PendingAuthorization {
  /** Send the customer here. */
  readonly url: string;
  /** The signed state embedded in `url`, returned so a caller can log or pin it. */
  readonly state: string;
  readonly expiresAt: number;
}

/**
 * One customer's authorised Stripe account.
 *
 * `accessToken` is a live credential for someone else's account. It is kept
 * out of `toString`/JSON by `redact` below, and must never reach a log line,
 * an error message, or an API response.
 */
export interface StripeConnection {
  readonly workspaceId: string;
  /** Stripe's id for the connected account — `acct_…`. */
  readonly accountId: string;
  readonly accessToken: string;
  /** Present when Stripe issues one; used to mint a fresh access token later. */
  readonly refreshToken?: string;
  readonly scope: string;
  readonly livemode: boolean;
  /** ISO instant the connection was established. */
  readonly connectedAt: string;
}

/** A connection with the credential removed — safe to log, store in a response, or show. */
export interface RedactedConnection {
  readonly workspaceId: string;
  readonly accountId: string;
  readonly scope: string;
  readonly livemode: boolean;
  readonly connectedAt: string;
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const sign = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/**
 * Read the Connect configuration from the environment.
 *
 * Absent configuration is not a default — a half-configured handshake fails at
 * the callback, after the customer has already authorised, which is the worst
 * possible moment to discover it. So it fails here instead.
 */
export const resolveConnectConfig = (
  env: Record<string, string | undefined> = process.env,
): ConnectConfig => {
  const clientId = env.STRIPE_CONNECT_CLIENT_ID?.trim();
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const redirectUri = env.STRIPE_CONNECT_REDIRECT_URI?.trim();
  const stateSecret = env.PAISA_SESSION_SECRET?.trim();

  const missing = [
    !clientId && "STRIPE_CONNECT_CLIENT_ID",
    !secretKey && "STRIPE_SECRET_KEY",
    !redirectUri && "STRIPE_CONNECT_REDIRECT_URI",
    !stateSecret && "PAISA_SESSION_SECRET",
  ].filter(Boolean);

  if (missing.length)
    throw new ConnectError(`Stripe Connect is not configured: ${missing.join(", ")} must be set`);

  return {
    clientId: clientId!,
    secretKey: secretKey!,
    redirectUri: redirectUri!,
    stateSecret: stateSecret!,
  };
};

/* ------------------------------------------------------------------ */
/* State — signed, expiring, workspace-bound                           */
/* ------------------------------------------------------------------ */

export const issueState = (
  workspaceId: string,
  secret: string,
  ttlSeconds = DEFAULT_STATE_TTL_SECONDS,
  now = Date.now(),
): string => {
  if (!workspaceId) throw new ConnectError("A workspace is required to start a Stripe connection");
  const claims: StateClaims = {
    workspaceId,
    nonce: randomBytes(9).toString("base64url"),
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
};

/** Returns null for anything not currently valid — never throws on input. */
export const readState = (
  state: string | undefined,
  secret: string,
  now = Date.now(),
): StateClaims | null => {
  if (!state || typeof state !== "string") return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = state.slice(0, dot);
  const provided = Buffer.from(state.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload, secret), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let claims: StateClaims;
  try {
    claims = JSON.parse(unb64(payload)) as StateClaims;
  } catch {
    return null;
  }
  if (typeof claims.workspaceId !== "string" || !claims.workspaceId) return null;
  if (typeof claims.nonce !== "string" || !claims.nonce) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
  return claims;
};

/* ------------------------------------------------------------------ */
/* Step 1 — send the customer to Stripe                                */
/* ------------------------------------------------------------------ */

/**
 * Build the URL that starts the handshake. Pure: no network, no clock beyond
 * the one passed in, so the whole URL is assertable in a test.
 */
export const buildAuthorization = (
  cfg: ConnectConfig,
  workspaceId: string,
  opts: { readonly ttlSeconds?: number; readonly now?: number } = {},
): PendingAuthorization => {
  if (!cfg.clientId.startsWith("ca_"))
    throw new ConnectError(
      `Expected a Connect client id (ca_…), got "${cfg.clientId.slice(0, 6)}…" — a secret key here would leak it into a redirect URL`,
    );

  const now = opts.now ?? Date.now();
  const ttl = opts.ttlSeconds ?? DEFAULT_STATE_TTL_SECONDS;
  const state = issueState(workspaceId, cfg.stateSecret, ttl, now);

  const qs = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: READ_ONLY_SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  });

  return {
    url: `${cfg.baseUrls?.authorize ?? AUTHORIZE_URL}?${qs}`,
    state,
    expiresAt: Math.floor(now / 1000) + ttl,
  };
};

/* ------------------------------------------------------------------ */
/* Step 2 — Stripe redirects back                                      */
/* ------------------------------------------------------------------ */

/** The shape Stripe's callback puts in the query string. */
export interface CallbackParams {
  readonly code?: string;
  readonly state?: string;
  readonly error?: string;
  readonly error_description?: string;
}

export interface ExchangeOptions {
  readonly cfg: ConnectConfig;
  readonly params: CallbackParams;
  /**
   * The workspace of the session that hit the callback. It must match the
   * workspace the handshake started in — that match is the whole point of
   * signing the state, so it is required rather than optional.
   */
  readonly workspaceId: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: number;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly stripe_user_id?: string;
  readonly scope?: string;
  readonly livemode?: boolean;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Exchange the callback's `code` for a token, or refuse and say why.
 *
 * Every refusal below is a case where continuing would produce a connection
 * that looks fine and is not: a forged state binds the wrong account, a wider
 * scope grants powers the product does not need, and a missing account id
 * leaves a token nothing can be attributed to.
 */
export const exchangeCode = async (opts: ExchangeOptions): Promise<StripeConnection> => {
  const { cfg, params, workspaceId } = opts;
  const now = opts.now ?? Date.now();

  // Stripe reports a declined authorisation here rather than by status code.
  if (params.error)
    throw new ConnectError(
      `Stripe declined the connection: ${params.error_description || params.error}`,
    );

  if (!params.code) throw new ConnectError("Callback carried no authorization code");

  const claims = readState(params.state, cfg.stateSecret, now);
  if (!claims)
    throw new ConnectError(
      "Connection request could not be verified — it was tampered with, or it expired before the customer finished. Start the connection again.",
    );

  if (claims.workspaceId !== workspaceId)
    throw new ConnectError(
      "Connection was started in a different workspace than the one completing it — refusing to bind the account",
    );

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(cfg.baseUrls?.token ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_secret: cfg.secretKey,
    }).toString(),
  });

  const body = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || body.error)
    throw new ConnectError(
      `Stripe rejected the code exchange (${res.status}): ${body.error_description || body.error || "no detail given"}`,
    );

  if (!body.access_token || !body.stripe_user_id)
    throw new ConnectError("Stripe returned a token without an account id — refusing an unattributable connection");

  // A token wider than asked for is a Stripe dashboard misconfiguration, and
  // storing it would silently give an AI CFO the ability to move money.
  const scope = body.scope ?? "";
  if (scope !== READ_ONLY_SCOPE)
    throw new ConnectError(
      `Stripe returned a "${scope || "unknown"}" token but Paisa asked for ${READ_ONLY_SCOPE} — refusing a token that can move a customer's money`,
    );

  return {
    workspaceId,
    accountId: body.stripe_user_id,
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    scope,
    livemode: body.livemode === true,
    connectedAt: new Date(now).toISOString(),
  };
};

/* ------------------------------------------------------------------ */
/* Revoking                                                            */
/* ------------------------------------------------------------------ */

/**
 * Hand the account back. A customer can also do this from their own Stripe
 * dashboard, which is the point of Connect — so this failing is not a reason
 * to keep the connection row: it is already unusable either way.
 */
export const deauthorize = async (
  cfg: ConnectConfig,
  connection: Pick<StripeConnection, "accountId">,
  fetchImpl?: typeof fetch,
): Promise<void> => {
  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(cfg.baseUrls?.deauthorize ?? DEAUTHORIZE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      stripe_user_id: connection.accountId,
    }).toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConnectError(`Stripe refused to revoke ${connection.accountId} (${res.status}): ${detail.slice(0, 200)}`);
  }
};

/* ------------------------------------------------------------------ */
/* Using a connection                                                  */
/* ------------------------------------------------------------------ */

/** Strip the credential. Anything leaving the process should go through this. */
export const redact = (c: StripeConnection): RedactedConnection => ({
  workspaceId: c.workspaceId,
  accountId: c.accountId,
  scope: c.scope,
  livemode: c.livemode,
  connectedAt: c.connectedAt,
});

/**
 * Turn a connection into options `fetchCharges` already understands.
 *
 * A Connect access token *is* a secret key for the connected account, so no
 * new transport is needed. That also means a live connection carries an
 * `sk_live_` token, which `fetchCharges` refuses on purpose until this
 * connector has been reconciled against a real close (see stripe.ts). Naming
 * that here gives the operator the actual reason instead of a refusal that
 * appears to come from nowhere.
 */
export const readOptionsFor = (
  connection: StripeConnection,
  extra: Omit<FetchChargesOptions, "secretKey"> = {},
): FetchChargesOptions => {
  if (connection.scope !== READ_ONLY_SCOPE)
    throw new ConnectError(
      `Refusing to read with a "${connection.scope}" token — Paisa reads, it does not move money`,
    );
  return { ...extra, secretKey: connection.accessToken };
};
