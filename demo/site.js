/**
 * Paisa — the public site.
 *
 * Served at /site so the app (/) and the ERP console (/erp) are untouched.
 * Every capability named here maps to a module that exists in src/erp/;
 * there are no customer logos, testimonials or certifications, because we
 * do not have them yet and inventing them would be the one thing a finance
 * product can never come back from.
 */

export const sitePage = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paisa — The AI-native ERP for finance teams</title>
<meta name="description" content="Perpetual general ledger, ASC 606 revenue recognition, multi-entity consolidation and a close that runs itself. With an AI CFO that cannot invent a number.">
<style>
  :root {
    --bg:#FAF7F2; --surface:#FFFFFF; --line:#EDE7DD; --line-2:#E2DACD;
    --ink:#1F1B16; --ink-2:#6B6459; --ink-3:#9C948A;
    --orange:#F26B1D; --orange-soft:#FDEEE3; --orange-deep:#C24E08;
    --green:#0B7A56; --green-soft:#E3F3EC;
    --night:#16130F; --night-2:#221D17; --night-line:#332B22; --night-ink:#F5F0E8; --night-ink-2:#A79C8D;
    --radius:16px; --wrap:1120px;
  }
  * { box-sizing:border-box; margin:0; }
  html { scroll-behavior:smooth; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
         background:var(--bg); color:var(--ink); font-size:15px; line-height:1.6;
         -webkit-font-smoothing:antialiased; }
  a { color:inherit; text-decoration:none; }
  .wrap { max-width:var(--wrap); margin:0 auto; padding:0 24px; }
  .eyebrow { font-size:11.5px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
             color:var(--orange-deep); margin-bottom:14px; }
  .eyebrow.on-dark { color:var(--orange); }
  h1 { font-size:clamp(34px,5.2vw,58px); line-height:1.06; letter-spacing:-.033em; font-weight:700; }
  h2 { font-size:clamp(26px,3.4vw,38px); line-height:1.14; letter-spacing:-.026em; font-weight:700; }
  h3 { font-size:17px; letter-spacing:-.012em; font-weight:650; }
  .lede { font-size:clamp(16px,1.7vw,19px); color:var(--ink-2); line-height:1.55; }
  .lede.on-dark { color:var(--night-ink-2); }
  section { padding:88px 0; }
  .btn { display:inline-flex; align-items:center; gap:7px; padding:11px 20px; border-radius:11px;
         font-weight:650; font-size:14.5px; border:1px solid transparent; cursor:pointer;
         font-family:inherit; transition:background .15s,border-color .15s; }
  .btn-primary { background:var(--orange); color:#fff; }
  .btn-primary:hover { background:var(--orange-deep); }
  .btn-ghost { border-color:var(--line-2); color:var(--ink); background:var(--surface); }
  .btn-ghost:hover { background:#F4EFE7; }
  .btn-dark { border-color:var(--night-line); color:var(--night-ink); background:transparent; }
  .btn-dark:hover { background:var(--night-2); }

  /* ---------- nav ---------- */
  nav.top { position:sticky; top:0; z-index:50; background:rgba(22,19,15,.86);
            backdrop-filter:saturate(160%) blur(12px); border-bottom:1px solid var(--night-line); }
  nav.top .inner { display:flex; align-items:center; gap:26px; height:62px; }
  .logo { display:flex; align-items:center; gap:9px; font-weight:700; font-size:17.5px;
          letter-spacing:-.02em; color:var(--night-ink); }
  .logo-mark { width:27px; height:27px; border-radius:8px; background:var(--orange); color:#fff;
               display:grid; place-items:center; font-size:15px; font-weight:700; }
  .navlinks { display:flex; gap:20px; margin-left:6px; font-size:14px; color:var(--night-ink-2); font-weight:500; }
  .navlinks a:hover { color:var(--night-ink); }
  .navcta { margin-left:auto; display:flex; gap:9px; align-items:center; }
  @media (max-width:860px){ .navlinks{display:none;} }

  /* ---------- hero ---------- */
  .hero { background:var(--night); color:var(--night-ink); padding:82px 0 96px; position:relative; overflow:hidden; }
  .hero::after { content:""; position:absolute; inset:auto -10% -60% 40%; height:420px;
                 background:radial-gradient(closest-side,rgba(242,107,29,.16),transparent);
                 pointer-events:none; }
  .hero .inner { position:relative; z-index:1; max-width:820px; }
  .hero h1 { color:var(--night-ink); }
  .hero h1 em { font-style:normal; color:var(--orange); }
  .hero .lede { margin-top:20px; max-width:600px; }
  .hero-cta { display:flex; gap:11px; margin-top:30px; flex-wrap:wrap; }
  .hero-note { margin-top:16px; font-size:13px; color:var(--night-ink-2); }

  /* ---------- console preview ---------- */
  .console { margin-top:56px; background:var(--night-2); border:1px solid var(--night-line);
             border-radius:18px; overflow:hidden; position:relative; z-index:1; }
  .console-bar { display:flex; align-items:center; gap:7px; padding:11px 15px;
                 border-bottom:1px solid var(--night-line); }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--night-line); }
  .console-title { margin-left:8px; font-size:12.5px; color:var(--night-ink-2); }
  .console-body { padding:18px 20px 22px; }
  .crow { display:flex; align-items:flex-start; gap:11px; padding:8px 0;
          border-top:1px solid var(--night-line); font-size:13.5px; }
  .crow:first-child { border-top:0; }
  .cmark { width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
           font-size:10px; font-weight:700; flex-shrink:0; margin-top:2px; }
  .cmark.ok { background:rgba(11,122,86,.22); color:#4ADE9E; }
  .cmark.no { background:rgba(192,57,43,.22); color:#F87171; }
  .cname { color:var(--night-ink); font-weight:550; }
  .cdetail { color:var(--night-ink-2); font-size:12.5px; }
  .cblock { color:#F87171; font-size:12.5px; margin-top:2px; }

  /* ---------- wedge strip ---------- */
  .strip { background:var(--night-2); border-top:1px solid var(--night-line);
           border-bottom:1px solid var(--night-line); padding:34px 0; }
  .strip .inner { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:26px; }
  .strip .n { font-size:23px; font-weight:700; color:var(--orange); letter-spacing:-.02em; }
  .strip .l { font-size:13px; color:var(--night-ink-2); margin-top:3px; line-height:1.45; }

  /* ---------- generic blocks ---------- */
  .head { max-width:660px; margin-bottom:44px; }
  .head .lede { margin-top:14px; }
  .grid { display:grid; gap:16px; }
  .g3 { grid-template-columns:repeat(3,1fr); }
  .g2 { grid-template-columns:repeat(2,1fr); }
  @media (max-width:900px){ .g3{grid-template-columns:1fr 1fr;} }
  @media (max-width:640px){ .g3,.g2{grid-template-columns:1fr;} }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);
          padding:22px 22px 24px; }
  .card .num { font-size:11.5px; font-weight:700; color:var(--ink-3); letter-spacing:.06em; }
  .card h3 { margin:9px 0 7px; }
  .card p { color:var(--ink-2); font-size:14px; line-height:1.58; }
  .card code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px;
               color:var(--ink-3); background:#F4EFE7; padding:1px 6px; border-radius:5px; }

  /* ---------- AI section ---------- */
  .ai { background:var(--night); color:var(--night-ink); }
  .ai h2 { color:var(--night-ink); }
  .flow { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:38px; }
  @media (max-width:820px){ .flow{grid-template-columns:1fr 1fr;} }
  .step { background:var(--night-2); border:1px solid var(--night-line); border-radius:14px; padding:18px; }
  .step .s { font-size:11px; font-weight:700; color:var(--orange); letter-spacing:.08em; }
  .step h4 { font-size:14.5px; margin:8px 0 6px; font-weight:650; color:var(--night-ink); }
  .step p { font-size:13px; color:var(--night-ink-2); line-height:1.5; }
  .quote { margin-top:38px; padding:22px 24px; border-left:2px solid var(--orange);
           background:var(--night-2); border-radius:0 14px 14px 0; }
  .quote p { font-size:16.5px; line-height:1.55; color:var(--night-ink); letter-spacing:-.01em; }
  .quote span { display:block; margin-top:10px; font-size:13px; color:var(--night-ink-2); }

  /* ---------- table ---------- */
  .tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); }
  table { width:100%; border-collapse:collapse; min-width:620px; }
  th,td { padding:13px 16px; text-align:left; border-top:1px solid var(--line); font-size:14px; }
  thead th { border-top:0; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em;
             color:var(--ink-3); font-weight:700; }
  tbody th { font-weight:550; color:var(--ink); }
  td.y { color:var(--green); font-weight:600; }
  td.n { color:var(--ink-3); }
  .col-paisa { background:var(--orange-soft); }
  thead .col-paisa { color:var(--orange-deep); }

  /* ---------- integrations ---------- */
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .chip { border:1px solid var(--line); background:var(--surface); border-radius:9px;
          padding:7px 13px; font-size:13px; color:var(--ink-2); font-weight:500; }
  .chip b { color:var(--ink); font-weight:600; }

  /* ---------- cta ---------- */
  .cta { background:var(--night); color:var(--night-ink); text-align:center; }
  .cta h2 { color:var(--night-ink); }
  .cta .lede { margin:16px auto 0; max-width:520px; }
  .cta-row { display:flex; gap:11px; justify-content:center; margin-top:28px; flex-wrap:wrap; }

  footer { background:var(--night); color:var(--night-ink-2); border-top:1px solid var(--night-line);
           padding:46px 0 40px; font-size:13.5px; }
  .fgrid { display:grid; grid-template-columns:1.6fr repeat(3,1fr); gap:28px; }
  @media (max-width:780px){ .fgrid{grid-template-columns:1fr 1fr;} }
  footer h5 { font-size:11.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--night-ink);
              font-weight:700; margin-bottom:11px; }
  footer li { list-style:none; margin-bottom:7px; }
  footer a:hover { color:var(--night-ink); }
  .fbottom { margin-top:34px; padding-top:22px; border-top:1px solid var(--night-line);
             display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; font-size:12.5px; }
  .honest { border:1px solid var(--night-line); border-radius:12px; padding:14px 16px;
            margin-top:20px; font-size:12.5px; line-height:1.55; }
