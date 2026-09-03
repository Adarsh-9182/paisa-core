/**
 * Paisa — the public site.
 *
 * Served at /site so the app (/) and the ERP console (/erp) are untouched.
 * Every capability named here maps to a module that exists in src/erp/;
 * there are no customer logos, testimonials or certifications, because we
 * do not have them yet and inventing them would be the one thing a finance
 * product can never come back from.
 */

import { nav, footer, SHELL_JS, head } from "./site/shell.js";
import { homeJsonLd } from "./site/seo.js";

export const sitePage = () => head({
  title: "Paisa — The AI-native ERP for finance teams",
  description:
    "Perpetual general ledger, ASC 606 revenue recognition, multi-entity consolidation and a close that runs itself. With an AI CFO that cannot invent a number.",
  path: "/",
  jsonLd: homeJsonLd(),
  extraCss: `
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
               display:grid; place-items:center; font-size:16px; font-weight:700; }
  .navlinks { display:flex; gap:3px; margin-left:6px; font-size:14px; font-weight:500; }
  .navlinks a:hover { color:var(--night-ink); }
  .navitem { position:relative; }
  .navitem > a, .navitem > button { display:flex; align-items:center; gap:5px; padding:8px 11px;
    border-radius:9px; color:var(--night-ink-2); background:none; border:0; font:inherit;
    font-weight:500; cursor:pointer; }
  .navitem > a:hover, .navitem > button:hover, .navitem.open > button { color:var(--night-ink); background:var(--night-2); }
  .navitem .chev { width:8px; height:8px; border-right:1.4px solid currentColor;
    border-bottom:1.4px solid currentColor; transform:rotate(45deg) translate(-2px,-2px);
    transition:transform .2s ease; }
  .navitem.open .chev { transform:rotate(-135deg) translate(-3px,-3px); }
  .mega { position:absolute; top:calc(100% + 9px); left:-8px; background:var(--night-2);
    border:1px solid var(--night-line); border-radius:15px; padding:16px; min-width:320px;
    opacity:0; visibility:hidden; transform:translateY(-6px);
    transition:opacity .18s ease, transform .18s ease, visibility .18s;
    box-shadow:0 22px 50px -22px rgba(0,0,0,.75); }
  .navitem.open .mega { opacity:1; visibility:visible; transform:none; }
  .mega.wide { min-width:640px; display:grid; grid-template-columns:1fr 1fr; gap:4px 20px; }
  .mega-group { font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    color:var(--night-ink-2); opacity:.7; padding:9px 10px 5px; grid-column:1/-1; }
  .mega-group.half { grid-column:auto; }
  .mega a { display:block; padding:8px 10px; border-radius:9px; color:var(--night-ink); }
  .mega a:hover { background:rgba(242,107,29,.12); }
  .mega a b { display:block; font-weight:600; font-size:13.5px; }
  .mega a span { display:block; font-size:12px; color:var(--night-ink-2); margin-top:1px; }
  .navcta { margin-left:auto; display:flex; gap:9px; align-items:center; }
  @media (max-width:1040px){ .navlinks{display:none;} }

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
  .quote { position:relative; margin-top:38px; padding:26px 28px 24px 60px;
           background:var(--night-2); border:1px solid var(--night-line); border-radius:14px; }
  .quote::before { content:"“"; position:absolute; left:20px; top:8px; font-size:52px; line-height:1;
           font-family:Georgia,"Times New Roman",serif; color:var(--orange); opacity:.55; }
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

  /* ---------- motion ---------- */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration:.001ms !important; animation-iteration-count:1 !important;
                             transition-duration:.001ms !important; }
    #fx { display:none; }
  }

  /* the ledger canvas sits behind the hero content */
  /* masked so the field dissolves toward the headline rather than stopping
     at a hard edge */
  #fx { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0; opacity:.9;
        -webkit-mask-image:linear-gradient(90deg, transparent 52%, #000 72%);
        mask-image:linear-gradient(90deg, transparent 52%, #000 72%); }
  .hero .wrap { position:relative; z-index:2; }
  .hero::after { z-index:1; }

  /* a glow that follows the cursor */
  .glow { position:absolute; width:520px; height:520px; border-radius:50%; pointer-events:none;
          z-index:1; opacity:0; transition:opacity .6s ease;
          background:radial-gradient(closest-side, rgba(242,107,29,.13), transparent 70%);
          transform:translate(-50%,-50%); }
  .hero:hover .glow { opacity:1; }

  /* headline words rise in */
  .rise > span { display:inline-block; opacity:0; transform:translateY(1.05em) rotate(2deg);
                 animation:rise .78s cubic-bezier(.19,1,.22,1) forwards; }
  @keyframes rise { to { opacity:1; transform:none; } }

  .fade-up { opacity:0; transform:translateY(14px); animation:fadeUp .7s cubic-bezier(.19,1,.22,1) forwards; }
  @keyframes fadeUp { to { opacity:1; transform:none; } }

  /* the close checklist types itself in */
  .crow { opacity:0; transform:translateX(-8px); }
  .crow.in { animation:slideIn .5s cubic-bezier(.19,1,.22,1) forwards; }
  @keyframes slideIn { to { opacity:1; transform:none; } }
  .cmark { position:relative; overflow:hidden; }
  .cmark::after { content:""; position:absolute; inset:0; border-radius:50%;
                  box-shadow:0 0 0 0 currentColor; opacity:.5; }
  .crow.in .cmark::after { animation:ping .8s ease-out .1s; }
  @keyframes ping { to { box-shadow:0 0 0 9px currentColor; opacity:0; } }
  .cmark.pending { background:rgba(167,156,141,.18); color:var(--night-ink-2); }
  .spin { display:inline-block; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  /* the number ticker */
  .ticker { border-top:1px solid var(--night-line); border-bottom:1px solid var(--night-line);
            background:var(--night); overflow:hidden; padding:11px 0; }
  .ticker-track { display:flex; gap:34px; width:max-content; animation:slide 46s linear infinite; }
  .ticker:hover .ticker-track { animation-play-state:paused; }
  @keyframes slide { to { transform:translateX(-50%); } }
  .tick { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--night-ink-2);
          white-space:nowrap; font-variant-numeric:tabular-nums; }
  .tick b { color:var(--night-ink); font-weight:600; }
  .tick .up { color:#4ADE9E; } .tick .down { color:#F87171; }
  .tick .dot-sep { width:3px; height:3px; border-radius:50%; background:var(--night-line); }

  /* strip counters */
  .strip .n { font-variant-numeric:tabular-nums; }

  /* cards reveal on scroll */
  .reveal { opacity:0; transform:translateY(18px); transition:opacity .65s cubic-bezier(.19,1,.22,1),
            transform .65s cubic-bezier(.19,1,.22,1); }
  .reveal.shown { opacity:1; transform:none; }
  .card { transition:transform .3s cubic-bezier(.19,1,.22,1), box-shadow .3s ease, border-color .3s ease; }
  .card:hover { transform:translateY(-3px); border-color:var(--line-2);
                box-shadow:0 10px 30px -14px rgba(31,27,22,.22); }
  .ai .card:hover, .cta .card:hover { box-shadow:0 10px 34px -14px rgba(0,0,0,.6); }

  /* flow steps draw a connecting line */
  .flow { position:relative; }
  .step { position:relative; }
  .step::after { content:""; position:absolute; top:50%; right:-12px; width:12px; height:1px;
                 background:var(--night-line); }
  .step:last-child::after { display:none; }
  @media (max-width:820px){ .step::after { display:none; } }
  .step .s { position:relative; }

  /* the verifier demo */
  .verify { margin-top:38px; background:var(--night-2); border:1px solid var(--night-line);
            border-radius:16px; overflow:hidden; }
  .verify-head { padding:11px 16px; border-bottom:1px solid var(--night-line); font-size:12.5px;
                 color:var(--night-ink-2); display:flex; align-items:center; gap:9px; }
  .verify-body { padding:18px 20px; font-size:14px; line-height:1.75; min-height:132px; }
  .vfig { padding:1px 5px; border-radius:5px; font-variant-numeric:tabular-nums;
          transition:background .4s ease, color .4s ease, box-shadow .4s ease; }
  .vfig.checking { background:rgba(242,107,29,.16); color:var(--orange); }
  .vfig.pass { background:rgba(11,122,86,.2); color:#4ADE9E; }
  .vfig.fail { background:rgba(192,57,43,.22); color:#F87171;
               box-shadow:0 0 0 1px rgba(192,57,43,.5); }
  .vstatus { padding:11px 20px; border-top:1px solid var(--night-line); font-size:12.5px;
             display:flex; align-items:center; gap:8px; min-height:42px; }
  .cursor { display:inline-block; width:7px; height:1.05em; background:var(--orange);
            vertical-align:-2px; animation:blink 1s steps(2) infinite; }
  @keyframes blink { 50% { opacity:0; } }

  /* logo mark spins its coin edge on hover */
  .logo-mark { transition:transform .5s cubic-bezier(.19,1,.22,1); }
  .logo:hover .logo-mark { transform:rotateY(180deg); }

  /* scroll progress */
  .progress { position:fixed; top:0; left:0; height:2px; width:0%; background:var(--orange);
              z-index:60; transition:width .1s linear; }

  /* nav condenses once you leave the hero */
  nav.top { transition:height .25s ease, background .25s ease, border-color .25s ease; }
  nav.top .inner { transition:height .25s ease; }
  nav.top.stuck .inner { height:54px; }
  nav.top.stuck { background:rgba(22,19,15,.95); box-shadow:0 1px 0 var(--night-line); }

  /* mobile menu */
  .menu-btn { display:none; background:none; border:1px solid var(--night-line); border-radius:9px;
              width:36px; height:32px; cursor:pointer; padding:0; position:relative; }
  .menu-btn span { position:absolute; left:9px; right:9px; height:1.5px; background:var(--night-ink);
                   transition:transform .25s ease, opacity .2s ease; }
  .menu-btn span:nth-child(1){ top:11px; } .menu-btn span:nth-child(2){ top:16px; }
  .menu-btn span:nth-child(3){ top:21px; }
  .menu-btn.open span:nth-child(1){ transform:translateY(5px) rotate(45deg); }
  .menu-btn.open span:nth-child(2){ opacity:0; }
  .menu-btn.open span:nth-child(3){ transform:translateY(-5px) rotate(-45deg); }
  .drawer { display:none; flex-direction:column; gap:2px; padding:10px 24px 18px;
            border-top:1px solid var(--night-line); background:var(--night); }
  .drawer a { padding:10px 2px; color:var(--night-ink-2); font-weight:550; }
  .drawer a:hover { color:var(--night-ink); }
  .drawer.open { display:flex; }
  /* the AI CFO is the only nav CTA, so it stays on every width */
  @media (max-width:1040px){ .menu-btn { display:block; } }

  /* buttons lift, and the primary one sweeps */
  .btn { position:relative; overflow:hidden; }
  .btn-primary::before { content:""; position:absolute; inset:0; transform:translateX(-101%);
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent); }
  .btn-primary:hover::before { animation:sweep .7s ease; }
  @keyframes sweep { to { transform:translateX(101%); } }
  .btn:active { transform:translateY(1px); }

  /* section headings reveal too */
  .head { opacity:0; transform:translateY(16px);
          transition:opacity .7s cubic-bezier(.19,1,.22,1), transform .7s cubic-bezier(.19,1,.22,1); }
  .head.shown { opacity:1; transform:none; }
  .hero .head, header .head { opacity:1; transform:none; }

  /* the eyebrow gets a rule that draws itself */
  .eyebrow { display:flex; align-items:center; gap:11px; }
  .eyebrow::after { content:""; height:1px; background:currentColor; opacity:.32; width:0;
                    transition:width .9s cubic-bezier(.19,1,.22,1) .15s; }
  .head.shown .eyebrow::after { width:62px; }
  .hero .eyebrow::after { width:62px; }

  /* comparison rows respond */
  tbody tr { transition:background .18s ease; }
  tbody tr:hover { background:#FBF7F1; }
  tbody tr:hover .col-paisa { background:#FBE2CE; }

  /* scroll hint under the hero cta */
  .hint { display:inline-flex; align-items:center; gap:7px; margin-top:26px; font-size:12.5px;
          color:var(--night-ink-2); }
  .hint i { display:block; width:1px; height:22px; background:linear-gradient(var(--orange),transparent);
            animation:drop 1.8s ease-in-out infinite; }
  @keyframes drop { 0%,100%{ transform:scaleY(.4); opacity:.4; transform-origin:top; }
                    50%{ transform:scaleY(1); opacity:1; transform-origin:top; } }

  /* strip values count too */
  .strip .n { transition:color .3s ease; }
  .strip .inner > div:hover .n { color:var(--night-ink); }
`,
}) + `
${nav()}

<!-- ---------------- HERO ---------------- -->
<header class="hero">
  <canvas id="fx" aria-hidden="true"></canvas>
  <div class="glow" id="glow" aria-hidden="true"></div>
  <div class="wrap">
    <div class="inner">
      <div class="eyebrow on-dark">AI-native ERP · Multi-entity · Multi-currency</div>
      <h1 class="rise" id="headline">Close the month in a day.<br>Trust <em>every number</em> in it.</h1>
      <p class="lede fade-up" style="animation-delay:.75s">Paisa is a perpetual general ledger with ASC 606 revenue recognition, multi-entity
        consolidation, and a close that runs itself. Its AI CFO answers in plain language — and is
        structurally incapable of inventing a figure.</p>
      <div class="hero-cta fade-up" style="animation-delay:.88s">
        <a class="btn btn-primary" href="/site/contact">Book a demo</a>
        <a class="btn btn-dark" href="/login">Sign in</a>
      </div>
      <div class="hero-note fade-up" style="animation-delay:1s">Your ledger is only ever visible to your team — the console is behind sign-in.</div>
      <div class="hint fade-up" style="animation-delay:1.15s"><i></i> watch the close resolve itself</div>
    </div>

    <div class="console fade-up" style="animation-delay:1.05s">
      <div class="console-bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="console-title">Month-end close · June 2026 · Nimbus Labs Pvt Ltd</span>
      </div>
      <div class="console-body" id="checklist">
        <div class="crow" data-final="ok"><div class="cmark pending">·</div><div>
          <div class="cname">Subledgers frozen for the period</div>
          <div class="cdetail">Period 2026-06 is SOFT_CLOSED</div></div></div>
        <div class="crow" data-final="no"><div class="cmark pending">·</div><div>
          <div class="cname">Bank reconciliations completed</div>
          <div class="cdetail cblockslot"></div></div></div>
        <div class="crow" data-final="ok"><div class="cmark pending">·</div><div>
          <div class="cname">Revenue recognition posted</div>
          <div class="cdetail">Recognised <span class="count" data-to="417945.21">₹0.00</span> across 3 performance obligations</div></div></div>
        <div class="crow" data-final="ok"><div class="cmark pending">·</div><div>
          <div class="cname">AR subledger ties to the control account</div>
          <div class="cdetail">Accounts Receivable <span class="count" data-to="3693400">₹0.00</span> agrees with the general ledger</div></div></div>
        <div class="crow" data-final="ok"><div class="cmark pending">·</div><div>
          <div class="cname">Deferred revenue roll-forward ties to the ledger</div>
          <div class="cdetail">opening + billed − recognised = closing, checked against the GL</div></div></div>
        <div class="crow" data-final="no"><div class="cmark pending">·</div><div>
          <div class="cname">Material P&amp;L movements explained</div>
          <div class="cdetail cblockslot"></div></div></div>
      </div>
    </div>
  </div>
</header>

<div class="ticker" aria-hidden="true"><div class="ticker-track" id="ticker"></div></div>

<div class="strip">
  <div class="wrap inner">
    <div><div class="n" data-count="0" data-suffix="">Zero</div><div class="l">figures the AI can state that no engine produced</div></div>
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
      <p>The LLM is never the source of financial truth.</p>
      <span>The rule the orchestrator enforces in code — not a guideline in a prompt.</span>
    </div>


    <div class="verify" id="verify">
      <div class="verify-head">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span style="margin-left:6px">Asked: “How much revenue did we recognise in June, and what is left on the contract?”</span>
      </div>
      <div class="verify-body" id="verify-body"></div>
      <div class="vstatus" id="verify-status"></div>
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
    <p class="lede on-dark">We will walk you through a seeded company with June still open — two real
      blockers waiting, agents holding proposals, and every number computed by the engines.</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="/site/contact">Book a demo</a>
      <a class="btn btn-dark" href="/login">Sign in</a>
    </div>
  </div>
</section>

${footer()}

${SHELL_JS}
<script>
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================================================================
     The ledger field.

     Not floating coins — a double-entry ledger. Debits fall on the left,
     credits on the right, and each pair drifts toward the centre line
     where it settles and balances. It is the product's one idea, moving.
     ================================================================ */
  const canvas = document.getElementById("fx");
  if (canvas && !reduced) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    // ₹ leads — the others are the multi-currency note, not an equal chorus
    const GLYPHS = ["₹", "₹", "₹", "₹", "$", "€", "£", "¥"];
    // The entries fall through the right of the hero only, so the headline
    // column stays clean and the empty half earns its space.
    const FIELD_START = 0.58;
    const fieldMid = () => w * (FIELD_START + (1 - FIELD_START) / 2);
    const fieldWidth = () => w * (1 - FIELD_START);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // A pair is one journal entry: a debit and its matching credit.
    const pairs = [];
    const makePair = (seed) => {
      const y = seed === undefined ? -40 - Math.random() * h : Math.random() * h;
      const depth = 0.35 + Math.random() * 0.65;      // parallax layer
      return {
        y,
        depth,
        speed: (0.16 + Math.random() * 0.34) * depth,
        spread: (0.16 + Math.random() * 0.3),          // how far apart the sides start
        settle: 0,                                     // 0 = apart, 1 = met in the middle
        settleAt: 0.42 + Math.random() * 0.3,          // where down the page they meet
        amount: (Math.random() * 900000 + 1000),
        glyph: GLYPHS[(Math.random() * GLYPHS.length) | 0],
        hue: Math.random() < 0.18,                     // a few carry the accent colour
      };
    };
    // 11, not 26: enough to read as a ledger in motion, few enough that two
    // entries rarely collide.
    for (let i = 0; i < 11; i++) pairs.push(makePair(i));

    const fmt = (n) => {
      const r = Math.round(n);
      const s = String(r);
      if (s.length <= 3) return s;
      const head = s.slice(0, -3), tail = s.slice(-3);
      return head.replace(/\\B(?=(\\d{2})+(?!\\d))/g, ",") + "," + tail;
    };

    let raf = 0, running = true;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const mid = fieldMid();

      for (const p of pairs) {
        p.y += p.speed * 1.5;
        const progress = p.y / h;
        // ease the two sides together as the entry falls past its settle point
        const t = Math.max(0, Math.min(1, (progress - p.settleAt) / 0.26));
        p.settle = t * t * (3 - 2 * t);                // smoothstep

        if (p.y > h + 60) { Object.assign(p, makePair()); p.y = -40; continue; }

        const gap = fieldWidth() * p.spread * (1 - p.settle);
        // fade in at the top as well as out at the bottom, so nothing pops
        const enter = Math.min(1, Math.max(0, progress / 0.12));
        const alpha = (0.04 + p.depth * 0.11) * enter * (1 - Math.max(0, progress - 0.82) / 0.18);
        const size = 9 + p.depth * 6;

        ctx.font = size + "px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";

        const accent = p.hue ? "242,107,29" : "245,240,232";
        // debit (left) and credit (right)
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(" + accent + "," + alpha + ")";
        ctx.fillText(p.glyph + fmt(p.amount), mid - gap - 10, p.y);
        ctx.textAlign = "left";
        ctx.fillText(p.glyph + fmt(p.amount), mid + gap + 10, p.y);

        // when they meet, a hairline joins them — the entry balances
        if (p.settle > 0.55) {
          const a = (p.settle - 0.55) / 0.45 * alpha * 1.6;
          ctx.strokeStyle = "rgba(242,107,29," + a + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(mid - gap - 6, p.y);
          ctx.lineTo(mid + gap + 6, p.y);
          ctx.stroke();
        }
      }
      if (running) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    // stop painting when the hero is off screen — no work nobody can see
    new IntersectionObserver(([e]) => {
      running = e.isIntersecting;
      if (running) raf = requestAnimationFrame(draw); else cancelAnimationFrame(raf);
    }, { threshold: 0 }).observe(canvas);
    raf = requestAnimationFrame(draw);
  }


  /* ---------------- scroll progress + sticky nav ---------------- */
  const progress = document.getElementById("progress");
  const navEl = document.getElementById("nav");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    if (navEl) navEl.classList.toggle("stuck", window.scrollY > 80);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------------- section headings reveal ---------------- */
  const headIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("shown");
      headIo.unobserve(e.target);
    });
  }, { threshold: 0.25 });
  document.querySelectorAll("section .head").forEach((el) => headIo.observe(el));

  /* ---------------- cursor glow ---------------- */
  const hero = document.querySelector(".hero");
  const glow = document.getElementById("glow");
  if (hero && glow && !reduced) {
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      glow.style.left = (e.clientX - r.left) + "px";
      glow.style.top = (e.clientY - r.top) + "px";
    });
  }

  /* ---------------- headline, word by word ---------------- */
  const headline = document.getElementById("headline");
  if (headline) {
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const word of child.textContent.split(/(\\s+)/)) {
            if (!word.trim()) { frag.appendChild(document.createTextNode(word)); continue; }
            const span = document.createElement("span");
            span.textContent = word;
            frag.appendChild(span);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          walk(child);
        }
      }
    };
    walk(headline);
    headline.querySelectorAll("span").forEach((el, i) => {
      el.style.animationDelay = (0.06 * i) + "s";
    });
  }

  /* ---------------- number counters ---------------- */
  const inr = (n) => {
    const neg = n < 0; n = Math.abs(n);
    const r = n.toFixed(2), [i, f] = r.split(".");
    let g = i;
    if (i.length > 3) {
      const head = i.slice(0, -3), tail = i.slice(-3);
      g = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
    }
    return (neg ? "-" : "") + "₹" + g + "." + f;
  };
  const countUp = (el) => {
    const to = parseFloat(el.dataset.to);
    if (reduced) { el.textContent = inr(to); return; }
    const dur = 1100, start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = inr(to * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ---------------- the close checklist resolves itself ---------------- */
  const checklist = document.getElementById("checklist");
  if (checklist) {
    const rows = [...checklist.querySelectorAll(".crow")];
    const blockers = {
      1: "↳ Bank has no completed reconciliation as of 2026-06-30",
      5: "↳ Services moved ₹2,80,000.00 vs prior period and has no explanation",
    };
    rows.forEach((row, i) => {
      const delay = reduced ? 0 : 1250 + i * 260;
      setTimeout(() => {
        row.classList.add("in");
        const mark = row.querySelector(".cmark");
        mark.innerHTML = '<span class="spin">◠</span>';
        setTimeout(() => {
          const ok = row.dataset.final === "ok";
          mark.classList.remove("pending");
          mark.classList.add(ok ? "ok" : "no");
          mark.textContent = ok ? "✓" : "✕";
          if (!ok) {
            const slot = row.querySelector(".cblockslot");
            if (slot) { slot.className = "cblock"; slot.textContent = blockers[i] || ""; }
          }
          row.querySelectorAll(".count").forEach(countUp);
        }, reduced ? 0 : 420);
      }, delay);
    });
  }

  /* ---------------- the ticker ---------------- */
  const ticker = document.getElementById("ticker");
  if (ticker) {
    const items = [
      ["MRR", "₹4,20,000.00", "up", "+12.4%"],
      ["ARR", "₹50,40,000.00", "up", "+12.4%"],
      ["Backlog / RPO", "₹28,18,356.16", "", ""],
      ["Deferred revenue", "₹0.00", "", "ties to GL"],
      ["Unbilled receivable", "₹1,81,643.84", "", ""],
      ["AR", "₹36,93,400.00", "", "ties to GL"],
      ["AP", "₹1,41,600.00", "", ""],
      ["NRR", "100.0%", "", "since Mar"],
      ["Close tasks passed", "9 / 11", "down", "2 blocked"],
      ["Trial balance", "balanced", "up", ""],
      ["Journal entries", "129", "", "append-only"],
      ["Audit events", "47", "", ""],
    ];
    const row = items.map(([label, value, dir, note]) =>
      '<span class="tick">' + label + ' <b>' + value + '</b>' +
      (note ? ' <span class="' + (dir || "") + '">' + note + '</span>' : '') +
      '</span><span class="tick dot-sep"></span>'
    ).join("");
    ticker.innerHTML = row + row; // duplicated so the loop is seamless
  }


  /* ---------------- the verifier, demonstrated ----------------
     The draft answer types out. Each figure is then checked against the
     tool results one at a time. Two came from tools; one did not, and the
     whole answer is rejected — which is what actually happens in the
     orchestrator, not a dramatisation of it. */
  const vbody = document.getElementById("verify-body");
  const vstatus = document.getElementById("verify-status");
  if (vbody && vstatus) {
    const parts = [
      { t: "You recognised " },
      { t: "₹4,17,945.21", fig: true, ok: true },
      { t: " of subscription revenue in June, leaving " },
      { t: "₹28,18,356.16", fig: true, ok: true },
      { t: " of contracted revenue still to be earned — about " },
      { t: "6.7 months", fig: true, ok: false },
      { t: " at the current run rate." },
    ];
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      vbody.innerHTML = "";
      vstatus.innerHTML = '<span style="color:var(--night-ink-2)">Drafting…</span>';
      const nodes = [];
      let i = 0;

      const typeNext = () => {
        if (i >= parts.length) return void setTimeout(check, 420);
        const part = parts[i++];
        const el = document.createElement("span");
        if (part.fig) { el.className = "vfig"; nodes.push({ el, ok: part.ok }); }
        vbody.appendChild(el);
        if (reduced) { el.textContent = part.t; typeNext(); return; }
        let c = 0;
        const cur = document.createElement("span");
        cur.className = "cursor";
        vbody.appendChild(cur);
        const step = () => {
          el.textContent = part.t.slice(0, ++c);
          if (c < part.t.length) setTimeout(step, 14);
          else { cur.remove(); typeNext(); }
        };
        step();
      };

      const check = () => {
        let n = 0;
        const one = () => {
          if (n >= nodes.length) return void verdict();
          const { el, ok } = nodes[n++];
          el.className = "vfig checking";
          vstatus.innerHTML = '<span style="color:var(--orange)">Checking ' + el.textContent +
            ' against tool results…</span>';
          setTimeout(() => {
            el.className = "vfig " + (ok ? "pass" : "fail");
            setTimeout(one, ok ? 260 : 520);
          }, reduced ? 0 : 620);
        };
        one();
      };

      const verdict = () => {
        vstatus.innerHTML =
          '<span style="color:#F87171;font-weight:600">✕ Rejected</span>' +
          '<span style="color:var(--night-ink-2)">“6.7 months” came from no tool — the model divided it ' +
          'itself. The answer never reaches the screen; it is sent back to be rewritten.</span>';
        setTimeout(() => { started = false; run(); }, 7000);
      };

      typeNext();
    };
    new IntersectionObserver(([e]) => { if (e.isIntersecting) run(); }, { threshold: 0.3 })
      .observe(vbody);
  }

  /* ---------------- scroll reveals ---------------- */
  const targets = document.querySelectorAll("section .card, .tablewrap, .chips, .flow, .quote, .verify");
  targets.forEach((el) => el.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const siblings = [...(e.target.parentElement?.children || [])];
      const i = Math.max(0, siblings.indexOf(e.target));
      e.target.style.transitionDelay = Math.min(i * 55, 330) + "ms";
      e.target.classList.add("shown");
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  targets.forEach((el) => io.observe(el));
})();
</script>

</body>
</html>`;
