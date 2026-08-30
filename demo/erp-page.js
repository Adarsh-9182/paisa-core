/**
 * The ERP console page. Self-contained HTML — reuses the same design tokens
 * as the AI CFO dashboard without importing from it, so neither page can
 * break the other.
 */

export const erpPage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paisa ERP — Close & Revenue</title>
<style>
  :root {
    --bg:#FAF7F2; --surface:#FFFFFF; --line:#EDE7DD;
    --ink:#1F1B16; --ink-2:#6B6459; --ink-3:#9C948A;
    --orange:#F26B1D; --orange-soft:#FDEEE3; --orange-deep:#C24E08;
    --green:#0B7A56; --green-soft:#E3F3EC; --amber:#B45309; --amber-soft:#FDF3E3;
    --red:#C0392B; --red-soft:#FBEAE8; --radius:16px;
  }
  * { box-sizing:border-box; margin:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--ink); font-size:14px; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1180px; margin:0 auto; padding:28px 24px 60px; }
  header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px; flex-wrap:wrap; gap:12px; }
  .logo { display:flex; align-items:center; gap:9px; font-weight:700; font-size:17px; letter-spacing:-.01em; }
  .logo-mark { width:26px; height:26px; border-radius:8px; background:var(--orange); color:#fff;
               display:grid; place-items:center; font-size:14px; }
  .sub { color:var(--ink-2); margin-bottom:22px; }
  .sub a { color:var(--orange-deep); }
  h2 { font-size:15px; font-weight:650; letter-spacing:-.01em; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);
          padding:18px 20px; margin-bottom:16px; }
  .card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:3px; gap:12px; flex-wrap:wrap; }
  .card-sub { color:var(--ink-3); font-size:12.5px; margin-bottom:14px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width:880px){ .grid2{grid-template-columns:1fr;} }
  .pill { font-size:11px; font-weight:650; padding:3px 9px; border-radius:20px; letter-spacing:.02em; }
  .ok { background:var(--green-soft); color:var(--green); }
  .warn { background:var(--amber-soft); color:var(--amber); }
  .bad { background:var(--red-soft); color:var(--red); }
  .neutral { background:#F2EDE4; color:var(--ink-2); }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
       color:var(--ink-3); font-weight:600; padding:0 10px 8px 0; }
  td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .task { display:flex; gap:11px; padding:10px 0; border-top:1px solid var(--line); align-items:flex-start; }
  .task:first-child { border-top:0; }
  .mark { width:18px; height:18px; border-radius:50%; display:grid; place-items:center;
          font-size:11px; font-weight:700; flex-shrink:0; margin-top:1px; }
  .mark.p { background:var(--green-soft); color:var(--green); }
  .mark.b { background:var(--red-soft); color:var(--red); }
  .mark.w { background:var(--amber-soft); color:var(--amber); }
  .task-body { flex:1; min-width:0; }
  .task-name { font-weight:550; }
  .task-detail { color:var(--ink-2); font-size:12.5px; margin-top:2px; }
  .blocker { color:var(--red); font-size:12.5px; margin-top:3px; }
  .bars { display:flex; align-items:flex-end; gap:5px; height:96px; margin-top:6px; }
  .bar { flex:1; background:var(--orange-soft); border-radius:5px 5px 0 0; position:relative; min-height:2px; }
  .bar.first { background:var(--orange); }
  .bar span { position:absolute; bottom:-19px; left:0; right:0; text-align:center;
              font-size:9.5px; color:var(--ink-3); }
  .bars-wrap { padding-bottom:22px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:14px; }
  .kpi .label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3); font-weight:600; }
  .kpi .value { font-size:19px; font-weight:680; letter-spacing:-.02em; margin-top:3px; font-variant-numeric:tabular-nums; }
  .kpi .note { font-size:11.5px; color:var(--ink-3); margin-top:1px; }
  .prop { border-top:1px solid var(--line); padding:13px 0; }
  .prop:first-child { border-top:0; }
  .prop-head { display:flex; gap:9px; align-items:center; margin-bottom:4px; flex-wrap:wrap; }
  .prop-title { font-weight:600; }
  .prop-why { color:var(--ink-2); font-size:12.5px; line-height:1.55; }
  .prop-actions { display:flex; gap:8px; margin-top:9px; }
  .btn { border:1px solid var(--line); background:var(--surface); color:var(--ink);
         padding:6px 13px; border-radius:9px; font-size:12.5px; font-weight:600; cursor:pointer;
         font-family:inherit; }
  .btn:hover { background:#F7F2EA; }
  .btn-primary { background:var(--orange); border-color:var(--orange); color:#fff; }
  .btn-primary:hover { background:var(--orange-deep); }
  .btn:disabled { opacity:.45; cursor:default; }
  .tie { display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid var(--line);
         font-variant-numeric:tabular-nums; }
  .tie:first-child { border-top:0; }
  .periods { display:flex; gap:5px; flex-wrap:wrap; margin-top:10px; }
  .per { font-size:11px; padding:4px 9px; border-radius:7px; font-weight:600; }
  .muted { color:var(--ink-3); font-size:12.5px; }
  .obl { color:var(--ink-2); font-size:12.5px; padding:2px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo"><span class="logo-mark">₹</span>paisa <span style="color:var(--ink-3);font-weight:500">ERP</span></div>
    <div class="muted">Nimbus Labs Pvt Ltd · period <b id="period">–</b></div>
  </header>
  <div class="sub">Close management, ASC 606 revenue, subledgers and continuous agents. <a href="/app">← AI CFO dashboard</a></div>

  <div class="card">
    <div class="card-head">
      <h2>Month-end close</h2>
      <div id="close-badge"></div>
    </div>
    <div class="card-sub">Every task runs a check against the ledger — nothing here is a tickable box</div>
    <div id="tasks"></div>
    <div class="periods" id="periods"></div>
    <div style="margin-top:14px;display:flex;gap:8px">
      <button class="btn" id="rerun">Re-run checklist</button>
      <button class="btn btn-primary" id="lock">Lock period</button>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-head"><h2>Revenue waterfall</h2><span class="pill neutral" id="rpo">–</span></div>
      <div class="card-sub">Contracted revenue not yet recognised, by month (RPO)</div>
      <div class="bars-wrap"><div class="bars" id="bars"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Deferred revenue roll-forward</h2><span id="rf-badge"></span></div>
      <div class="card-sub">opening + billed − recognised = closing, checked against the GL</div>
      <div id="rollforward"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>SaaS metrics</h2><span class="muted" id="mrr-sub"></span></div>
    <div class="card-sub">Computed from the same contracts as the GAAP numbers</div>
    <div class="kpis" id="kpis"></div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Continuous agents</h2><span class="pill neutral" id="prop-count">–</span></div>
    <div class="card-sub">Agents propose; a human approves. Approving is what posts the entry.</div>
    <div id="proposals"></div>
  </div>

  <div class="grid2">
    <div class="card">
      <div class="card-head"><h2>Subledger tie-out</h2></div>
      <div class="card-sub">Subledgers must agree with their GL control accounts</div>
      <div id="ties"></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Connected sources</h2></div>
      <div class="card-sub">Ingestion is idempotent — replays create nothing</div>
      <div id="connectors"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Revenue contracts</h2></div>
    <div class="card-sub">ASC 606 allocation per performance obligation</div>
    <div id="contracts"></div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const get = (p) => fetch("/api/erp/" + p).then((r) => r.json());

const badge = (ok, okText, badText) =>
  '<span class="pill ' + (ok ? "ok" : "bad") + '">' + (ok ? okText : badText) + "</span>";

async function loadClose() {
  const d = await get("close");
  $("period").textContent = d.period;
  $("close-badge").innerHTML = d.locked
    ? '<span class="pill ok">LOCKED</span>'
    : d.readyToClose
      ? '<span class="pill ok">READY TO CLOSE</span>'
      : '<span class="pill bad">' + d.blocked + " BLOCKED</span>";
  $("tasks").innerHTML = d.tasks
    .map((t) => {
      const cls = t.status === "PASSED" ? "p" : t.status === "WAIVED" ? "w" : "b";
      const glyph = t.status === "PASSED" ? "✓" : t.status === "WAIVED" ? "~" : "✕";
      return (
        '<div class="task"><div class="mark ' + cls + '">' + glyph + "</div>" +
        '<div class="task-body"><div class="task-name">' + t.name +
        (t.automated ? ' <span class="pill neutral">auto</span>' : "") + "</div>" +
        '<div class="task-detail">' + t.detail + "</div>" +
        t.blockers.map((b) => '<div class="blocker">↳ ' + b + "</div>").join("") +
        (t.waiverReason ? '<div class="task-detail">waived by ' + t.waivedBy + " — " + t.waiverReason + "</div>" : "") +
        "</div></div>"
      );
    })
    .join("");
  $("periods").innerHTML = d.periods
    .map((p) => {
      const cls = p.status === "CLOSED" ? "ok" : p.status === "SOFT_CLOSED" ? "warn" : "neutral";
      return '<span class="per pill ' + cls + '">' + p.period + " · " + p.status + "</span>";
    })
    .join("");
  $("lock").disabled = !d.readyToClose || d.locked;
}

async function loadRevenue() {
  const d = await get("revenue");
  $("rpo").textContent = "RPO " + d.rpo;
  const max = Math.max(...d.waterfall.map((w) => w.raw), 1);
  $("bars").innerHTML = d.waterfall
    .map((w, i) =>
      '<div class="bar' + (i === 0 ? " first" : "") + '" style="height:' +
      Math.max(2, (w.raw / max) * 100) + '%" title="' + w.period + " " + w.amount +
      '"><span>' + w.period.slice(5) + "</span></div>",
    )
    .join("");
  const r = d.rollforward;
  $("rf-badge").innerHTML = badge(r.ties, "TIES TO GL", "DOES NOT TIE");
  $("rollforward").innerHTML =
    row("Opening deferred", r.opening) + row("Billed", r.billed) +
    row("Recognised", "− " + r.recognized) + row("<b>Closing</b>", "<b>" + r.closing + "</b>") +
    row("Per general ledger", r.ledgerClosing) +
    row("Recognised YTD", d.recognizedYtd) + row("Unbilled receivable", d.unbilled);
}

const row = (k, v) => '<div class="tie"><span>' + k + "</span><span>" + v + "</span></div>";

async function loadMetrics() {
  const d = await get("metrics");
  $("mrr-sub").textContent = d.customers + " customers";
  $("kpis").innerHTML = [
    ["MRR", d.closingMrr, "from " + d.openingMrr],
    ["ARR", d.arr, ""],
    ["New", d.newMrr, "this month"],
    ["Expansion", d.expansion, ""],
    ["Churn", d.churn, ""],
    ["NRR", d.nrr, "since Mar"],
    ["Backlog", d.backlog, "RPO"],
    ["ARPA", d.arpa, ""],
  ]
    .map(([l, v, n]) => '<div class="kpi"><div class="label">' + l + '</div><div class="value">' + v +
      '</div><div class="note">' + n + "</div></div>")
    .join("");
}

async function loadAgents() {
  const d = await get("agents");
  $("prop-count").textContent = d.length + " open";
  $("proposals").innerHTML = d.length === 0
    ? '<div class="muted">No open exceptions — the agents found nothing outstanding.</div>'
    : d.map((p) => {
        const sev = p.severity === "HIGH" ? "bad" : p.severity === "MEDIUM" ? "warn" : "neutral";
        return (
          '<div class="prop" data-id="' + p.id + '">' +
          '<div class="prop-head"><span class="pill ' + sev + '">' + p.severity + "</span>" +
          '<span class="prop-title">' + p.title + "</span>" +
          (p.postsOnApproval ? '<span class="pill neutral">posts on approval</span>' : "") + "</div>" +
          '<div class="prop-why">' + p.rationale + "</div>" +
          '<div class="prop-actions">' +
          '<button class="btn btn-primary" data-act="approve">Approve</button>' +
          '<button class="btn" data-act="dismiss">Dismiss</button></div></div>'
        );
      }).join("");
}

async function loadSubledgers() {
  const d = await get("subledgers");
  $("ties").innerHTML =
    '<div class="tie"><span>Accounts receivable</span><span>' + d.ar.subledger + " vs " + d.ar.ledger +
    " " + badge(d.ar.ties, "ties", "OUT") + "</span></div>" +
    '<div class="tie"><span>Accounts payable</span><span>' + d.ap.subledger + " vs " + d.ap.ledger +
    " " + badge(d.ap.ties, "ties", "OUT") + "</span></div>" +
    d.aging.map((b) => row("AP " + b.label, b.amount + " (" + b.count + ")")).join("");
  $("connectors").innerHTML = d.connectors
    .map((c) => row(c.source + ' <span class="pill neutral">' + c.kind + "</span>",
      c.ingested + " ingested · " + c.duplicates + " dupes skipped"))
    .join("");
}

async function loadContracts() {
  const d = await get("contracts");
  $("contracts").innerHTML =
    "<table><thead><tr><th>Contract</th><th>Customer</th><th>Status</th>" +
    '<th class="num">Price</th><th class="num">Recognised</th><th class="num">Deferred</th><th class="num">Unbilled</th></tr></thead><tbody>' +
    d.map((c) =>
      "<tr><td><b>" + c.number + "</b><div class=\\"muted\\">" + c.term + "</div>" +
      c.obligations.map((o) => '<div class="obl">· ' + o.description + " — " + o.allocated +
        ' <span class="pill neutral">' + o.method + "</span></div>").join("") +
      "</td><td>" + c.customer + '</td><td><span class="pill ' +
      (c.status === "ACTIVE" ? "ok" : "neutral") + '">' + c.status + "</span></td>" +
      '<td class="num">' + c.transactionPrice + '</td><td class="num">' + c.recognized +
      '</td><td class="num">' + c.deferred + '</td><td class="num">' + c.unbilled + "</td></tr>",
    ).join("") + "</tbody></table>";
}

const loadAll = () => Promise.all([loadClose(), loadRevenue(), loadMetrics(), loadAgents(), loadSubledgers(), loadContracts()]);

$("proposals").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.closest(".prop").dataset.id;
  btn.disabled = true;
  await fetch("/api/erp/proposals/" + id + "/" + btn.dataset.act, { method: "POST" });
  await loadAll();
});
$("rerun").addEventListener("click", async () => {
  await fetch("/api/erp/close/run", { method: "POST" });
  await loadAll();
});
$("lock").addEventListener("click", async () => {
  const r = await fetch("/api/erp/close/lock", { method: "POST" }).then((x) => x.json());
  if (r.error) alert(r.error);
  await loadAll();
});

loadAll();
</script>
</body>
</html>`;