</style>
</head>
<body>

<nav class="top">
  <div class="wrap inner">
    <a class="logo" href="/site"><span class="logo-mark">P</span>paisa</a>
    <div class="navlinks">
      <a href="#platform">Platform</a>
      <a href="#ai">Paisa AI</a>
      <a href="#global">Global &amp; local</a>
      <a href="#close">Close</a>
      <a href="#compare">Compare</a>
    </div>
    <div class="navcta">
      <a class="btn btn-dark" href="/">Live app</a>
      <a class="btn btn-primary" href="/erp">See the close</a>
    </div>
  </div>
</nav>

<!-- ---------------- HERO ---------------- -->
<header class="hero">
  <div class="wrap">
    <div class="inner">
      <div class="eyebrow on-dark">AI-native ERP · Multi-entity · Multi-currency</div>
      <h1>Close the month in a day.<br>Trust <em>every number</em> in it.</h1>
      <p class="lede">Paisa is a perpetual general ledger with ASC 606 revenue recognition, multi-entity
        consolidation, and a close that runs itself. Its AI CFO answers in plain language — and is
        structurally incapable of inventing a figure.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="/erp">Open the ERP console</a>
        <a class="btn btn-dark" href="#ai">How the AI is grounded</a>
      </div>
      <div class="hero-note">No sign-up — the demo runs on a seeded company with a live close waiting.</div>
    </div>

    <div class="console">
      <div class="console-bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="console-title">Month-end close · June 2026 · Nimbus Labs Pvt Ltd</span>
      </div>
      <div class="console-body">
        <div class="crow"><div class="cmark ok">✓</div><div>
          <div class="cname">Subledgers frozen for the period</div>
          <div class="cdetail">Period 2026-06 is SOFT_CLOSED</div></div></div>
        <div class="crow"><div class="cmark no">✕</div><div>
          <div class="cname">Bank reconciliations completed</div>
          <div class="cblock">↳ Bank has no completed reconciliation as of 2026-06-30</div></div></div>
        <div class="crow"><div class="cmark ok">✓</div><div>
          <div class="cname">Revenue recognition posted</div>
          <div class="cdetail">Recognised ₹4,17,945.21 across 3 performance obligations</div></div></div>
        <div class="crow"><div class="cmark ok">✓</div><div>
          <div class="cname">AR subledger ties to the control account</div>
          <div class="cdetail">Accounts Receivable ₹36,93,400.00 agrees with the general ledger</div></div></div>
        <div class="crow"><div class="cmark ok">✓</div><div>
          <div class="cname">Deferred revenue roll-forward ties to the ledger</div>
          <div class="cdetail">opening + billed − recognised = closing, checked against the GL</div></div></div>
        <div class="crow"><div class="cmark no">✕</div><div>
          <div class="cname">Material P&amp;L movements explained</div>
          <div class="cblock">↳ Services moved ₹2,80,000.00 vs prior period and has no explanation</div></div></div>
      </div>
    </div>
  </div>
