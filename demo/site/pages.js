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
      <a class="btn btn-primary" href="/app">Try the AI CFO</a>
      <a class="btn btn-dark" href="/erp">Open the ERP console</a>
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
      <a class="btn btn-primary" href="/site/product/paisa-ai">How the AI is grounded</a>
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

/* ------------------------------------------------------------------ */
/* Company pages                                                       */
/* ------------------------------------------------------------------ */

export const aboutPage = () =>
  page(
    "About — Paisa",
    "Why Paisa exists, and the three rules it is built on.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Company</div>
    <div class="eyebrow on-dark">About</div>
    <h1>Finance software should be checkable.</h1>
    <p class="lede on-dark">Most of it asks to be trusted. Paisa is built so that trust is not the
      mechanism — the books check themselves, and the AI cannot state a figure no engine produced.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">The rules</div>
      <h2>Three, and they are enforced in code.</h2>
      <p class="lede">Not values on a careers page. Each of these is a constraint the codebase
        physically holds, and each one closed off a class of bug that finance software is famous for.</p>
    </div>
    <div class="featrow"><h3>1 · The LLM is never the source of financial truth</h3>
      <p>The model chooses which question to ask. Deterministic engines answer it. A verifier checks
        every figure in the narration against the tool results and rejects the answer if one came from
        anywhere else — including a correct figure the model computed itself. There is no payment tool,
        so the assistant cannot move money: not disabled by a flag, never written.</p></div>
    <div class="featrow"><h3>2 · Derived, never stored</h3>
      <p>Balances are projections over an append-only journal. The ledger cannot disagree with the
        journal because there is only one of them. The same idea, one level up, is how persistence
        works: the log records what was asked for, and replaying it rebuilds the state — so there is
        no separate load path that could drift from the apply path.</p></div>
    <div class="featrow"><h3>3 · Refuse rather than guess</h3>
      <p>An unbalanced entry is rejected, not flagged. A missing FX rate throws rather than carrying
        a stale one forward. A bank line the rules cannot categorise waits for a person. A statement
        is not produced when the trial balance is out. When there is not enough history to compute a
        runway honestly, Paisa says so instead of estimating.</p></div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Where it is</div>
      <h2>Early, and specific about it.</h2>
    </div>
    <div class="grid g3">
      <div class="card"><h3>Built</h3><p>The ledger, revenue recognition, AR, AP, schedules, bank
        reconciliation, multi-entity consolidation, close management, continuous agents, the verified
        assistant, and durable persistence. All tested.</p></div>
      <div class="card"><h3>Not built</h3><p>Inventory, manufacturing, order management, procurement,
        fixed-asset revaluation, and jurisdictions beyond India for local tax. Named integrations are
        roadmap; the ingestion layer they plug into is done.</p></div>
      <div class="card"><h3>Not claimed</h3><p>No customers, no testimonials, no G2 rating, no SOC
        report. When those exist they will appear here; until then this page says they do not.</p></div>
    </div>
    <div class="honestbox"><b>Why that matters more here than elsewhere.</b> A finance buyer checks
      claims. Inventing a logo or a certification is the one mistake this category does not forgive,
      so the site is built to be verifiable instead of impressive.</div>
  </div>
</section>

${ctaBlock("Check it yourself.", "The console and the ledger are open — no sign-up, nothing scripted.")}`,
  );

export const customersPage = () =>
  page(
    "Customers — Paisa",
    "Paisa has no customers yet. Here is what early access involves instead.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Company</div>
    <div class="eyebrow on-dark">Customers</div>
    <h1>No customers yet.</h1>
    <p class="lede on-dark">This page would normally be a wall of logos. Paisa does not have one, and
      borrowing somebody else's is the fastest way to lose a finance buyer permanently.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Instead</div>
      <h2>What you can check right now.</h2>
      <p class="lede">Everything a case study would assert, you can verify directly.</p>
    </div>
    <div class="tiles">
      <a class="tile" href="/erp"><b>A close with real blockers</b><span>June is open; two checks genuinely fail</span></a>
      <a class="tile" href="/"><b>The assistant, answering</b><span>every figure traceable to an engine</span></a>
      <a class="tile" href="/journal"><b>Every journal entry</b><span>append-only, nothing hidden</span></a>
      <a class="tile" href="/trial-balance"><b>The trial balance</b><span>a projection, not a report</span></a>
      <a class="tile" href="/audit"><b>The audit trail</b><span>who did what, and when</span></a>
      <a class="tile" href="/site/resources"><b>The specifications</b><span>including the bugs tests caught</span></a>
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Early access</div>
      <h2>What being first would actually mean.</h2>
    </div>
    <div class="featrow"><h3>You would shape the close</h3>
      <p>The checklist is eleven checks today. Which twelfth one your controller needs is a decision
        that has not been made yet, and an early customer makes it.</p></div>
    <div class="featrow"><h3>You would find things</h3>
      <p>Two real bugs have been caught by the system's own checks so far, both documented in the
        specs. Running it on real books will find more, and that is the point of going early.</p></div>
    <div class="featrow"><h3>You would need a fallback</h3>
      <p>Being straight: this is not a system to run a statutory audit on alone today. An early
        deployment runs alongside what you have, not instead of it.</p></div>
  </div>
</section>

${ctaBlock("Start by breaking it.", "Open the console and see whether the checks would pass on books like yours.")}`,
  );

