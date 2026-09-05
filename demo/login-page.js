/**
 * The sign-in page.
 *
 * Posts credentials to /api/login, which sets an HttpOnly session cookie and
 * redirects. No client-side session logic — the cookie is the only state, so
 * a page reload is always the source of truth.
 *
 * Two ways in, and they are not equal. Google is offered first because it is
 * the one most people will use and the one that cannot be phished for a
 * password Paisa stores. Email and password stay below it for the owner
 * account, which exists before any Google identity is linked to it.
 *
 * The Google button renders only when Google sign-in is configured. A button
 * that is always present and always fails teaches a visitor that the product
 * is broken, which is a worse first impression than one route in.
 */

/**
 * Where to land once the cookie is set.
 *
 * Only a path within this site is accepted. A `next` that carries a host —
 * "//evil.test" and "https://evil.test" both do — would turn the login page
 * into an open redirect, which is the standard way a convincing credential
 * phish is built on top of a real sign-in URL.
 */
export const safeNext = (next, fallback = "/app") => {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
};

/**
 * Text that is about to become HTML.
 *
 * The error on this page arrives in the query string — /api/login bounces its
 * own message back through ?error= — so it is caller-supplied, and a sign-in
 * page is exactly where a reflected script is worth the attacker's trouble.
 */
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * A value that is about to be embedded in a <script> block.
 *
 * JSON.stringify alone is not enough: it happily emits the characters
 * "</script>", which ends the block early and starts an attacker's. `safeNext`
 * keeps the value a path on this site, but a path may still contain "<".
 */
const inlineJson = (value) =>
  JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

/** Google's mark, inline: four paths, no network request, no layout shift. */
const GOOGLE_MARK = `<svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"/>
  <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"/>
  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"/>
</svg>`;

/** What the right-hand panel promises. Each line is something the app does. */
const PROOF = [
  "A perpetual ledger, closed continuously",
  "ASC 606 revenue recognition",
  "GST with place of supply and dated rates",
  "An AI CFO that cites the ledger for every figure",
];