</header>

<div class="strip">
  <div class="wrap inner">
    <div><div class="n">Zero</div><div class="l">figures the AI can state that no engine produced</div></div>
    <div><div class="n">To the paisa</div><div class="l">every ASC 606 allocation and schedule sums exactly</div></div>
    <div><div class="n">Append-only</div><div class="l">no entry is ever edited or deleted — corrections are reversals</div></div>
    <div><div class="n">Any currency</div><div class="l">exact rational FX rates, per-entity ledgers, consolidation on demand</div></div>
  </div>
</div>

<!-- ---------------- PLATFORM ---------------- -->
<section id="platform">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">01 · Platform</div>
      <h2>One ledger. Every subledger tied to it.</h2>
      <p class="lede">Revenue, payables, schedules and cash live in the same system as the general
        ledger. Nothing syncs, so nothing drifts — and the close proves it every month.</p>
    </div>
    <div class="grid g3">
      <div class="card"><div class="num">01</div><h3>Perpetual general ledger</h3>
        <p>Balances are projections over an append-only journal, never stored figures. The ledger and
          the journal cannot disagree, because there is only one of them.</p></div>
      <div class="card"><div class="num">02</div><h3>Advanced revenue recognition</h3>
        <p>ASC 606 end to end: performance obligations, relative-SSP allocation, ratable, point-in-time,
          usage and milestone patterns, versioned contract modifications.</p></div>
      <div class="card"><div class="num">03</div><h3>Close management</h3>
        <p>A checklist of executable checks, not tickable boxes. Each task runs against the ledger and
          returns PASSED or BLOCKED with the reason.</p></div>
      <div class="card"><div class="num">04</div><h3>Accounts receivable</h3>
        <p>Invoicing, aging, collections and contract billing feeding one AR control account that ties
          out as-at any date you ask for.</p></div>
      <div class="card"><div class="num">05</div><h3>Accounts payable</h3>
        <p>Approval limits, segregation of duties enforced in code, duplicate-invoice rejection, and
          blocked GST capitalised into the expense where ITC cannot be claimed.</p></div>
      <div class="card"><div class="num">06</div><h3>Bank reconciliation</h3>
        <p>Tiered matching — exact date, settlement window, shared reference. No fuzzy amount matching:
          a rupee out is a discrepancy, not a match.</p></div>
      <div class="card"><div class="num">07</div><h3>Multi-entity &amp; multi-currency</h3>
        <p>Per-entity ledgers consolidated on demand with intercompany elimination. Exact rational FX
          rates; a missing rate throws rather than carrying a stale one.</p></div>
      <div class="card"><div class="num">08</div><h3>Real-time reporting</h3>
        <p>GAAP statements and operator metrics — MRR movement, NRR, backlog — computed from the same
          contracts, so they reconcile to each other on demand.</p></div>
      <div class="card"><div class="num">09</div><h3>Audit trail</h3>
        <p>Every mutation emits an event. Reopening a closed period demands a stated reason and is
          recorded. Waiving a close task names who waived it and why.</p></div>
    </div>
  </div>
