/**
 * Page renderers. One function per page type, all sharing the shell, so a
 * new product page is a content entry rather than a new file to maintain.
 */

import { head, nav, footer, SHELL_JS } from "./shell.js";
import { PRODUCTS, SOLUTIONS, COMPARISONS, bySlug } from "./content.js";

const PAGE_CSS = `
  .phero { background:var(--night); color:var(--night-ink); padding:74px 0 78px; position:relative;
           overflow:hidden; }
  .phero::after { content:""; position:absolute; inset:auto -20% -70% 45%; height:400px;
                  background:radial-gradient(closest-side,rgba(242,107,29,.15),transparent); }
  .phero .wrap { position:relative; z-index:1; }
  .phero h1 { color:var(--night-ink); max-width:780px; }
  .phero .lede { margin-top:18px; max-width:620px; }
  .phero-cta { display:flex; gap:11px; margin-top:28px; flex-wrap:wrap; }
  .crumb { font-size:12.5px; color:var(--night-ink-2); margin-bottom:16px; }
  .crumb a:hover { color:var(--night-ink); }
  .module { margin-top:24px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px;
            color:var(--night-ink-2); border:1px solid var(--night-line); border-radius:9px;
            padding:8px 12px; display:inline-block; }
  .module b { color:var(--orange); font-weight:600; }

  .statband { background:var(--night-2); border-top:1px solid var(--night-line);
              border-bottom:1px solid var(--night-line); padding:26px 0; }
  .statband .inner { display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; }
  .statband .s { font-size:26px; font-weight:700; color:var(--orange); letter-spacing:-.02em; }
  .statband .l { color:var(--night-ink-2); font-size:14px; }

  .head { max-width:660px; margin-bottom:40px; }
  .head .lede { margin-top:13px; }
  .featrow { display:grid; grid-template-columns:260px 1fr; gap:26px; padding:26px 0;
             border-top:1px solid var(--line); }
  .featrow:first-of-type { border-top:0; }
  .featrow h3 { letter-spacing:-.015em; }
  .featrow p { color:var(--ink-2); font-size:14.5px; line-height:1.62; max-width:660px; }
  @media (max-width:760px){ .featrow{ grid-template-columns:1fr; gap:8px; padding:20px 0; } }

  .painlist { list-style:none; }
  .painlist li { padding:11px 0 11px 26px; border-top:1px solid var(--line); position:relative;
                 color:var(--ink-2); font-size:14.5px; }
  .painlist li:first-child { border-top:0; }
  .painlist li::before { content:"✕"; position:absolute; left:0; top:11px; color:var(--red);
                         font-size:12px; font-weight:700; }
  .outlist { list-style:none; }
  .outlist li { padding:11px 0 11px 26px; border-top:1px solid var(--line); position:relative;
                font-size:14.5px; font-weight:550; }
  .outlist li:first-child { border-top:0; }
  .outlist li::before { content:"✓"; position:absolute; left:0; top:11px; color:var(--green);
                        font-size:12px; font-weight:700; }

  .split { display:grid; grid-template-columns:1fr 1fr; gap:40px; }
  @media (max-width:780px){ .split{ grid-template-columns:1fr; gap:26px; } }

  .honestbox { border:1px solid var(--line-2); background:var(--surface); border-radius:14px;
               padding:18px 20px; margin-top:26px; font-size:14px; color:var(--ink-2); line-height:1.6; }
  .honestbox b { color:var(--ink); }

  .cta { background:var(--night); color:var(--night-ink); text-align:center; }
  .cta h2 { color:var(--night-ink); }
  .cta .lede { margin:15px auto 0; max-width:520px; }
  .cta-row { display:flex; gap:11px; justify-content:center; margin-top:26px; flex-wrap:wrap; }

  .reveal { opacity:0; transform:translateY(16px);
            transition:opacity .6s cubic-bezier(.19,1,.22,1), transform .6s cubic-bezier(.19,1,.22,1); }
  .reveal.shown { opacity:1; transform:none; }

  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; }
  .tile { border:1px solid var(--line); background:var(--surface); border-radius:13px; padding:16px 17px;
          transition:border-color .25s ease, transform .25s ease; }
  .tile:hover { border-color:var(--orange); transform:translateY(-2px); }
  .tile b { display:block; font-size:14.5px; font-weight:650; }
  .tile span { display:block; font-size:12.5px; color:var(--ink-3); margin-top:3px; }
`;

