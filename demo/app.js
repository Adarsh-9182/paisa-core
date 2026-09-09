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
import { describeRun } from "../dist/src/erp/cfo-agent.js";
import { indiaBusinessDate, runScheduledCfo, CfoScheduleUnavailableError } from "../dist/src/erp/cfo-schedule.js";
import { FAVICON_PNG, APPLE_TOUCH_PNG } from "./mark.js";
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
  SignInThrottle,
  MemoryThrottleStore,
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
 * Who is asking, for rate-limiting purposes only.
 *
 * x-forwarded-for is caller-supplied on a bare socket, so this is trustworthy
 * exactly to the extent that the proxy in front rewrites it — which Vercel
 * does. It is never used for authority, only to decide whether one source has
 * guessed too many passwords.
 *
 * The leftmost entry is the client; the rest are proxies. An unknown address
 * falls back to one shared bucket rather than to a unique value per request:
 * over-counting throttles a few people together, while under-counting removes
 * the limit altogether, and only one of those is a security failure.
 */
const callerIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] ?? "").trim() || req.socket?.remoteAddress || "unknown";
};

/**
 * Sign-in rate limiting. See src/auth/throttle.ts for the policy and for the
 * honest limits of counting in memory on serverless.
 */
const signInThrottle = new SignInThrottle(new MemoryThrottleStore());