export const contactPage = () =>
  page(
    "Contact — Paisa",
    "How to reach the team building Paisa.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Company</div>
    <div class="eyebrow on-dark">Contact</div>
    <h1>Small team. Direct line.</h1>
    <p class="lede on-dark">There is no sales org, no SDR queue and no demo booking funnel. The demo
      is already open, and the fastest useful conversation starts after you have poked at it.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="grid g3">
      <div class="card"><h3>Try it first</h3><p>The ERP console and the assistant run on a seeded
        company with a live close. Nothing is gated, so a call can start from what you actually saw.</p>
        <p style="margin-top:12px"><a class="btn btn-ghost" href="/erp">Open the console</a></p></div>
      <div class="card"><h3>Read the reasoning</h3><p>Every architectural decision is written down,
        including the ones that turned out wrong. Faster than a discovery call.</p>
        <p style="margin-top:12px"><a class="btn btn-ghost" href="/site/resources">Read the specs</a></p></div>
      <div class="card"><h3>Partner with us</h3><p>Firms and technology partners shape the
        implementation methodology while it is still being written.</p>
        <p style="margin-top:12px"><a class="btn btn-ghost" href="/site/partners">Partner programme</a></p></div>
    </div>
    <div class="honestbox"><b>No contact form here yet.</b> A form that collects details nobody is
      staffed to answer is worse than no form. When there is someone to answer it, it will appear.</div>
  </div>
</section>

${ctaBlock("The product is the pitch.", "Everything is open. Look at it, then tell us what is missing.")}`,
  );

export const continuousClosePage = () =>
  page(
    "Continuous close — Paisa",
    "Why the close should happen as the month happens, not after it.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Concept</div>
    <div class="eyebrow on-dark">Continuous close</div>
    <h1>The month closes as it happens.</h1>
    <p class="lede on-dark">A two-week close is not a staffing problem. It is what happens when every
      check waits until the month is over, so every exception is discovered at the worst moment to
      fix it.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">The shift</div>
      <h2>Three things move earlier.</h2>
    </div>
    <div class="grid g3">
      <div class="card"><h3>Exceptions, not surprises</h3><p>Continuous agents raise missing accruals,
        outliers, probable duplicates, stale receivables and unrecognised revenue while the month is
        still open and the person who knows the answer is still available.</p></div>
      <div class="card"><h3>Schedules already posted</h3><p>Recognition, amortisation and depreciation
        are idempotent, so they can run during the month and again at close without double-posting.
        Day one is review, not execution.</p></div>
      <div class="card"><h3>Tie-outs continuously true</h3><p>Subledger totals are derived from the
        same journal the control accounts read, so they agree by construction rather than after a
        reconciliation exercise.</p></div>
    </div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">What makes it possible</div>
      <h2>Idempotence, mostly.</h2>
    </div>
    <div class="featrow"><h3>Running twice is safe</h3>
      <p>Recognition is keyed by obligation and period; amortisation and depreciation by item and
        period. Running the close mid-month, then again at month end, posts each amount once. Without
        that property continuous close is just double-counting with a nicer name.</p></div>
    <div class="featrow"><h3>Checks that execute</h3>
      <p>A checklist of tickable boxes cannot run early — a person has to be looking. A checklist of
        functions can run continuously, and tell you the state at any moment.</p></div>
    <div class="featrow"><h3>A soft close for the gap</h3>
      <p>Subledgers freeze while accruals, recognition, FX and adjustments still post, so review does
        not have to fight new transactions arriving underneath it.</p></div>
    <div class="featrow"><h3>The lock is real</h3>
      <p>Once the period is signed off the journal itself refuses entries dated inside it. Continuous
        only works if closed genuinely means closed; otherwise the number moves after everyone stopped
        watching.</p></div>
  </div>
</section>

${ctaBlock("See a close mid-flight.", "June is open in the console right now, with two blockers and three exceptions waiting.")}`,
  );