</section>

<!-- ---------------- AI ---------------- -->
<section class="ai" id="ai">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow on-dark">02 · Paisa AI</div>
      <h2>An AI CFO that cannot make a number up.</h2>
      <p class="lede on-dark">Most finance AI asks you to trust it. Paisa removes the need to. The model
        decides which question to ask; the engines produce every figure; a verifier rejects the answer
        if a single number in it is not traceable to a tool result.</p>
    </div>

    <div class="flow">
      <div class="step"><div class="s">STEP 1</div><h4>Model plans</h4>
        <p>Claude reads the question and chooses which engine tools to call. It never computes.</p></div>
      <div class="step"><div class="s">STEP 2</div><h4>Engines answer</h4>
        <p>Deterministic modules read the ledger and return exact figures with their basis.</p></div>
      <div class="step"><div class="s">STEP 3</div><h4>Model narrates</h4>
        <p>The answer is written from those tool results, quoting each figure exactly as printed.</p></div>
      <div class="step"><div class="s">STEP 4</div><h4>Verifier gates</h4>
        <p>Any figure not traceable to a tool output rejects the answer. It never reaches the screen.</p></div>
    </div>

    <div class="quote">
      <p>“The LLM is never the source of financial truth.”</p>
      <span>The rule the orchestrator enforces in code — not a guideline in a prompt.</span>
    </div>

    <div class="grid g3" style="margin-top:38px">
      <div class="card" style="background:var(--night-2);border-color:var(--night-line)">
        <h3 style="color:var(--night-ink)">Agents propose, humans dispose</h3>
        <p style="color:var(--night-ink-2)">Missing accruals, unusual charges, probable duplicates,
          stale receivables and unrecognised revenue are raised as proposals. Approving one is what
          posts the entry — and the entry is attributed to the approver, never the agent.</p></div>
      <div class="card" style="background:var(--night-2);border-color:var(--night-line)">
        <h3 style="color:var(--night-ink)">Deterministic detection</h3>
        <p style="color:var(--night-ink-2)">Exceptions come from rules over the ledger, not model
          judgement. That makes every finding reproducible, explainable, and the same on Tuesday as it
          was on Monday.</p></div>
      <div class="card" style="background:var(--night-2);border-color:var(--night-line)">
        <h3 style="color:var(--night-ink)">No payment tool exists</h3>
        <p style="color:var(--night-ink-2)">The AI recommends and drafts. It cannot move money, approve
          a bill, or close a period — not because it is told not to, but because no such code path
          was written.</p></div>
    </div>
  </div>
