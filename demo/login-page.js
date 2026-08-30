/**
 * The login page.
 *
 * Posts credentials to /api/login, which sets an HttpOnly session cookie
 * and redirects. No client-side session logic — the cookie is the only
 * state, so a page reload is always the source of truth.
 */

export const loginPage = (error) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Paisa</title>
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23F26B1D'/%3E%3Ctext x='16' y='23' font-family='-apple-system,sans-serif' font-size='20' font-weight='700' fill='white' text-anchor='middle'%3E%E2%82%B9%3C/text%3E%3C/svg%3E">
<style>
  :root {
    --bg:#16130F; --surface:#221D17; --line:#332B22; --ink:#F5F0E8; --ink-2:#A79C8D;
    --orange:#F26B1D; --orange-deep:#C24E08; --red:#E36B5E; --red-soft:#3A231F;
    --radius:14px;
  }
  * { box-sizing:border-box; margin:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
         background:var(--bg); color:var(--ink); min-height:100vh;
         display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:360px; }
  .mark { display:flex; align-items:center; gap:9px; margin-bottom:28px; }
  .mark .box { width:28px; height:28px; border-radius:8px; background:var(--orange);
               display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; }
  .mark span { font-weight:700; font-size:16px; letter-spacing:-.01em; }
  h1 { font-size:20px; font-weight:650; letter-spacing:-.015em; margin-bottom:6px; }
  p.sub { color:var(--ink-2); font-size:13.5px; margin-bottom:26px; }
  form { display:flex; flex-direction:column; gap:14px; }
  label { font-size:12.5px; font-weight:600; color:var(--ink-2); margin-bottom:6px; display:block; }
  input { width:100%; background:var(--surface); border:1px solid var(--line); color:var(--ink);
          border-radius:10px; padding:11px 13px; font-size:14.5px; font-family:inherit;
          outline:none; transition:border-color .15s; }
  input:focus { border-color:var(--orange); }
  button { margin-top:6px; background:var(--orange); color:#fff; border:none; border-radius:10px;
           padding:12px; font-size:14.5px; font-weight:650; font-family:inherit; cursor:pointer;
           transition:background .15s; }
  button:hover { background:var(--orange-deep); }
  button:disabled { opacity:.6; cursor:default; }
  .error { background:var(--red-soft); color:var(--red); border-radius:9px; padding:10px 12px;
           font-size:13px; margin-bottom:4px; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark"><div class="box">₹</div><span>Paisa</span></div>
    <h1>Sign in</h1>
    <p class="sub">The AI CFO for your business.</p>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form id="f" method="POST" action="/api/login">
      <div>
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required autofocus>
      </div>
      <div>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit">Sign in</button>
    </form>
  </div>
  <script>
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      const body = JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      });
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) return (location.href = "/");
      btn.disabled = false;
      const { error } = await res.json().catch(() => ({ error: "Sign in failed" }));
      location.href = "/login?error=" + encodeURIComponent(error || "Sign in failed");
    });
  </script>
</body>
</html>`;
