/**
 * The site shell — design tokens, nav and footer.
 *
 * Both the homepage and every sub-page render through this, so the
 * navigation cannot drift between them. Adding a product page adds it to
 * the menu automatically, because the menu is built from the content.
 */

import { PRODUCTS, SOLUTIONS, COMPARISONS, PRODUCT_GROUPS, SOLUTION_GROUPS } from "./content.js";

export const TOKENS = `
  :root {
    --bg:#FAF7F2; --surface:#FFFFFF; --line:#EDE7DD; --line-2:#E2DACD;
    --ink:#1F1B16; --ink-2:#6B6459; --ink-3:#9C948A;
    --orange:#F26B1D; --orange-soft:#FDEEE3; --orange-deep:#C24E08;
    --green:#0B7A56; --green-soft:#E3F3EC; --amber:#B45309; --amber-soft:#FDF3E3;
    --red:#C0392B; --red-soft:#FBEAE8;
    --night:#16130F; --night-2:#221D17; --night-line:#332B22;
    --night-ink:#F5F0E8; --night-ink-2:#A79C8D;
    --radius:16px; --wrap:1120px;
  }
  * { box-sizing:border-box; margin:0; }
  html { scroll-behavior:smooth; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
         background:var(--bg); color:var(--ink); font-size:15px; line-height:1.6;
         -webkit-font-smoothing:antialiased; }
  a { color:inherit; text-decoration:none; }
  .wrap { max-width:var(--wrap); margin:0 auto; padding:0 24px; }
  h1 { font-size:clamp(32px,4.6vw,54px); line-height:1.07; letter-spacing:-.032em; font-weight:700; }
  h2 { font-size:clamp(25px,3.2vw,36px); line-height:1.15; letter-spacing:-.026em; font-weight:700; }
  h3 { font-size:17px; letter-spacing:-.012em; font-weight:650; }
  .lede { font-size:clamp(16px,1.7vw,19px); color:var(--ink-2); line-height:1.55; }
  .lede.on-dark { color:var(--night-ink-2); }
  section { padding:82px 0; }
  .eyebrow { display:flex; align-items:center; gap:11px; font-size:11.5px; font-weight:700;
             letter-spacing:.12em; text-transform:uppercase; color:var(--orange-deep); margin-bottom:14px; }
  .eyebrow.on-dark { color:var(--orange); }
  .eyebrow::after { content:""; height:1px; background:currentColor; opacity:.32; width:62px; }
  .btn { display:inline-flex; align-items:center; gap:7px; padding:11px 20px; border-radius:11px;
         font-weight:650; font-size:14.5px; border:1px solid transparent; cursor:pointer;
         font-family:inherit; position:relative; overflow:hidden;
         transition:background .15s,border-color .15s,transform .1s; }
  .btn-primary { background:var(--orange); color:#fff; }
  .btn-primary:hover { background:var(--orange-deep); }
  .btn-ghost { border-color:var(--line-2); color:var(--ink); background:var(--surface); }
  .btn-ghost:hover { background:#F4EFE7; }
  .btn-dark { border-color:var(--night-line); color:var(--night-ink); background:transparent; }
  .btn-dark:hover { background:var(--night-2); }
  .btn:active { transform:translateY(1px); }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);
          padding:22px 22px 24px;
          transition:transform .3s cubic-bezier(.19,1,.22,1), box-shadow .3s ease, border-color .3s ease; }
  .card:hover { transform:translateY(-3px); border-color:var(--line-2);
                box-shadow:0 10px 30px -14px rgba(31,27,22,.22); }
  .card h3 { margin-bottom:7px; }
  .card p { color:var(--ink-2); font-size:14px; line-height:1.58; }
  .grid { display:grid; gap:16px; }
  .g3 { grid-template-columns:repeat(3,1fr); }
  .g2 { grid-template-columns:repeat(2,1fr); }
  @media (max-width:900px){ .g3{grid-template-columns:1fr 1fr;} }
  @media (max-width:640px){ .g3,.g2{grid-template-columns:1fr;} }
  .progress { position:fixed; top:0; left:0; height:2px; width:0%; background:var(--orange); z-index:60; }

  /* ---------- nav ---------- */
  nav.top { position:sticky; top:0; z-index:50; background:rgba(22,19,15,.88);
            backdrop-filter:saturate(160%) blur(12px); border-bottom:1px solid var(--night-line);
            transition:background .25s ease; }
  nav.top.stuck { background:rgba(22,19,15,.96); }
  nav.top .inner { display:flex; align-items:center; gap:22px; height:62px; }
  .logo { display:flex; align-items:center; gap:9px; font-weight:700; font-size:17.5px;
          letter-spacing:-.02em; color:var(--night-ink); }
  .logo-mark { width:27px; height:27px; border-radius:8px; background:var(--orange); color:#fff;
               display:grid; place-items:center; font-size:15px; font-weight:700;
               transition:transform .5s cubic-bezier(.19,1,.22,1); }
  .logo:hover .logo-mark { transform:rotateY(180deg); }
  .navlinks { display:flex; gap:3px; margin-left:4px; font-size:14px; font-weight:500; }
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
  .menu-btn { display:none; background:none; border:1px solid var(--night-line); border-radius:9px;
    width:36px; height:32px; cursor:pointer; padding:0; position:relative; }
  .menu-btn span { position:absolute; left:9px; right:9px; height:1.5px; background:var(--night-ink);
    transition:transform .25s ease, opacity .2s ease; }
  .menu-btn span:nth-child(1){ top:11px; } .menu-btn span:nth-child(2){ top:16px; }
  .menu-btn span:nth-child(3){ top:21px; }
  .menu-btn.open span:nth-child(1){ transform:translateY(5px) rotate(45deg); }
  .menu-btn.open span:nth-child(2){ opacity:0; }
  .menu-btn.open span:nth-child(3){ transform:translateY(-5px) rotate(-45deg); }
  .drawer { display:none; flex-direction:column; padding:10px 24px 20px; max-height:76vh;
    overflow:auto; border-top:1px solid var(--night-line); background:var(--night); }
  .drawer.open { display:flex; }
  .drawer h6 { font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
    color:var(--night-ink-2); margin:14px 0 4px; }
  .drawer a { padding:8px 2px; color:var(--night-ink-2); font-weight:550; }
  .drawer a:hover { color:var(--night-ink); }
  @media (max-width:1040px){ .navlinks { display:none; } .menu-btn { display:block; }
                             .navcta .btn-dark { display:none; } }

  /* ---------- footer ---------- */
  footer { background:var(--night); color:var(--night-ink-2); border-top:1px solid var(--night-line);
           padding:54px 0 40px; font-size:13.5px; }
  .fgrid { display:grid; grid-template-columns:1.7fr repeat(4,1fr); gap:26px; }
  @media (max-width:920px){ .fgrid{grid-template-columns:1fr 1fr 1fr;} }
  @media (max-width:600px){ .fgrid{grid-template-columns:1fr 1fr;} }
  footer h5 { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--night-ink);
              font-weight:700; margin-bottom:11px; }
  footer li { list-style:none; margin-bottom:7px; }
  footer a:hover { color:var(--night-ink); }
  .honest { border:1px solid var(--night-line); border-radius:12px; padding:14px 16px;
            margin-top:26px; font-size:12.5px; line-height:1.55; }
  .fbottom { margin-top:26px; padding-top:20px; border-top:1px solid var(--night-line);
             display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; font-size:12.5px; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration:.001ms !important; animation-iteration-count:1 !important;
                             transition-duration:.001ms !important; }
  }
`;

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23F26B1D'/%3E%3Ctext x='16' y='23' font-family='-apple-system,sans-serif' font-size='20' font-weight='700' fill='white' text-anchor='middle'%3EP%3C/text%3E%3C/svg%3E";

