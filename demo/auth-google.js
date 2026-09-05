/**
 * Google sign-in, through Supabase.
 *
 * Supabase Auth owns the conversation with Google; this module owns the two
 * decisions that conversation cannot make for us — where to send the browser,
 * and where it is allowed to come back to.
 *
 * There is no SDK here on purpose. Supabase's authorize endpoint is a plain
 * redirect, and the token it hands back is verified by `src/auth/supabase.ts`,
 * which is pure HMAC and needs no network. A browser bundle would add a
 * dependency, a build step and a second place where a token is trusted, to
 * replace a URL and a fetch.
 *
 * Sign-in is configuration, not code: with no Supabase project configured the
 * button does not render at all. A button that is always there and always
 * fails teaches a visitor that the product is broken.
 */

/**
 * The configured project, or null.
 *
 * Both halves are required. The URL alone cannot verify a token, and the
 * secret alone has nowhere to send anyone — so a half-configured deployment
 * is treated as no configuration rather than as a broken button.
 */
export const googleConfig = () => {
  const url = process.env.PAISA_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const jwtSecret = process.env.PAISA_SUPABASE_JWT_SECRET?.trim();
  if (!url || !jwtSecret) return null;
  return { url, jwtSecret, issuer: `${url}/auth/v1` };
};

export const googleEnabled = () => googleConfig() !== null;

/** Where the browser comes back to. One fixed URL, for a reason — see below. */
export const callbackUrl = (origin) => `${origin}/auth/callback`;

/**
 * The Supabase authorize URL for Google.
 *
 * `redirect_to` carries no query of its own, and that is deliberate. Supabase
 * matches it against an allow-list, so a URL that varies per sign-in is a URL
 * that silently stops working the first time someone signs in from a page the
 * list did not anticipate. Where the visitor was headed travels in a cookie
 * instead, which the allow-list has no opinion about.
 */
export const authorizeUrl = (config, origin) =>
  `${config.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl(origin))}`;

/**
 * The origin this request arrived on.
 *
 * Taken from the request rather than from configuration so that a preview
 * deployment sends people back to the preview, and local development back to
 * localhost. Getting this from an env var is how every developer ends up
 * signing in to production by accident.
 */
export const originOf = (req, secure) => {
  const host = String(req.headers.host ?? "").split(",")[0].trim();
  return `${secure ? "https" : "http"}://${host}`;
};
