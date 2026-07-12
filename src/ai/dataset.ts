/**
 * Fine-tuning data pipeline (spec 007) — the Sonar step of the Perplexity
 * recipe, done the Paisa way.
 *
 * A Paisa narrator model is trained on BEHAVIOUR (grounded, cited financial
 * narration over tool results), never on knowledge (prices, laws, balances).
 * The training data is therefore verified Paisa conversations, and the
 * deterministic engine is the labeler: it generates randomized ledgers,
 * answers questions about them through the same orchestrator + verifier the
 * product uses, and keeps only answers whose every figure survived
 * verifyNarration. Every example is correct by construction.
 *
 * Two sources feed the same JSONL format:
 *   - generateSyntheticDataset(): seeded scenario generator (this file).
 *   - auditRecordToExample(): converts real (opt-in) chat audit records —
 *     the premium source once an LLM provider is live, exactly how
 *     Perplexity's usage data fed Sonar.
 *
 * Format: one {"messages": [...]} per line — system, user (question + the
 * tool results as inline context), assistant (the verified narration).
 * This trains the NARRATOR (generate only from provided context, quote
 * figures verbatim, cite sources). Training tool-CALL policy is a separate,
 * later dataset.
 */

import { Platform } from "../organization.js";
import { parseINR } from "../money.js";
import { parseQty } from "../portfolio.js";
import { AiAuditRecord, AiUser, Orchestrator } from "./orchestrator.js";
import { CfoPlanner } from "./planner.js";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface TrainingExample {
  readonly messages: readonly ChatMessage[];
  readonly meta: {
    readonly scenario: string;
    readonly tools: readonly string[];
    readonly seed: number;
  };
}

/** The behaviour being distilled — matches the production system prompt's hard rules. */
export const NARRATOR_SYSTEM = [
  "You are Paisa, an AI CFO for a small Indian business.",
  "Answer ONLY from the tool results provided in the conversation. Every figure you state must appear in them, quoted exactly: same digits, same comma grouping, same decimals, same ₹ symbol.",
  "Never invent balances, rates, or dates. When data is missing, say exactly what is missing.",
  "When quoting a law or rule, cite its source and verified-as-of date from the tool result.",
  "Lead with the answer, then the reasoning. Concise, plain sentences.",
].join(" ");

const formatToolResults = (record: AiAuditRecord): string =>
  record.toolsInvoked
    .map((t) => `### ${t.tool}(${JSON.stringify(t.args)})\n${t.result}`)
    .join("\n\n");

/**
 * Convert one verified audit record into a training example. Returns null
 * for unverified records — unverified narrations must never teach anything.
 */
export const auditRecordToExample = (
  record: AiAuditRecord,
  meta: { scenario: string; seed: number },
): TrainingExample | null => {
  if (!record.verified) return null;
  return {
    messages: [
      { role: "system", content: NARRATOR_SYSTEM },
      {
        role: "user",
        content: `${record.userQuery}\n\n[Tool results — the only permitted source of figures]\n${formatToolResults(record)}`,
      },
      { role: "assistant", content: record.finalAnswer },
    ],
    meta: { scenario: meta.scenario, tools: record.toolsInvoked.map((t) => t.tool), seed: meta.seed },
  };
};

export const toJsonl = (examples: readonly TrainingExample[]): string =>
  examples.map((e) => JSON.stringify(e)).join("\n") + (examples.length ? "\n" : "");