const REVEAL_JS = `
<script>
(() => {
  const els = document.querySelectorAll(".featrow, .card, .tile, .honestbox, .painlist, .outlist");
  els.forEach((el) => el.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const sibs = [...(e.target.parentElement?.children || [])];
      e.target.style.transitionDelay = Math.min(Math.max(0, sibs.indexOf(e.target)) * 45, 260) + "ms";
      e.target.classList.add("shown");
      io.unobserve(e.target);
    });
  }, { threshold: .1, rootMargin: "0px 0px -40px 0px" });
  els.forEach((el) => io.observe(el));
})();
</script>`;

const ctaBlock = (headline, sub) => `
<section class="cta">
  <div class="wrap">
    <h2>${headline}</h2>
    <p class="lede on-dark">${sub}</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="/erp">Open the ERP console</a>
      <a class="btn btn-dark" href="/">Try the assistant</a>
    </div>
  </div>
</section>`;

const page = (title, description, body) =>
  head({ title, description, extraCss: PAGE_CSS }) + nav() + body + footer() + SHELL_JS + REVEAL_JS + "\n</body>\n</html>";

/* ------------------------------------------------------------------ */

export const productPage = (slug) => {
  const p = bySlug(PRODUCTS, slug);
  if (!p) return null;
  const related = p.related.map((s) => bySlug(PRODUCTS, s)).filter(Boolean);
  return page(
    `${p.name} — Paisa`,
    p.sub,
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Product</div>
    <div class="eyebrow on-dark">${p.eyebrow}</div>
    <h1>${p.headline}</h1>
    <p class="lede on-dark">${p.sub}</p>
    <div class="phero-cta">
      <a class="btn btn-primary" href="/erp">See it running</a>
      <a class="btn btn-dark" href="/site">Back to overview</a>
    </div>
    <div class="module">Implemented in <b>${p.module}</b></div>
  </div>
</header>

<div class="statband"><div class="wrap inner">
  <span class="s">${p.proof.stat}</span><span class="l">${p.proof.label}</span>
</div></div>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Why it is built this way</div>
      <h2>${p.benefits.length} decisions that carry the weight.</h2>
    </div>
    <div class="grid g3">
      ${p.benefits.map((b) => `<div class="card"><h3>${b.h}</h3><p>${b.p}</p></div>`).join("")}
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Capabilities</div>
      <h2>What it does, in full.</h2>
    </div>
    ${p.features.map((f) => `
    <div class="featrow"><h3>${f.h}</h3><p>${f.p}</p></div>`).join("")}
  </div>
</section>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Related</div>
      <h2>Works with</h2>
    </div>
    <div class="tiles">
      ${related.map((r) => `<a class="tile" href="/site/product/${r.slug}"><b>${r.name}</b><span>${r.navBlurb}</span></a>`).join("")}
    </div>
  </div>
</section>

${ctaBlock("See it against a real ledger.", "The demo runs on a seeded company with a live close waiting — two real blockers and agents holding proposals.")}`,
  );
};

/* ------------------------------------------------------------------ */

export const solutionPage = (slug) => {
  const s = bySlug(SOLUTIONS, slug);
  if (!s) return null;
  return page(
    `Paisa for ${s.name}`,
    s.sub,
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Solutions</div>
    <div class="eyebrow on-dark">${s.eyebrow}</div>
    <h1>${s.headline}</h1>
    <p class="lede on-dark">${s.sub}</p>
    <div class="phero-cta">
      <a class="btn btn-primary" href="/erp">See the close</a>
      <a class="btn btn-dark" href="/site/product/paisa-ai">How the AI is grounded</a>
    </div>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="split">
      <div>
        <div class="eyebrow">What usually goes wrong</div>
        <ul class="painlist">${s.pains.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <div>
        <div class="eyebrow">What changes</div>
        <ul class="outlist">${s.outcomes.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">How</div>
      <h2>Three things that do the work.</h2>
    </div>
    <div class="grid g3">
      ${s.pillars.map((x) => `<div class="card"><h3>${x.h}</h3><p>${x.p}</p></div>`).join("")}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">The modules behind it</div>
      <h2>Nothing here is a promise.</h2>
      <p class="lede">Each of these is a product page describing code that exists.</p>
    </div>
    <div class="tiles">
      ${PRODUCTS.slice(0, 8).map((p) => `<a class="tile" href="/site/product/${p.slug}"><b>${p.name}</b><span>${p.navBlurb}</span></a>`).join("")}
    </div>
  </div>
</section>

${ctaBlock("Look at the books, not the brochure.", "A seeded company, a close in progress, and every number computed by the engines.")}`,
  );
};