</section>

<!-- ---------------- INDIA ---------------- -->
<section id="global">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">03 · Global &amp; local</div>
      <h2>Global by architecture. Local where it counts.</h2>
      <p class="lede">Multi-entity and multi-currency are in the core, not an upgrade tier. And where a
        jurisdiction's tax sits inside the accounting rather than beside it, Paisa puts it there —
        starting with Indian GST, because that is the market we know best.</p>
    </div>
    <div class="grid g3">
      <div class="card"><h3>Entities are structural</h3>
        <p>Each entity keeps its own chart, journal and functional currency. Consolidation is a
          read-only projection with intercompany elimination — there is no cross-entity posting to
          go wrong, and an unmatched intercompany balance is surfaced, never netted away.</p></div>
      <div class="card"><h3>Currency without drift</h3>
        <p>Rates are exact rationals, never floats, so a conversion is reproducible to the minor unit
          years later. A rate that was never loaded throws rather than silently carrying a stale one
          forward. Monetary balances revalue at period end; non-monetary ones never do.</p></div>
      <div class="card"><h3>One revenue standard, five steps</h3>
        <p>ASC 606 and IFRS 15 share the same five steps, and the engine implements the steps rather
          than one regulator's wording — performance obligations, relative-SSP allocation, and
          recognition patterns from ratable to usage to milestone.</p></div>
      <div class="card"><h3>Tax inside the accounting</h3>
        <p>Where a jurisdiction's tax belongs in the entry rather than a report, it goes there. Indian
          GST posts with the invoice and the bill, and ITC eligibility is a property of the bill line —
          where credit is blocked, the tax is capitalised into the expense instead of parked as a
          receivable you can never claim.</p></div>
      <div class="card"><h3>Filing calendars as arithmetic</h3>
        <p>GSTR-1 and GSTR-3B due dates are computed, not reminded. The brief says what is due, in how
          many days, with the figures already prepared. The same shape takes another jurisdiction's
          calendar when we add one.</p></div>
      <div class="card"><h3>Compliance answers with citations</h3>
        <p>Ask about a rate, threshold or section and Paisa answers only from a curated regulation
          corpus, citing the source and the date it was verified — or says the corpus does not cover
          it and suggests an accountant. It never answers tax law from memory.</p></div>
    </div>
  </div>
