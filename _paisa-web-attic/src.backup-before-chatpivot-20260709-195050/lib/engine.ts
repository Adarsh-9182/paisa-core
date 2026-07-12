/**
 * Engine bootstrap — one seeded organization + AI orchestrator per process.
 *
 * The paisa-core engines are in-memory; a globalThis cache keeps the
 * singleton stable across Next.js hot reloads. Durable state is the persisted
 * action log (Postgres or JSONL — see store.ts), replayed incrementally on
 * every getPaisa() call, so all server instances converge.
 */

import {
  Platform,
  parseINR,
  parseQty,
  Orchestrator,
  CfoPlanner,
  AnthropicProvider,
  FallbackProvider,
  type Organization,
  type AiUser,
  type Permission,
} from "paisa-core";
import { applyActions, fetchActionsAfter } from "./store";

export const AS_OF = "2026-07-02";
export const PERIOD_FROM = "2026-01-01";
export const ACTOR = "adarsh";

export interface PaisaRuntime {
  org: Organization;
  orchestrator: Orchestrator;
  aiUser: AiUser;
  providerName: string;
}

function build(): PaisaRuntime {
  const platform = new Platform();
  // Org id must stay "org_nimbus" — the action log (file and Postgres) is keyed on it.
  const org = platform.createOrganization("org_nimbus", "Adarsh Kumar");

  // ---- Adarsh's personal money story (the one-job MVP demo, Bible §1) ----

  const post = (date: string, narration: string, drId: string, crId: string, amt: string, sourceModule = "manual") =>
    org.journal.post({
      date,
      narration,
      lines: [
        { accountId: drId, side: "DEBIT", amount: parseINR(amt) },
        { accountId: crId, side: "CREDIT", amount: parseINR(amt) },
      ],
      sourceModule,
      createdBy: ACTOR,
    });

  // Personal categories on top of the generic double-entry chart.
  const personalAccounts: [string, string, string, "REVENUE" | "EXPENSE"][] = [
    ["acc_salary_income", "4500", "Salary", "REVENUE"],
    ["acc_home", "5805", "Rent & Home", "EXPENSE"],
    ["acc_food", "5810", "Food & Dining", "EXPENSE"],
    ["acc_groceries", "5815", "Groceries", "EXPENSE"],
    ["acc_transport", "5820", "Transport", "EXPENSE"],
    ["acc_shopping", "5830", "Shopping", "EXPENSE"],
    ["acc_subs", "5840", "Subscriptions", "EXPENSE"],
    ["acc_emi", "5850", "EMI & Loans", "EXPENSE"],
  ];
  for (const [id, code, name, type] of personalAccounts)
    org.chart.add({ id, code, name, type, parentId: null, isCashEquivalent: false, active: true });

  // How UPI/bank descriptions map to categories — same auto-categorise gate
  // real imported statements flow through.
  const personalRules: [string, string, string][] = [
    // NOTE: the banking gate applies FIRST matching rule, and the engine's
    // default SMB rules run before these — so descriptions below deliberately
    // avoid the default keywords ("salary", "rent", "uber", …).
    ["technova", "acc_salary_income", "Salary"],
    ["nobroker", "acc_home", "Rent & Home"],
    ["swiggy", "acc_food", "Food & Dining"],
    ["zomato", "acc_food", "Food & Dining"],
    ["blinkit", "acc_groceries", "Groceries"],
    ["zepto", "acc_groceries", "Groceries"],
    ["yatri", "acc_transport", "Transport"],
    ["rapido", "acc_transport", "Transport"],
    ["amazon", "acc_shopping", "Shopping"],
    ["flipkart", "acc_shopping", "Shopping"],
    ["myntra", "acc_shopping", "Shopping"],
    ["netflix", "acc_subs", "Subscriptions"],
    ["spotify", "acc_subs", "Subscriptions"],
    ["hotstar", "acc_subs", "Subscriptions"],
    ["cult", "acc_subs", "Subscriptions"],
    ["emi", "acc_emi", "EMI & Loans"],
  ];
  for (const [keyword, accountId, label] of personalRules) org.banking.addRule({ keyword, accountId, label });

  post("2026-01-01", "Opening balance", "acc_bank", "acc_capital", "2,80,000");

  // Small deterministic month-to-month variation so the story feels lived-in.
  const vary = (base: number, m: number, step: number) => String(base + ((m * 7) % 5) * step);

  for (let m = 1; m <= 6; m++) {
    const mm = String(m).padStart(2, "0");
    org.banking.importStatement(
      [
        { date: `2026-${mm}-01`, description: "NEFT CR TECHNOVA PVT LTD", amount: parseINR("1,45,000"), reference: `sal-${mm}` },
        { date: `2026-${mm}-02`, description: "NOBROKER HOUSE PAYMENT", amount: parseINR("-30,000"), reference: `rent-${mm}` },
        { date: `2026-${mm}-05`, description: "HDFC BANK EMI", amount: parseINR("-18,500"), reference: `emi-${mm}` },
        { date: `2026-${mm}-04`, description: "NETFLIX", amount: parseINR("-649"), reference: `nfx-${mm}` },
        { date: `2026-${mm}-05`, description: "SPOTIFY", amount: parseINR("-119"), reference: `spt-${mm}` },
        { date: `2026-${mm}-06`, description: "HOTSTAR", amount: parseINR("-299"), reference: `hst-${mm}` },
        { date: `2026-${mm}-07`, description: "CULT FIT MEMBERSHIP", amount: parseINR("-1,500"), reference: `cult-${mm}` },
        { date: `2026-${mm}-08`, description: "UPI SWIGGY ORDER", amount: parseINR(`-${vary(2400, m, 180)}`), reference: `swg-a-${mm}` },
        { date: `2026-${mm}-15`, description: "UPI ZOMATO ORDER", amount: parseINR(`-${vary(1900, m, 140)}`), reference: `zmt-${mm}` },
        { date: `2026-${mm}-22`, description: "UPI SWIGGY ORDER", amount: parseINR(`-${vary(2100, m, 160)}`), reference: `swg-b-${mm}` },
        { date: `2026-${mm}-09`, description: "BLINKIT GROCERIES", amount: parseINR(`-${vary(2200, m, 120)}`), reference: `blk-${mm}` },
        { date: `2026-${mm}-19`, description: "ZEPTO GROCERIES", amount: parseINR(`-${vary(1700, m, 90)}`), reference: `zpt-${mm}` },
        { date: `2026-${mm}-11`, description: "NAMMA YATRI AUTO", amount: parseINR(`-${vary(1400, m, 110)}`), reference: `ubr-${mm}` },
        { date: `2026-${mm}-24`, description: "RAPIDO", amount: parseINR(`-${vary(700, m, 60)}`), reference: `rpd-${mm}` },
        { date: `2026-${mm}-13`, description: "AMAZON.IN", amount: parseINR(`-${vary(3200, m, 400)}`), reference: `amz-${mm}` },
        { date: `2026-${mm}-27`, description: "FLIPKART", amount: parseINR(`-${vary(1800, m, 260)}`), reference: `fk-${mm}` },
        { date: `2026-${mm}-16`, description: "BESCOM ELECTRICITY", amount: parseINR(`-${vary(1350, m, 70)}`), reference: `el-${mm}` },
        { date: `2026-${mm}-18`, description: "AIRTEL BROADBAND", amount: parseINR("-999"), reference: `net-${mm}` },
        { date: `2026-${mm}-20`, description: "JIO RECHARGE", amount: parseINR("-599"), reference: `jio-${mm}` },
      ],
      ACTOR,
    );

    // Monthly SIP — every trade posts to the ledger through the same gate.
    org.portfolio.record(
      {
        symbol: "PPFCF",
        name: "Parag Parikh Flexi Cap (Direct)",
        kind: "MUTUAL_FUND",
        side: "BUY",
        date: `2026-${mm}-03`,
        qty: parseQty(String(Math.round((25000 / (83 + m)) * 1000) / 1000)),
        pricePerUnit: parseINR(String(83 + m)),
      },
      ACTOR,
    );
  }

  // July so far: salary landed, rent went out, two spends await categorisation.
  org.banking.importStatement(
    [
      { date: "2026-07-01", description: "NEFT CR TECHNOVA PVT LTD", amount: parseINR("1,45,000"), reference: "sal-07" },
      { date: "2026-07-02", description: "NOBROKER HOUSE PAYMENT", amount: parseINR("-30,000"), reference: "rent-07" },
      { date: "2026-06-28", description: "IMPS 4032 Chai Point", amount: parseINR("-1,250"), reference: "imps-4032" },
      { date: "2026-06-30", description: "UPI transfer to Rahul", amount: parseINR("-3,400"), reference: "upi-rahul" },
    ],
    ACTOR,
  );

  // One-time ETF position and an FD parked from a bonus. Market values exist
  // only where a price has been explicitly marked.
  org.portfolio.record(
    { symbol: "NIFTYBEES", name: "Nippon India Nifty 50 BeES", kind: "ETF", side: "BUY", date: "2026-02-10", qty: parseQty("400"), pricePerUnit: parseINR("255.40"), fees: parseINR("120") },
    ACTOR,
  );
  org.portfolio.record(
    { symbol: "HDFC-FD-182D", name: "HDFC Bank FD · 182 days · 7.1%", kind: "FIXED_DEPOSIT", side: "BUY", date: "2026-03-04", qty: parseQty("1"), pricePerUnit: parseINR("1,00,000") },
    ACTOR,
  );
  org.portfolio.mark("NIFTYBEES", "2026-07-01", parseINR("271.05"), ACTOR, "nse-close");
  org.portfolio.mark("PPFCF", "2026-07-01", parseINR("92.40"), ACTOR, "amfi-nav");
  // The FD is deliberately left unmarked — Paisa declares it, never guesses.

  org.recommendations.generate(AS_OF, PERIOD_FROM);

  const planner = new CfoPlanner({ asOf: AS_OF, periodFrom: PERIOD_FROM });
  const useAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const anthropic = useAnthropic ? new AnthropicProvider() : null;
  const provider = anthropic ? new FallbackProvider([anthropic, planner]) : planner;
  const orchestrator = new Orchestrator(provider, 6, { asOf: AS_OF, periodFrom: PERIOD_FROM });
  const aiUser: AiUser = {
    userId: ACTOR,
    orgId: org.orgId,
    permissions: new Set<Permission>(["access_ai_cfo", "view_reports"]),
  };

  return {
    org,
    orchestrator,
    aiUser,
    providerName: anthropic
      ? `Anthropic (${anthropic.model}) with server-side Opus fallback + offline planner`
      : "Offline CFO planner (deterministic)",
  };
}

