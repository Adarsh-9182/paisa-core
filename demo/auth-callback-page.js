/**
 * Where Google sends the browser back.
 *
 * Supabase returns its tokens in the URL *fragment*, which browsers never put
 * on the wire — so the server cannot read them, and this page exists to hand
 * them over deliberately. It posts the access token to /api/auth/google,
 * which verifies it and issues a Paisa session cookie.
 *
 * The fragment is cleared before anything else happens. A token left in the
 * address bar is a token in the history of a shared machine, and in the
 * referrer of the next link clicked.
 *
 * There is no visible UI beyond a line of text: on a working connection this
 * page lives for about as long as a redirect.
 */
export const callbackPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signing you in — Paisa</title>
<meta name="robots" content="noindex">
<style>
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#16130F; color:#A79C8D; min-height:100vh; margin:0;
         display:flex; align-items:center; justify-content:center; font-size:14px; }
</style>
</head>
<body>
  <p id="msg">Signing you in…</p>
  <script>
    (async () => {
      const params = new URLSearchParams(location.hash.slice(1));
      // Clear it first: what is in the fragment is a credential.
      history.replaceState(null, "", location.pathname);

      const fail = (message) =>
        (location.href = "/login?" + new URLSearchParams({ error: message }));

      // Google or Supabase refused before a token was ever minted.
      if (params.get("error"))
        return fail(params.get("error_description") || params.get("error"));

      const token = params.get("access_token");
      if (!token) return fail("That sign-in link is incomplete. Try signing in again.");

      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => null);

      if (!res || !res.ok) {
        const body = await res?.json().catch(() => null);
        return fail(body?.error || "Sign-in did not complete. Try again.");
      }
      const { next } = await res.json();
      location.href = next || "/app";
    })();
  </script>
</body>
</html>`;