</section>

<!-- ---------------- CLOSE ---------------- -->
<section id="close" style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">04 · The close</div>
      <h2>A closed period is closed.</h2>
      <p class="lede">Most systems make a closed month a convention. Paisa makes it a fact: the journal
        itself refuses an entry dated inside a locked period.</p>
    </div>
    <div class="grid g3">
      <div class="card" style="background:var(--bg)"><h3>Sequential and reversible</h3>
        <p>March cannot close while February is open. Reopening is allowed, demands a written reason,
          and is recorded as an audit event — never a silent edit.</p></div>
      <div class="card" style="background:var(--bg)"><h3>Soft close for adjustments</h3>
        <p>Subledgers freeze while accruals, recognition, FX and manual adjustments still post. That is
          the state the checklist runs in.</p></div>
      <div class="card" style="background:var(--bg)"><h3>Safe to re-run</h3>
        <p>Recognition, amortisation and depreciation are keyed by item and period. Re-running the
          close after a correction posts nothing twice.</p></div>
      <div class="card" style="background:var(--bg)"><h3>Flux analysis with teeth</h3>
        <p>A material P&amp;L movement blocks the close until someone writes down why. Immaterial noise
          does not, and the first trading period is exempt — there is nothing to vary from.</p></div>
      <div class="card" style="background:var(--bg)"><h3>Tie-outs, as-at</h3>
        <p>AR and AP are rebuilt as they stood on the period end, not as they stand today. A document
          raised next month does not leak into last month's balance.</p></div>
      <div class="card" style="background:var(--bg)"><h3>Waivers on the record</h3>
        <p>A blocked task can be waived — by a named person, with a reason, visible on the checklist.
          Nobody quietly ticks a box the books do not support.</p></div>
    </div>
  </div>
</section>

<!-- ---------------- INTEGRATIONS ---------------- -->
<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">05 · Integrations</div>
      <h2>Data in. Judgement stays yours.</h2>
      <p class="lede">Ingestion is idempotent by external id — webhooks retry, exports overlap, and a
        replay creates nothing. Nothing posts to the ledger on arrival: a closed-won deal becomes a
        <em>draft</em> contract, because the revenue treatment of a deal is an accounting judgement,
        not a CRM field.</p>
    </div>
    <div class="chips">
      <span class="chip"><b>CRM</b> · Salesforce, HubSpot</span>
      <span class="chip"><b>Billing</b> · Stripe, Chargebee, Razorpay</span>
      <span class="chip"><b>Banking</b> · J.P. Morgan, Brex, Mercury, HDFC, ICICI</span>
      <span class="chip"><b>Payroll</b> · Gusto, Deel, Rippling, RazorpayX</span>
      <span class="chip"><b>Expense</b> · Ramp, Bill, Happay</span>
      <span class="chip"><b>Warehouse</b> · Snowflake, BigQuery</span>
    </div>
    <p style="margin-top:16px;font-size:13px;color:var(--ink-3)">
      Connectors are transport-agnostic: the same code path runs against a live API, a nightly file
      or a test fixture. Named integrations are on the roadmap; the ingestion layer they plug into is built.
    </p>
  </div>
</section>