/** mulberry32 — tiny deterministic PRNG so a seed always yields the same dataset. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rng = () => number;
const int = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const chance = (rng: Rng, p: number): boolean => rng() < p;

const AS_OF = "2026-07-02";
const PERIOD_FROM = "2026-01-01";
const ACTOR = "synth";

const CUSTOMERS = ["Meridian Retail", "Kova Labs", "Sundaram & Co", "BrightPath EdTech", "Anvaya Foods"];
const VENDNARR = {
  salary: ["Payroll — engineering", "Payroll — operations", "Monthly salaries"],
  rent: ["Office rent — HSR Layout", "Office rent — Baner", "Rent for workspace"],
  software: ["AWS invoice", "Google Workspace", "Figma subscription", "GitHub Team", "Zoho Books"],
  marketing: ["Google Ads", "LinkedIn campaign", "Content agency retainer"],
  travel: ["Flights — client visit", "Team offsite travel", "Cab reimbursements"],
  utilities: ["Electricity bill", "Internet — Airtel lease line"],
  professional: ["CA retainer", "Legal consultation"],
} as const;

const month = (m: number, day: number): string =>
  `2026-${String(m).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;

/** Build one randomized-but-deterministic org. Returns the org + which extras it got. */
const buildScenarioOrg = (rng: Rng) => {
  const platform = new Platform();
  const org = platform.createOrganization("org_synth", pick(rng, ["ABC Technologies", "Nimbus Software", "Kirana Plus", "Vector Studio"]));

  const capital = int(rng, 10, 80) * 100_000;
  org.journal.post({
    date: "2026-01-01", narration: "Seed capital",
    lines: [
      { accountId: "acc_bank", side: "DEBIT", amount: parseINR(String(capital)) },
      { accountId: "acc_capital", side: "CREDIT", amount: parseINR(String(capital)) },
    ],
    sourceModule: "manual", createdBy: ACTOR,
  });

  // Six months of revenue and expenses with jitter — a plausible small business.
  const baseRevenue = int(rng, 1, 10) * 100_000;
  const spend: [keyof typeof VENDNARR, string, number][] = [
    ["salary", "5000", int(rng, 50, 400) * 1_000],
    ["rent", "5100", int(rng, 20, 90) * 1_000],
    ["software", "5300", int(rng, 5, 60) * 1_000],
    ["marketing", "5200", int(rng, 0, 80) * 1_000],
    ["utilities", "5500", int(rng, 2, 12) * 1_000],
  ];
  for (let m = 1; m <= 6; m++) {
    const revenue = Math.max(50_000, baseRevenue + int(rng, -30, 30) * 1_000);
    org.journal.post({
      date: month(m, int(rng, 3, 26)), narration: pick(rng, ["Client retainer", "SaaS subscription revenue", "Consulting fees received"]),
      lines: [
        { accountId: "acc_bank", side: "DEBIT", amount: parseINR(String(revenue)) },
        { accountId: "acc_sales", side: "CREDIT", amount: parseINR(String(revenue)) },
      ],
      sourceModule: "manual", createdBy: ACTOR,
    });
    for (const [kind, code, base] of spend) {
      if (base === 0) continue;
      const amt = Math.max(1_000, base + int(rng, -5, 5) * 1_000);
      const acct = org.chart.getByCode(code);
      org.journal.post({
        date: month(m, int(rng, 1, 28)), narration: pick(rng, VENDNARR[kind]),
        lines: [
          { accountId: acct.id, side: "DEBIT", amount: parseINR(String(amt)) },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR(String(amt)) },
        ],
        sourceModule: "manual", createdBy: ACTOR,
      });
    }
  }

  // Extras, each on a coin flip, so empty states are trained too.
  const hasDuplicate = chance(rng, 0.3);
  if (hasDuplicate) {
    const amt = int(rng, 15, 90) * 1_000;
    const narration = `${pick(rng, VENDNARR.software)} #${int(rng, 100, 999)}`;
    const acct = org.chart.getByCode("5300");
    for (const d of [month(6, 18), month(6, 18 + int(rng, 1, 4))])
      org.journal.post({
        date: d, narration,
        lines: [
          { accountId: acct.id, side: "DEBIT", amount: parseINR(String(amt)) },
          { accountId: "acc_bank", side: "CREDIT", amount: parseINR(String(amt)) },
        ],
        sourceModule: "manual", createdBy: ACTOR,
      });
  }

  const hasInvoices = chance(rng, 0.6);
  if (hasInvoices) {
    for (let i = 0; i < int(rng, 1, 3); i++) {
      const issueDate = month(int(rng, 3, 5), int(rng, 1, 28));
      // Due 15–45 days after issue — some land before AS_OF and go overdue.
      const due = new Date(Date.parse(`${issueDate}T00:00:00Z`) + int(rng, 15, 45) * 86_400_000);
      const inv = org.invoices.create(
        {
          number: `INV-2026-${100 + i}`,
          customer: pick(rng, CUSTOMERS),
          issueDate,
          dueDate: due.toISOString().slice(0, 10),
          lines: [{ description: "Professional services", amount: parseINR(String(int(rng, 40, 500) * 1_000)), gstRatePct: 18 }],
        },
        ACTOR,
      );
      org.invoices.send(inv.id, ACTOR);
    }
  }

  const hasPortfolio = chance(rng, 0.4);
  if (hasPortfolio) {
    const qty = int(rng, 50, 500);
    const buyPrice = int(rng, 200, 300);
    org.portfolio.record(
      { symbol: "NIFTYBEES", name: "Nippon India Nifty 50 BeES", kind: "ETF", side: "BUY", date: month(2, 10), qty: parseQty(String(qty)), pricePerUnit: parseINR(String(buyPrice)) },
      ACTOR,
    );
    if (chance(rng, 0.7))
      org.portfolio.mark("NIFTYBEES", month(6, 30), parseINR(String(buyPrice + int(rng, -20, 40))), ACTOR, "nse-close");
  }

  return { org, hasDuplicate, hasInvoices, hasPortfolio };
};