/** One refusal shape, so a throttled caller learns nothing about the account. */
const tooManyAttempts = (res, send, retryAfterSeconds) => {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return send(429, {
    error: "Too many sign-in attempts. Try again in a moment.",
    retryAfterSeconds,
  });
};

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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232F6BFF'/%3E%3Ctext x='16' y='23' font-family='-apple-system,sans-serif' font-size='20' font-weight='700' fill='white' text-anchor='middle'%3E%E2%82%B9%3C/text%3E%3C/svg%3E">
<link rel="icon" type="image/png" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
  :root {
    --bg: #FFFFFF; --side: #F9F9F9; --side-hover: #ECECEC; --surface: #FFFFFF;
    --user-bub: #F4F4F4; --line: rgba(13,16,23,0.10); --line-2: rgba(13,16,23,0.06);
    --ink: #0D1017; --ink-2: #4A5162; --ink-3: #8A91A0;
    --accent: #2F6BFF; --accent-ink: #FFFFFF; --accent-soft: #EDF2FF;
    --green: #0E9C72; --green-soft: #E3F6EF; --amber: #B3770F; --amber-soft: #FDF3E2;
    --red: #DC3E5E; --red-soft: #FDEBEF;
    --code-bg: #0D1017; --code-ink: #E7EAF0;
    --radius: 14px; --shadow: 0 1px 2px rgba(13,16,23,.05), 0 8px 24px rgba(13,16,23,.07);
  }
  :root[data-theme="dark"] {
    --bg: #212121; --side: #171717; --side-hover: #2A2A2A; --surface: #2A2A2A;
    --user-bub: #303030; --line: rgba(255,255,255,0.13); --line-2: rgba(255,255,255,0.07);
    --ink: #ECECEC; --ink-2: #B4B4B4; --ink-3: #8E8E8E;
    --accent: #5B8CFF; --accent-ink: #0D1017; --accent-soft: #1E2A47;
    --green: #3FD3A3; --green-soft: #16302A; --amber: #E0A64B; --amber-soft: #33280F;
    --red: #FF7C93; --red-soft: #3A1C24;
    --code-bg: #0B0D12; --code-ink: #E7EAF0;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.35);
  }
  * { box-sizing: border-box; margin: 0; }
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--bg); color: var(--ink); font-size: 15px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  button, input, textarea { font: inherit; color: inherit; }
  ::selection { background: var(--accent); color: #fff; }

  /* ---------------- shell ---------------- */
  .shell { display: grid; grid-template-columns: 264px 1fr; height: 100vh; }
  .shell.collapsed { grid-template-columns: 0 1fr; }

  /* ---------------- sidebar ---------------- */
  .sidebar {
    background: var(--side); border-right: 1px solid var(--line-2);
    display: flex; flex-direction: column; overflow: hidden; transition: transform .22s ease;
  }
  .shell.collapsed .sidebar { transform: translateX(-100%); }
  .side-top { display: flex; align-items: center; gap: 6px; padding: 10px 10px 6px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: -.2px; padding: 6px 8px; flex: 1; }
  .logo-mark {
    width: 26px; height: 26px; border-radius: 8px; background: var(--accent); color: #fff;
    display: grid; place-items: center; font-weight: 700; font-size: 15px;
  }
  .icon-btn {
    width: 32px; height: 32px; border-radius: 8px; border: 0; background: transparent;
    color: var(--ink-2); display: grid; place-items: center; cursor: pointer; flex: none;
  }
  .icon-btn:hover { background: var(--side-hover); color: var(--ink); }
  .icon-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; }
  .newchat {
    margin: 4px 10px 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--surface); color: var(--ink); font-weight: 550; font-size: 14px;
    display: flex; align-items: center; gap: 9px; cursor: pointer; text-align: left;
  }
  .newchat:hover { background: var(--side-hover); }
  .newchat svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }

  .side-scroll { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
  .side-label { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-3); padding: 12px 10px 6px; }
  .side-nav a {
    display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px;
    color: var(--ink-2); text-decoration: none; font-size: 14px;
  }
  .side-nav a:hover { background: var(--side-hover); color: var(--ink); }
  .side-nav svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; flex: none; }

  .convo {
    display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 9px;
    color: var(--ink-2); font-size: 14px; cursor: pointer; position: relative;
  }
  .convo:hover { background: var(--side-hover); color: var(--ink); }
  .convo.active { background: var(--side-hover); color: var(--ink); font-weight: 550; }
  .convo .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .convo .x { opacity: 0; width: 24px; height: 24px; border-radius: 6px; border: 0; background: transparent;
    color: var(--ink-3); cursor: pointer; flex: none; display: grid; place-items: center; }
  .convo:hover .x { opacity: 1; }
  .convo .x:hover { background: var(--red-soft); color: var(--red); }
  .empty-convos { padding: 10px; font-size: 13px; color: var(--ink-3); }

  .health {
    margin: 8px 10px; padding: 12px; border-radius: 12px; background: var(--surface);
    border: 1px solid var(--line-2);
  }
  .health .label { font-size: 10.5px; font-weight: 650; letter-spacing: .06em; color: var(--ink-3); }
  .health-row { display: flex; align-items: baseline; gap: 8px; margin: 4px 0 8px; }
  .health-score { font-size: 24px; font-weight: 700; letter-spacing: -.5px; }
  .health-grade { font-size: 12px; font-weight: 600; color: var(--ink-2); }
  .health-bar { height: 5px; border-radius: 99px; background: var(--line); overflow: hidden; }
  .health-bar div { height: 100%; background: var(--green); border-radius: 99px; transition: width .5s ease; }

  .profile { border-top: 1px solid var(--line-2); padding: 10px; }
  .profile a, .profile .who-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px;
    border-radius: 9px; text-decoration: none; color: inherit; }
  .profile a:hover, .profile .who-row:hover { background: var(--side-hover); }
  .avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--accent); color: #fff;
    display: grid; place-items: center; font-size: 12px; font-weight: 650; flex: none; }
  .avatar.guest { background: var(--ink-3); }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .who b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who span { font-size: 11.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ---------------- main ---------------- */
  .main { display: flex; flex-direction: column; min-width: 0; position: relative; }
  .topbar {
    height: 52px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
    border-bottom: 1px solid var(--line-2); background: var(--bg); position: sticky; top: 0; z-index: 20;
  }
  .topbar .title { font-weight: 600; font-size: 14.5px; flex: 1; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .auth-actions { display: flex; gap: 8px; }
  .auth-door { font-size: 13px; font-weight: 550; padding: 7px 14px; border-radius: 9px; text-decoration: none; }
  .auth-door.ghost { color: var(--ink-2); border: 1px solid var(--line); }
  .auth-door.ghost:hover { background: var(--side-hover); }
  .auth-door.solid { background: var(--accent); color: #fff; }
  .auth-btn { display: flex; align-items: center; gap: 7px; border: 1px solid var(--line);
    background: transparent; border-radius: 99px; padding: 4px 10px 4px 4px; cursor: pointer; font-size: 13px; }
  .auth-btn:hover { background: var(--side-hover); }
  .avatar-sm { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #fff;
    display: grid; place-items: center; font-size: 10.5px; font-weight: 650; }
  .auth-menu { position: absolute; right: 12px; top: 50px; width: 240px; background: var(--surface);
    border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 6px; z-index: 60; }
  .auth-head { padding: 10px; border-bottom: 1px solid var(--line-2); margin-bottom: 4px; display: flex; flex-direction: column; }
  .auth-head b { font-size: 13.5px; } .auth-head span { font-size: 11.5px; color: var(--ink-3); }
  .auth-item { display: block; width: 100%; text-align: left; padding: 9px 10px; border-radius: 8px;
    border: 0; background: transparent; text-decoration: none; color: var(--ink); font-size: 13.5px; cursor: pointer; }
  .auth-item:hover { background: var(--side-hover); }
  .auth-item.danger { color: var(--red); }

  .scroll { flex: 1; overflow-y: auto; scroll-behavior: smooth; }
  .col { max-width: 760px; margin-inline: auto; padding: 0 24px; }

  /* ---------------- empty state ---------------- */
  .empty { min-height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 48px 0 32px; }
  .hello { text-align: center; margin-bottom: 28px; }
  .hello .dateline { font-size: 12.5px; color: var(--ink-3); letter-spacing: .02em; margin-bottom: 10px; }
  .hello h1 { font-size: 30px; font-weight: 650; letter-spacing: -.7px; line-height: 1.25; }
  .hello p { color: var(--ink-2); margin-top: 6px; font-size: 15px; }
  .hello .mark { width: 46px; height: 46px; border-radius: 14px; background: var(--accent); color: #fff;
    display: grid; place-items: center; font-size: 24px; font-weight: 700; margin: 0 auto 16px; }

  .brief { border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; background: var(--surface); }
  .brief-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .tag { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; color: var(--accent);
    background: var(--accent-soft); padding: 3px 8px; border-radius: 6px; }
  .when { font-size: 11.5px; color: var(--ink-3); }
  .brief p { font-size: 14.5px; color: var(--ink-2); }
  .hl-g { color: var(--green); font-weight: 650; } .hl-o { color: var(--accent); font-weight: 650; }
  .brief-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .btn { border-radius: 9px; padding: 8px 13px; font-size: 13.5px; font-weight: 550; cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink-2); }
  .btn-ghost:hover { background: var(--side-hover); }

  .recs { display: none; flex-direction: column; gap: 10px; margin-top: 12px; }
  .recs.open { display: flex; }
  .rec { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--surface); }
  .rec-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .rec-head b { font-size: 14px; }
  .rec-badges { display: flex; gap: 5px; flex-wrap: wrap; }
  .chip { font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 5px; background: var(--side-hover); color: var(--ink-2); }
  .chip.risk-low { background: var(--green-soft); color: var(--green); }
  .chip.risk-medium { background: var(--amber-soft); color: var(--amber); }
  .chip.risk-high { background: var(--red-soft); color: var(--red); }
  .chip.approval { background: var(--accent-soft); color: var(--accent); }
  .rec p { font-size: 13.5px; color: var(--ink-2); }
  .impact { font-size: 12px; color: var(--ink-3); margin-top: 6px; }
  .rec-actions { display: flex; gap: 8px; margin-top: 10px; }
  .btn-approve { background: var(--green); color: #fff; }
  .btn-dismiss { background: transparent; border-color: var(--line); color: var(--ink-2); }

  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; justify-content: center; }
  .chips button {
    border: 1px solid var(--line); background: var(--surface); border-radius: 99px;
    padding: 8px 14px; font-size: 13px; color: var(--ink-2); cursor: pointer;
  }
  .chips button:hover { background: var(--side-hover); color: var(--ink); border-color: var(--line-strong, var(--line)); }

  /* ---------------- thread ---------------- */
  .thread { padding: 24px 0 8px; }
  .turn { display: flex; gap: 14px; margin-bottom: 26px; }
  .turn.user { justify-content: flex-end; }
  .turn.user .body {
    background: var(--user-bub); border-radius: 18px; padding: 10px 15px; max-width: 78%;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .turn.ai .mark {
    width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: #fff;
    display: grid; place-items: center; font-size: 14px; font-weight: 700; flex: none; margin-top: 1px;
  }
  .turn.ai .body { min-width: 0; flex: 1; }
  .body > *:first-child { margin-top: 0; } .body > *:last-child { margin-bottom: 0; }
  .body p { margin: 0 0 12px; overflow-wrap: anywhere; }
  .body h1, .body h2, .body h3 { line-height: 1.35; margin: 20px 0 8px; font-weight: 650; letter-spacing: -.3px; }
  .body h1 { font-size: 20px; } .body h2 { font-size: 17.5px; } .body h3 { font-size: 15.5px; }
  .body ul, .body ol { margin: 0 0 12px; padding-left: 22px; }
  .body li { margin-bottom: 5px; }
  .body a { color: var(--accent); }
  .body hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  .body blockquote { border-left: 3px solid var(--line); padding-left: 12px; color: var(--ink-2); margin: 0 0 12px; }
  .body code.inline { background: var(--side-hover); padding: 1.5px 5px; border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
  .codeblock { position: relative; margin: 0 0 14px; border-radius: 12px; overflow: hidden; background: var(--code-bg); }
  .codeblock .cb-top { display: flex; align-items: center; justify-content: space-between;
    padding: 7px 12px; font-size: 11.5px; color: #9AA3B2; border-bottom: 1px solid rgba(255,255,255,.08); }
  .codeblock .cb-copy { border: 0; background: transparent; color: #9AA3B2; cursor: pointer; font-size: 11.5px; }
  .codeblock .cb-copy:hover { color: #fff; }
  .codeblock pre { margin: 0; padding: 13px; overflow-x: auto; }
  .codeblock code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.8px;
    color: var(--code-ink); line-height: 1.55; }
  .tablewrap { overflow-x: auto; margin: 0 0 14px; }
  .body table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  .body th, .body td { border: 1px solid var(--line); padding: 7px 11px; text-align: left; }
  .body th { background: var(--side-hover); font-weight: 650; }

  .msgbar { display: flex; gap: 2px; margin-top: 8px; opacity: 0; transition: opacity .15s; }
  .turn.ai:hover .msgbar, .msgbar.stuck { opacity: 1; }
  .msgbar button { border: 0; background: transparent; color: var(--ink-3); cursor: pointer;
    padding: 5px 7px; border-radius: 7px; font-size: 12px; display: flex; align-items: center; gap: 5px; }
  .msgbar button:hover { background: var(--side-hover); color: var(--ink); }
  .msgbar svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; }
  .tools { display: block; margin-top: 10px; font-size: 11.5px; color: var(--ink-3); }
  .badge-unverified { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px;
    color: var(--amber); background: var(--amber-soft); padding: 3px 8px; border-radius: 6px; margin-top: 8px; }

  /* thinking */
  .thinking { display: flex; align-items: center; gap: 9px; color: var(--ink-3); font-size: 14px; }
  .dots { display: inline-flex; gap: 3px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--ink-3); animation: bounce 1.3s infinite; }
  .dots i:nth-child(2) { animation-delay: .18s; } .dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes bounce { 0%,60%,100% { opacity:.25; transform: translateY(0) } 30% { opacity:1; transform: translateY(-3px) } }

  /* action cards */
  .act { border: 1px solid var(--line); border-radius: 12px; padding: 13px; margin-top: 12px; background: var(--surface); }
  .act .kind { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); }
  .act .what { font-size: 14px; margin: 5px 0 10px; }
  .act .row { display: flex; gap: 8px; }
  .act .row button { border-radius: 9px; padding: 7px 13px; font-size: 13px; font-weight: 550; cursor: pointer; border: 1px solid transparent; }
  .act .row button[data-do="approve"] { background: var(--green); color: #fff; }
  .act .row button[data-do="dismiss"] { background: transparent; border-color: var(--line); color: var(--ink-2); }
  .act .done { font-size: 13px; color: var(--ink-2); background: var(--side-hover); padding: 8px 11px; border-radius: 9px; }

  /* ---------------- composer ---------------- */
  .composer-wrap { padding: 10px 0 14px; background: linear-gradient(to top, var(--bg) 62%, transparent); }
  .composer {
    display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--line);
    background: var(--surface); border-radius: 24px; padding: 8px 8px 8px 16px; box-shadow: var(--shadow);
  }
  .composer:focus-within { border-color: var(--accent); }
  .composer textarea {
    flex: 1; border: 0; outline: 0; background: transparent; resize: none; max-height: 200px;
    padding: 7px 0; font-size: 15px; line-height: 1.5;
  }
  .composer textarea::placeholder { color: var(--ink-3); }
  .send {
    width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--accent); color: #fff;
    cursor: pointer; display: grid; place-items: center; flex: none; transition: opacity .15s;
  }
  .send:disabled { opacity: .3; cursor: default; }
  .send svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; }
  .send.stop { background: var(--ink); }
  .send.stop svg { fill: currentColor; }
  .disclaimer { text-align: center; font-size: 11.5px; color: var(--ink-3); margin-top: 8px; }

  .scrim { display: none; }
  @media (max-width: 860px) {
    .shell { grid-template-columns: 1fr; }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: 272px; z-index: 70; transform: translateX(-100%); }
    .shell.mobile-open .sidebar { transform: translateX(0); }
    .shell.collapsed .sidebar { transform: translateX(-100%); }
    .shell.mobile-open .scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 60; }
    .col { padding: 0 16px; }
    .hello h1 { font-size: 25px; }
    .turn.user .body { max-width: 88%; }
  }