export const docsPage = () =>
  page(
    "Documentation — Paisa",
    "The engine API, the command registry and how to run Paisa yourself.",
    `
<header class="phero">
  <div class="wrap">
    <div class="crumb"><a href="/site">Paisa</a> · Developers</div>
    <div class="eyebrow on-dark">Documentation</div>
    <h1>It is a library before it is an app.</h1>
    <p class="lede on-dark">The engines are pure TypeScript with no runtime dependencies. You can
      import them, drive them from tests, and get the same answers the product does.</p>
  </div>
</header>

<section>
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Shape</div>
      <h2>How it fits together.</h2>
    </div>
    <div class="featrow"><h3>The core</h3>
      <p>Money as branded bigint paise, a chart of accounts whose types fix normal balance sides, an
        append-only journal, and a ledger that projects over it. Statements, cash flow, health scoring,
        invoicing, tax and bank feeds build on those.</p></div>
    <div class="featrow"><h3>The ERP layer</h3>
      <p>attachErp(org, options) layers periods, contracts, revenue recognition, payables, schedules,
        FX, reconciliation, metrics, close management, agents and connectors onto an organization —
        additively, without changing the core.</p></div>
    <div class="featrow"><h3>The command registry</h3>
      <p>Every mutation that can reach the engines is enumerated. A command not in the registry is
        refused rather than executed, so the surface that survives a restart is a list you can read
        rather than a property you have to trust.</p></div>
    <div class="featrow"><h3>The AI layer</h3>
      <p>A provider interface, an orchestrator that routes every tool call through the engines, and
        verifyNarration, which rejects any answer containing a figure no tool produced.</p></div>
  </div>
</section>

<section style="background:var(--surface);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="head">
      <div class="eyebrow">Run it</div>
      <h2>Three commands.</h2>
    </div>
    <div class="featrow"><h3>The demo</h3>
      <p><code>npm install &amp;&amp; npm run build &amp;&amp; node demo/server.js</code> — the site,
        the assistant dashboard and the ERP console, on a seeded company.</p></div>
    <div class="featrow"><h3>The full quarter</h3>
      <p><code>node demo/erp-close.js</code> — CRM sync through contract, billing, recognition,
        subledgers, agents, close and lock, printed as it happens.</p></div>
    <div class="featrow"><h3>Persistence</h3>
      <p><code>node demo/persistence.js</code> — records one month per invocation into an on-disk
        Postgres and rebuilds the books from the log each time. Run it repeatedly; the books grow
        across processes and nothing is ever written out as state.</p></div>
    <div class="featrow"><h3>The tests</h3>
      <p><code>npm test</code> — the whole suite, including replay-identity against real Postgres
        compiled to WASM rather than a mock.</p></div>
  </div>
</section>

${ctaBlock("Read the specs next.", "Every decision, with its reasoning and the bugs the tests caught.")}`,
  );