<!-- ---------------- COMPARE ---------------- -->
<section id="compare" style="background:var(--surface);border-top:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">06 · Compare</div>
      <h2>Where Paisa is different.</h2>
      <p class="lede">An honest table. The incumbents are mature products with decades of deployment
        behind them; the last row says so. A dash means the category is not offered as such, not that
        the product is worse.</p>
    </div>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th></th><th class="col-paisa">Paisa</th><th>NetSuite</th><th>Sage Intacct</th><th>Tally</th>
        </tr></thead>
        <tbody>
          <tr><th>ASC 606 / IFRS 15 revenue subledger</th><td class="col-paisa y">Yes</td><td class="y">Yes</td><td class="y">Yes</td><td class="n">No</td></tr>
          <tr><th>Multi-entity consolidation</th><td class="col-paisa y">Yes</td><td class="y">Yes</td><td class="y">Yes</td><td class="n">Limited</td></tr>
          <tr><th>Local tax inside the entry</th><td class="col-paisa y">India today</td><td class="n">Tax module</td><td class="n">Tax module</td><td class="y">India</td></tr>
          <tr><th>Close tasks that run checks</th><td class="col-paisa y">Executable</td><td class="n">Task lists</td><td class="n">Task lists</td><td class="n">No</td></tr>
          <tr><th>Closed period is unpostable</th><td class="col-paisa y">Enforced</td><td class="y">Yes</td><td class="y">Yes</td><td class="n">Convention</td></tr>
          <tr><th>AI answers gated by a verifier</th><td class="col-paisa y">Yes</td><td class="n">—</td><td class="n">—</td><td class="n">—</td></tr>
          <tr><th>Continuous exception agents</th><td class="col-paisa y">Yes</td><td class="n">—</td><td class="n">—</td><td class="n">—</td></tr>
          <tr><th>Production deployments</th><td class="col-paisa n">Not yet</td><td class="y">Decades</td><td class="y">Decades</td><td class="y">Millions</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- ---------------- CTA ---------------- -->
<section class="cta">
  <div class="wrap">
    <h2>See a close that will not let you lie to yourself.</h2>
    <p class="lede on-dark">The demo runs on a seeded company with June still open — two real blockers
      waiting, agents holding proposals, and every number computed by the engines.</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="/erp">Open the ERP console</a>
      <a class="btn btn-dark" href="/">Try the AI CFO</a>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div class="fgrid">
      <div>
        <div class="logo" style="margin-bottom:12px"><span class="logo-mark">P</span>paisa</div>
        <p style="max-width:290px;line-height:1.55">The AI-native ERP for finance teams.
          A perpetual ledger, a close that proves itself, and an AI that cannot invent a number.</p>
      </div>
      <div><h5>Platform</h5><ul>
        <li><a href="#platform">General ledger</a></li>
        <li><a href="#platform">Revenue recognition</a></li>
        <li><a href="#close">Close management</a></li>
        <li><a href="#platform">Multi-entity</a></li>
      </ul></div>
      <div><h5>Product</h5><ul>
        <li><a href="/">AI CFO dashboard</a></li>
        <li><a href="/erp">ERP console</a></li>
        <li><a href="/trial-balance">Trial balance</a></li>
        <li><a href="/audit">Audit trail</a></li>
      </ul></div>
      <div><h5>Engine</h5><ul>
        <li><a href="/journal">Journal</a></li>
        <li><a href="/balance-sheet">Balance sheet</a></li>
        <li><a href="/profit-and-loss">Profit &amp; loss</a></li>
      </ul></div>
    </div>

    <div class="honest">
      <b style="color:var(--night-ink)">What this page does not claim.</b>
      Paisa has no customers, testimonials, G2 rating or SOC certification yet, so none are shown here.
      Data is in-memory and resets on restart; persistence is the next milestone. Named integrations
      are roadmap — the idempotent ingestion layer they plug into is built and tested.
    </div>

    <div class="fbottom">
      <span>© 2026 Paisa</span>
      <span>Every figure on this site comes from the demo company's own ledger.</span>
    </div>
  </div>
</footer>

</body>
</html>`;