</style>
</head>
<body>

<div class="shell" id="shell">
  <div class="scrim" id="scrim"></div>

  <aside class="sidebar">
    <div class="side-top">
      <div class="brand"><span class="logo-mark">₹</span>paisa</div>
      <button class="icon-btn" id="collapse" aria-label="Hide sidebar" title="Hide sidebar">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
      </button>
    </div>
    <button class="newchat" id="newchat">
      <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>New chat
    </button>
    <div class="side-scroll">
      <div class="side-label">Jump to</div>
      <nav class="side-nav" id="navmenu"></nav>
      <div class="side-label">Chats</div>
      <div id="convos"></div>
      <div class="health">
        <div class="label">FINANCIAL HEALTH</div>
        <div class="health-row"><span class="health-score" id="hscore">–</span><span class="health-grade" id="hgrade"></span></div>
        <div class="health-bar"><div id="hbar" style="width:0%"></div></div>
      </div>
    </div>
    <div class="profile" id="profile"></div>
  </aside>

  <main class="main">
    <div class="topbar">
      <button class="icon-btn" id="menubtn" aria-label="Show sidebar">
        <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
      <div class="title" id="threadtitle">New chat</div>
      <button class="icon-btn" id="themebtn" aria-label="Toggle theme" title="Toggle theme"></button>
      <div id="authpill"></div>
    </div>

    <div class="scroll" id="scroll">
      <div class="col">
        <div class="empty" id="empty">
          <div class="hello">
            <div class="mark">₹</div>
            <div class="dateline" id="dateline"></div>
            <h1 id="greeting">Hi, I&#39;m Paisa</h1>
            <p>Your AI CFO. Ask me anything about your money.</p>
          </div>
          <section class="brief">
            <div class="brief-top"><span class="tag">MORNING BRIEF</span><span class="when" id="briefwhen"></span></div>
            <p id="brief-text">Loading your morning brief…</p>
            <div class="brief-actions">
              <button class="btn btn-primary" id="toggle-recs">Review AI recommendations</button>
              <button class="btn btn-ghost" id="ask-brief">Ask about this</button>
            </div>
            <section class="recs" id="recs"></section>
          </section>
          <div class="chips" id="suggest"></div>
        </div>
        <div class="thread" id="thread" hidden></div>
      </div>
    </div>

    <div class="composer-wrap">
      <div class="col">
        <form class="composer" id="chatform">
          <textarea id="chatbox" rows="1" placeholder="Ask anything about your money…"></textarea>
          <button class="send" id="sendbtn" type="submit" aria-label="Send" disabled>
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
        </form>
        <div class="disclaimer">Paisa verifies every figure against your ledger. Nothing is sent or posted without your approval.</div>
      </div>
    </div>
  </main>
