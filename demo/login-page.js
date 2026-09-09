/**
 * The sign-in and sign-up page.
 *
 * One screen, two modes, and a star.
 *
 * The scene behind it — a core, the belts of collectors turning around it,
 * and the light they throw — is CSS and one inline SVG. No canvas, no 3D
 * library, nothing to download before the form is usable, and the dashes
 * travel along each orbit rather than the ring spinning as a shape, which is
 * what reads as something moving around a star instead of a picture rotating.
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
 *
 * The backslash is the case that looks safe and is not: "/\evil.test" starts
 * with a single slash and passes a naive check, but browsers normalise the
 * backslash to a slash before they resolve it, so what actually gets fetched
 * is "//evil.test" — the very host this function exists to refuse.
 */
export const safeNext = (next, fallback = "/app") => {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  if (next[1] === "/" || next[1] === "\\") return fallback;
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

/** What the editorial rail promises. Each line is something the app does. */
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

/**
 * Which half of the page the visitor asked for.
 *
 * Anything that is not "signup" is a sign-in, so a mangled or hostile ?mode=
 * lands on the safer of the two rather than on an account-creation form.
 */
export const loginMode = (mode) => (mode === "signup" ? "signup" : "signin");

export const loginPage = (
  error,
  next,
  { google = false, signup = false, mode = "signin" } = {}
) => {
  const view = loginMode(mode);
  const dest = safeNext(next);
  const googleHref = `/auth/google?next=${encodeURIComponent(dest)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view === "signup" ? "Create your account" : "Sign in"} — Paisa</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/logo.png">
<link rel="icon" type="image/png" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root {
    --bg:#0E0C09; --wash:#16130F; --surface:#1E1913; --raised:#272018;
    --line:#332B22; --line-soft:#221C15;
    --ink:#F5F0E8; --ink-2:#A79C8D; --ink-3:#7A7063;
    --orange:#F26B1D; --orange-deep:#C24E08; --gold:#E8A54B;
    --red:#E36B5E; --red-soft:#3A231F; --red-line:#5A322A;
  }
  * { box-sizing:border-box; margin:0; }
  html { -webkit-text-size-adjust:100%; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
         background:var(--bg); color:var(--ink); min-height:100vh; overflow-x:hidden;
         display:flex; flex-direction:column; position:relative; }

  /* ---- the scene ------------------------------------------------------
     A star, the belts of collectors around it, and the light they throw.
     All of it is CSS and one inline SVG: no canvas, no 3D library, nothing
     to download before the sign-in form is usable.                        */
  .scene { position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:0; }

  /* The same hairline field the console sits on, kept underneath the star. */
  .scene .grid {
    position:absolute; inset:0; opacity:.5;
    background-image:linear-gradient(var(--line-soft) 1px, transparent 1px),
                     linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
    background-size:64px 64px;
    -webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 40%, #000 30%, transparent 100%);
            mask-image:radial-gradient(ellipse 80% 60% at 50% 40%, #000 30%, transparent 100%);
  }

  /* One anchor at the star's centre; every layer below centres on it, which is
     the only way the core and the belts share an origin instead of drifting. */
  .star { position:absolute; left:50%; top:46%; width:0; height:0; }
  @media (min-width:1000px) { .star { left:54%; top:48%; } }

  .corona, .core, .core-hot, .rings {
    position:absolute; left:0; top:0; transform:translate(-50%,-50%);
  }
  .corona {
    width:1180px; height:1180px; border-radius:50%; filter:blur(70px);
    background:radial-gradient(circle, rgba(248,150,60,.42) 0%, rgba(212,96,16,.20) 36%,
                               rgba(140,64,18,.07) 60%, transparent 74%);
    animation:breathe 9s ease-in-out infinite;
  }
  .core {
    width:300px; height:300px; border-radius:50%; filter:blur(22px);
    background:radial-gradient(circle at 50% 45%, #fff 0%, #FFEBCB 22%, #F9BE5C 44%,
                               #D9741A 66%, rgba(180,83,9,.35) 82%, transparent 92%);
    animation:pulse 6.5s ease-in-out infinite;
  }
  .core-hot {
    width:150px; height:150px; border-radius:50%; filter:blur(14px);
    background:radial-gradient(circle, #fff 0%, #FFF4DF 55%, transparent 78%);
    animation:pulse 6.5s ease-in-out infinite;
  }
  .rings { width:960px; height:960px; animation:drift 150s linear infinite; }

  /* The dashes travel along the orbit rather than the ring spinning as a shape —
     that is what reads as collectors moving around a star. */
  .belt { fill:none; stroke:var(--gold); stroke-linecap:round;
          animation:travel var(--dur,26s) linear infinite; }

  @keyframes travel  { to { stroke-dashoffset:-2000; } }
  @keyframes drift   { to { transform:translate(-50%,-50%) rotate(360deg); } }
  @keyframes pulse   { 0%,100% { opacity:.94; } 50% { opacity:1; } }
  @keyframes breathe { 0%,100% { opacity:.6; } 50% { opacity:.85; } }
  @keyframes spark   { 0%   { opacity:0; transform:translate3d(0,0,0) scale(.6); }
                       15%  { opacity:.9; }
                       100% { opacity:0; transform:translate3d(var(--sx,40px),var(--sy,-90px),0) scale(1); } }
  @keyframes rise    { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
  @keyframes blink   { 0%,100% { opacity:1; } 50% { opacity:.35; } }

  .spark { position:absolute; width:3px; height:3px; border-radius:50%;
           background:#FBD9A6; animation:spark var(--sd,9s) ease-out infinite; }

  /* Copy has to stay readable across a moving light source, so the rails get a
     scrim rather than the star getting dimmed. */
  .scrim-side { position:absolute; inset:0 auto 0 0; width:100%;
                background:linear-gradient(90deg, var(--bg) 0%, rgba(14,12,9,.72) 26%, transparent 52%); }
  .scrim-bottom { position:absolute; inset:auto 0 0 0; height:180px;
                  background:linear-gradient(to top, var(--bg), transparent); }
  @media (max-width:999px) {
    .scrim-side { background:rgba(14,12,9,.78); }
  }

  /* ---- chrome ---------------------------------------------------------- */
  header, main, footer { position:relative; z-index:1; }
  header { display:flex; align-items:center; justify-content:space-between; gap:16px;
           padding:20px 22px; animation:rise .8s cubic-bezier(.16,1,.3,1) both; }
  @media (min-width:700px) { header { padding:24px 34px; } }

  .mark { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--ink); }
  .mark .box { width:27px; height:27px; border-radius:22%; display:block; }
  .mark b { font-weight:640; font-size:13px; letter-spacing:.30em; text-transform:uppercase; }
  .mark .div { width:1px; height:13px; background:#3A3128; }
  .mark .kind { font-size:10px; letter-spacing:.26em; text-transform:uppercase; color:var(--ink-3); }
  @media (max-width:560px) { .mark .div, .mark .kind { display:none; } }

  .head-right { display:flex; align-items:center; gap:16px; }
  .status { display:inline-flex; align-items:center; gap:8px; font-size:10px; letter-spacing:.22em;
            text-transform:uppercase; color:var(--ink-3); white-space:nowrap; }
  .status i { width:6px; height:6px; border-radius:50%; background:#5FBF8B;
              animation:blink 2.4s ease-in-out infinite; }
  @media (max-width:700px) { .status { display:none; } }
  .top-link { display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 17px;
              border:1px solid var(--line); border-radius:999px; background:rgba(30,25,19,.7);
              backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
              color:var(--ink); text-decoration:none; font-size:14px; font-weight:520;
              white-space:nowrap; transition:border-color .15s, background .15s; }
  .top-link:hover { background:var(--raised); border-color:#4A4034; }

  main { flex:1; display:grid; align-items:center; gap:44px;
         padding:26px 22px 44px; max-width:1280px; width:100%; margin:0 auto; }
  @media (min-width:1000px) {
    main { grid-template-columns:minmax(0,1fr) 396px; gap:64px; padding:40px 34px 56px; }
  }

  /* ---- the editorial rail ---------------------------------------------- */
  .rail { max-width:520px; animation:rise .9s cubic-bezier(.16,1,.3,1) .08s both; }
  .eyebrow { font-size:10px; letter-spacing:.30em; text-transform:uppercase; color:#C98B45; }
  .rail h1 { margin-top:20px; font-size:31px; font-weight:600; letter-spacing:-.03em; line-height:1.08; }
  @media (min-width:700px)  { .rail h1 { font-size:38px; } }
  @media (min-width:1000px) { .rail h1 { font-size:44px; } }
  .rail h1 .dim { color:var(--ink-3); display:block; }
  .rail .lede { margin-top:20px; color:var(--ink-2); font-size:15px; line-height:1.6; max-width:38ch; }
  .hair { margin-top:28px; width:96px; height:1px;
          background:linear-gradient(90deg, rgba(232,165,75,.55), transparent); }
  .rail ul { list-style:none; padding:0; margin:22px 0 0; display:flex; flex-direction:column; gap:13px; }
  .rail li { display:flex; align-items:flex-start; gap:11px; font-size:14px; line-height:1.45;
             color:var(--ink-2); }
  .rail li svg { color:#8A6B3E; flex:none; margin-top:1px; }
  @media (max-width:999px) { .rail ul { display:none; } }

  /* ---- the panel ------------------------------------------------------- */
  .card { width:100%; max-width:396px; justify-self:start; border:1px solid rgba(245,240,232,.10);
          border-radius:22px; padding:28px 26px 26px;
          background:rgba(22,19,15,.72); backdrop-filter:blur(22px); -webkit-backdrop-filter:blur(22px);
          box-shadow:0 30px 80px -40px rgba(0,0,0,.9);
          animation:rise .9s cubic-bezier(.16,1,.3,1) .16s both; }
  @media (min-width:1000px) { .card { justify-self:end; } }

  .card h2 { font-size:19px; font-weight:620; letter-spacing:-.02em; }
  .card .sub { color:var(--ink-2); font-size:13.5px; margin-top:7px; line-height:1.5; }

  .provider { position:relative; display:flex; align-items:center; justify-content:center; gap:10px;
              width:100%; height:47px; margin-top:22px; border-radius:999px;
              border:1px solid rgba(245,240,232,.14); background:rgba(245,240,232,.06); color:var(--ink);
              font-size:14.5px; font-weight:560; font-family:inherit; cursor:pointer;
              text-decoration:none; transition:background .15s, border-color .15s; }
  .provider:hover { background:rgba(245,240,232,.11); border-color:rgba(245,240,232,.24); }
  .badge { position:absolute; top:-9px; left:50%; transform:translateX(-50%); white-space:nowrap;
           background:#191410; border:1px solid var(--line); border-radius:999px;
           padding:1px 9px; font-size:10.5px; font-weight:500; color:var(--ink-3); }

  .rule { display:flex; align-items:center; gap:13px; margin:20px 0 18px; }
  .rule i { flex:1; height:1px; background:rgba(245,240,232,.10); }
  .rule span { font-size:10px; text-transform:uppercase; letter-spacing:.20em; color:var(--ink-3); }

  form { display:flex; flex-direction:column; gap:14px; margin-top:20px; }
  label { display:block; font-size:12.5px; font-weight:560; margin-bottom:7px; color:var(--ink-2); }
  input { width:100%; height:46px; background:rgba(10,8,6,.55); border:1px solid rgba(245,240,232,.12);
          color:var(--ink); border-radius:999px; padding:0 17px; font-size:14.5px;
          font-family:inherit; outline:none; transition:border-color .15s, background .15s; }
  input::placeholder { color:var(--ink-3); }
  input:focus { border-color:rgba(232,165,75,.55); background:rgba(10,8,6,.8); }
  .go { height:47px; margin-top:3px; background:var(--orange); color:#fff; border:none;
        border-radius:999px; font-size:14.5px; font-weight:600; font-family:inherit; cursor:pointer;
        transition:background .15s, opacity .15s; }
  .go:hover { background:var(--orange-deep); }
  .go:disabled { opacity:.55; cursor:default; }

  .error { display:flex; gap:9px; background:var(--red-soft); border:1px solid var(--red-line);
           color:var(--red); border-radius:13px; padding:11px 13px; font-size:13px;
           line-height:1.45; margin-top:18px; }

  /* The other door, always offered, never hidden in a menu. */
  .swap { margin-top:20px; font-size:13.5px; color:var(--ink-2); }
  .swap a { color:var(--gold); font-weight:560; text-decoration:none; }
  .swap a:hover { text-decoration:underline; text-underline-offset:2px; }

  .note { margin-top:20px; padding:14px 15px; background:rgba(245,240,232,.04);
          border:1px solid rgba(245,240,232,.10); border-radius:14px;
          font-size:13.5px; color:var(--ink-2); line-height:1.55; }
  .note a { color:var(--gold); text-decoration:none; font-weight:540; }
  .note a:hover { text-decoration:underline; text-underline-offset:2px; }

  .fine { margin-top:20px; font-size:12.5px; color:var(--ink-3); line-height:1.6; }
  .fine a { color:var(--ink-2); text-decoration:underline; text-underline-offset:2px; }

  footer { display:flex; justify-content:space-between; align-items:center; gap:14px;
           padding:0 22px 26px; font-size:10px; letter-spacing:.22em; text-transform:uppercase;
           color:#5F5648; animation:rise .9s cubic-bezier(.16,1,.3,1) .24s both; }
  @media (min-width:700px) { footer { padding:0 34px 30px; } }

  /* The motion is the point of this screen, so it is slowed rather than
     removed for anyone who has asked the system for less of it. */
  @media (prefers-reduced-motion:reduce) {
    * { transition:none !important; }
    .belt   { animation-duration:calc(var(--dur,26s) * 8); }
    .rings  { animation-duration:900s; }
    .core, .core-hot, .corona { animation-duration:40s; }
    .spark  { animation:none; opacity:.3; }
    header, .rail, .card, footer { animation-duration:.01s; }
  }
</style>
</head>
<body>
  <div class="scene" aria-hidden="true">
    <div class="grid"></div>
    <div class="star">
      <div class="corona"></div>
      <svg class="rings" viewBox="0 0 960 960">
        <ellipse class="belt" cx="480" cy="480" rx="404" ry="128" transform="rotate(-18 480 480)"
                 stroke-width="1.7" stroke-dasharray="20 13" opacity=".62" style="--dur:24s"/>
        <ellipse class="belt" cx="480" cy="480" rx="330" ry="202" transform="rotate(26 480 480)"
                 stroke-width="1.4" stroke-dasharray="11 17" opacity=".46" style="--dur:34s"/>
        <ellipse class="belt" cx="480" cy="480" rx="452" ry="70"  transform="rotate(8 480 480)"
                 stroke-width="1.2" stroke-dasharray="28 22" opacity=".34" style="--dur:46s"/>
      </svg>
      <div class="core"></div>
      <div class="core-hot"></div>
    </div>
    <span class="spark" style="left:18%; top:62%; --sx:60px;  --sy:-130px; --sd:9s;  animation-delay:0s"></span>
    <span class="spark" style="left:72%; top:70%; --sx:-40px; --sy:-150px; --sd:11s; animation-delay:1.6s"></span>
    <span class="spark" style="left:44%; top:78%; --sx:30px;  --sy:-170px; --sd:13s; animation-delay:3.1s"></span>
    <span class="spark" style="left:62%; top:40%; --sx:50px;  --sy:-100px; --sd:10s; animation-delay:4.4s"></span>
    <span class="spark" style="left:30%; top:36%; --sx:-30px; --sy:-120px; --sd:12s; animation-delay:2.2s"></span>
    <div class="scrim-side"></div>
    <div class="scrim-bottom"></div>
  </div>

  <header>
    <a class="mark" href="/">
      <img class="box" src="/logo.png" alt="" width="27" height="27"><b>Paisa</b>
      <span class="div"></span><span class="kind">AI CFO</span>
    </a>
    <div class="head-right">
      <span class="status"><i></i>Ledger live</span>
      <a class="top-link" href="/site/contact">Book a demo →</a>
    </div>
  </header>

  <main>
    <div class="rail">
      <p class="eyebrow">An AI-native close</p>
      <h1>The books, and the reason
        <span class="dim">for every number in them.</span></h1>
      <p class="lede">${
        view === "signup"
          ? "Start with the demo books, or bring your own — the ledger closes continuously either way."
          : "Sign in to the ledger your team already closes against."
      }</p>
      <div class="hair"></div>
      <ul>
        ${PROOF.map((line) => `<li>${CHECK}<span>${line}</span></li>`).join("\n        ")}
      </ul>
    </div>

    <div class="card">
      <h2>${view === "signup" ? "Create your account" : "Welcome back"}</h2>
      <p class="sub">Your ledger, your close, and a CFO that shows its working.</p>

      ${
        google
          ? `<a class="provider" id="google" href="${googleHref}">
               <span class="badge" id="last-used" hidden>Last used</span>
               ${GOOGLE_MARK} Continue with Google
             </a>
             <div class="rule"><i></i><span>or</span><i></i></div>`
          : ""
      }

      ${
        view === "signup" && !signup
          ? `<div class="note">Paisa is invite-only while we onboard the first teams, so accounts
               are created by an owner rather than at the door.
               ${google ? "If you have already been invited, Google sign-in above will let you in." : ""}
               <a href="/site/contact">Talk to us</a> and we will set your workspace up.</div>`
          : `<form id="f" method="POST" action="${view === "signup" ? "/api/register" : "/api/login"}">
              ${
                view === "signup"
                  ? `<div>
                      <label for="name">Name</label>
                      <input id="name" name="name" type="text" placeholder="Your name"
                             autocomplete="name">
                    </div>`
                  : ""
              }
              <div>
                <label for="email">Email</label>
                <input id="email" name="email" type="email" placeholder="you@company.com"
                       autocomplete="username" required>
              </div>
              <div>
                <label for="password">Password</label>
                <input id="password" name="password" type="password" placeholder="••••••••"
                       autocomplete="${view === "signup" ? "new-password" : "current-password"}" required>
              </div>
              <button class="go" type="submit">${view === "signup" ? "Create account" : "Continue"}</button>
            </form>`
      }

      ${error ? `<div class="error" role="alert"><span>${escapeHtml(error)}</span></div>` : ""}

      <p class="swap">${
        view === "signup"
          ? `Already have an account? <a href="/login?next=${encodeURIComponent(dest)}">Sign in</a>`
          : `Don&#39;t have an account? <a href="/signup?next=${encodeURIComponent(dest)}">Sign up</a>`
      }</p>

      <p class="fine">Curious first? <a href="/try">Explore the demo books</a> — no account needed.</p>
    </div>
  </main>

  <footer>
    <span>Double-entry · ASC 606 · GST</span>
    <span>Secured by Google</span>
  </footer>

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

    const MODE = ${inlineJson(view)};
    const NEXT = ${inlineJson(dest)};
    const form = document.getElementById("f");

    /* Sign-up posts to /api/register, which creates the account but does not
       hand back a session — so a new account is signed in through the very
       same /api/login the returning half uses. One path issues cookies. */
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true;
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      const fail = (message) => {
        btn.disabled = false;
        const back = new URLSearchParams({ error: message || "Something went wrong", next: NEXT });
        location.href = (MODE === "signup" ? "/signup?" : "/login?") + back;
      };

      const post = (url, body) =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      if (MODE === "signup") {
        const name = document.getElementById("name")?.value || "";
        const made = await post("/api/register", { email, password, name });
        if (!made.ok) {
          const { error } = await made.json().catch(() => ({}));
          return fail(error || "Could not create that account");
        }
      }

      const res = await post("/api/login", { email, password });
      if (res.ok) {
        try { localStorage.setItem("paisa:last-auth", "email"); } catch {}
        return (location.href = NEXT);
      }
      const { error } = await res.json().catch(() => ({ error: "Sign in failed" }));
      fail(error || "Sign in failed");
    });
  </script>
</body>
</html>`;
};
