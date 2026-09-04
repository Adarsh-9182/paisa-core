/**
 * The Paisa application console.
 *
 * One shell, many panels: a persistent sidebar picks a module, each module
 * fetches its own endpoint and renders into the same content area. Nothing
 * here holds its own copy of the books — every number on screen comes from
 * the API that owns it, so a panel cannot drift from the ledger by caching
 * a figure it rendered earlier.
 *
 * Self-contained HTML, matching the convention erp-page.js set: the design
 * tokens are declared here rather than imported, so this page and the other
 * pages cannot break each other.
 *
 * The client script deliberately avoids template literals so this file can
 * stay one template literal without escaping every interpolation.
 */

export const consolePage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paisa — Console</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    --bg:#F7F6F3; --surface:#FFFFFF; --line:#E6E2DA; --line-2:#F0EDE7;
    --ink:#17140F; --ink-2:#5F594F; --ink-3:#938C81;
    --rail:#1B1814; --rail-2:#2A2620; --rail-ink:#CFC8BC; --rail-ink-2:#8B8378;
    --accent:#F26B1D; --accent-soft:#FDEEE3; --accent-deep:#B84907;
    --green:#0B7A56; --green-soft:#E4F3ED;
    --amber:#9A5B08; --amber-soft:#FBF0DF;
    --red:#B3372A; --red-soft:#FAE9E7;
    --radius:10px;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  }
  * { box-sizing:border-box; margin:0; }
  html,body { height:100%; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--ink); font-size:13.5px; -webkit-font-smoothing:antialiased; }
  a { color:inherit; text-decoration:none; }

  /* Layout ------------------------------------------------------- */
  .app { display:grid; grid-template-columns:216px 1fr; min-height:100vh; }
  .rail { background:var(--rail); color:var(--rail-ink); display:flex; flex-direction:column;
          position:sticky; top:0; height:100vh; }
  .rail-top { padding:16px 14px 12px; }
  .brand { display:flex; align-items:center; gap:9px; font-weight:680; font-size:15px; color:#fff; letter-spacing:-.01em; }
  .brand-mark { width:24px; height:24px; border-radius:7px; background:var(--accent); display:grid; place-items:center;
                font-size:13px; color:#fff; font-weight:700; }
  .org { margin-top:14px; background:var(--rail-2); border-radius:8px; padding:8px 10px; }
  .org-name { font-size:12.5px; color:#fff; font-weight:600; }
  .org-meta { font-size:11px; color:var(--rail-ink-2); margin-top:2px; }
  nav { padding:6px 8px; flex:1; overflow-y:auto; }
  .nav-label { font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--rail-ink-2);
               padding:14px 8px 5px; font-weight:600; }
  .nav-item { display:flex; align-items:center; gap:9px; padding:7px 9px; border-radius:7px;
              color:var(--rail-ink); cursor:pointer; font-size:13px; border:0; background:none; width:100%;
              text-align:left; font-family:inherit; }
  .nav-item:hover { background:var(--rail-2); color:#fff; }
  .nav-item[aria-current="page"] { background:var(--rail-2); color:#fff; font-weight:600; }
  .nav-item .ic { width:15px; text-align:center; opacity:.85; font-size:12px; }
  .rail-foot { padding:10px 14px 14px; border-top:1px solid var(--rail-2); font-size:11.5px; color:var(--rail-ink-2); }
  .rail-foot a { color:var(--rail-ink); }

  /* Topbar ------------------------------------------------------- */
  .main { display:flex; flex-direction:column; min-width:0; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px;
            padding:0 24px; height:52px; border-bottom:1px solid var(--line); background:var(--surface);
            position:sticky; top:0; z-index:5; }
  .crumb { font-size:13px; color:var(--ink-2); }
  .crumb b { color:var(--ink); font-weight:620; }
  .topbar-right { display:flex; align-items:center; gap:10px; }
  .period { font-family:var(--mono); font-size:12px; background:var(--bg); border:1px solid var(--line);
            padding:4px 9px; border-radius:6px; color:var(--ink-2); }
  .content { padding:22px 24px 56px; max-width:1240px; width:100%; }

  /* Primitives --------------------------------------------------- */
  h1 { font-size:19px; font-weight:660; letter-spacing:-.015em; }
  .page-sub { color:var(--ink-2); margin-top:3px; font-size:13px; }
  .page-head { margin-bottom:18px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); margin-bottom:14px; }
  .card-head { display:flex; align-items:center; justify-content:space-between; gap:12px;
               padding:13px 16px; border-bottom:1px solid var(--line-2); flex-wrap:wrap; }
  .card-head h2 { font-size:13.5px; font-weight:640; letter-spacing:-.005em; }
  .card-head .hint { font-size:11.5px; color:var(--ink-3); }
  .card-body { padding:14px 16px; }
  .card-body.flush { padding:0; }

  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(178px,1fr)); gap:12px; margin-bottom:14px; }
  .tile { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:13px 15px; }
  .tile .k { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3); font-weight:600; }
  .tile .v { font-size:21px; font-weight:640; margin-top:6px; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .tile .d { font-size:11.5px; color:var(--ink-2); margin-top:4px; }

  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.055em; color:var(--ink-3);
       font-weight:600; padding:9px 16px; border-bottom:1px solid var(--line-2); background:#FCFBF9; }
  td { padding:10px 16px; border-bottom:1px solid var(--line-2); vertical-align:top; }
  tr:last-child td { border-bottom:0; }
  tbody tr.click { cursor:pointer; }
  tbody tr.click:hover { background:#FCFAF7; }
  .num { text-align:right; font-variant-numeric:tabular-nums; font-family:var(--mono); font-size:12.5px; white-space:nowrap; }
  .muted { color:var(--ink-3); }
  .strong { font-weight:620; }

  .pill { display:inline-block; font-size:10.5px; font-weight:650; padding:2.5px 8px; border-radius:20px; letter-spacing:.02em; }
  .ok { background:var(--green-soft); color:var(--green); }
  .warn { background:var(--amber-soft); color:var(--amber); }
  .bad { background:var(--red-soft); color:var(--red); }
  .neutral { background:#F1EEE8; color:var(--ink-2); }
  .accent { background:var(--accent-soft); color:var(--accent-deep); }

  .btn { font:inherit; font-size:12.5px; font-weight:560; padding:5.5px 12px; border-radius:7px;
         border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; }
  .btn:hover { border-color:var(--ink-3); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:hover { background:var(--accent-deep); border-color:var(--accent-deep); }
  .btn:disabled { opacity:.5; cursor:default; }

  .empty { padding:30px 16px; text-align:center; color:var(--ink-3); font-size:13px; }
  .skel { padding:30px 16px; text-align:center; color:var(--ink-3); font-size:12.5px; }
  .err { margin:0; padding:13px 16px; background:var(--red-soft); color:var(--red); border-radius:var(--radius);
         font-size:12.5px; border:1px solid #F2D6D2; }

  .bars { display:flex; align-items:flex-end; gap:5px; height:104px; padding-top:6px; }
  .bar { flex:1; background:var(--accent-soft); border-radius:4px 4px 0 0; position:relative; min-height:3px; }
  .bar span { position:absolute; bottom:-19px; left:0; right:0; text-align:center; font-size:9.5px; color:var(--ink-3); }
  .bars-wrap { padding-bottom:22px; }

  .kv { display:grid; grid-template-columns:1fr auto; gap:7px 16px; font-size:12.5px; }
  .kv dt { color:var(--ink-2); }
  .kv dd { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }

  .split { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  @media (max-width:1000px){ .split{grid-template-columns:1fr;} }
  @media (max-width:760px){
    .app { grid-template-columns:1fr; }
    .rail { position:static; height:auto; }
    nav { display:flex; flex-wrap:wrap; gap:4px; }
    .nav-label { width:100%; }
    .nav-item { width:auto; }
  }

  /* Drawer ------------------------------------------------------- */
  .scrim { position:fixed; inset:0; background:rgba(23,20,15,.34); z-index:20; }
  .drawer { position:fixed; top:0; right:0; bottom:0; width:min(520px,100%); background:var(--surface);
            border-left:1px solid var(--line); z-index:21; display:flex; flex-direction:column; }
  .drawer-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px;
                 padding:16px 18px; border-bottom:1px solid var(--line-2); }
  .drawer-head h3 { font-size:15px; font-weight:640; }
  .drawer-body { padding:16px 18px; overflow-y:auto; }
  .x { border:0; background:none; font-size:19px; line-height:1; cursor:pointer; color:var(--ink-3); padding:0 2px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<div class="app">
  <aside class="rail">
    <div class="rail-top">
      <div class="brand"><span class="brand-mark">P</span> Paisa</div>
      <div class="org">
        <div class="org-name" id="orgName">Loading…</div>
        <div class="org-meta" id="orgMeta">&nbsp;</div>
      </div>
    </div>
    <nav id="nav"></nav>
    <div class="rail-foot">
      <a href="/">AI CFO</a> · <a href="/erp">Legacy ERP</a>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div class="crumb">Console <span class="muted">/</span> <b id="crumb">Overview</b></div>
      <div class="topbar-right">
        <span class="period" id="periodChip">—</span>
        <button class="btn" id="refresh">Refresh</button>
      </div>
    </div>
    <div class="content" id="content"><div class="skel">Loading…</div></div>
  </div>
</div>

<div id="scrim" class="scrim" hidden></div>
<aside id="drawer" class="drawer" hidden aria-label="Detail">
  <div class="drawer-head">
    <h3 id="drawerTitle">Detail</h3>
    <button class="x" id="drawerClose" aria-label="Close">&times;</button>
  </div>
  <div class="drawer-body" id="drawerBody"></div>
</aside>

<script>
(function () {
  "use strict";

  /* ---------------------------------------------------------------
   * Every panel reads from the endpoint that owns its numbers. No
   * panel keeps a copy, so nothing on screen can drift from the books.
   * ------------------------------------------------------------- */
  var MODULES = [
    { id: "overview",   label: "Overview",    icon: "◉", group: "Finance" },
    { id: "close",      label: "Close",       icon: "✓", group: "Finance" },
    { id: "revenue",    label: "Revenue",     icon: "◴", group: "Finance" },
    { id: "contracts",  label: "Contracts",   icon: "≡", group: "Finance" },
    { id: "metrics",    label: "SaaS metrics",icon: "↗", group: "Finance" },
    { id: "subledgers", label: "AR / AP",     icon: "◫", group: "Operations" },
    { id: "agents",     label: "AI proposals",icon: "✦", group: "Operations" },
    { id: "connectors", label: "Connectors",  icon: "⇄", group: "Operations" }
  ];

  var el = function (id) { return document.getElementById(id); };
  var content = el("content");
  var current = "overview";

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var get = function (url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (r.status === 401 || r.status === 403) { location.href = "/login?next=/console"; throw new Error("auth"); }
      if (!r.ok) throw new Error("Request failed (" + r.status + ")");
      return r.json();
    });
  };

  /* Rendering helpers -------------------------------------------- */
  var card = function (title, hint, body, flush) {
    return '<section class="card"><div class="card-head"><h2>' + esc(title) + "</h2>" +
      (hint ? '<span class="hint">' + esc(hint) + "</span>" : "") + "</div>" +
      '<div class="card-body' + (flush ? " flush" : "") + '">' + body + "</div></section>";
  };
  var tile = function (k, v, d) {
    return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + "</div>" +
      (d ? '<div class="d">' + esc(d) + "</div>" : "") + "</div>";
  };
  var pill = function (text, kind) { return '<span class="pill ' + kind + '">' + esc(text) + "</span>"; };
  var empty = function (msg) { return '<div class="empty">' + esc(msg) + "</div>"; };
  var table = function (heads, rows) {
    if (!rows.length) return empty("Nothing here yet.");
    var th = heads.map(function (h) {
      return "<th" + (h.num ? ' class="num"' : "") + ">" + esc(h.label) + "</th>";
    }).join("");
    return "<table><thead><tr>" + th + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>";
  };
  var tiesPill = function (ties) { return ties ? pill("Ties to ledger", "ok") : pill("Does not tie", "bad"); };

  /* Drawer -------------------------------------------------------- */
  var openDrawer = function (title, html) {
    el("drawerTitle").textContent = title;
    el("drawerBody").innerHTML = html;
    el("drawer").hidden = false;
    el("scrim").hidden = false;
  };
  var closeDrawer = function () { el("drawer").hidden = true; el("scrim").hidden = true; };
  el("drawerClose").addEventListener("click", closeDrawer);
  el("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  /* Panels -------------------------------------------------------- */
  var PANELS = {};

  PANELS.overview = function () {
    return Promise.all([
      get("/api/erp/metrics"), get("/api/erp/close"),
      get("/api/erp/revenue"), get("/api/erp/agents")
    ]).then(function (r) {
      var m = r[0], c = r[1], rev = r[2], ag = r[3];
      var closeState = c.locked ? pill("Locked", "neutral")
        : c.readyToClose ? pill("Ready to close", "ok")
        : c.hasRun ? pill(c.blocked + " blocked", "warn") : pill("Not run", "neutral");

      var tiles = '<div class="tiles">' +
        tile("ARR", m.arr, m.customers + " customers") +
        tile("Closing MRR", m.closingMrr, "ARPA " + m.arpa) +
        tile("NRR", m.nrr, "GRR " + m.grr) +
        tile("RPO", rev.rpo, "Backlog " + m.backlog) + "</div>";

      var closeRows = (c.tasks || []).slice(0, 6).map(function (t) {
        var kind = t.status === "PASSED" ? "ok" : t.status === "BLOCKED" ? "bad" : "neutral";
        return '<tr><td>' + esc(t.name) + '<div class="muted" style="font-size:11.5px;margin-top:2px">' +
          esc(t.category) + (t.automated ? " · automated" : "") + "</div></td>" +
          '<td class="num">' + pill(t.status, kind) + "</td></tr>";
      });

      var agRows = (ag || []).slice(0, 6).map(function (p) {
        var kind = p.severity === "HIGH" ? "bad" : p.severity === "MEDIUM" ? "warn" : "neutral";
        return '<tr class="click" data-prop="' + esc(p.id) + '"><td>' + esc(p.title) +
          '<div class="muted" style="font-size:11.5px;margin-top:2px">' + esc(p.kind) + "</div></td>" +
          '<td class="num">' + (p.amount ? esc(p.amount) : "") + "</td>" +
          '<td class="num">' + pill(p.severity, kind) + "</td></tr>";
      });

      return tiles +
        '<div class="split">' +
        card("Close — " + c.period, c.passed + " passed · " + c.blocked + " blocked",
          '<div style="margin-bottom:10px">' + closeState + "</div>" +
          table([{ label: "Task" }, { label: "Status", num: true }], closeRows), false) +
        card("Deferred revenue rollforward", rev.rollforward.ties ? "Ties to ledger" : "Does not tie",
          '<dl class="kv">' +
          "<dt>Opening</dt><dd>" + esc(rev.rollforward.opening) + "</dd>" +
          "<dt>Billed</dt><dd>" + esc(rev.rollforward.billed) + "</dd>" +
          "<dt>Recognised</dt><dd>" + esc(rev.rollforward.recognized) + "</dd>" +
          "<dt><b>Closing</b></dt><dd><b>" + esc(rev.rollforward.closing) + "</b></dd>" +
          "</dl><div style='margin-top:12px'>" + tiesPill(rev.rollforward.ties) + "</div>") +
        "</div>" +
        card("AI proposals", (ag || []).length + " open",
          table([{ label: "Proposal" }, { label: "Amount", num: true }, { label: "Severity", num: true }], agRows), true);
    });
  };

  PANELS.close = function () {
    return get("/api/erp/close").then(function (c) {
      var rows = (c.tasks || []).map(function (t) {
        var kind = t.status === "PASSED" ? "ok" : t.status === "BLOCKED" ? "bad" : "neutral";
        var blockers = (t.blockers || []).length
          ? '<div class="muted" style="font-size:11.5px;margin-top:3px">' + esc(t.blockers.join(" · ")) + "</div>" : "";
        return "<tr><td>" + esc(t.name) + blockers + "</td>" +
          "<td>" + esc(t.category) + "</td>" +
          "<td>" + (t.automated ? pill("Automated", "accent") : pill("Manual", "neutral")) + "</td>" +
          '<td class="num">' + pill(t.status, kind) + "</td></tr>";
      });
      var periods = (c.periods || []).map(function (p) {
        return "<tr><td>" + esc(p.period) + "</td><td>" + esc(p.status) + "</td>" +
          '<td class="num muted">' + esc(p.closedBy || "") + "</td></tr>";
      });
      return '<div class="tiles">' +
        tile("Period", c.period, c.periodStatus) +
        tile("Passed", String(c.passed), "checks") +
        tile("Blocked", String(c.blocked), "checks") +
        tile("State", c.locked ? "Locked" : c.readyToClose ? "Ready" : "In progress", c.hasRun ? "last run recorded" : "not run yet") +
        "</div>" +
        card("Close checklist", c.period,
          table([{ label: "Task" }, { label: "Category" }, { label: "Owner" }, { label: "Status", num: true }], rows), true) +
        card("Period history", "", table([{ label: "Period" }, { label: "Status" }, { label: "Closed by", num: true }], periods), true);
    });
  };

  PANELS.revenue = function () {
    return get("/api/erp/revenue").then(function (r) {
      var w = r.waterfall || [];
      var max = w.reduce(function (a, c) { return Math.max(a, Math.abs(c.raw || 0)); }, 0) || 1;
      var bars = w.map(function (c) {
        var h = Math.max(3, Math.round((Math.abs(c.raw || 0) / max) * 100));
        return '<div class="bar" style="height:' + h + '%" title="' + esc(c.period + " · " + c.amount) +
          '"><span>' + esc(String(c.period).slice(2)) + "</span></div>";
      }).join("");

      return '<div class="tiles">' +
        tile("Recognised YTD", r.recognizedYtd) +
        tile("Deferred", r.deferred) +
        tile("Unbilled", r.unbilled) +
        tile("RPO", r.rpo, "remaining obligations") +
        "</div>" +
        card("Revenue waterfall", "next " + w.length + " periods",
          '<div class="bars-wrap"><div class="bars">' + (bars || "") + "</div></div>") +
        card("Deferred revenue rollforward", r.rollforward.ties ? "Ties to ledger" : "Does not tie",
          '<dl class="kv">' +
          "<dt>Opening</dt><dd>" + esc(r.rollforward.opening) + "</dd>" +
          "<dt>Billed in period</dt><dd>" + esc(r.rollforward.billed) + "</dd>" +
          "<dt>Recognised in period</dt><dd>" + esc(r.rollforward.recognized) + "</dd>" +
          "<dt><b>Closing</b></dt><dd><b>" + esc(r.rollforward.closing) + "</b></dd>" +
          "<dt>Ledger closing</dt><dd>" + esc(r.rollforward.ledgerClosing) + "</dd>" +
          "</dl><div style='margin-top:12px'>" + tiesPill(r.rollforward.ties) + "</div>");
    });
  };

  PANELS.contracts = function () {
    return get("/api/erp/contracts").then(function (list) {
      var rows = (list || []).map(function (c, i) {
        var kind = c.status === "ACTIVE" ? "ok" : c.status === "DRAFT" ? "warn" : "neutral";
        return '<tr class="click" data-contract="' + i + '"><td>' + esc(c.number) +
          '<div class="muted" style="font-size:11.5px;margin-top:2px">' + esc(c.term) + "</div></td>" +
          "<td>" + esc(c.customer) + "</td>" +
          "<td>" + pill(c.status, kind) + "</td>" +
          '<td class="num">' + esc(c.transactionPrice) + "</td>" +
          '<td class="num">' + esc(c.recognized) + "</td>" +
          '<td class="num">' + esc(c.deferred) + "</td></tr>";
      });
      window.__contracts = list || [];
      return card("Contracts", (list || []).length + " total — click a row for its obligations",
        table([{ label: "Contract" }, { label: "Customer" }, { label: "Status" },
               { label: "Price", num: true }, { label: "Recognised", num: true }, { label: "Deferred", num: true }], rows), true);
    });
  };

  PANELS.metrics = function () {
    return get("/api/erp/metrics").then(function (m) {
      var rows = (m.movements || []).map(function (mv) {
        var kind = mv.kind === "NEW" || mv.kind === "EXPANSION" ? "ok"
          : mv.kind === "CHURN" || mv.kind === "CONTRACTION" ? "bad" : "neutral";
        return "<tr><td>" + esc(mv.customer) + "</td><td>" + pill(mv.kind, kind) + "</td>" +
          '<td class="num">' + esc(mv.delta) + "</td></tr>";
      });
      return '<div class="tiles">' +
        tile("ARR", m.arr, m.customers + " customers") +
        tile("Closing MRR", m.closingMrr) +
        tile("NRR", m.nrr) + tile("GRR", m.grr) + "</div>" +
        card("MRR movement — " + m.period, "opening to closing",
          '<dl class="kv">' +
          "<dt>Opening MRR</dt><dd>" + esc(m.openingMrr) + "</dd>" +
          "<dt>New</dt><dd>" + esc(m.newMrr) + "</dd>" +
          "<dt>Expansion</dt><dd>" + esc(m.expansion) + "</dd>" +
          "<dt>Contraction</dt><dd>" + esc(m.contraction) + "</dd>" +
          "<dt>Churn</dt><dd>" + esc(m.churn) + "</dd>" +
          "<dt><b>Closing MRR</b></dt><dd><b>" + esc(m.closingMrr) + "</b></dd>" +
          "</dl>") +
        card("Customer movements", (m.movements || []).length + " this period",
          table([{ label: "Customer" }, { label: "Kind" }, { label: "Delta", num: true }], rows), true);
    });
  };

  PANELS.subledgers = function () {
    return get("/api/erp/subledgers").then(function (s) {
      var aging = (s.aging || []).map(function (b) {
        return "<tr><td>" + esc(b.label) + "</td>" +
          '<td class="num muted">' + esc(String(b.count)) + "</td>" +
          '<td class="num">' + esc(b.amount) + "</td></tr>";
      });
      return '<div class="tiles">' +
        tile("AR subledger", s.ar.subledger, s.ar.ties ? "ties to ledger" : "does not tie") +
        tile("AP subledger", s.ap.subledger, s.ap.ties ? "ties to ledger" : "does not tie") +
        tile("Pending approval", String(s.pendingApproval), "bills") +
        tile("As of", s.asOf) + "</div>" +
        '<div class="split">' +
        card("AR tie-out", "subledger vs general ledger",
          '<dl class="kv"><dt>Subledger</dt><dd>' + esc(s.ar.subledger) + "</dd>" +
          "<dt>Ledger</dt><dd>" + esc(s.ar.ledger) + "</dd></dl>" +
          "<div style='margin-top:12px'>" + tiesPill(s.ar.ties) + "</div>") +
        card("AP tie-out", "subledger vs general ledger",
          '<dl class="kv"><dt>Subledger</dt><dd>' + esc(s.ap.subledger) + "</dd>" +
          "<dt>Ledger</dt><dd>" + esc(s.ap.ledger) + "</dd></dl>" +
          "<div style='margin-top:12px'>" + tiesPill(s.ap.ties) + "</div>") +
        "</div>" +
        card("AP ageing", "as of " + s.asOf,
          table([{ label: "Bucket" }, { label: "Bills", num: true }, { label: "Amount", num: true }], aging), true);
    });
  };

  PANELS.agents = function () {
    return get("/api/erp/agents").then(function (list) {
      var rows = (list || []).map(function (p, i) {
        var kind = p.severity === "HIGH" ? "bad" : p.severity === "MEDIUM" ? "warn" : "neutral";
        return '<tr class="click" data-prop-idx="' + i + '"><td>' + esc(p.title) +
          '<div class="muted" style="font-size:11.5px;margin-top:2px">' + esc(p.kind) + " · " + esc(p.period) + "</div></td>" +
          '<td class="num">' + (p.amount ? esc(p.amount) : '<span class="muted">—</span>') + "</td>" +
          "<td>" + (p.postsOnApproval ? pill("Posts on approval", "accent") : pill("Advisory", "neutral")) + "</td>" +
          '<td class="num">' + pill(p.severity, kind) + "</td></tr>";
      });
      window.__proposals = list || [];
      return card("AI proposals", (list || []).length + " open — click for the reasoning",
        table([{ label: "Proposal" }, { label: "Amount", num: true },
               { label: "Effect" }, { label: "Severity", num: true }], rows), true);
    });
  };

  PANELS.connectors = function () {
    return get("/api/erp/subledgers").then(function (s) {
      var rows = (s.connectors || []).map(function (c) {
        return "<tr><td>" + esc(c.source) + "</td><td>" + pill(c.kind, "neutral") + "</td>" +
          '<td class="muted">' + esc(c.lastSyncAt || "never") + "</td>" +
          '<td class="num">' + esc(String(c.ingested)) + "</td>" +
          '<td class="num muted">' + esc(String(c.duplicates)) + "</td></tr>";
      });
      return card("Connectors", "ingestion is idempotent — duplicates are counted, never re-posted",
        table([{ label: "Source" }, { label: "Kind" }, { label: "Last sync" },
               { label: "Ingested", num: true }, { label: "Duplicates", num: true }], rows), true);
    });
  };

  /* Drilldowns ---------------------------------------------------- */
  content.addEventListener("click", function (e) {
    var row = e.target.closest ? e.target.closest("tr.click") : null;
    if (!row) return;

    if (row.dataset.contract !== undefined) {
      var c = (window.__contracts || [])[Number(row.dataset.contract)];
      if (!c) return;
      var obs = (c.obligations || []).map(function (o) {
        return "<tr><td>" + esc(o.description) + '<div class="muted" style="font-size:11.5px;margin-top:2px">' +
          esc(o.method) + "</div></td>" + '<td class="num">' + esc(o.ssp) + "</td>" +
          '<td class="num">' + esc(o.allocated) + "</td></tr>";
      });
      openDrawer(c.number + " · " + c.customer,
        '<dl class="kv"><dt>Status</dt><dd>' + esc(c.status) + "</dd>" +
        "<dt>Term</dt><dd>" + esc(c.term) + "</dd>" +
        "<dt>Transaction price</dt><dd>" + esc(c.transactionPrice) + "</dd>" +
        "<dt>Recognised</dt><dd>" + esc(c.recognized) + "</dd>" +
        "<dt>Billed</dt><dd>" + esc(c.billed) + "</dd>" +
        "<dt>Deferred</dt><dd>" + esc(c.deferred) + "</dd>" +
        "<dt>Unbilled</dt><dd>" + esc(c.unbilled) + "</dd></dl>" +
        '<h4 style="margin:18px 0 8px;font-size:12.5px">Performance obligations</h4>' +
        table([{ label: "Obligation" }, { label: "SSP", num: true }, { label: "Allocated", num: true }], obs));
      return;
    }

    var idx = row.dataset.propIdx !== undefined ? row.dataset.propIdx : null;
    if (idx !== null) {
      var p = (window.__proposals || [])[Number(idx)];
      if (!p) return;
      openDrawer(p.title,
        '<dl class="kv"><dt>Kind</dt><dd>' + esc(p.kind) + "</dd>" +
        "<dt>Period</dt><dd>" + esc(p.period) + "</dd>" +
        "<dt>Severity</dt><dd>" + esc(p.severity) + "</dd>" +
        (p.amount ? "<dt>Amount</dt><dd>" + esc(p.amount) + "</dd>" : "") + "</dl>" +
        '<h4 style="margin:18px 0 6px;font-size:12.5px">Why</h4>' +
        '<p style="font-size:12.5px;color:var(--ink-2);line-height:1.55">' + esc(p.rationale) + "</p>" +
        '<p style="margin-top:14px">' +
        (p.postsOnApproval
          ? pill("Posts a journal entry on approval", "accent")
          : pill("Advisory only — posts nothing", "neutral")) + "</p>");
    }
  });

  /* Shell --------------------------------------------------------- */
  var renderNav = function () {
    var html = "", lastGroup = null;
    MODULES.forEach(function (m) {
      if (m.group !== lastGroup) { html += '<div class="nav-label">' + esc(m.group) + "</div>"; lastGroup = m.group; }
      html += '<button class="nav-item" data-mod="' + m.id + '"' +
        (m.id === current ? ' aria-current="page"' : "") + '><span class="ic">' + m.icon + "</span>" + esc(m.label) + "</button>";
    });
    el("nav").innerHTML = html;
  };

  var show = function (id) {
    current = id;
    var mod = MODULES.filter(function (m) { return m.id === id; })[0] || MODULES[0];
    el("crumb").textContent = mod.label;
    renderNav();
    content.innerHTML = '<div class="skel">Loading ' + esc(mod.label.toLowerCase()) + "…</div>";
    (PANELS[id] || PANELS.overview)()
      .then(function (html) { content.innerHTML = html; })
      .catch(function (err) {
        if (err && err.message === "auth") return;
        content.innerHTML = '<p class="err">Could not load ' + esc(mod.label) + ". " + esc(err.message) + "</p>";
      });
  };

  el("nav").addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-mod]") : null;
    if (btn) { closeDrawer(); show(btn.dataset.mod); }
  });
  el("refresh").addEventListener("click", function () { show(current); });

  /* Identity + period, from the endpoints that own them ----------- */
  get("/api/me").then(function (me) {
    var org = me.org || me.organization || {};
    el("orgName").textContent = org.name || me.name || "Paisa";
    el("orgMeta").textContent = me.email || (me.account && me.account.email) || "";
  }).catch(function () {
    el("orgName").textContent = "Paisa";
    el("orgMeta").textContent = "";
  });

  get("/api/erp/close").then(function (c) { el("periodChip").textContent = c.period; }).catch(function () {});

  renderNav();
  show("overview");
})();
</script>
</body>
</html>`;