</div>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const j = (url, opts) => fetch(url, opts).then((r) => r.json());

/* ---------------- theme ----------------
   The choice is the visitor's and it belongs to this browser, so it lives in
   localStorage. With nothing stored we follow the OS rather than assuming. */
const SUN = '<svg viewBox="0 0 24 24" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("themebtn").innerHTML = t === "dark" ? SUN : MOON;
}
let theme = localStorage.getItem("paisa.theme")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
applyTheme(theme);
$("themebtn").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem("paisa.theme", theme);
  applyTheme(theme);
});

/* ---------------- markdown ----------------
   Escaped first, then marked up, so a model that emits raw HTML cannot
   inject it. Code fences are pulled out before anything else runs, or the
   inline rules would rewrite the code they contain. */
function md(src) {
  const blocks = [];
  let s = String(src == null ? "" : src).replace(/\\r\\n/g, "\\n");

  s = s.replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g, (_m, lang, code) => {
    blocks.push({ lang: lang || "text", code: code.replace(/\\n$/, "") });
    return "\\n\\n@@CB" + (blocks.length - 1) + "@@\\n\\n";
  });

  s = esc(s);

  const inline = (t) => t
    .replace(/\`([^\`]+)\`/g, '<code class="inline">$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
    .replace(/(^|[\\s(])\\*([^*\\n]+)\\*/g, "$1<i>$2</i>")
    .replace(/(^|[\\s(])_([^_\\n]+)_/g, "$1<i>$2</i>")
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = s.split("\\n");
  const out = [];
  let list = null, para = [], table = null;

  const flushPara = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } };
  const flushList = () => {
    if (list) {
      out.push("<" + list.tag + ">" + list.items.map((i) => "<li>" + inline(i) + "</li>").join("") + "</" + list.tag + ">");
      list = null;
    }
  };
  const flushTable = () => {
    if (!table) return;
    const cells = (r) => r.replace(/^\\||\\|$/g, "").split("|").map((c) => c.trim());
    const head = "<tr>" + cells(table[0]).map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr>";
    const rows = table.slice(2).map((r) => "<tr>" + cells(r).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("");
    out.push('<div class="tablewrap"><table>' + head + rows + "</table></div>");
    table = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushTable(); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    if (/^@@CB\\d+@@$/.test(raw)) { flushAll(); out.push(raw); continue; }
    if (!raw) { flushAll(); continue; }

    // A table needs its separator row to be a table at all.
    if (/^\\|.*\\|$/.test(raw) && !table && /^\\|[\\s:|-]+\\|$/.test((lines[i + 1] || "").trim())) {
      flushPara(); flushList(); table = [raw]; continue;
    }
    if (table) {
      if (/^\\|.*\\|$/.test(raw)) { table.push(raw); continue; }
      flushTable();
    }

    const h = raw.match(/^(#{1,3})\\s+(.*)$/);
    if (h) { flushAll(); out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); continue; }
    if (/^(---|\\*\\*\\*|___)$/.test(raw)) { flushAll(); out.push("<hr>"); continue; }
    if (/^&gt;\\s?/.test(raw)) { flushAll(); out.push("<blockquote>" + inline(raw.replace(/^&gt;\\s?/, "")) + "</blockquote>"); continue; }

    const ul = raw.match(/^[-*•]\\s+(.*)$/);
    const ol = raw.match(/^\\d+[.)]\\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      flushPara();
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ul || ol)[1]);
      continue;
    }
    flushList();
    para.push(raw);
  }
  flushAll();

  return out.join("").replace(/@@CB(\\d+)@@/g, (_m, n) => {
    const b = blocks[+n];
    return '<div class="codeblock"><div class="cb-top"><span>' + esc(b.lang) +
      '</span><button class="cb-copy" type="button">Copy</button></div><pre><code>' +
      esc(b.code) + "</code></pre></div>";
  });
}

/* ---------------- conversations ----------------
   The server is stateless, so the browser is the only place a past chat can
   live. Kept per-browser in localStorage; a signed-in member's history does
   not follow them to another device yet. */
const KEY = "paisa.chats.v1";
let chats = [];
let currentId = null;

function loadChats() {
  try { chats = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { chats = []; }
  if (!Array.isArray(chats)) chats = [];
}
function saveChats() {
  try { localStorage.setItem(KEY, JSON.stringify(chats.slice(0, 60))); } catch {}
}
const current = () => chats.find((c) => c.id === currentId) || null;

function titleFrom(text) {
  const t = text.trim().replace(/\\s+/g, " ");
  return t.length > 42 ? t.slice(0, 42).trim() + "…" : t;
}

function renderConvos() {
  const box = $("convos");
  if (!chats.length) { box.innerHTML = '<div class="empty-convos">No chats yet.</div>'; return; }
  box.innerHTML = chats.map((c) =>
    '<div class="convo' + (c.id === currentId ? " active" : "") + '" data-id="' + esc(c.id) + '">' +
      '<span class="t">' + esc(c.title) + "</span>" +
      '<button class="x" data-del="' + esc(c.id) + '" aria-label="Delete chat">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button></div>"
  ).join("");
}

$("convos").addEventListener("click", (e) => {
  const del = e.target.closest("button[data-del]");
  if (del) {
    e.stopPropagation();
    const id = del.dataset.del;
    chats = chats.filter((c) => c.id !== id);
    saveChats();
    if (currentId === id) startNew(); else renderConvos();
    return;
  }
  const row = e.target.closest(".convo");
  if (row) openChat(row.dataset.id);
});

function startNew() {
  currentId = null;
  $("thread").innerHTML = "";
  $("thread").hidden = true;
  $("empty").hidden = false;
  $("threadtitle").textContent = "New chat";
  renderConvos();
  closeMobile();
  $("chatbox").focus();
}
$("newchat").addEventListener("click", startNew);

function openChat(id) {
  const c = chats.find((x) => x.id === id);
  if (!c) return;
  currentId = id;
  $("empty").hidden = true;
  $("thread").hidden = false;
  $("thread").innerHTML = "";
  $("threadtitle").textContent = c.title;
  c.messages.forEach((m) => { if (m.role === "user") addUser(m.text); else addAI(m); });
  renderConvos();
  closeMobile();
  scrollDown(false);
}

/* ---------------- sidebar ---------------- */
const closeMobile = () => $("shell").classList.remove("mobile-open");
$("menubtn").addEventListener("click", () => {
  if (matchMedia("(max-width: 860px)").matches) $("shell").classList.toggle("mobile-open");
  else $("shell").classList.toggle("collapsed");
});
$("collapse").addEventListener("click", () => {
  if (matchMedia("(max-width: 860px)").matches) closeMobile();
  else $("shell").classList.add("collapsed");
});
$("scrim").addEventListener("click", closeMobile);

/* Every section is the same chat asked a different question - there is no
   separate Money/Invoices page, so a click sends its prompt. */
const NAV = [
  ["Money", "M3 7h18v10H3zM7 12h.01M17 12h.01M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "Show my cash position, burn rate, and recent transactions"],
  ["Invoices", "M7 3h10a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6", "Show unpaid invoices and receivables aging"],
  ["Taxes &amp; GST", "M4 5h16v14H4zM8 3v4m8-4v4M4 11h16", "What's my GST position and upcoming filings?"],
  ["Investments", "M4 17 10 11l4 4 6-7M20 8v4h-4", "Show my investment portfolio"],
  ["Reports", "M5 21V9m7 12V3m7 18v-8", "Give me the full morning brief"],
];
$("navmenu").innerHTML = NAV.map(([name, d]) =>
  '<a href="#"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>' + name + "</a>"
).join("");
[...$("navmenu").querySelectorAll("a")].forEach((a, i) => {
  a.addEventListener("click", (e) => { e.preventDefault(); closeMobile(); sendChat(NAV[i][2]); });
});

$("dateline").textContent = new Date("${AS_OF}T00:00:00")
  .toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

/* ---------------- identity ---------------- */
const initials = (name) => name.trim().split(/\\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

async function loadIdentity() {
  const res = await fetch("/api/me");
  if (!res.ok) {
    $("profile").innerHTML =
      '<a href="/login?next=%2Fapp"><div class="avatar guest">→</div>' +
      '<div class="who"><b>Sign in</b><span>You are viewing demo books</span></div></a>';
    $("authpill").innerHTML =
      '<div class="auth-actions">' +
        '<a class="auth-door ghost" href="/login?next=%2Fapp">Sign in</a>' +
        '<a class="auth-door solid" href="/signup?next=%2Fapp">Sign up</a>' +
      "</div>";
    return;
  }
  const me = await res.json();
  const name = me.user.displayName || me.user.email;
  $("profile").innerHTML =
    '<div class="who-row"><div class="avatar">' + esc(initials(name)) + "</div>" +
    '<div class="who"><b>' + esc(name) + "</b><span>" + esc(me.workspace) + "</span></div></div>";
  $("authpill").innerHTML =
    '<button class="auth-btn" id="authBtn" type="button" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="avatar-sm">' + esc(initials(name)) + "</span></button>" +
    '<div class="auth-menu" id="authMenu" hidden role="menu">' +
      '<div class="auth-head"><b>' + esc(name) + "</b><span>" + esc(me.user.email || me.workspace) + "</span></div>" +
      '<a class="auth-item" role="menuitem" href="/console">Console</a>' +
      '<button class="auth-item danger" role="menuitem" id="authOut" type="button">Sign out</button>' +
    "</div>";
  const menu = $("authMenu"), btn = $("authBtn");
  const setOpen = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", open ? "true" : "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  $("authOut").addEventListener("click", () => {
    fetch("/api/logout", { method: "POST" }).finally(() => { location.href = "/login"; });
  });
}

/* ---------------- brief + health ---------------- */
async function loadBrief() {
  const b = await j("/api/brief");
  $("hscore").textContent = b.health.score;
  $("hgrade").textContent = b.health.grade;
  $("hbar").style.width = b.health.score + "%";
  $("briefwhen").textContent = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  let i = 0;
  $("brief-text").innerHTML = esc(b.headline)
    .replace(/₹[\\d,]+(?:\\.\\d{2})?/g, (m) => '<span class="' + (i++ === 0 ? "hl-g" : "hl-o") + '">' + m + "</span>");
}

async function loadRecs() {
  const r = await j("/api/recommendations");
  $("recs").innerHTML = r.items.map((it) => {
    const badges =
      '<span class="chip">' + it.confidence + " confidence</span>" +
      '<span class="chip risk-' + it.risk + '">' + it.risk + " risk</span>" +
      (it.requiresApproval ? '<span class="chip approval">needs approval</span>' : "") +
      (it.status !== "pending" ? '<span class="chip">' + it.status + "</span>" : "");
    const impact = [it.impact ? "Impact: " + it.impact : null,
      it.estimatedSavings ? "Est. savings: " + it.estimatedSavings + "/yr" : null].filter(Boolean).join(" · ");
    const actions = it.status === "pending"
      ? '<div class="rec-actions"><button class="btn btn-approve" data-act="approve" data-id="' + it.id + '">Approve</button>' +
        '<button class="btn btn-dismiss" data-act="dismiss" data-id="' + it.id + '">Dismiss</button></div>'
      : "";
    return '<div class="rec"><div class="rec-head"><b>' + esc(it.title) + '</b><div class="rec-badges">' + badges +
      "</div></div><p>" + esc(it.problem) + " " + esc(it.reason) + '</p><div class="impact">' + impact + "</div>" + actions + "</div>";
  }).join("");
}
$("toggle-recs").addEventListener("click", () => $("recs").classList.toggle("open"));
$("recs").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  await fetch("/api/recommendations/" + btn.dataset.id + "/" + btn.dataset.act, { method: "POST" });
  await Promise.all([loadRecs(), loadBrief()]);
});

/* ---------------- suggestions ---------------- */
const SUGGESTIONS = [
  "How long can we survive?",
  "Show unpaid invoices",
  "Prepare GST",
  "What subscriptions should I cancel?",
  "Why did profit change last month?",
];
$("suggest").innerHTML = SUGGESTIONS.map((s) => "<button type='button'>" + esc(s) + "</button>").join("");
$("suggest").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") sendChat(e.target.textContent); });
$("ask-brief").addEventListener("click", () => sendChat("Summarize business performance"));

/* ---------------- thread rendering ---------------- */
const scrollDown = (smooth = true) => {
  const el = $("scroll");
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
};

function addUser(text) {
  $("thread").insertAdjacentHTML("beforeend",
    '<div class="turn user"><div class="body">' + esc(text) + "</div></div>");
}

const COPY_ICON = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const REDO_ICON = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';

function actionCards(actions) {
  if (!actions || !actions.length) return "";
  return actions.map((a) =>
    '<div class="act" data-id="' + esc(a.id) + '">' +
    '<span class="kind">' + esc(a.kind.replace(/_/g, " ")) + " · needs your approval</span>" +
    '<div class="what">' + esc(a.summary) + "</div>" +
    '<div class="row"><button data-do="approve">Approve</button><button data-do="dismiss">Dismiss</button></div></div>'
  ).join("");
}

function addAI(m) {
  const tools = m.tools && m.tools.length
    ? '<span class="tools">Verified against: ' + esc(m.tools.join(", ")) + "</span>" : "";
  const unverified = m.verified === false
    ? '<div class="badge-unverified">Not fully verified against the ledger</div>' : "";
  $("thread").insertAdjacentHTML("beforeend",
    '<div class="turn ai"><div class="mark">₹</div><div class="body">' +
      '<div class="answer">' + md(m.text) + "</div>" +
      actionCards(m.actions) + unverified + tools +
      '<div class="msgbar"><button data-copy type="button">' + COPY_ICON + "<span>Copy</span></button>" +
      '<button data-redo type="button">' + REDO_ICON + "<span>Try again</span></button></div>" +
    "</div></div>");
}

function addThinking() {
  $("thread").insertAdjacentHTML("beforeend",
    '<div class="turn ai" id="pending"><div class="mark">₹</div><div class="body">' +
    '<div class="thinking">Checking the ledger<span class="dots"><i></i><i></i><i></i></span></div></div></div>');
}

/* Copy, retry, and approvals are delegated so messages rendered later work. */
$("thread").addEventListener("click", async (e) => {
  const copyCode = e.target.closest(".cb-copy");
  if (copyCode) {
    const code = copyCode.closest(".codeblock").querySelector("code").textContent;
    navigator.clipboard.writeText(code).then(() => {
      copyCode.textContent = "Copied";
      setTimeout(() => { copyCode.textContent = "Copy"; }, 1400);
    });
    return;
  }

  const copy = e.target.closest("button[data-copy]");
  if (copy) {
    const label = copy.querySelector("span");
    navigator.clipboard.writeText(copy.closest(".body").querySelector(".answer").innerText).then(() => {
      const bar = copy.closest(".msgbar");
      bar.classList.add("stuck");
      label.textContent = "Copied";
      setTimeout(() => { label.textContent = "Copy"; bar.classList.remove("stuck"); }, 1400);
    });
    return;
  }

  const redo = e.target.closest("button[data-redo]");
  if (redo) {
    const c = current();
    if (!c) return;
    // Drop this answer and the question that produced it, then ask again.
    const turn = redo.closest(".turn");
    let lastUser = null;
    for (let i = c.messages.length - 1; i >= 0; i--) {
      if (c.messages[i].role === "user") { lastUser = c.messages[i].text; c.messages.splice(i); break; }
    }
    if (!lastUser) return;
    const prev = turn.previousElementSibling;
    turn.remove();
    if (prev && prev.classList.contains("user")) prev.remove();
    saveChats();
    sendChat(lastUser);
    return;
  }

  const btn = e.target.closest(".act button[data-do]");
  if (!btn) return;
  const card = btn.closest(".act");
  const row = card.querySelector(".row");
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const out = await j("/api/actions/" + encodeURIComponent(card.dataset.id) + "/" + btn.dataset.do, { method: "POST" });
    if (!out.ok) throw new Error(out.error || "refused");
    row.outerHTML = '<div class="done">' +
      (btn.dataset.do === "approve" ? "Approved — " + esc(out.result || "done") : "Dismissed. Nothing was posted.") + "</div>";
    if (btn.dataset.do === "approve") await loadBrief();
  } catch {
    row.outerHTML = '<div class="done">That did not go through — nothing was posted.</div>';
  }
});

/* ---------------- composer ---------------- */
const box = $("chatbox"), sendbtn = $("sendbtn");
const SEND_ICON = sendbtn.innerHTML;
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';

function autosize() {
  box.style.height = "auto";
  box.style.height = Math.min(box.scrollHeight, 200) + "px";
}
box.addEventListener("input", () => { autosize(); if (!busy) sendbtn.disabled = !box.value.trim(); });
box.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chatform").requestSubmit(); }
});
$("chatform").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) { if (controller) controller.abort(); return; }
  const v = box.value.trim();
  if (!v) return;
  box.value = ""; autosize(); sendbtn.disabled = true;
  sendChat(v);
});

/* ---------------- asking ---------------- */
const HISTORY_TURNS = 12;
let busy = false, controller = null;

function setBusy(on) {
  busy = on;
  sendbtn.disabled = on ? false : !box.value.trim();
  sendbtn.classList.toggle("stop", on);
  sendbtn.innerHTML = on ? STOP_ICON : SEND_ICON;
  sendbtn.setAttribute("aria-label", on ? "Stop" : "Send");
}

async function sendChat(text) {
  if (busy) return;

  let c = current();
  if (!c) {
    c = { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), title: titleFrom(text), messages: [] };
    chats.unshift(c);
    currentId = c.id;
    $("threadtitle").textContent = c.title;
  }
  $("empty").hidden = true;
  $("thread").hidden = false;
  renderConvos();

  addUser(text);
  c.messages.push({ role: "user", text });
  saveChats();
  addThinking();
  scrollDown();
  setBusy(true);

  controller = new AbortController();
  try {
    // Only completed turns become context: a failed request would otherwise
    // feed the model its own error message back as history. The turn just
    // pushed is dropped, because it is sent as the message field.
    const history = c.messages
      .slice(-HISTORY_TURNS - 1)
      .slice(0, -1)
      .map((m) => ({ role: m.role, text: m.text }));

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
      signal: controller.signal,
    }).then((r) => r.json());

    const msg = { role: "assistant", text: res.answer, tools: res.tools, actions: res.actions, verified: res.verified };
    $("pending").remove();
    addAI(msg);
    c.messages.push(msg);
    saveChats();
  } catch (err) {
    const p = $("pending");
    if (p) p.remove();
    const stopped = err && err.name === "AbortError";
    addAI({ role: "assistant", text: stopped ? "_Stopped._" : "Something went wrong reaching the engine — try again." });
  }
  setBusy(false);
  controller = null;
  scrollDown();
}

loadChats(); renderConvos(); autosize();
loadIdentity(); loadBrief(); loadRecs();
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
    /* Two doors, one page. /signup is not a second implementation of the
       form — it is the same page in its other mode, so the two halves cannot
       drift apart and a visitor can swap between them without losing where
       they were headed. */
    if (path === "/login" || path === "/signup") {
      const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const next = safeNext(query.get("next"));
      if (currentSession(req)) {
        res.statusCode = 302;
        // Already signed in: go where they were headed, not to the marketing
        // page they have plainly already read.
        res.setHeader("Location", next);
        return res.end();
      }
      const mode = path === "/signup" ? "signup" : "signin";
      return send(
        200,
        loginPage(query.get("error"), next, { google: googleEnabled(), signup: openSignup(), mode }),
        "text/html"
      );
    }

    if (path === "/api/login" && req.method === "POST") {
      const { email, password } = JSON.parse((await readBody(req)) || "{}");
      const address = String(email ?? "");
      const ip = callerIp(req);

      // Asked before the password is verified, so a locked-out caller does not
      // even spend the server's scrypt work. An address with no account is
      // throttled exactly like one with an account — a 429 that appeared only
      // for real users would be the membership check the next comment exists
      // to prevent.
      const gate = await signInThrottle.check(address, ip);
      if (!gate.allowed) return tooManyAttempts(res, send, gate.retryAfterSeconds);

      const account = await accounts.authenticate(address, String(password ?? ""));
      // One message for both halves. "No account with that email" is a free
      // membership check for anyone holding a list of addresses, which for a
      // finance product is a list of who banks with you.
      if (!account) {
        await signInThrottle.fail(address, ip);
        return send(401, { error: "Invalid email or password" });
      }

      const workspaces = members.listUser(account.userId);
      // Not a failed guess — the password was right — so this does not count
      // against them. Throttling it would lock a correctly-typed password out
      // over a membership problem only an owner can fix.
      if (!workspaces.length) return send(403, { error: "Your account is not a member of any workspace." });

      await signInThrottle.succeed(address, ip);
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

      const ip = callerIp(req);
      // Verifying a token is an HMAC, not scrypt, so this is cheap to attempt
      // — but a forged token is still a guess, and a source that keeps sending
      // them should slow down. Counted under a fixed name rather than a real
      // address: nobody's email is known until the token verifies, and
      // charging a stranger's failures to a real account is how the counter
      // would become a way to lock someone out.
      const GOOGLE_BUCKET = "oauth:google";
      const gate = await signInThrottle.check(GOOGLE_BUCKET, ip);
      if (!gate.allowed) return tooManyAttempts(res, send, gate.retryAfterSeconds);

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
        await signInThrottle.fail(GOOGLE_BUCKET, ip);
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

      await signInThrottle.succeed(GOOGLE_BUCKET, ip);
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

        /* An account with no workspace is an account that cannot sign in —
           /api/login refuses it, correctly, and the new visitor sees a dead
           end one second after creating a password. So the seat is granted
           here, in the same request that created the account.

           Granted through the ordinary `add`, with the founding owner as the
           actor, rather than by writing a membership directly: open signup is
           a deliberate switch on a demo deployment, not a reason to give the
           tenant boundary a second door. And it is capped at `viewer` — the
           new arrival can read the books and cannot touch them. */
        const owner = await authReady;
        if (owner) {
          const booted = await ready;
          members.add(members.authorize(owner.userId, booted.org.orgId), account.userId, "viewer");
        }

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

    // Belt as well as braces: every page already carries this mark as a
    // <link rel="icon">, but a browser's implicit favicon probe — the one it
    // makes for a bookmark, or before it has even parsed the page's <head> —
    // asks for this exact path. Without a route here that probe fell through
    // to the catch-all 404, and what a visitor saw in the tab was whatever
    // their browser shows for a missing icon, never Paisa's.
    if (path === "/favicon.ico") {
      // A real PNG, not the SVG this used to return.
      //
      // Safari does not render SVG favicons at all, so it ignores the
      // <link rel="icon"> data URI and falls back to this path — and what it
      // got back was SVG bytes under image/svg+xml at a URL that promises an
      // icon format. It cannot decode that, so the tab showed the browser's
      // own placeholder rather than the mark. Chrome hid the bug by
      // preferring the link tag.
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.end(FAVICON_PNG);
    }

    // Home-screen and bookmark icon. Same mark, sized for it.
    if (path === "/apple-touch-icon.png" || path === "/apple-touch-icon-precomposed.png") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.end(APPLE_TOUCH_PNG);
    }

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

    /**
     * The scheduled sweep.
     *
     * Vercel's cron calls this once a day with the project's CRON_SECRET as
     * a bearer token; nothing else may reach it, because it writes to the
     * real company's books rather than a visitor's sandbox. With no secret
     * configured the endpoint refuses rather than defaulting to open — an
     * unauthenticated URL that settles findings is worse than no schedule.
     *
     * It runs against the shared runtime, and it syncs first: another
     * instance may have approved something since this one cold started, and
     * sweeping stale books would chase an invoice that is already paid.
     */
    if (path === "/api/cron/sweep") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return send(405, { ok: false, error: "Use GET for the scheduled sweep." });
      }
      const secret = process.env.CRON_SECRET;
      if (!secret) return send(503, { ok: false, error: "No CRON_SECRET is configured, so the schedule is off." });
      if (req.headers.authorization !== `Bearer ${secret}`) return send(401, { ok: false, error: "Not authorised." });

      try {
        return send(200, await runScheduledCfo(runtime, persistence.mode));
      } catch (err) {
        return send(err instanceof CfoScheduleUnavailableError ? 503 : 500, { ok: false, error: err.message });
      }
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
    /*
     * Standing authority.
     *
     * Granting one takes `manage_members`, not `post_journal`, and the
     * difference is the point: a grant is not a posting, it is a
     * non-human actor being given the standing power to make them. That
     * is a membership-shaped decision, so it sits with the permission
     * that governs who may act in this organisation at all.
     *
     * Settling takes `post_journal` — the same permission as approving a
     * proposal by hand, because that is exactly what it does.
     */
    if (path === "/api/erp/authority/grant" && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "manage_members");
      if (refusal) return send(refusal.code, refusal.body);
      const body = JSON.parse((await readBody(req)) || "{}");
      try {
        /*
         * The ceilings arrive as rupee strings, not numbers.
         *
         * Money is bigint paise everywhere inside, and JSON cannot carry a
         * bigint — `JSON.stringify(50000n)` throws and a client that sent a
         * float would be handing an amount limit to floating point. So the
         * wire format is the same string a person would type ("50,000") and
         * `parseINR` is the only thing that turns it into money.
         */
        const a = await books.exec(
          "authority.grant",
          {
            ...body,
            maxAmount: parseINR(String(body.maxAmount ?? "")),
            maxPerSweep: parseINR(String(body.maxPerSweep ?? "")),
          },
          CONTROLLER,
        );
        return send(200, { ok: true, id: a.id, kind: a.kind, grantedBy: a.grantedBy });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    const revoke = /^\/api\/erp\/authority\/([\w]+)\/revoke$/.exec(path);
    if (revoke && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "manage_members");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const a = await books.exec("authority.revoke", { id: revoke[1] }, CONTROLLER);
        return send(200, { ok: true, id: a.id, revokedAt: a.revokedAt });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    if (path === "/api/erp/authority/settle" && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "post_journal");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        // The command names its proposals rather than saying "settle what is
        // open", so replaying the log a year later settles the same queue
        // instead of whatever happens to be open then.
        const open = books.erp.agents.open().map((p) => p.id);
        const result = await books.exec("authority.settle", { proposalIds: open }, CONTROLLER);
        return send(200, {
          ok: true,
          approved: result.approved.length,
          refused: result.refused,
        });
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

    /**
     * Run the standing agent now.
     *
     * The same permission as working the close, because a sweep contains
     * one — plus drafting, which is harmless, and settling, which is not.
     */
    if (path === "/api/erp/cfo/run" && req.method === "POST") {
      const { books, refusal } = await booksForWrite(req, res, "post_journal");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const body = JSON.parse((await readBody(req)) || "{}");
        await books.exec("cfo.run", { asOf: body.asOf || (books.demo ? AS_OF : indiaBusinessDate()), version: 2 }, "cfo-agent");
        return send(200, { ok: true, cfo: erpApi(books.org, books.org.erp).cfo() });
      } catch (err) {
        return send(200, { ok: false, error: err.message });
      }
    }

    /**
     * Setting the plan the agents measure against.
     *
     * Through `books.exec` like every other write, so a budget survives a
     * restart — and behind `set_budget`, which admins and owners hold but
     * accountants do not: whoever can move the budget line can silence the
     * variance that fires on it.
     */
    if (path === "/api/erp/budgets" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const { books, refusal } = await booksForWrite(req, res, "set_budget");
      if (refusal) return send(refusal.code, refusal.body);
      try {
        const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({
          accountId: String(l.accountId ?? ""),
          amount: parseINR(String(l.amount ?? "0")),
        }));
        await books.exec("budget.set", { period: body.period || CLOSE_PERIOD, lines }, CONTROLLER);
        return send(200, { ok: true, budgets: erpApi(books.org, books.org.erp).budgets() });
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