interface Cached {
  runtime: PaisaRuntime;
  lastSeq: number; // highest action_log seq applied to this instance's engines
}

const g = globalThis as unknown as { __paisa?: Cached; __paisaRefresh?: Promise<void> };

/**
 * The runtime, with incremental replay (spec 001): every call applies any
 * persisted actions this instance hasn't seen, so all server instances
 * converge on the same state. Refreshes are serialized through a promise
 * chain — two concurrent requests can never double-apply the same actions.
 */
export async function getPaisa(): Promise<PaisaRuntime> {
  // build() is sync — no first-call race. The shape check discards a stale
  // global left by hot-reloading across module versions.
  if (!g.__paisa?.runtime) g.__paisa = { runtime: build(), lastSeq: 0 };
  const cached = g.__paisa;
  const refresh = (g.__paisaRefresh ?? Promise.resolve()).then(async () => {
    const fresh = await fetchActionsAfter(cached.lastSeq);
    if (fresh.length > 0) {
      applyActions(cached.runtime.org, fresh.map((f) => f.action));
      cached.lastSeq = fresh[fresh.length - 1].seq;
    }
  });
  g.__paisaRefresh = refresh.catch(() => {}); // keep the chain alive after a failed fetch
  await refresh;
  return cached.runtime;
}