const CHECK = `<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
  <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <path d="m6.6 10.2 2.3 2.3 4.5-4.7" fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const loginPage = (error, next, { google = false } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Paisa</title>
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23F26B1D'/%3E%3Ctext x='16' y='23' font-family='-apple-system,sans-serif' font-size='20' font-weight='700' fill='white' text-anchor='middle'%3E%E2%82%B9%3C/text%3E%3C/svg%3E">
<style>
  :root {
    --bg:#16130F; --wash:#1C1813; --surface:#221D17; --raised:#2A241C;
    --line:#332B22; --line-soft:#282118;
    --ink:#F5F0E8; --ink-2:#A79C8D; --ink-3:#7A7063;
    --orange:#F26B1D; --orange-deep:#C24E08;
    --red:#E36B5E; --red-soft:#3A231F; --red-line:#5A322A;
  }
  * { box-sizing:border-box; margin:0; }
  html { -webkit-text-size-adjust:100%; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
         background:var(--bg); color:var(--ink); min-height:100vh;
         display:flex; flex-direction:column; }

  /* A single hairline grid, very faint — the same field the console sits on. */
  body::before {
    content:""; position:fixed; inset:0; pointer-events:none; opacity:.5;
    background-image:linear-gradient(var(--line-soft) 1px, transparent 1px),
                     linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
    background-size:64px 64px;
    -webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 40%, #000 30%, transparent 100%);
            mask-image:radial-gradient(ellipse 80% 60% at 50% 40%, #000 30%, transparent 100%);
  }

  header { position:relative; display:flex; align-items:center; justify-content:space-between;
           padding:20px 22px; }
  .mark { display:flex; align-items:center; gap:9px; text-decoration:none; color:var(--ink); }
  .mark .box { width:27px; height:27px; border-radius:8px; background:var(--orange); color:#fff;
               display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; }
  .mark b { font-weight:660; font-size:15.5px; letter-spacing:-.01em; }
  .top-link { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 17px;
              border:1px solid var(--line); border-radius:999px; background:var(--surface);
              color:var(--ink); text-decoration:none; font-size:14px; font-weight:520;
              transition:border-color .15s, background .15s; }
  .top-link:hover { background:var(--raised); border-color:#3E362B; }

  main { position:relative; flex:1; display:flex; align-items:center; justify-content:center;
         padding:8px 18px 52px; }

  /* One wash panel holds both halves; the form floats inside it. */
  .shell { width:100%; max-width:940px; background:var(--wash); border:1px solid var(--line-soft);
           border-radius:26px; padding:10px; }
  .split { display:grid; gap:10px; grid-template-columns:minmax(0,1fr) minmax(0,.92fr); }
  .panel { background:var(--bg); border:1px solid var(--line); border-radius:19px;
           padding:44px 34px; }
  .form-wrap { max-width:352px; margin:0 auto; width:100%; }

  h1 { font-size:29px; font-weight:640; letter-spacing:-.025em; text-align:center; line-height:1.15; }
  .sub { color:var(--ink-2); font-size:14px; text-align:center; margin-top:11px; line-height:1.5; }

  .provider { position:relative; display:flex; align-items:center; justify-content:center; gap:10px;
              width:100%; height:47px; margin-top:26px; border-radius:999px;
              border:1px solid var(--line); background:var(--surface); color:var(--ink);
              font-size:14.5px; font-weight:560; font-family:inherit; cursor:pointer;
              text-decoration:none; transition:background .15s, border-color .15s; }
  .provider:hover { background:var(--raised); border-color:#3E362B; }
  .badge { position:absolute; top:-9px; left:50%; transform:translateX(-50%); white-space:nowrap;
           background:var(--bg); border:1px solid var(--line); border-radius:999px;
           padding:1px 9px; font-size:10.5px; font-weight:500; color:var(--ink-3); letter-spacing:.01em; }

  .rule { display:flex; align-items:center; gap:13px; margin:24px 0 22px; }
  .rule i { flex:1; height:1px; background:var(--line); }
  .rule span { font-size:10.5px; text-transform:uppercase; letter-spacing:.11em; color:var(--ink-3); }

  form { display:flex; flex-direction:column; gap:15px; }
  label { display:block; font-size:13px; font-weight:560; margin-bottom:8px; }
  input { width:100%; height:47px; background:var(--surface); border:1px solid var(--line);
          color:var(--ink); border-radius:999px; padding:0 18px; font-size:14.5px;
          font-family:inherit; outline:none; transition:border-color .15s, background .15s; }
  input::placeholder { color:var(--ink-3); }
  input:focus { border-color:#4C4134; background:var(--raised); }
  .go { height:47px; margin-top:3px; background:var(--orange); color:#fff; border:none;
        border-radius:999px; font-size:14.5px; font-weight:600; font-family:inherit; cursor:pointer;
        transition:background .15s, opacity .15s; }
  .go:hover { background:var(--orange-deep); }
  .go:disabled { opacity:.55; cursor:default; }

  .error { display:flex; gap:9px; background:var(--red-soft); border:1px solid var(--red-line);
           color:var(--red); border-radius:13px; padding:11px 13px; font-size:13px;
           line-height:1.45; margin-top:22px; }
  .fine { margin-top:26px; text-align:center; font-size:12.5px; color:var(--ink-3); line-height:1.6; }
  .fine a { color:var(--ink-2); text-decoration:underline; text-underline-offset:2px; }

  /* ---- the right half ---- */
  .proof { display:flex; flex-direction:column; justify-content:center; padding:44px 34px;
           background:none; border:none; }
  .proof h2 { font-size:31px; font-weight:640; letter-spacing:-.028em; line-height:1.16; max-width:15ch; }
  .proof p { margin-top:17px; color:var(--ink-2); font-size:15px; line-height:1.6; max-width:34ch; }
  .proof ul { list-style:none; padding:0; margin:30px 0 0; display:flex; flex-direction:column; gap:15px; }
  .proof li { display:flex; align-items:flex-start; gap:12px; font-size:14.5px; line-height:1.45;
              color:var(--ink); }
  .proof li svg { color:var(--ink-3); flex:none; margin-top:1px; }

  @media (max-width:880px) {
    .split { grid-template-columns:minmax(0,1fr); }
    .proof { display:none; }
    .panel { padding:38px 24px; }
    h1 { font-size:26px; }
  }
  @media (prefers-reduced-motion:reduce) { * { transition:none !important; } }
</style>
</head>
<body>
  <header>
    <a class="mark" href="/"><div class="box">₹</div><b>Paisa</b></a>
    <a class="top-link" href="/site/contact">Book a demo →</a>
  </header>

  <main>
    <div class="shell">
      <div class="split">
        <div class="panel">
          <div class="form-wrap">
            <h1>Sign in to Paisa</h1>
            <p class="sub">Your ledger, your close, and a CFO that shows its working.</p>

            ${google ? `<a class="provider" id="google" href="/auth/google?next=${encodeURIComponent(safeNext(next))}">
              <span class="badge" id="last-used" hidden>Last used</span>
              ${GOOGLE_MARK} Continue with Google
            </a>
            <div class="rule"><i></i><span>or</span><i></i></div>` : ""}

            <form id="f" method="POST" action="/api/login">
              <div>
                <label for="email">Email</label>
                <input id="email" name="email" type="email" placeholder="you@company.com"
                       autocomplete="username" required ${google ? "" : "autofocus"}>
              </div>
              <div>
                <label for="password">Password</label>
                <input id="password" name="password" type="password" placeholder="••••••••"
                       autocomplete="current-password" required>
              </div>
              <button class="go" type="submit">Continue</button>
            </form>

            ${error ? `<div class="error" role="alert"><span>${escapeHtml(error)}</span></div>` : ""}

            <p class="fine">Paisa is invite-only while we onboard the first teams.<br>
              Need access? <a href="/site/contact">Talk to us</a>.</p>
          </div>
        </div>

        <div class="proof">
          <h2>The books, and the reason for every number in them.</h2>
          <p>Sign in to the ledger your team already closes against.</p>
          <ul>
            ${PROOF.map((line) => `<li>${CHECK}<span>${line}</span></li>`).join("\n            ")}
          </ul>
        </div>
      </div>
    </div>
  </main>

  <script>
    /* Which way in they used last time. A hint on the button, nothing more —
       it is a convenience stored on this device, never an identity. */
    try {
      if (localStorage.getItem("paisa:last-auth") === "google") {
        const badge = document.getElementById("last-used");
        if (badge) badge.hidden = false;
      }
    } catch {}
    document.getElementById("google")?.addEventListener("click", () => {
      try { localStorage.setItem("paisa:last-auth", "google"); } catch {}
    });

    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      const body = JSON.stringify({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      });
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) {
        try { localStorage.setItem("paisa:last-auth", "email"); } catch {}
        return (location.href = ${inlineJson(safeNext(next))});
      }
      btn.disabled = false;
      const { error } = await res.json().catch(() => ({ error: "Sign in failed" }));
      const back = new URLSearchParams({ error: error || "Sign in failed", next: ${inlineJson(safeNext(next))} });
      location.href = "/login?" + back;
    });
  </script>
</body>
</html>`;