/* ------------------------------------------------------------------ */

export const comparePage = (slug) => {
  const c = bySlug(COMPARISONS, slug);
  if (!c) return null;
  return page(
    `${c.headline}`,
    c.sub,
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Compare</div>
    <div class="eyebrow on-dark">${c.eyebrow}</div>
    <h1>${c.headline}</h1>
    <p class="lede on-dark">${c.sub}</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="split">
      <div>
        <div class="eyebrow">Where ${c.name} is strong</div>
        <ul class="outlist">${c.theirStrengths.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <div>
        <div class="eyebrow">Where Paisa differs</div>
        <ul class="outlist">${c.ourDifferences.map((d) => `<li>${d.h}</li>`).join("")}</ul>
      </div>
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">The differences, explained</div>
      <h2>What actually changes for you.</h2>
    </div>
    ${c.ourDifferences.map((d) => `<div class="featrow"><h3>${d.h}</h3><p>${d.p}</p></div>`).join("")}
    <div class="honestbox"><b>Being straight about it.</b> ${c.honest}</div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="head"><div class="eyebrow">Other comparisons</div><h2>See the rest</h2></div>
    <div class="tiles">
      ${COMPARISONS.filter((x) => x.slug !== c.slug).map((x) =>
        `<a class="tile" href="/site/compare/${x.slug}"><b>Paisa vs ${x.name}</b><span>an honest comparison</span></a>`).join("")}
    </div>
  </div>
</section>

${ctaBlock("Judge it against your own close.", "Open the console and see whether the checks would pass on your books.")}`,
  );
};

/* ------------------------------------------------------------------ */

export const partnersPage = () =>
  page(
    "Partners — Paisa",
    "Implementation partners, advisory firms and technology partners building on Paisa.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Partners</div>
    <div class="eyebrow on-dark">Partners</div>
    <h1>Build the practice around it.</h1>
    <p class="lede on-dark">Paisa is early. That is the honest pitch: partners who come in now shape
      what the implementation methodology becomes, rather than inheriting one.</p>
    <div class="phero-cta"><a class="btn btn-primary" href="/site/resources">Read the specs</a></div>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Who we work with</div>
      <h2>Four kinds of partner.</h2>
    </div>
    <div class="grid g2">
      <div class="card"><h3>Accounting &amp; advisory firms</h3>
        <p>Run client closes on one process. The same checks, tie-outs and audit trail on every
          engagement, with each client isolated as its own organization.</p></div>
      <div class="card"><h3>Technology partners</h3>
        <p>The connector layer is transport-agnostic and idempotent by external id. Building an
          integration means supplying records, not designing a sync protocol.</p></div>
      <div class="card"><h3>Private equity &amp; VC</h3>
        <p>Give portfolio companies a ledger that consolidates. Per-entity books, elimination and
          translation, so a rollup is a query rather than a quarter.</p></div>
      <div class="card"><h3>Independent consultants</h3>
        <p>If you implement finance systems and want to shape one before its methodology hardens,
          this is the moment to talk.</p></div>
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">What you get</div>
      <h2>Access, not a portal.</h2>
    </div>
    <div class="featrow"><h3>The source and the specs</h3>
      <p>Every architectural decision is written down in the specs, including the mistakes and what
        the tests caught. You can read exactly how revenue recognition or the close lock works before
        you recommend it to a client.</p></div>
    <div class="featrow"><h3>A deterministic core</h3>
      <p>The engines are pure and testable. An implementation question — will this contract recognise
        correctly? — is answerable by running it, not by filing a ticket.</p></div>
    <div class="featrow"><h3>Direct line to the team</h3>
      <p>There is no partner tier and no certification programme yet. There is a small team that will
        answer you.</p></div>
    <div class="honestbox"><b>No partner directory yet.</b> Rather than show an empty grid or borrowed
      logos, this page says plainly: the programme is being built and the first partners will help
      define it.</div>
  </div>
</section>

${ctaBlock("See what you would be implementing.", "The console shows a real close with real blockers, not a scripted walkthrough.")}`,
  );

/* ------------------------------------------------------------------ */

export const resourcesPage = () =>
  page(
    "Resources — Paisa",
    "Specifications, architecture notes and the live demo surfaces.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Resources</div>
    <div class="eyebrow on-dark">Resources</div>
    <h1>How it works, written down.</h1>
    <p class="lede on-dark">Not a blog. The actual specifications the system was built from, including
      the decisions that turned out wrong and the tests that caught them.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Specifications</div>
      <h2>Every architectural decision, with its reasoning.</h2>
    </div>
    <div class="featrow"><h3>The ERP layer</h3>
      <p>ASC 606 contracts and recognition, the close lock as a posting guard, multi-entity
        consolidation, continuous agents. Includes the deferred-revenue roll-forward bug: the first
        implementation moved the whole recognised amount through deferred revenue and reported a
        difference that did not exist. A test caught it.</p></div>
    <div class="featrow"><h3>Persistence by command sourcing</h3>
      <p>Why state is never serialised out, and why the log records what was asked for rather than
        what resulted. One code path applies changes and restores them, so a restored ledger is
        arrived at the way the original was.</p></div>
    <div class="featrow"><h3>The AI boundary</h3>
      <p>The orchestrator, the tool layer and verifyNarration — why the LLM is never the source of
        financial truth, and what happens to an answer that breaks that rule.</p></div>
    <div class="featrow"><h3>Compliance knowledge</h3>
      <p>How tax questions are answered from a curated corpus with citations and verification dates,
        and why answering them from model memory is not allowed.</p></div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Live surfaces</div>
      <h2>Look at the running system.</h2>
    </div>
    <div class="tiles">
      <a class="tile" href="/"><b>AI CFO dashboard</b><span>morning brief, chat, recommendations</span></a>
      <a class="tile" href="/erp"><b>ERP console</b><span>close, revenue, agents, tie-outs</span></a>
      <a class="tile" href="/journal"><b>Journal</b><span>every entry, append-only</span></a>
      <a class="tile" href="/trial-balance"><b>Trial balance</b><span>as a projection</span></a>
      <a class="tile" href="/balance-sheet"><b>Balance sheet</b><span>equation checked</span></a>
      <a class="tile" href="/profit-and-loss"><b>Profit &amp; loss</b><span>any window</span></a>
      <a class="tile" href="/audit"><b>Audit trail</b><span>every mutation, attributed</span></a>
    </div>
  </div>
</section>

${ctaBlock("Read it, then run it.", "Both are available right now, with no sign-up.")}`,
  );
