/**
 * Paisa — the request handler.
 *
 * Serves the dashboard (floating nav, a chat that starts as a landing hero
 * and becomes a docked thread, and a metrics rail)
 * and a JSON API over the deterministic paisa-core engines. Every number on
 * the page is computed by the core; the AI chat goes through the Orchestrator
 * so every figure in an answer is verified against tool outputs.
 *
 * One handler, two entry points: demo/server.js runs it on a local
 * node:http server, api/index.js runs it as a Vercel function. Routing
 * lives here only — two copies of a router drift the same way two copies
 * of a balance calculation do.
 * Chat uses the offline CfoPlanner by default; set ANTHROPIC_API_KEY to route
 * through Claude (with the planner as fallback).
 */

import { readFile } from "node:fs/promises";
import { erpApi, ERP_READS, CONTROLLER, CLOSE_PERIOD } from "./erp-console.js";
import { erpPage } from "./erp-page.js";
import { sitePage } from "./site.js";
import { productPage, solutionPage, comparePage, partnersPage, resourcesPage,
         aboutPage, customersPage, contactPage, continuousClosePage, docsPage } from "./site/pages.js";
import { canonicalRedirect, isCanonicalHost, robotsTxt, sitemapXml } from "./site/seo.js";
import { boot, sync, ORG_ID, ORG_NAME } from "./boot.js";
import { seedAll, AS_OF, PERIOD_FROM } from "./seed.js";
import { loginPage, safeNext } from "./login-page.js";
import { callbackPage } from "./auth-callback-page.js";
import { consolePage } from "./console.js";
import { demoRuntime, newDemoId, isDemoId, demoStats } from "./demo-sessions.js";
import { googleConfig, googleEnabled, authorizeUrl, originOf } from "./auth-google.js";
import {
  parseINR,
  formatINR,
  Orchestrator,
  CfoPlanner,
  AnthropicProvider,
  OpenAIProvider,
  FallbackProvider,
  hashPassword,
  verifyPassword,
  issueSession,
  readSession,
  sessionCookie,
  clearCookie,
  parseCookies,
  resolveSessionSecret,
  SESSION_COOKIE,
  fetchBillingRecords,
  toBankLines,
  suggestKeyword,
  AccountDirectory,
  MemberDirectory,
  AccessError,
  normalizeEmail,
  identityFromToken,
  SupabaseAuthError,
} from "../dist/src/index.js";

const ACTOR = "adarsh";

/* ------------------------------------------------------------------ */
/* Auth: one demo user, env-configured, cookie-based sessions          */
/* ------------------------------------------------------------------ */

/**
 * Resolved on first use, not at import.
 *
 * The rule itself is not being relaxed: without a real secret this still
 * refuses to sign a session. But resolving at module scope meant an absent
 * secret threw while the module was loading, so the serverless function
 * never booted and every route died with it — the marketing page, the docs,
 * /api/health. A deployment that is merely unconfigured looked entirely
 * broken, and the logs said nothing about which of the two it was.
 *
 * Deferring the failure to the first caller that actually needs a session
 * keeps the blast radius on the routes that genuinely cannot work.
 */
let sessionSecret;
const requireSessionSecret = () => (sessionSecret ??= resolveSessionSecret());

/**
 * Null when no secret is configured. Without one no session can be verified,
 * so the honest answer to "who is this request from" is nobody — not a crash.
 */
const optionalSessionSecret = () => {
  try {
    return requireSessionSecret();
  } catch {
    return null;
  }
};

/**
 * Accounts and memberships.
 *
 * This replaces a single username and a single password in an environment
 * variable. People now have accounts; access to a set of books is a
 * membership with a role, checked on every request. A revoked member is
 * locked out on their next request rather than at their next login, because
 * the session only carries an identity — authority is looked up, never
 * carried in the cookie.
 */
const accounts = new AccountDirectory();
const members = new MemberDirectory();

/**
 * Signup is closed by default.
 *
 * A B2B ledger is not a product strangers should be able to create an
 * account on. PAISA_OPEN_SIGNUP=1 turns it on deliberately; otherwise the
 * only accounts are the founding owner and people an owner invites.
 */
const openSignup = () => process.env.PAISA_OPEN_SIGNUP === "1";

/**
 * The founding owner, from the environment.
 *
 * The development password is committed, so it must never guard a
 * deployment: production refuses to boot without a real one rather than
 * quietly falling back — the same rule resolveSessionSecret() applies to
 * session signing.
 */
const resolvePassword = () => {
  const password = process.env.PAISA_PASSWORD;
  if (password && password.length >= 10) return password;
  // In production there is no fallback: the development password is
  // committed, so guarding a deployment with it would be the same as having
  // no password at all. Null means "found no owner", handled at boot.
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return null;
  return "paisa123456-dev";
};

const OWNER_EMAIL = normalizeEmail(process.env.PAISA_OWNER_EMAIL ?? "owner@paisa.local");

/**
 * A workspace's display name.
 *
 * There is no organization directory yet — memberships carry an orgId and
 * nothing else — so the one set of books this instance serves is named from
 * boot, and anything else falls back to its id rather than inventing a name
 * the user never chose.
 */
const workspaceName = (orgId) => (orgId === ORG_ID ? ORG_NAME : orgId);


const isSecure = (req) => req.headers["x-forwarded-proto"] === "https" || !!process.env.VERCEL;

/**
 * Where a visitor was headed before they were sent to Google.
 *
 * A breadcrumb for one round trip, not a session: it is unsigned, so nothing
 * is trusted from it beyond `safeNext`'s rule that a destination is a path on
 * this site. Ten minutes is long enough to pick a Google account and short
 * enough that a shared machine does not keep it.
 */
const NEXT_COOKIE = "paisa_next";

const currentSession = (req) => {
  const secret = optionalSessionSecret();
  if (!secret) return null;
  return readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE], secret);
};

/* ------------------------------------------------------------------ */
/* Boot: one runtime, durable when a database is configured            */
/* ------------------------------------------------------------------ */

let org, erp, persistence, runtime;

const ready = boot(seedAll).then((b) => {
  ({ org, erp, persistence, runtime } = b);
  return b;
});

/**
 * Seeding the founding owner is part of booting, not of the first request.
 * An organization whose only owner does not exist yet is a set of books
 * nobody can open, and the window in which that is true should be zero.
 *
 * Defined after `ready` on purpose: reading it from above would work only
 * because of when the first await happens, which is not a property worth
 * depending on.
 */
const authReady = (async () => {
  const password = resolvePassword();

  // No configured password means no owner account — which is fail-closed, and
  // is not the same as failing to boot. This used to throw, and because it
  // throws at module scope the whole function died at cold start: a missing
  // owner credential took down the marketing site, the docs and every public
  // page with it, and the platform kept serving the last deployment that
  // booted, so weeks of merges silently never shipped. An outage is a worse
  // answer than a site whose owner cannot sign in yet.
  if (!password) {
    console.error(
      "PAISA_PASSWORD is not set (needs 10+ characters), so no owner account exists and owner sign-in is disabled. " +
        "Everything else serves normally. Set it and redeploy to enable sign-in.",
    );
    return null;
  }

  const owner = await accounts.register(OWNER_EMAIL, password, process.env.PAISA_OWNER_NAME);
  const booted = await ready;
  members.found(booted.org.orgId, owner.userId);
  return owner;
})();

/* ------------------------------------------------------------------ */
/* AI CFO chat                                                          */
/* ------------------------------------------------------------------ */

/**
 * Provider chain, best available first, ending in something that always works.
 *
 * The planner is last and needs no key or network: it maps a question to
 * tools by keyword and reads the results back. It is not a model and cannot
 * follow a conversation, but it never invents a figure either, so an
 * unattended deploy degrades to something honest rather than to an error.
 *
 * The middle rung is any OpenAI-compatible endpoint — Groq, Gemini's
 * compatibility layer, an Ollama server on localhost — which is what makes
 * running this without paying for tokens possible. Set OPENAI_BASE_URL,
 * OPENAI_API_KEY and PAISA_OPENAI_MODEL to point it somewhere.
 */
const planner = new CfoPlanner({ asOf: AS_OF, periodFrom: PERIOD_FROM });
const chain = [];
if (process.env.ANTHROPIC_API_KEY) chain.push(new AnthropicProvider());
// A base URL on its own is enough: a server on localhost has no key to set,
// and requiring one here would leave the free path permanently unreachable.
if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) chain.push(new OpenAIProvider());
// A second model on the same endpoint, tried when the first is rate-limited.
// On a free tier the binding constraint is quota, not capability: the newest
// model is the busiest, so the rung that matters is another model rather than
// another provider. Dropping to the planner should be the last resort, not
// the response to a 429.
if (process.env.PAISA_OPENAI_MODEL_FALLBACK)
  chain.push(new OpenAIProvider({ model: process.env.PAISA_OPENAI_MODEL_FALLBACK }));
chain.push(planner);
const provider = chain.length > 1 ? new FallbackProvider(chain) : planner;
const orchestrator = new Orchestrator(provider, 6, { asOf: AS_OF, periodFrom: PERIOD_FROM });
const aiUser = {
  userId: ACTOR,
  orgId: "org_nimbus",
  permissions: new Set(["access_ai_cfo", "view_reports"]),
};

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const rupees = (p) => Number(p) / 100; // paise (bigint) → rupees (number) for charts
const inr = (p) => formatINR(p);
const inrCompact = (p) => {
  const r = Number(p) / 100;
  const abs = Math.abs(r);
  const sign = r < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
};

const monthWindow = (offset) => {
  const [y, m] = AS_OF.split("-").map(Number);
  const total = y * 12 + (m - 1) + offset;
  const ty = Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const mm = String(tm + 1).padStart(2, "0");
  return { from: `${ty}-${mm}-01`, to: `${ty}-${mm}-${String(lastDay).padStart(2, "0")}` };
};

const pct = (cur, prev) => (prev !== 0n ? Number(((cur - prev) * 1000n) / prev) / 10 : null);

/* ------------------------------------------------------------------ */
/* ERP suite — attached to the same org, its own routes and page       */
/* ------------------------------------------------------------------ */

// The ERP views are bound per request, against whichever books the caller is
// entitled to: the real ones when signed in, their own demo runtime when not.
// Binding them once at boot pointed every visitor at the real company.