/** Question pools, keyed by scenario name. Phrasings vary; the route is stable. */
const QUESTION_POOLS: readonly { scenario: string; pool: readonly string[] }[] = [
  { scenario: "cash", pool: ["How much cash do we have right now?", "What's our bank balance today?", "What's our current cash position?"] },
  { scenario: "runway", pool: ["What's our runway?", "How long can we survive at this burn rate?", "What's our monthly burn and runway?"] },
  { scenario: "pnl", pool: ["What was our profit last month?", "How much did we spend this month?", "Show me revenue and expenses for this month."] },
  { scenario: "invoices", pool: ["Which invoices are overdue?", "Who owes us money right now?", "Show me unpaid invoices."] },
  { scenario: "gst", pool: ["What is my GST position for this month?", "When are my GST filings due?", "How much GST do we owe?"] },
  { scenario: "afford", pool: ["Can we afford to spend ₹1,50,000 on new laptops?", "Can we spend 2 lakh on a marketing push?", "Can we afford to pay ₹80,000 for a conference sponsorship?"] },
  { scenario: "hire", pool: ["Can we afford to hire an engineer at ₹1,20,000 per month?", "What happens to runway if we hire someone at 90000 monthly?"] },
  { scenario: "portfolio", pool: ["How are my investments doing?", "Show me my portfolio.", "What's my portfolio worth?"] },
  { scenario: "screening", pool: ["Any duplicate or suspicious payments recently?", "Run a fraud check on recent transactions.", "Were we double-charged for anything?"] },
  { scenario: "forecast", pool: ["What does our cash look like next quarter?", "Project our cash position for the next few months."] },
  { scenario: "subscriptions", pool: ["How much are we spending on subscriptions?", "What recurring payments do we have?"] },
  { scenario: "health", pool: ["How is the business doing overall?", "What's our financial health score?"] },
  {
    scenario: "regulation",
    pool: [
      "Can I claim ITC on food and beverages for the office?",
      "What GST rate applies to software services?",
      "What is the turnover limit under section 44AD?",
      "How does 44ADA presumptive taxation work for freelancers?",
      "TDS rate on professional fees?",
      "When is advance tax due?",
      "Do we need e-invoicing? What's the threshold?",
      "Am I eligible for the composition scheme?",
      "What are the GST rate slabs now?",
      "How much can I deduct under 80C?",
    ],
  },
];

export interface DatasetResult {
  readonly examples: readonly TrainingExample[];
  readonly attempted: number;
  readonly discarded: number;
}

/**
 * Generate `count` verified training examples from seeded synthetic
 * scenarios. Same seed → byte-identical dataset. Unverified or failed
 * conversations are discarded and counted, never silently patched.
 */
export const generateSyntheticDataset = async (count: number, seed = 1): Promise<DatasetResult> => {
  const rng = mulberry32(seed);
  const user: AiUser = { userId: ACTOR, orgId: "org_synth", permissions: new Set(["access_ai_cfo", "view_reports"]) };
  const examples: TrainingExample[] = [];
  let attempted = 0;
  let discarded = 0;

  while (examples.length < count && attempted < count * 3) {
    attempted++;
    const { org } = buildScenarioOrg(rng);
    const { scenario, pool } = pick(rng, QUESTION_POOLS);
    const question = pick(rng, pool);
    const orchestrator = new Orchestrator(new CfoPlanner({ asOf: AS_OF, periodFrom: PERIOD_FROM }), 5, {
      asOf: AS_OF,
      periodFrom: PERIOD_FROM,
    });
    try {
      const record = await orchestrator.ask(user, org, question);
      const example = auditRecordToExample(record, { scenario, seed });
      if (example) examples.push(example);
      else discarded++;
    } catch {
      discarded++;
    }
  }
  return { examples, attempted, discarded };
};