export const head = ({ title, description, extraCss = "" }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#16130F">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${FAVICON}">
<style>${TOKENS}${extraCss}</style>
</head>
<body>
<div class="progress" id="progress"></div>`;

const megaLink = (href, name, blurb) =>
  `<a href="${href}"><b>${name}</b><span>${blurb}</span></a>`;

const productMega = () => {
  let out = "";
  for (const g of PRODUCT_GROUPS) {
    const items = PRODUCTS.filter((p) => p.group === g);
    if (!items.length) continue;
    out += `<div class="mega-group">${g}</div>`;
    out += items.map((p) => megaLink(`/site/product/${p.slug}`, p.name, p.navBlurb)).join("");
  }
  return `<div class="mega wide">${out}</div>`;
};

const solutionMega = () => {
  let out = "";
  for (const g of SOLUTION_GROUPS) {
    const items = SOLUTIONS.filter((s) => s.group === g);
    if (!items.length) continue;
    out += `<div class="mega-group">${g}</div>`;
    out += items.map((s) => megaLink(`/site/solution/${s.slug}`, s.name, "")).join("");
  }
  return `<div class="mega">${out}</div>`;
};

const compareMega = () =>
  `<div class="mega">${COMPARISONS.map((c) =>
    megaLink(`/site/compare/${c.slug}`, `Paisa vs ${c.name}`, "")).join("")}</div>`;

export const nav = () => `
<nav class="top" id="nav">
  <div class="wrap inner">
    <a class="logo" href="/site"><span class="logo-mark">P</span>paisa</a>
    <div class="navlinks">
      <div class="navitem" data-menu>
        <button type="button" aria-expanded="false">Product <i class="chev"></i></button>
        ${productMega()}
      </div>
      <div class="navitem" data-menu>
        <button type="button" aria-expanded="false">Solutions <i class="chev"></i></button>
        ${solutionMega()}
      </div>
      <div class="navitem" data-menu>
        <button type="button" aria-expanded="false">Compare <i class="chev"></i></button>
        ${compareMega()}
      </div>
      <div class="navitem" data-menu>
        <button type="button" aria-expanded="false">Company <i class="chev"></i></button>
        <div class="mega">
          ${megaLink("/site/about", "About", "why it exists, and its three rules")}
          ${megaLink("/site/customers", "Customers", "what early access actually means")}
          ${megaLink("/site/partners", "Partners", "firms and technology partners")}
          ${megaLink("/site/contact", "Contact", "small team, direct line")}
        </div>
      </div>
      <div class="navitem" data-menu>
        <button type="button" aria-expanded="false">Resources <i class="chev"></i></button>
        <div class="mega">
          ${megaLink("/site/resources", "Specifications", "every decision, with its reasoning")}
          ${megaLink("/site/docs", "Documentation", "the engine API and how to run it")}
          ${megaLink("/site/continuous-close", "Continuous close", "why the close moves earlier")}
        </div>
      </div>
    </div>
    <div class="navcta">
      <a class="btn btn-dark" href="/">Live app</a>
      <a class="btn btn-primary" href="/erp">See the close</a>
      <button class="menu-btn" id="menu-btn" aria-label="Menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
  <div class="drawer" id="drawer">
    <h6>Product</h6>
    ${PRODUCTS.map((p) => `<a href="/site/product/${p.slug}">${p.name}</a>`).join("")}
    <h6>Solutions</h6>
    ${SOLUTIONS.map((s) => `<a href="/site/solution/${s.slug}">${s.name}</a>`).join("")}
    <h6>Compare</h6>
    ${COMPARISONS.map((c) => `<a href="/site/compare/${c.slug}">Paisa vs ${c.name}</a>`).join("")}
    <h6>Company</h6>
    <a href="/site/about">About</a>
    <a href="/site/customers">Customers</a>
    <a href="/site/partners">Partners</a>
    <a href="/site/contact">Contact</a>
    <h6>Resources</h6>
    <a href="/site/resources">Specifications</a>
    <a href="/site/docs">Documentation</a>
    <a href="/site/continuous-close">Continuous close</a>
    <a href="/">Live app</a>
    <a href="/erp">ERP console</a>
  </div>
</nav>`;

export const footer = () => `
<footer>
  <div class="wrap">
    <div class="fgrid">
      <div>
        <div class="logo" style="margin-bottom:12px"><span class="logo-mark">P</span>paisa</div>
        <p style="max-width:270px;line-height:1.55">The AI-native ERP for finance teams. A perpetual
          ledger, a close that proves itself, and an assistant that cannot invent a number.</p>
      </div>
      <div><h5>Product</h5><ul>
        ${PRODUCTS.slice(0, 6).map((p) => `<li><a href="/site/product/${p.slug}">${p.name}</a></li>`).join("")}
      </ul></div>
      <div><h5>More product</h5><ul>
        ${PRODUCTS.slice(6).map((p) => `<li><a href="/site/product/${p.slug}">${p.name}</a></li>`).join("")}
      </ul></div>
      <div><h5>Solutions</h5><ul>
        ${SOLUTIONS.map((s) => `<li><a href="/site/solution/${s.slug}">${s.name}</a></li>`).join("")}
      </ul></div>
      <div><h5>Company</h5><ul>
        ${COMPARISONS.map((c) => `<li><a href="/site/compare/${c.slug}">vs ${c.name}</a></li>`).join("")}
        <li><a href="/site/about">About</a></li>
        <li><a href="/site/customers">Customers</a></li>
        <li><a href="/site/partners">Partners</a></li>
        <li><a href="/site/contact">Contact</a></li>
        <li><a href="/site/resources">Specifications</a></li>
        <li><a href="/site/docs">Documentation</a></li>
        <li><a href="/site/continuous-close">Continuous close</a></li>
        <li><a href="/">Live app</a></li>
        <li><a href="/erp">ERP console</a></li>
      </ul></div>
    </div>

    <div class="honest">
      <b style="color:var(--night-ink)">What this site does not claim.</b>
      Paisa has no customers, testimonials, G2 rating or SOC certification yet, so none are shown
      anywhere on it. Named integrations are roadmap — the idempotent ingestion layer they plug into
      is built and tested. Every capability described maps to a module in the codebase.
    </div>

    <div class="fbottom">
      <span>© 2026 Paisa</span>
      <span>Every figure on this site comes from the demo company's own ledger.</span>
    </div>
  </div>
</footer>`;

export const SHELL_JS = `
<script>
(() => {
  const progress = document.getElementById("progress");
  const navEl = document.getElementById("nav");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + "%";
    if (navEl) navEl.classList.toggle("stuck", window.scrollY > 60);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // dropdowns: hover on pointer devices, click everywhere (keyboard included)
  document.querySelectorAll("[data-menu]").forEach((item) => {
    const btn = item.querySelector("button");
    const close = () => { item.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
    const open = () => {
      document.querySelectorAll("[data-menu].open").forEach((o) => {
        if (o !== item) { o.classList.remove("open"); o.querySelector("button").setAttribute("aria-expanded","false"); }
      });
      item.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      item.classList.contains("open") ? close() : open();
    });
    item.addEventListener("mouseenter", () => { if (matchMedia("(hover:hover)").matches) open(); });
    item.addEventListener("mouseleave", () => { if (matchMedia("(hover:hover)").matches) close(); });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll("[data-menu].open").forEach((o) => {
      o.classList.remove("open"); o.querySelector("button").setAttribute("aria-expanded","false");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll("[data-menu].open").forEach((o) => o.classList.remove("open"));
  });

  const menuBtn = document.getElementById("menu-btn");
  const drawer = document.getElementById("drawer");
  if (menuBtn && drawer) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = drawer.classList.toggle("open");
      menuBtn.classList.toggle("open", isOpen);
      menuBtn.setAttribute("aria-expanded", String(isOpen));
    });
  }
})();
</script>`;