const apiFor = (org) => ({
  brief() {
    org.recommendations.generate(AS_OF, PERIOD_FROM);
    const b = org.brief.compose(AS_OF, PERIOD_FROM);
    return {
      asOf: AS_OF,
      headline: b.headline,
      health: { score: b.health.score, grade: b.health.grade, components: b.health.components },
      cash: inr(b.cashOnHand),
      cashCompact: inrCompact(b.cashOnHand),
      runwayDays: b.runwayDays,
      overdueCount: b.overdueCount,
      overdueAmount: inr(b.overdueAmount),
      nextFiling: b.nextFiling,
      pendingRecommendations: b.pendingRecommendations.length,
    };
  },

  metrics() {
    const cur = monthWindow(-1); // last full month (June)
    const prev = monthWindow(-2);
    const plCur = org.statements.profitAndLoss(cur.from, cur.to);
    const plPrev = org.statements.profitAndLoss(prev.from, prev.to);
    const cm = org.cashflow.metrics(AS_OF);
    const marginPct = plCur.totalRevenue > 0n ? Number((plCur.netProfit * 100n) / plCur.totalRevenue) : null;
    return {
      monthLabel: cur.from.slice(0, 7),
      revenue: { value: inrCompact(plCur.totalRevenue), full: inr(plCur.totalRevenue), changePct: pct(plCur.totalRevenue, plPrev.totalRevenue) },
      expenses: { value: inrCompact(plCur.totalExpenses), full: inr(plCur.totalExpenses), changePct: pct(plCur.totalExpenses, plPrev.totalExpenses) },
      profit: { value: inrCompact(plCur.netProfit), full: inr(plCur.netProfit), marginPct },
      runway: {
        days: cm.runwayDays,
        burn: cm.monthlyNetBurn === null ? null : inrCompact(cm.monthlyNetBurn),
        positive: cm.monthlyNetBurn !== null && cm.monthlyNetBurn <= 0n,
        note: cm.note,
      },
    };
  },

  cashflow() {
    const f = org.forecast.cashForecast(AS_OF, 6, 3);
    return {
      assumption: f.assumption,
      depletionMonth: f.depletionMonth,
      points: f.points.map((p) => ({
        month: p.month,
        kind: p.kind,
        closing: rupees(p.closingCash),
        net: rupees(p.net),
        closingLabel: inrCompact(p.closingCash),
        netLabel: inrCompact(p.net),
      })),
    };
  },

  upcoming() {
    const filings = org.gst.upcomingFilings(AS_OF).filter((f) => f.daysLeft >= 0).slice(0, 2);
    const recurring = org.recurring
      .detect(AS_OF)
      .filter((r) => r.nextExpectedDate >= AS_OF)
      .slice(0, 3);
    return {
      items: [
        ...filings.map((f) => ({
          kind: "filing",
          title: `${f.form} · ${f.period}`,
          sub: f.note,
          date: f.dueDate,
          badge: f.daysLeft <= 7 ? `${f.daysLeft}d left` : null,
          amount: null,
        })),
        ...recurring.map((r) => {
          const title = r.name.replace(/\b\w/g, (c) => c.toUpperCase());
          return {
          kind: "recurring",
          title,
          sub: title.toLowerCase() === r.accountName.toLowerCase() ? "Recurring · monthly" : r.accountName,
          date: r.nextExpectedDate,
          badge: null,
          amount: inrCompact(r.monthlyAmount),
          };
        }),
      ].sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
  },

  transactions() {
    const cashIds = new Set(org.chart.all().filter((a) => a.isCashEquivalent).map((a) => a.id));
    const rows = [...org.journal.all()]
      .reverse()
      .map((e) => {
        let cashDelta = 0n;
        let counterName = "";
        for (const l of e.lines) {
          if (cashIds.has(l.accountId)) cashDelta += l.side === "DEBIT" ? l.amount : -l.amount;
          else counterName = org.chart.get(l.accountId).name;
        }
        if (cashDelta === 0n) return null;
        return {
          date: e.date,
          narration: e.narration,
          category: counterName,
          amount: inr(cashDelta < 0n ? -cashDelta : cashDelta),
          direction: cashDelta < 0n ? "out" : "in",
        };
      })
      .filter(Boolean)
      .slice(0, 7);
    return { rows, needsReview: org.banking.pendingReview().length };
  },

  recommendations() {
    org.recommendations.generate(AS_OF, PERIOD_FROM);
    return {
      items: org.recommendations.all().map((r) => ({
        id: r.id,
        title: r.title,
        problem: r.problem,
        reason: r.reason,
        requiredAction: r.requiredAction,
        impact: r.impact ? inr(r.impact) : null,
        estimatedSavings: r.estimatedSavings ? inr(r.estimatedSavings) : null,
        confidence: r.confidence,
        risk: r.risk,
        requiresApproval: r.requiresApproval,
        status: r.status,
      })),
    };
  },

  invoices() {
    return {
      items: org.invoices.all().slice(-8).reverse().map((i) => ({
        number: i.number,
        customer: i.customer,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        total: inr(i.total),
        outstanding: inr(org.invoices.outstanding(i)),
        status: i.status,
      })),
      aging: org.invoices.aging(AS_OF).buckets.map((b) => ({ label: b.label, count: b.count, amount: inr(b.amount) })),
    };
  },
});

/* ------------------------------------------------------------------ */
/* HTML                                                                 */
/* ------------------------------------------------------------------ */

const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paisa — Your AI CFO</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    /* Mission Control — cool graphite ground, electric blue + violet identity */
    --bg: #F5F6F9; --surface: #FFFFFF; --surface-2: #F0F2F6; --line: rgba(12,15,22,0.09);
    --line-strong: rgba(12,15,22,0.13);
    --ink: #0B0E14; --ink-2: #495264; --ink-3: #878FA1;
    --orange: #2F6BFF; --orange-soft: #E9F0FF; --orange-deep: #1C4FE0;
    --violet: #6A49F2;
    --green: #0E9C72; --green-soft: #DFF5EC; --amber: #B3770F; --red: #DD4360; --red-soft: #FCE9EC;
    --radius: 18px;
    --shadow-sm: 0 1px 2px rgba(12,15,22,0.05), 0 4px 12px rgba(12,15,22,0.05);
    --shadow-md: 0 2px 5px rgba(12,15,22,0.05), 0 12px 30px rgba(12,15,22,0.08);
    --glow: 0 6px 22px rgba(47,107,255,0.26);
  }
  * { box-sizing: border-box; margin: 0; }
  /* the landing/thread swap toggles [hidden]; class display rules would win without this */
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--bg); color: var(--ink); font-size: 14px; -webkit-font-smoothing: antialiased;
  }
  /* ambient mission-control backdrop */
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(60% 50% at 12% 0%, rgba(47,107,255,0.10), transparent 70%),
      radial-gradient(50% 45% at 100% 6%, rgba(106,73,242,0.09), transparent 72%);
  }
  .app { position: relative; z-index: 1; display: grid; grid-template-columns: 1fr 380px; height: 100vh; }

  /* ---------- floating nav (hamburger) ---------- */
  .hamburger {
    position: fixed; top: 16px; left: 16px; z-index: 60; width: 42px; height: 42px;
    border-radius: 13px; border: 1px solid var(--line); background: var(--surface);
    box-shadow: var(--shadow-sm); display: grid; place-items: center; cursor: pointer;
  }
  .hamburger:hover { border-color: var(--line-strong); }
  .hamburger i { display: block; width: 17px; height: 2px; border-radius: 2px; background: var(--ink-2); position: relative; }
  .hamburger i::before, .hamburger i::after {
    content: ""; position: absolute; left: 0; width: 17px; height: 2px; border-radius: 2px; background: var(--ink-2);
    transition: transform 0.18s cubic-bezier(.22,.7,.16,1);
  }
  .hamburger i::before { top: -6px; } .hamburger i::after { top: 6px; }
  .brandpill {
    position: fixed; top: 16px; left: 70px; z-index: 60; display: flex; align-items: center; gap: 8px;
    height: 42px; padding: 0 14px 0 8px; border-radius: 13px; border: 1px solid var(--line);
    background: var(--surface); box-shadow: var(--shadow-sm); font-weight: 750; letter-spacing: -0.02em;
  }
  .logo-mark { width: 26px; height: 26px; border-radius: 8px; color: #fff; display: grid; place-items: center;
    font-size: 15px; font-weight: 800; background: linear-gradient(150deg, var(--orange), var(--violet)); box-shadow: var(--glow); }
  .nav-menu {
    position: fixed; top: 66px; left: 16px; z-index: 59; width: 252px; padding: 10px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 18px;
    box-shadow: var(--shadow-md); display: none; flex-direction: column; gap: 2px;
    transform-origin: top left; animation: popIn 0.16s cubic-bezier(.34,1.56,.64,1);
  }
  .nav-menu.open { display: flex; }
  @keyframes popIn { from { opacity: 0; transform: scale(0.97) translateY(-4px); } to { opacity: 1; transform: none; } }
  .nav-menu a { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 11px; color: var(--ink-2); text-decoration: none; font-weight: 500; font-size: 13.5px; }
  .nav-menu a svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.7; }
  .nav-menu a.active { background: var(--orange-soft); color: var(--orange-deep); font-weight: 650; }
  .nav-menu a:hover:not(.active) { background: var(--surface-2); }
  .nav-divider { height: 1px; background: var(--line); margin: 8px 2px; }
  .health-card { background: var(--surface-2); border: 1px solid var(--line); border-radius: 14px; padding: 13px; margin-bottom: 8px; }
  .health-card .label { font-size: 10.5px; letter-spacing: 0.09em; font-weight: 700; color: var(--ink-3); }
  .health-row { display: flex; align-items: baseline; gap: 8px; margin: 6px 0 8px; }
  .health-score { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
  .health-grade { font-size: 11.5px; font-weight: 650; color: var(--green); background: var(--green-soft); border-radius: 99px; padding: 2px 9px; }
  .health-bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
  .health-bar > div { height: 100%; border-radius: 3px; background: var(--green); }
  .profile { display: flex; gap: 10px; align-items: center; padding: 6px 8px; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--green-soft); color: var(--green); font-weight: 700; font-size: 12.5px; display: grid; place-items: center; flex-shrink: 0; }
  .avatar.guest { background: var(--surface-2); color: var(--ink-3); }
  .profile b { display: block; font-size: 13px; }
  .profile span { display: block; font-size: 11.5px; color: var(--ink-3); }
  /* the signed-out card is the way in, so the whole row is the target */
  .profile.guest { padding: 0; }
  .profile.guest a { display: flex; gap: 10px; align-items: center; width: 100%;
    padding: 6px 8px; border-radius: 11px; text-decoration: none; color: inherit; }
  .profile.guest a:hover { background: var(--surface-2); }
  .profile .who { min-width: 0; }
  .profile .who b, .profile .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---------- dashboard rail ---------- */
  .main { grid-area: 1 / 2; overflow-y: auto; padding: 22px 20px 30px; border-left: 1px solid var(--line); background: color-mix(in oklab, var(--surface) 55%, transparent); }
  .date-line { color: var(--ink-3); font-size: 13px; margin-bottom: 5px; }
  h1 { font-size: 31px; letter-spacing: -0.032em; font-weight: 700; }
  .btn { border: 0; border-radius: 99px; padding: 10px 18px; font-weight: 650; font-size: 13px; cursor: pointer; font-family: inherit; }
  .btn-primary { background: var(--orange); color: #fff; }
  .btn-primary:hover { background: var(--orange-deep); }
  .btn-ghost { background: transparent; color: var(--orange-deep); }
  .btn-quiet { background: var(--surface-2); color: var(--ink-2); padding: 7px 13px; }

  .brief { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 22px; margin-bottom: 16px; box-shadow: var(--shadow-md); }
  /* animated gradient hairline — the brief is the page's one flourish */
  .brief::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
    background: linear-gradient(90deg, var(--orange), var(--violet), #0E97B4, var(--orange));
    background-size: 300% 100%; animation: panGradient 8s ease-in-out infinite; }
  @keyframes panGradient { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  .brief-top { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .brief-top .tag { font-size: 10.5px; letter-spacing: 0.1em; font-weight: 800; color: var(--orange-deep); }
  .brief-top .when { font-size: 11.5px; color: var(--ink-3); }
  .brief p { font-size: 16.5px; line-height: 1.55; max-width: 60ch; }
  .brief p .hl-g { color: var(--green); font-weight: 700; }
  .brief p .hl-o { color: var(--orange-deep); font-weight: 700; }
  .brief-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }

  .recs { display: none; margin: -8px 0 20px; flex-direction: column; gap: 10px; }
  .recs.open { display: flex; }
  .rec { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .rec-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .rec-head b { font-size: 14px; }
  .rec-badges { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .chip { font-size: 10.5px; font-weight: 700; border-radius: 99px; padding: 3px 9px; }
  .chip.conf { background: #EEF2FA; color: #3B5BA5; }
  .chip.risk-low { background: var(--green-soft); color: var(--green); }
  .chip.risk-medium { background: #FBF3D9; color: var(--amber); }
  .chip.risk-high { background: var(--red-soft); color: var(--red); }
  .chip.approval { background: var(--orange-soft); color: var(--orange-deep); }
  .chip.done { background: #F0EDE7; color: var(--ink-3); }
  .rec p { color: var(--ink-2); font-size: 13px; margin-top: 6px; line-height: 1.5; }
  .rec .impact { margin-top: 6px; font-size: 12.5px; color: var(--ink); font-weight: 600; }
  .rec-actions { display: flex; gap: 8px; margin-top: 10px; }
  .btn-approve { background: var(--green); color: #fff; padding: 7px 14px; }
  .btn-dismiss { background: var(--surface-2); color: var(--ink-2); padding: 7px 14px; }

  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .tile { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 15px 16px; }
  .tile .t-label { font-size: 12px; color: var(--ink-2); font-weight: 600; }
  .tile .t-value { font-size: 23px; font-weight: 800; letter-spacing: -0.02em; margin: 6px 0 3px; font-variant-numeric: tabular-nums; }
  .tile .t-sub { font-size: 11.5px; color: var(--ink-3); }
  .delta-up { color: var(--green); font-weight: 700; }
  .delta-down { color: var(--green); font-weight: 700; }
  .delta-bad { color: var(--red); font-weight: 700; }

  .row2 { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; margin-bottom: 20px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .card-head h2 { font-size: 15.5px; font-weight: 750; letter-spacing: -0.01em; }
  .card-sub { font-size: 12px; color: var(--ink-3); margin-bottom: 10px; }
  .badge-healthy { font-size: 11.5px; font-weight: 700; color: var(--green); background: var(--green-soft); border-radius: 99px; padding: 3px 10px; }
  .cash-line { font-size: 12.5px; color: var(--ink-2); margin-top: 8px; }
  .cash-line b { font-variant-numeric: tabular-nums; }

  .chart-wrap { position: relative; }
  .chart-tip { position: absolute; pointer-events: none; background: var(--ink); color: #fff; border-radius: 8px; padding: 7px 10px; font-size: 11.5px; line-height: 1.45; opacity: 0; transform: translate(-50%, -110%); white-space: nowrap; transition: opacity 80ms; }
  .legend { display: flex; gap: 16px; font-size: 11.5px; color: var(--ink-2); margin-top: 6px; }
  .legend i { display: inline-block; width: 14px; height: 0; border-top: 2.5px solid; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .legend .l-actual i { border-color: #0E9C72; }
  .legend .l-forecast i { border-color: #B3770F; border-top-style: dashed; }

  .up-item { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .up-item:last-child { border-bottom: 0; }
  .up-item b { font-size: 13px; display: block; }
  .up-item .sub { font-size: 11.5px; color: var(--ink-3); }
  .up-right { text-align: right; font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .badge-due { display: inline-block; font-size: 10.5px; font-weight: 700; color: var(--orange-deep); background: var(--orange-soft); border-radius: 99px; padding: 2px 8px; margin-top: 2px; }

  /* ---------- bank feed review ---------- */
  .rate { font-size: 11.5px; font-weight: 700; border-radius: 99px; padding: 3px 10px;
    color: var(--orange-deep); background: var(--orange-soft); font-variant-numeric: tabular-nums; }
  .rvw { border-top: 1px solid var(--line); padding: 12px 0; }
  .rvw:first-child { border-top: 0; }
  .rvw-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .rvw-desc { font-weight: 600; font-size: 13px; word-break: break-word; }
  .rvw-when { font-size: 11.5px; color: var(--ink-3); }
  .rvw-amt { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rvw-amt.in { color: var(--green); }
  .rvw-form { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; align-items: center; }
  .rvw-form select, .rvw-form input {
    border: 1px solid var(--line); border-radius: 9px; padding: 7px 9px; font-size: 12.5px;
    font-family: inherit; background: var(--surface); color: var(--ink); outline: none; min-width: 0; }
  .rvw-form select { flex: 1 1 140px; }
  .rvw-form input { flex: 1 1 110px; }
  .rvw-form select:focus, .rvw-form input:focus { border-color: var(--orange); }
  .rvw-learn { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-2);
    white-space: nowrap; cursor: pointer; }
  .rvw-learn input { flex: none; min-width: 0; width: 14px; height: 14px; accent-color: var(--orange); }
  .rvw-err { color: var(--red); font-size: 11.5px; margin-top: 6px; }
  .rvw-empty { color: var(--ink-3); font-size: 12.5px; padding: 6px 0; }

  table.tx { width: 100%; border-collapse: collapse; }
  table.tx td { padding: 9px 4px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: middle; }
  table.tx tr:last-child td { border-bottom: 0; }
  .tx .cat { color: var(--ink-3); font-size: 11.5px; }
  .tx .amt { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tx .amt.in { color: var(--green); }
  .link { color: var(--orange-deep); font-weight: 650; font-size: 12.5px; text-decoration: none; cursor: pointer; }

  /* ---------- centre: landing → conversation ---------- */
  .centre { grid-area: 1 / 1; min-width: 0; display: flex; flex-direction: column; height: 100vh; }

  /* landing: everything centred, the ask bar sitting low like a fresh chat */
  .landing { flex: 1; overflow-y: auto; display: flex; flex-direction: column; justify-content: center; padding: 88px 24px 40px; }
  .landing-inner { width: 100%; max-width: 660px; margin-inline: auto; }
  .landing .date-line, .landing h1 { text-align: center; }
  .landing h1 { margin-bottom: 22px; }

  /* conversation: a scrolling thread with the ask bar pinned under it */
  .thread { flex: 1; overflow-y: auto; scroll-behavior: smooth; }
  .thread-log { max-width: 780px; margin-inline: auto; padding: 26px 20px 8px; display: flex; flex-direction: column; gap: 16px; }
  .msg { max-width: 82%; border-radius: 16px; padding: 11px 14px; font-size: 14px; line-height: 1.6; }
  .msg.user { align-self: flex-end; color: #fff; border-bottom-right-radius: 5px;
    background: linear-gradient(150deg, var(--orange), var(--violet)); box-shadow: var(--glow); }
  .msg.ai { align-self: flex-start; background: var(--surface); border: 1px solid var(--line); border-bottom-left-radius: 5px; box-shadow: var(--shadow-sm); }
  .msg.ai b { font-weight: 700; }
  .msg .tools { display: block; margin-top: 8px; font-size: 10.5px; color: var(--ink-3); }
  /* A drafted action. It reads as a distinct object inside the reply, not as
     more prose, because approving it changes the books. */
  .act { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--orange); border-radius: 8px; background: var(--bg); }
  .act .what { font-size: 12px; line-height: 1.45; }
  .act .kind { display: block; margin-bottom: 4px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
  .act .row { display: flex; gap: 8px; margin-top: 9px; }
  .act button { padding: 5px 12px; font: inherit; font-size: 11.5px; border-radius: 6px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
  .act button[data-do="approve"] { background: var(--orange); border-color: var(--orange-deep); color: #fff; font-weight: 600; }
  .act button:disabled { opacity: .5; cursor: default; }
  .act .done { margin-top: 9px; font-size: 11.5px; color: var(--ink-3); }
  .msg.thinking { color: var(--ink-3); font-style: italic; }

  /* the one ask bar — it starts in the landing and moves into the footer */
  .ask { display: flex; gap: 9px; }
  .ask input { flex: 1; border: 1px solid var(--line); border-radius: 99px; padding: 14px 20px; font-size: 14px;
    font-family: inherit; background: var(--surface); color: var(--ink); outline: none; box-shadow: var(--shadow-sm); }
  .ask input:focus { border-color: var(--orange); box-shadow: 0 0 0 3px var(--orange-soft); }
  .ask .send { width: 46px; height: 46px; border-radius: 50%; border: 0; color: #fff; font-size: 17px; cursor: pointer; flex-shrink: 0;
    background: linear-gradient(150deg, var(--orange), var(--violet)); box-shadow: var(--glow); }
  .ask .send:active { transform: scale(0.96); }
  .askdock { flex-shrink: 0; border-top: 1px solid var(--line); background: var(--bg); padding: 14px 20px 20px; }
  .askdock .ask { max-width: 780px; margin-inline: auto; }

  .chips { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; margin-bottom: 18px; }
  .chips button { border: 1px solid var(--line); background: var(--surface); border-radius: 99px; padding: 7px 13px;
    font-size: 12px; color: var(--ink-2); cursor: pointer; font-family: inherit; }
  .chips button:hover { border-color: var(--orange); color: var(--orange-deep); }

  .main .tiles { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .main .row2 { grid-template-columns: 1fr; }

  @media (max-width: 1180px) { .app { grid-template-columns: 1fr; } .main { display: none; } }
  @media (max-width: 720px) { .brandpill { display: none; } .landing { padding-top: 76px; } }
</style>
</head>
<body>
<button class="hamburger" id="menubtn" aria-label="Open menu" aria-expanded="false"><i></i></button>
<div class="brandpill"><span class="logo-mark">₹</span>paisa</div>
<nav class="nav-menu" id="navmenu"></nav>

<div class="app">

  <section class="centre">
    <div class="landing" id="landing">
      <div class="landing-inner">
        <div class="date-line" id="dateline"></div>
        <h1 id="greeting">Good morning</h1>

        <section class="brief">
          <div class="brief-top"><span class="tag">YOUR AI CFO</span><span class="when">Updated 6:00 AM</span></div>
          <p id="brief-text">Loading your morning brief…</p>
          <div class="brief-actions">
            <button class="btn btn-primary" id="toggle-recs">Review AI recommendations</button>
            <button class="btn btn-ghost" id="ask-brief">Ask about this</button>
          </div>
        </section>

        <section class="recs" id="recs"></section>

        <div class="chips" id="suggest"></div>

        <form class="ask" id="chatform">
          <input id="chatbox" placeholder="Ask anything about your money…" autocomplete="off">
          <button class="send" type="submit" aria-label="Send">↑</button>
        </form>
      </div>
    </div>

    <div class="thread" id="thread" hidden>
      <div class="thread-log" id="log"></div>
    </div>

    <div class="askdock" id="askdock" hidden></div>
  </section>

  <main class="main">
    <section class="tiles" id="tiles"></section>

    <section class="row2">
      <div class="card">
        <div class="card-head"><h2>Cash flow</h2><span class="badge-healthy" id="cf-badge">Healthy</span></div>
        <div class="card-sub">Last 6 months · forecast in amber</div>
        <div class="chart-wrap">
          <svg id="chart" width="100%" height="210" role="img" aria-label="Monthly closing cash, actuals and forecast"></svg>
          <div class="chart-tip" id="tip"></div>
        </div>
        <div class="legend"><span class="l-actual"><i></i>Closing cash (actual)</span><span class="l-forecast"><i></i>Forecast</span></div>
        <div class="cash-line" id="cash-line"></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Upcoming</h2></div>
        <div class="card-sub">Compliance & committed payments</div>
        <div id="upcoming"></div>
      </div>
    </section>

    <section class="card" id="review-card" style="margin-bottom:16px">
      <div class="card-head"><h2>Needs your review</h2><span class="rate" id="review-rate"></span></div>
      <div class="card-sub" id="review-sub">Lines the categoriser would not guess an account for</div>
      <div id="review-list"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Recent transactions</h2><a class="link" href="/journal" target="_blank">View all</a></div>
      <div class="card-sub" id="tx-sub">Auto-categorised by AI</div>
      <table class="tx"><tbody id="txbody"></tbody></table>
    </section>
  </main>
</div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* tiny markdown: **bold**, _italic_, bullets, line breaks — applied after escaping */
const md = (s) => esc(s)
  .replace(/\\*\\*(.+?)\\*\\*/g, "<b>$1</b>")
  .replace(/_(.+?)_/g, "<i>$1</i>")
  .replace(/^  • /gm, "&nbsp;&nbsp;• ")
  .replace(/\\n/g, "<br>");

/* Every section is the same chat, asked a different question — there is no
   separate Money/Invoices/Taxes page, so a click sends its prompt to
   sendChat() instead of navigating. Home and Ask AI just focus the chat. */
const NAV = [
  ["Home", "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z", true, null],
  ["Ask AI", "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1", false, null],
  ["Money", "M3 7h18v10H3zM7 12h.01M17 12h.01M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", false, "Show my cash position, burn rate, and recent transactions"],
  ["Invoices", "M7 3h10a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6", false, "Show unpaid invoices and receivables aging"],
  ["Taxes & GST", "M4 5h16v14H4zM8 3v4m8-4v4M4 11h16", false, "What's my GST position and upcoming filings?"],
  ["Investments", "M4 17 10 11l4 4 6-7M20 8v4h-4", false, "Show my investment portfolio"],
  ["Reports", "M5 21V9m7 12V3m7 18v-8", false, "Give me the full morning brief"],
  ["Settings", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12", false, null],
];
$("navmenu").innerHTML =
  NAV.map(([name, d, active]) =>
    '<a href="#" class="' + (active ? "active" : "") + '"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>' + name + "</a>"
  ).join("") +
  '<div class="nav-divider"></div>' +
  '<div class="health-card">' +
    '<div class="label">FINANCIAL HEALTH</div>' +
    '<div class="health-row"><span class="health-score" id="hscore">–</span><span class="health-grade" id="hgrade"></span></div>' +
    '<div class="health-bar"><div id="hbar" style="width:0%"></div></div>' +
  "</div>" +
  '<div class="profile" id="profile"></div>';

const navLinks = [...$("navmenu").querySelectorAll("a")];
const closeMenu = () => { $("navmenu").classList.remove("open"); $("menubtn").setAttribute("aria-expanded", "false"); };
$("menubtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = $("navmenu").classList.toggle("open");
  $("menubtn").setAttribute("aria-expanded", open ? "true" : "false");
});
document.addEventListener("click", (e) => { if (!$("navmenu").contains(e.target) && !$("menubtn").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
navLinks.forEach((a, i) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    navLinks.forEach((el) => el.classList.remove("active"));
    a.classList.add("active");
    closeMenu();
    const prompt = NAV[i][3];
    if (prompt) sendChat(prompt);
    else { openThread(); $("chatbox").focus(); }
  });
});

$("dateline").textContent = new Date("${AS_OF}T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

const j = (url, opts) => fetch(url, opts).then((r) => r.json());

/* ---- who is looking ----

   The page renders for two kinds of visitor: a signed-in member, who sees
   their own name and workspace, and everyone else, who is looking at demo
   books and is offered a way in. The cookie decides which — never the client,
   which is why this asks the server rather than reading anything local. */
const initials = (name) =>
  name.trim().split(/\\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

async function loadIdentity() {
  const res = await fetch("/api/me");
  if (!res.ok) {
    $("profile").className = "profile guest";
    $("profile").innerHTML =
      '<a href="/login"><div class="avatar guest">→</div>' +
      '<div class="who"><b>Sign in</b><span>You are viewing demo books</span></div></a>';
    return;
  }
  const me = await res.json();
  const name = me.user.displayName || me.user.email;
  $("profile").className = "profile";
  $("profile").innerHTML =
    '<div class="avatar">' + esc(initials(name)) + "</div>" +
    '<div class="who"><b>' + esc(name) + "</b><span>" + esc(me.workspace) + "</span></div>";
  $("greeting").textContent = "Good morning, " + name.split(/\\s+/)[0];
}

/* ---- brief + health ---- */
async function loadBrief() {
  const b = await j("/api/brief");
  $("hscore").textContent = b.health.score;
  $("hgrade").textContent = b.health.grade;
  $("hbar").style.width = b.health.score + "%";
  // highlight rupee amounts in green/orange like the design
  let i = 0;
  $("brief-text").innerHTML = esc(b.headline).replace(/₹[\\d,]+(?:\\.\\d{2})?/g, (m) => '<span class="' + (i++ === 0 ? "hl-g" : "hl-o") + '">' + m + "</span>");
}

/* ---- metric tiles ---- */
const deltaSpan = (chg, goodWhenUp) => {
  if (chg === null) return "";
  if (chg === 0) return '<span style="color:var(--ink-3);font-weight:700">→ 0%</span> ';
  const up = chg > 0;
  const good = goodWhenUp ? up : !up;
  const cls = good ? "delta-up" : "delta-bad";
  return '<span class="' + cls + '">' + (up ? "↗" : "↘") + " " + Math.abs(chg) + "%</span> ";
};
async function loadTiles() {
  const m = await j("/api/metrics");
  const runwayVal = m.runway.positive ? "∞" : m.runway.days !== null ? m.runway.days + "d" : "—";
  const runwaySub = m.runway.positive ? "cash-flow positive — no burn" : m.runway.burn ? "at current burn of " + m.runway.burn + "/mo" : m.runway.note;
  $("tiles").innerHTML =
    tile("Revenue", m.revenue.value, deltaSpan(m.revenue.changePct, true) + "vs last month", m.revenue.full) +
    tile("Expenses", m.expenses.value, deltaSpan(m.expenses.changePct, false) + "vs last month", m.expenses.full) +
    tile("Profit", m.profit.value, (m.profit.marginPct ?? "—") + "% margin", m.profit.full) +
    tile("Runway", runwayVal, runwaySub, "");
}
const tile = (label, value, sub, title) =>
  '<div class="tile" title="' + esc(title) + '"><div class="t-label">' + label + '</div><div class="t-value">' + value + '</div><div class="t-sub">' + sub + "</div></div>";

/* ---- cash flow chart ---- */
async function loadChart() {
  const data = await j("/api/cashflow");
  const svg = $("chart");
  const W = svg.clientWidth || 520, H = 210, padL = 46, padR = 40, padT = 14, padB = 26;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  const pts = data.points;
  const ys = pts.map((p) => p.closing);
  const yMax = Math.max(...ys) * 1.08, yMin = Math.min(0, Math.min(...ys));
  const x = (i) => padL + (i * (W - padL - padR)) / (pts.length - 1);
  const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const fmtL = (v) => "₹" + (v / 1e5).toFixed(0) + "L";

  let g = "";
  // gridlines + y labels (recessive)
  for (let k = 0; k <= 3; k++) {
    const v = yMin + ((yMax - yMin) * k) / 3;
    g += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#E4E7EE" stroke-width="1"/>';
    g += '<text x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" fill="#878FA1">' + fmtL(v) + "</text>";
  }
  // x labels
  pts.forEach((p, i) => {
    const name = new Date(p.month + "-01T00:00:00").toLocaleDateString("en", { month: "short" });
    g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#878FA1">' + name + "</text>";
  });
  // paths: actual solid, forecast dashed (starts at last actual point)
  const lastActual = pts.map((p) => p.kind).lastIndexOf("actual");
  const path = (from, to) => pts.slice(from, to + 1).map((p, k) => (k ? "L" : "M") + x(from + k) + " " + y(p.closing)).join(" ");
  // soft area under actuals
  g += '<path d="' + path(0, lastActual) + " L" + x(lastActual) + " " + y(yMin) + " L" + x(0) + " " + y(yMin) + ' Z" fill="#0E9C72" opacity="0.07"/>';
  g += '<path d="' + path(0, lastActual) + '" fill="none" stroke="#0E9C72" stroke-width="2" stroke-linecap="round"/>';
  if (lastActual < pts.length - 1)
    g += '<path d="' + path(lastActual, pts.length - 1) + '" fill="none" stroke="#B3770F" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>';
  // end-point markers + direct labels
  const mark = (i, color, label) => {
    g += '<circle cx="' + x(i) + '" cy="' + y(pts[i].closing) + '" r="4" fill="' + color + '" stroke="#FFFFFF" stroke-width="2"/>';
    g += '<text x="' + x(i) + '" y="' + (y(pts[i].closing) - 10) + '" text-anchor="middle" font-size="10.5" font-weight="700" fill="' + color + '">' + label + "</text>";
  };
  mark(lastActual, "#0E9C72", pts[lastActual].closingLabel);
  mark(pts.length - 1, "#B3770F", pts[pts.length - 1].closingLabel);
  // hover targets
  pts.forEach((p, i) => {
    g += '<rect data-i="' + i + '" x="' + (x(i) - (W - padL - padR) / (2 * (pts.length - 1))) + '" y="0" width="' + (W - padL - padR) / (pts.length - 1) + '" height="' + H + '" fill="transparent"/>';
  });
  g += '<line id="xh" y1="' + padT + '" y2="' + (H - padB) + '" stroke="#878FA1" stroke-width="1" stroke-dasharray="2 3" opacity="0"/>';
  svg.innerHTML = g;

  const tip = $("tip");
  svg.addEventListener("mousemove", (e) => {
    const t = e.target.closest("rect[data-i]");
    if (!t) return;
    const i = +t.dataset.i, p = pts[i];
    const xh = svg.querySelector("#xh");
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("opacity", "1");
    tip.style.opacity = 1;
    tip.style.left = (x(i) / W) * svg.clientWidth + "px";
    tip.style.top = (y(p.closing) / H) * 210 + "px";
    tip.innerHTML = "<b>" + p.month + (p.kind === "forecast" ? " · forecast" : "") + "</b><br>Closing " + p.closingLabel + " · Net " + p.netLabel;
  });
  svg.addEventListener("mouseleave", () => { tip.style.opacity = 0; svg.querySelector("#xh").setAttribute("opacity", "0"); });

  const b = await j("/api/brief");
  $("cash-line").innerHTML = "<b>" + b.cash + "</b> in bank · " + esc(data.assumption);
  if (data.depletionMonth) { $("cf-badge").textContent = "At risk"; $("cf-badge").style.color = "#DD4360"; $("cf-badge").style.background = "#FCE9EC"; }
}

/* ---- upcoming ---- */
async function loadUpcoming() {
  const u = await j("/api/upcoming");
  $("upcoming").innerHTML = u.items.map((it) =>
    '<div class="up-item"><div><b>' + esc(it.title) + '</b><span class="sub">' + esc(it.sub) + (it.badge ? ' </span><span class="badge-due">' + it.badge + "</span>" : "</span>") +
    '</div><div class="up-right">' + new Date(it.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + (it.amount ? "<br><b>" + it.amount + "</b>" : "") + "</div></div>"
  ).join("");
}

/* ---- transactions ---- */
async function loadTx() {
  const t = await j("/api/transactions");
  $("tx-sub").textContent = "Auto-categorised by AI" + (t.needsReview ? " · " + t.needsReview + " need review" : "");
  $("txbody").innerHTML = t.rows.map((r) =>
    "<tr><td><b>" + esc(r.narration) + '</b><div class="cat">' + esc(r.category) + " · " + r.date + '</div></td><td class="amt ' + (r.direction === "in" ? "in" : "") + '">' + (r.direction === "in" ? "+" : "−") + r.amount.replace("-", "") + "</td></tr>"
  ).join("");
}

/* ---- recommendations ---- */
async function loadRecs() {
  const r = await j("/api/recommendations");
  $("recs").innerHTML = r.items.map((it) => {
    const badges =
      '<span class="chip conf">' + it.confidence + " confidence</span>" +
      '<span class="chip risk-' + it.risk + '">' + it.risk + " risk</span>" +
      (it.requiresApproval ? '<span class="chip approval">needs approval</span>' : "") +
      (it.status !== "pending" ? '<span class="chip done">' + it.status + "</span>" : "");
    const impact = [it.impact ? "Impact: " + it.impact : null, it.estimatedSavings ? "Est. savings: " + it.estimatedSavings + "/yr" : null].filter(Boolean).join(" · ");
    const actions = it.status === "pending"
      ? '<div class="rec-actions"><button class="btn btn-approve" data-act="approve" data-id="' + it.id + '">Approve</button><button class="btn btn-dismiss" data-act="dismiss" data-id="' + it.id + '">Dismiss</button></div>'
      : "";
    return '<div class="rec"><div class="rec-head"><b>' + esc(it.title) + '</b><div class="rec-badges">' + badges + "</div></div><p>" + esc(it.problem) + " " + esc(it.reason) + '</p><div class="impact">' + impact + "</div>" + actions + "</div>";
  }).join("");
}
$("toggle-recs").addEventListener("click", () => $("recs").classList.toggle("open"));
$("recs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  await fetch("/api/recommendations/" + btn.dataset.id + "/" + btn.dataset.act, { method: "POST" });
  await Promise.all([loadRecs(), loadBrief()]);
});

/* ---- bank feed review ----

   The queue is where the auto-book rate is actually earned: every line
   resolved here can leave a rule behind, so the same payee never asks again.
   The rate is shown beside it because that is the whole point of the work —
   a reviewer should watch the queue get quieter. */
async function loadReview() {
  const d = await j("/api/banking/review");
  const pct = d.stats.autoBookedPct;
  $("review-rate").textContent = pct === null ? "no feed yet" : pct + "% booked automatically";

  if (!d.items.length) {
    $("review-sub").textContent = "Every line in the feed booked itself";
    $("review-list").innerHTML = '<div class="rvw-empty">Nothing waiting — the categoriser placed all of it.</div>';
    return;
  }

  $("review-sub").textContent =
    d.items.length + (d.items.length === 1 ? " line" : " lines") + " the categoriser would not guess an account for";

  const options = d.accounts
    .map((a) => '<option value="' + esc(a.id) + '">' + esc(a.name) + "</option>")
    .join("");

  $("review-list").innerHTML = d.items.map((it) => {
    const kw = it.suggestedKeyword;
    // Learning is offered pre-ticked only when there is something to learn;
    // the keyword stays editable because the reviewer, not the heuristic, is
    // the one vouching for it.
    const learn = kw
      ? '<input type="text" value="' + esc(kw) + '" data-kw aria-label="Keyword to remember">' +
        '<label class="rvw-learn"><input type="checkbox" data-learn checked>remember</label>'
      : "";
    return (
      '<div class="rvw" data-ref="' + esc(it.reference) + '">' +
        '<div class="rvw-head">' +
          '<div><div class="rvw-desc">' + esc(it.description) + "</div>" +
          '<div class="rvw-when">' + esc(it.date) + "</div></div>" +
          '<div class="rvw-amt' + (it.direction === "in" ? " in" : "") + '">' + esc(it.amount) + "</div>" +
        "</div>" +
        '<div class="rvw-form">' +
          "<select data-acc>" + options + "</select>" + learn +
          '<button class="btn btn-quiet" data-book>Book</button>' +
        "</div>" +
        '<div class="rvw-err" hidden></div>' +
      "</div>"
    );
  }).join("");
}

$("review-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-book]");
  if (!btn) return;
  const row = btn.closest(".rvw");
  const err = row.querySelector(".rvw-err");
  const learnBox = row.querySelector("[data-learn]");
  const kwField = row.querySelector("[data-kw]");

  btn.disabled = true;
  err.hidden = true;
  const res = await j("/api/banking/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reference: row.dataset.ref,
      accountId: row.querySelector("[data-acc]").value,
      ...(learnBox && learnBox.checked && kwField.value.trim() ? { learn: kwField.value.trim() } : {}),
    }),
  });

  if (!res.ok) {
    // The rejection is the useful part — a keyword that is not in the line
    // would have become a rule that fires on somebody else's payments.
    btn.disabled = false;
    err.textContent = res.error;
    err.hidden = false;
    return;
  }
  // The books moved, so anything derived from them is now stale.
  await Promise.all([loadReview(), loadTx(), loadTiles(), loadBrief()]);
});

/* ---- chat ---- */
const SUGGESTIONS = [
  "How long can we survive?",
  "Show unpaid invoices",
  "Prepare GST",
  "What subscriptions should I cancel?",
  "Can I hire an engineer at ₹1 lakh/month?",
  "Why did profit change last month?",
];
$("suggest").innerHTML = SUGGESTIONS.map((s) => "<button type='button'>" + s + "</button>").join("");
$("suggest").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") sendChat(e.target.textContent); });
$("ask-brief").addEventListener("click", () => sendChat("Summarize business performance"));
$("chatform").addEventListener("submit", (e) => { e.preventDefault(); const v = $("chatbox").value.trim(); if (v) sendChat(v); $("chatbox").value = ""; });

/* The landing is the empty state. The first question retires it: the ask bar
   moves out of the hero and docks under a scrolling thread, which then keeps
   itself pinned to the newest message. */
let threadOpen = false;
function openThread() {
  if (threadOpen) return;
  threadOpen = true;
  $("askdock").appendChild($("chatform"));
  $("askdock").hidden = false;
  $("landing").hidden = true;
  $("thread").hidden = false;
}
const scrollThread = () => { const t = $("thread"); t.scrollTop = t.scrollHeight; };

/* The conversation so far. The handler is stateless, so the browser holds
   this and returns it each turn — that is what lets "and last month?" mean
   anything. Only completed turns go in: a failed request would otherwise
   leave the model reading its own error message back as context. */
const history = [];
const HISTORY_TURNS = 12;

/* An action the agent drafted this turn. Nothing has happened to the books
   yet — the card is the approval step, and it is rendered from the server's
   list rather than parsed out of the answer text, so a model that describes
   an action it never queued cannot produce a button. */
function actionCards(actions) {
  if (!actions || !actions.length) return "";
  return actions
    .map(
      (a) =>
        '<div class="act" data-id="' + esc(a.id) + '">' +
        '<span class="kind">' + esc(a.kind.replace(/_/g, " ")) + " · needs your approval</span>" +
        '<div class="what">' + esc(a.summary) + "</div>" +
        '<div class="row"><button data-do="approve">Approve</button>' +
        '<button data-do="dismiss">Dismiss</button></div></div>',
    )
    .join("");
}

/* Decisions are delegated from the thread, so cards added later still work. */
$("log").addEventListener("click", async (e) => {
  const btn = e.target.closest(".act button[data-do]");
  if (!btn) return;
  const card = btn.closest(".act");
  const row = card.querySelector(".row");
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const out = await j("/api/actions/" + encodeURIComponent(card.dataset.id) + "/" + btn.dataset.do, { method: "POST" });
    // j() resolves whatever the status was, so a refusal arrives here as a
    // body, not a rejection. Read it, or a failed approval renders as done.
    if (!out.ok) throw new Error(out.error || "refused");
    row.outerHTML =
      '<div class="done">' +
      (btn.dataset.do === "approve" ? "Approved — " + esc(out.result || "done") : "Dismissed. Nothing was posted.") +
      "</div>";
    if (btn.dataset.do === "approve") await Promise.all([loadBrief(), loadTx(), loadUpcoming()]);
  } catch {
    row.outerHTML = '<div class="done">That didn\'t go through — nothing was posted.</div>';
  }
});

async function sendChat(text) {
  openThread();
  const log = $("log");
  log.insertAdjacentHTML("beforeend", '<div class="msg user">' + esc(text) + "</div>");
  log.insertAdjacentHTML("beforeend", '<div class="msg ai thinking" id="pending">Checking the ledger…</div>');
  scrollThread();
  try {
    const res = await j("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(-HISTORY_TURNS) }),
    });
    const tools = res.tools && res.tools.length ? '<span class="tools">verified against: ' + res.tools.join(", ") + "</span>" : "";
    $("pending").outerHTML = '<div class="msg ai">' + md(res.answer) + actionCards(res.actions) + tools + "</div>";
    history.push({ role: "user", text }, { role: "assistant", text: res.answer });
  } catch {
    $("pending").outerHTML = '<div class="msg ai">Something went wrong reaching the engine — try again.</div>';
  }
  scrollThread();
}

loadIdentity(); loadBrief(); loadTiles(); loadChart(); loadUpcoming(); loadTx(); loadRecs(); loadReview();
</script>
</body>
</html>`;

/* ------------------------------------------------------------------ */
/* HTTP server                                                          */
/* ------------------------------------------------------------------ */

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));

/* ------------------------------------------------------------------ */
/* Conversation memory                                                  */
/* ------------------------------------------------------------------ */

/** Turns kept per request — enough to follow a thread, bounded for cost. */
const HISTORY_TURNS = 12;
/** Per-turn character cap, so one request cannot arrive enormous. */
const HISTORY_CHARS = 4000;
/** Leaves room inside the 60s function limit to still send a reply. */
const CHAT_DEADLINE_MS = 48_000;

/**
 * The browser holds the conversation and returns it each turn, because the
 * handler is stateless. That means the history is caller-supplied and cannot
 * be trusted, so it is bounded here rather than taken as given.
 *
 * It does not need to be trusted for correctness: verifyNarration only
 * accepts figures traceable to tool outputs from the current turn, so a
 * fabricated history still cannot put a number into an answer. What it can
 * do is waste context and cost, which is what these caps are for.
 */
/**
 * Which books this request is about.
 *
 * A signed-in caller gets the real, shared runtime. Anyone else gets a demo
 * runtime of their own, keyed by a cookie, so a visitor can approve, edit and
 * categorise without changing what the next visitor sees. The cookie is set
 * on first contact and is not a credential — it names a sandbox, nothing more.
 */
const DEMO_COOKIE = "paisa_demo";

const setDemoCookie = (req, res, id) => {
  res.setHeader("Set-Cookie",
    `${DEMO_COOKIE}=${id}; Path=/; Max-Age=1800; SameSite=Lax; HttpOnly${isSecure(req) ? "; Secure" : ""}`);
};

/**
 * Name the visitor's sandbox on the page response, before the page's own
 * fetches go out.
 *
 * A dashboard paints from half a dozen parallel requests. If the cookie is
 * only set on whichever of them is served first, the others arrive without
 * one and each mint a runtime of their own — six sets of books per visitor,
 * five of them orphaned, and a write that may not land in the one the next
 * read comes from.
 */
const RAW_VIEWS = new Set(["/journal", "/trial-balance", "/balance-sheet", "/profit-and-loss", "/audit"]);

/**
 * The dashboards are for customers, and for visitors who asked to see them.
 *
 * A finance product that shows a ledger to whoever types the URL has to
 * explain that to every buyer who asks how their books are protected, and
 * "those were fake books" is a worse answer than not having shown them. So
 * typing `/console` still lands on the sign-in page: the console is not what
 * this site hands a stranger who guessed a path.
 *
 * `/try` is the door instead. It mints the visitor a sandbox and sends them
 * in carrying its cookie, so the console opens for someone who asked for the
 * demo and stays shut for someone who did not. What they then see is their
 * own runtime, never the real books — that separation is `resolveBooks`, and
 * it is unchanged by opening this door.
 */
const requireSession = (req, res, path) => {
  if (currentSession(req)) return false;
  // Came through /try: not signed in, and `resolveBooks` will hand them a
  // sandbox rather than the real books, but they did ask for the demo.
  if (isDemoId(parseCookies(req.headers.cookie)[DEMO_COOKIE])) return false;
  res.statusCode = 302;
  // Come back to where they were headed once they are signed in, rather than
  // dropping them on a dashboard they did not ask for.
  res.setHeader("Location", `/login?next=${encodeURIComponent(path)}`);
  res.end();
  return true;
};

/**
 * Who is calling, with their authority looked up rather than trusted.
 *
 * The session cookie says who you are and which workspace you are looking
 * at; the role comes from the directory on every request. One answer, used
 * by the read routes and by the write gate, so the two cannot disagree about
 * what a caller is allowed to do.
 */
const authorizeRequest = (req) => {
  const claims = currentSession(req);
  if (!claims) return null;
  const account = accounts.get(claims.userId);
  if (!account) return null;
  try {
    return { account, access: members.authorize(claims.userId, claims.orgId) };
  } catch {
    return null;
  }
};

const resolveBooks = async (req, res) => {
  const me = authorizeRequest(req);
  if (me) {
    const exec = async (type, payload, actor = ACTOR) => (await runtime.execute(type, payload, actor)).result;
    return { org, erp, exec, access: me.access, demo: false };
  }

  const cookies = parseCookies(req.headers.cookie);
  let id = cookies[DEMO_COOKIE];
  if (!isDemoId(id)) {
    id = newDemoId();
    setDemoCookie(req, res, id);
  }
  const session = await demoRuntime(id);
  // A visitor's sandbox travels the same command path as the real books, so
  // a route cannot accidentally work one way signed in and another way out.
  const exec = async (type, payload, actor = ACTOR) => (await session.runtime.execute(type, payload, actor)).result;
  return { org: session.org, erp: session.erp, exec, access: null, demo: true };
};

/**
 * The books a mutating route may write to, or the refusal it must send.
 *
 * Anonymous callers are not turned away — they get their own demo runtime, so
 * the product stays fully clickable without an account — but nothing they do
 * reaches the real books. A signed-in caller must actually hold the
 * permission the route needs; holding a session is not authority.
 */
const booksForWrite = async (req, res, permission) => {
  const books = await resolveBooks(req, res);
  if (!books.demo && !books.access.permissions.has(permission))
    return {
      refusal: {
        code: 403,
        body: { ok: false, error: `Your role (${books.access.role}) cannot ${permission.replace(/_/g, " ")}` },
      },
    };
  return { books };
};

const sanitizeHistory = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-HISTORY_TURNS)
    .map((t) => ({ role: t.role, text: t.text.slice(0, HISTORY_CHARS) }));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

export const handle = async (req, res) => {
  await ready;
  await authReady;
  const path = (req.url ?? "/").split("?")[0];
  const send = (code, body, type = "application/json") => {
    res.statusCode = code;
    res.setHeader("Content-Type", `${type}; charset=utf-8`);
    res.end(type === "application/json" ? JSON.stringify(jsonSafe(body), null, 2) : body);
  };

  /*
   * One host, before anything else runs.
   *
   * The site answers on the apex, on www and on a vercel.app subdomain, all
   * 200, all identical. Three copies of a page compete in an index and the
   * canonical tag only suggests a winner; a 301 decides it. Path and query
   * are preserved, because a redirect that drops them sends every deep link
   * to the home page and discards the ranking it was meant to consolidate.
   *
   * Safe methods only: 301-ing a POST would turn a form submission into a
   * GET and lose the body.
   */
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (req.method === "GET" || req.method === "HEAD") {
    const target = canonicalRedirect(host, req.url);
    if (target) {
      res.statusCode = 301;
      res.setHeader("Location", target);
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.end();
    }
  }
  // Belt as well as braces: a preview deployment or a host that has not been
  // recrawled yet must not be indexed while the 301 propagates.
  if (!isCanonicalHost(host)) res.setHeader("X-Robots-Tag", "noindex");

  try {
    if (path === "/login") {
      const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const next = safeNext(query.get("next"));
      if (currentSession(req)) {
        res.statusCode = 302;
        // Already signed in: go where they were headed, not to the marketing
        // page they have plainly already read.
        res.setHeader("Location", next);
        return res.end();
      }
      return send(200, loginPage(query.get("error"), next, { google: googleEnabled() }), "text/html");
    }

    if (path === "/api/login" && req.method === "POST") {
      const { email, password } = JSON.parse((await readBody(req)) || "{}");
      const account = await accounts.authenticate(String(email ?? ""), String(password ?? ""));
      // One message for both halves. "No account with that email" is a free
      // membership check for anyone holding a list of addresses, which for a
      // finance product is a list of who banks with you.
      if (!account) return send(401, { error: "Invalid email or password" });

      const workspaces = members.listUser(account.userId);
      if (!workspaces.length) return send(403, { error: "Your account is not a member of any workspace." });
      const token = issueSession(account.userId, workspaces[0].orgId, requireSessionSecret());
      res.setHeader("Set-Cookie", sessionCookie(token, isSecure(req)));
      return send(200, { ok: true, orgId: workspaces[0].orgId });
    }

    /* ---- Google sign-in, via Supabase ----

       Three steps, because an OAuth redirect cannot carry a server secret
       and a URL fragment never reaches the server:

         /auth/google      → remember where they were headed, hand them to
                             Supabase
         /auth/callback    → the fragment lands in the browser; a script
                             posts the token back
         /api/auth/google  → verify the token, become a Paisa session       */

    if (path === "/auth/google") {
      const config = googleConfig();
      if (!config) return send(404, { error: "Google sign-in is not configured" });
      // Where they were going travels in a cookie, not in redirect_to —
      // Supabase matches that against an allow-list. Short-lived: it is a
      // breadcrumb for one round trip, not a session.
      const next = safeNext(new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("next"));
      res.setHeader("Set-Cookie",
        `${NEXT_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax; HttpOnly${isSecure(req) ? "; Secure" : ""}`);
      res.statusCode = 302;
      res.setHeader("Location", authorizeUrl(config, originOf(req, isSecure(req))));
      res.end();
      return;
    }

    if (path === "/auth/callback") return send(200, callbackPage(), "text/html");

    if (path === "/api/auth/google" && req.method === "POST") {
      const config = googleConfig();
      if (!config) return send(404, { error: "Google sign-in is not configured" });

      const { token } = JSON.parse((await readBody(req)) || "{}");
      let identity;
      try {
        identity = identityFromToken(String(token ?? ""), {
          jwtSecret: config.jwtSecret,
          issuer: config.issuer,
        });
      } catch (err) {
        // Every rejection reason here is a forged or stale token, and none of
        // them is the visitor's to fix. One message, logged server-side.
        if (err instanceof SupabaseAuthError) console.error(`[paisa] google sign-in rejected: ${err.message}`);
        return send(401, { error: "That Google sign-in could not be verified. Try again." });
      }

      const account = accounts.findByEmail(identity.email);
      // Unlike the password route, this one may say the address is unknown.
      // Supabase has already proved the caller controls it, so naming it
      // leaks nothing they could not learn by reading their own inbox — and
      // "no account" is the one thing that tells them what to do next.
      if (!account)
        return send(403, { error: `No Paisa account for ${identity.email}. Ask an owner to invite you.` });

      const workspaces = members.listUser(account.userId);
      if (!workspaces.length) return send(403, { error: "Your account is not a member of any workspace." });

      const cookies = parseCookies(req.headers.cookie);
      const next = safeNext(decodeURIComponent(cookies[NEXT_COOKIE] ?? ""));
      const session = issueSession(account.userId, workspaces[0].orgId, requireSessionSecret());
      res.setHeader("Set-Cookie", [
        sessionCookie(session, isSecure(req)),
        `${NEXT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${isSecure(req) ? "; Secure" : ""}`,
      ]);
      return send(200, { ok: true, orgId: workspaces[0].orgId, next });
    }

    if (path === "/api/register" && req.method === "POST") {
      // Closed unless deliberately opened: a B2B ledger is not something
      // strangers should be able to create an account on.
      if (!openSignup()) return send(404, { error: "Not found" });
      const { email, password, name } = JSON.parse((await readBody(req)) || "{}");
      try {
        const account = await accounts.register(String(email ?? ""), String(password ?? ""), name);
        return send(201, { ok: true, userId: account.userId, email: account.email });
      } catch (err) {
        return send(400, { error: err.message });
      }
    }

    if (path === "/api/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", clearCookie(isSecure(req)));
      return send(200, { ok: true });
    }

    /* ---- authenticated: identity and workspaces ---- */

    /**
     * Authority is looked up, never read out of the cookie.
     *
     * The session carries only who you are and which workspace you are
     * looking at. The role comes from the directory on every request, so a
     * revoked member is locked out on their next call rather than at their
     * next login, and a role change takes effect immediately.
     */
    const authed = () => authorizeRequest(req);

    if (path === "/api/me") {
      const me = authed();
      if (!me) return send(401, { error: "Not signed in" });
      return send(200, {
        user: me.account,
        orgId: me.access.orgId,
        workspace: workspaceName(me.access.orgId),
        role: me.access.role,
        permissions: [...me.access.permissions].sort(),
        workspaces: members
          .listUser(me.account.userId)
          .map((m) => ({ orgId: m.orgId, name: workspaceName(m.orgId), role: m.role })),
      });
    }

    if (path === "/api/workspace/switch" && req.method === "POST") {
      const me = authed();
      if (!me) return send(401, { error: "Not signed in" });
      const { orgId } = JSON.parse((await readBody(req)) || "{}");
      try {
        // Re-authorising here is the point: a cookie naming a workspace is
        // not evidence of belonging to it.
        members.authorize(me.account.userId, String(orgId ?? ""));
      } catch {
        return send(403, { error: `No access to organization ${orgId}` });
      }
      const token = issueSession(me.account.userId, String(orgId), requireSessionSecret());
      res.setHeader("Set-Cookie", sessionCookie(token, isSecure(req)));
      return send(200, { ok: true, orgId });
    }

    /* ---- members ---- */

    if (path === "/api/members") {
      const me = authed();
      if (!me) return send(401, { error: "Not signed in" });

      if (req.method === "GET") {
        return send(200, {
          items: members.listOrg(me.access.orgId).map((m) => ({
            ...m,
            email: accounts.get(m.userId)?.email ?? null,
            name: accounts.get(m.userId)?.displayName ?? null,
          })),
        });
      }

      if (req.method === "POST") {
        const { email, role } = JSON.parse((await readBody(req)) || "{}");
        const invitee = accounts.findByEmail(String(email ?? ""));
        // Deliberately checked *after* the permission check below would have
        // run — see the try/catch: a caller who cannot manage members must
        // not be able to use this endpoint to discover who has an account.
        try {
          members.require(me.access, "manage_members");
          if (!invitee) return send(404, { error: "No account with that email. Ask them to sign up first." });
          const added = members.add(me.access, invitee.userId, role);
          return send(201, { ok: true, member: { ...added, email: invitee.email } });
        } catch (err) {
          return send(err instanceof AccessError ? 403 : 400, { error: err.message });
        }
      }
    }

    if (path.startsWith("/api/members/")) {
      const me = authed();
      if (!me) return send(401, { error: "Not signed in" });
      const userId = decodeURIComponent(path.slice("/api/members/".length));
      try {
        if (req.method === "PATCH") {
          const { role } = JSON.parse((await readBody(req)) || "{}");
          return send(200, { ok: true, member: members.changeRole(me.access, userId, role) });
        }
        if (req.method === "DELETE") {
          members.remove(me.access, userId);
          return send(200, { ok: true });
        }
      } catch (err) {
        return send(err instanceof AccessError ? 403 : 400, { error: err.message });
      }
    }

    if (path === "/") return send(200, sitePage(), "text/html");

    /* The demo's front door.
     *
     * The sandbox is named here, in one response, rather than by whichever
     * of the console's parallel fetches happens to arrive first — the same
     * reason RAW_VIEWS exists. A visitor who already has a sandbox keeps it,
     * so returning to /try resumes their books instead of resetting them. */
    if (path === "/try") {
      if (!isDemoId(parseCookies(req.headers.cookie)[DEMO_COOKIE]))
        setDemoCookie(req, res, newDemoId());
      res.statusCode = 302;
      res.setHeader("Location", "/app");
      res.end();
      return;
    }

    if (path === "/app") {
      if (requireSession(req, res, path)) return;
      return send(200, page(), "text/html");
    }

    if (path === "/robots.txt") return send(200, robotsTxt(), "text/plain");
    if (path === "/sitemap.xml") return send(200, sitemapXml(), "application/xml");

    // vercel.json rewrites every path into this function, so the social card
    // is served from here rather than trusted to static hosting.
    if (path === "/og.png") {
      const png = await readFile(new URL("../public/og.png", import.meta.url));
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.end(png);
    }

    if (path === "/api/chat" && req.method === "POST") {
      const { message, history } = JSON.parse((await readBody(req)) || "{}");
      if (!message) return send(400, { error: "message required" });
      try {
        const books = await resolveBooks(req, res);

        // Which actions existed before this turn, so the reply can carry only
        // the ones this turn drafted. The queue also holds anything left
        // undecided from earlier questions, and offering those again under a
        // new answer would attach a button to text that never proposed it.
        const before = new Set(books.org.actions.pending().map((a) => a.id));

        // A rejected answer costs a second full agent loop, and two of them
        // can outlive the function. Racing a deadline turns that into an
        // honest reply instead of a 504 with nothing in it.
        const record = await Promise.race([
          orchestrator.ask(
            { ...aiUser, orgId: books.org.orgId },
            books.org,
            message,
            sanitizeHistory(history),
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("agent deadline exceeded")), CHAT_DEADLINE_MS),
          ),
        ]);
        // Logged even when the answer succeeded, because a good answer from a
        // lower rung is exactly the case that otherwise leaves no trace.
        if (provider instanceof FallbackProvider)
          for (const f of provider.lastFailures) console.warn(`[paisa] ${f.name} declined: ${f.error}`);
        const drafted = books.org.actions
          .pending()
          .filter((a) => !before.has(a.id))
          .map((a) => ({ id: a.id, kind: a.kind, summary: a.summary }));
        return send(200, {
          answer: record.finalAnswer,
          tools: record.toolsInvoked.map((t) => t.tool),
          verified: record.verified,
          actions: drafted,
          // Which rung of the chain actually answered. Without this a model
          // outage reads as "the AI got worse today" — the planner's answer
          // is correct but plainer, and nothing on the page said why.
          answeredBy: provider instanceof FallbackProvider ? provider.lastUsedName : provider.name,
        });
      } catch (err) {
        const timedOut = err.message === "agent deadline exceeded";
        return send(200, {
          answer: timedOut
            ? "That took longer than I'm allowed to spend on one question. Try asking for one thing at a time."
            : "I couldn't verify every figure in my draft answer against the ledger, so I'm not sending it. Try rephrasing the question.",
          tools: [],
          verified: false,
          detail: err.message,
        });
      }
    }

    if (path === "/api/demo") {
      const books = await resolveBooks(req, res);
      return send(200, { demo: books.demo, orgId: books.org.orgId, ...demoStats() });
    }

    if (path === "/api/status") {
      const s = await sync(); // pick up anything another instance wrote
      return send(200, {
        persistence: persistence.mode,
        detail: persistence.detail,
        seededThisInstance: persistence.seeded,
        actionsApplied: persistence.appliedThrough,
        syncedNow: s.applied,
        journalEntries: org.journal.all().length,
        trialBalanceBalanced: org.ledger.trialBalance(AS_OF).balanced,
      });
    }

    // "/" and "/site" served the same page under two URLs. The site's own
    // links point at /site, so it stays reachable — as a redirect, not a
    // second copy for a crawler to split authority between.
    if (path === "/site") {
      res.statusCode = 301;
      res.setHeader("Location", "/");
      return res.end();
    }

    const siteRoute = /^\/site\/(product|solution|compare)\/([a-z0-9-]+)$/.exec(path);
    if (siteRoute) {
      const [, kind, slug] = siteRoute;
      const render = kind === "product" ? productPage : kind === "solution" ? solutionPage : comparePage;
      const html = render(slug);
      if (html) return send(200, html, "text/html");
      return send(404, { error: `Unknown ${kind} "${slug}"` });
    }
    const staticSite = {
      "/site/partners": partnersPage,
      "/site/resources": resourcesPage,
      "/site/about": aboutPage,
      "/site/customers": customersPage,
      "/site/contact": contactPage,
      "/site/continuous-close": continuousClosePage,
      "/site/docs": docsPage,
    };
    if (staticSite[path]) return send(200, staticSite[path](), "text/html");
    if (path === "/erp") {
      if (requireSession(req, res, path)) return;
      return send(200, erpPage(), "text/html");
    }

    /* The application console. Reads only — every panel fetches the
       endpoint that owns its numbers, so this page cannot show a figure
       the books do not agree with. */
    if (path === "/console") {
      if (requireSession(req, res, path)) return;
      return send(200, consolePage(), "text/html");
    }

    const erpName = path.replace("/api/erp/", "");
    if (path.startsWith("/api/erp/") && req.method === "GET" && ERP_READS.has(erpName)) {
      const { org: books, erp: suite } = await resolveBooks(req, res);
      return send(200, erpApi(books, suite)[erpName]());
    }

    const propAction = /^\/api\/erp\/proposals\/(prop_[\w]+)\/(approve|dismiss)$/.exec(path);
    if (propAction && req.method === "POST") {
      const [, id, action] = propAction;
      // Approving a proposal posts a journal entry, so it takes the same
      // permission as posting one by hand.
      const { books, refusal } = await booksForWrite(req, res, "post_journal");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const p = action === "approve"
          ? await books.exec("agents.approve", { proposalId: id }, CONTROLLER)
          : await books.exec("agents.dismiss", { proposalId: id, reason: "reviewed" }, CONTROLLER);
        return send(200, { ok: true, id: p.id, status: p.status, entryId: p.resultingEntryId ?? null });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }
    /* Stripe → billing queue. The key lives only in the environment; it is
       never accepted from the request, so a sync cannot be triggered against
       someone else's account by posting a key at this route. */
    if (path === "/api/connectors/stripe/sync" && req.method === "POST") {
      // A sync spends Stripe rate limit and writes to the review queue, so it
      // needs a signed-in caller who runs the connectors. The key is
      // server-side either way, but an open endpoint lets anyone trigger the
      // work — and a viewer is not someone who should be able to.
      const me = authorizeRequest(req);
      if (!me) return send(401, { ok: false, error: "Sign in required" });
      if (!me.access.permissions.has("manage_connectors"))
        return send(403, { ok: false, error: `Your role (${me.access.role}) cannot manage connectors` });

      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey)
        return send(400, {
          ok: false,
          error: "STRIPE_SECRET_KEY is not set. Add a test key (sk_test_…) to .env and restart.",
        });
      try {
        if (!erp.connectors.all().some((c) => c.source === "stripe"))
          erp.connectors.register("stripe", "BILLING");

        const { since } = JSON.parse((await readBody(req)) || "{}");
        const { records, rejected: unmapped } = await fetchBillingRecords({
          secretKey,
          ...(since ? { since } : {}),
        });
        const outcome = erp.connectors.syncBilling("stripe", records, ACTOR);

        // syncBilling only dedupes and hands the records back — it stores
        // nothing. Settled charges become bank lines so they land where the
        // AI CFO can actually see them: auto-posted when a categorisation
        // rule matches, otherwise queued for review.
        const { lines, withheld } = toBankLines(outcome.created);
        const imported = org.banking.importStatement(lines, ACTOR);

        return send(200, {
          ok: true,
          fetched: records.length + unmapped.length,
          ingested: outcome.created.length,
          duplicates: outcome.duplicates.length,
          posted: imported.posted.length,
          needsReview: imported.needsReview.length,
          // Charges Stripe returned that could not be booked, with the reason.
          unmapped,
          // Ingested, but deliberately kept out of the bank feed.
          withheld,
          status: erp.connectors.status("stripe"),
        });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    /* ---- bank feed review: the queue, and the way out of it ---- */

    /**
     * What the categorizer could not book, and the rate at which it books.
     *
     * The suggestion is the keyword a rule would be taught from, offered so a
     * reviewer confirms a word rather than composing one — but it is only ever
     * a default in a field, never applied on its own.
     */
    if (path === "/api/banking/review") {
      const { org: books } = await resolveBooks(req, res);
      return send(200, {
        stats: books.banking.stats(),
        accounts: books.chart
          .all()
          .filter((a) => a.active && (a.type === "EXPENSE" || a.type === "REVENUE"))
          .map((a) => ({ id: a.id, name: a.name, type: a.type })),
        items: books.banking.pendingReview().map((l) => ({
          reference: l.reference,
          date: l.date,
          description: l.description,
          amount: formatINR(l.amount),
          direction: l.amount < 0n ? "out" : "in",
          suggestedKeyword: suggestKeyword(l.description),
        })),
      });
    }

    if (path === "/api/banking/categorize" && req.method === "POST") {
      const { reference, accountId, learn } = JSON.parse((await readBody(req)) || "{}");
      const { books, refusal } = await booksForWrite(req, res, "categorize_transactions");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        // Both sets of books go through the action log, so a taught rule
        // survives a restart of the real instance and behaves identically in
        // a visitor's sandbox.
        await books.exec("banking.categorize", {
          reference: String(reference ?? ""),
          accountId: String(accountId ?? ""),
          ...(learn ? { learn } : {}),
        });
        return send(200, { ok: true, stats: books.org.banking.stats() });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    if (path === "/api/erp/close/run" && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "close_period");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const run = await books.exec("close.run", { period: CLOSE_PERIOD }, CONTROLLER);
        return send(200, { ok: true, passed: run.passed, blocked: run.blocked, readyToClose: run.readyToClose });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }
    if (path === "/api/erp/close/lock" && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "close_period");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const run = await books.exec("close.lock", { period: CLOSE_PERIOD }, CONTROLLER);
        return send(200, { ok: true, locked: run.locked, completedAt: run.completedAt });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    if (path === "/api/actions") {
      const { org: books } = await resolveBooks(req, res);
      return send(200, { items: books.actions.pending() });
    }

    const actAction = /^\/api\/actions\/(prop_[\w]+)\/(approve|dismiss)$/.exec(path);
    if (actAction && req.method === "POST") {
      const [, id, decision] = actAction;
      // A drafted action runs a real effect on approval — an invoice, a
      // posting, a payment — so it takes a deciding permission, not a
      // recording one.
      const { books: resolved, refusal } = await booksForWrite(req, res, "approve_payments");
      if (refusal) return send(refusal.code, refusal.body);
      const books = resolved.org;
      try {
        const settled = decision === "approve"
          ? books.actions.approve(id, ACTOR)
          : books.actions.dismiss(id, ACTOR);
        return send(200, { ok: true, id: settled.id, status: settled.status, result: settled.result ?? null });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    const recAction = /^\/api\/recommendations\/(rec_[\w]+)\/(approve|dismiss)$/.exec(path);
    if (recAction && req.method === "POST") {
      const [, id, action] = recAction;
      const { books, refusal } = await booksForWrite(req, res, "approve_payments");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const rec = await books.exec(`recommendations.${action}`, { id });
        return send(200, { ok: true, id: rec.id, status: rec.status });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    const apiName = path.replace("/api/", "");
    if (path.startsWith("/api/")) {
      const books = await resolveBooks(req, res);
      const routes = apiFor(books.org);
      if (routes[apiName]) return send(200, routes[apiName]());
    }

    /* ---- raw engine views ----
     *
     * These are the drill-down behind the dashboard, and they print the whole
     * ledger: every entry, the trial balance, the audit trail. They used to
     * read the module-level `org`, which meant the real company's books were
     * one unauthenticated GET away. They now answer from whichever books the
     * caller is entitled to, like every other read.
     */
    if (RAW_VIEWS.has(path)) {
      const { org: books } = await resolveBooks(req, res);
      if (path === "/journal")
        return send(200, books.journal.all().map((e) => ({
          id: e.id, date: e.date, narration: e.narration, source: e.sourceModule,
          lines: e.lines.map((l) => ({ account: books.chart.get(l.accountId).name, side: l.side, amount: formatINR(l.amount) })),
        })));
      if (path === "/trial-balance") return send(200, books.ledger.trialBalance(AS_OF));
      if (path === "/balance-sheet") return send(200, books.statements.balanceSheet(AS_OF));
      if (path === "/profit-and-loss") return send(200, books.statements.profitAndLoss(PERIOD_FROM, AS_OF));
      if (path === "/audit") return send(200, books.bus.audit(books.orgId));
    }

    return send(404, { error: `Unknown route ${path}` });
  } catch (err) {
    return send(500, { error: err.message });
  }
};
