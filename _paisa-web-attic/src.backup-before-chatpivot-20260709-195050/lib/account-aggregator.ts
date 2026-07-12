/**
 * Account Aggregator (AA) — India's RBI-regulated, consent-based rails for
 * read-only financial data sharing (Sahamati / ReBIT). Paisa is the FIU; the
 * user consents at an AA and the bank (FIP) pushes data through it. No
 * credentials are ever shared with us; consent is time-boxed and revocable.
 *
 * Two implementations behind one interface:
 *   • SandboxAaProvider  — in-app consent, instant, demo FIP data. The default.
 *   • SetuAaProvider     — the real Setu FIU API (redirect consent → poll →
 *                          data session). Setu returns DECRYPTED JSON, so no
 *                          ECDH crypto here. Gated on AA_CLIENT_ID etc.
 *
 * The two differ in `mode`: "inapp" (sandbox modal) vs "redirect" (hand off to
 * the AA and return via /api/aa/callback). Routes and UI branch on it.
 */

export interface FipInfo {
  fipId: string;
  fipName: string;
  hue: number;
}

export interface ConsentDetail {
  fiTypes: string[];
  purpose: string;
  fromDate: string;
  toDate: string;
  frequency: string;
  expiry: string;
}

export interface AaAccount {
  maskedAccountNumber: string;
  accountType: string;
  openingBalance: string; // rupee string, at fromDate
  openingDate: string;
}

export interface AaTransaction {
  date: string;
  description: string;
  amountINR: string; // signed: negative = debit
  reference: string; // bank UTR / txn id — the dedupe key
}

export interface FiAccountData {
  account: AaAccount;
  transactions: AaTransaction[];
}

export type ConsentState = "PENDING" | "ACTIVE" | "REJECTED" | "REVOKED";

export interface CreateConsentInput {
  fipId?: string; // inapp only
  vua?: string; // redirect: virtual user address, e.g. 9999999999@onemoney
  window: { from: string; to: string };
  redirectUrl?: string; // redirect: where the AA returns the user
}

export interface ConsentResult {
  ref: string; // our consent reference (sandbox: encoded handle; Setu: consent id)
  redirectUrl?: string; // present in redirect mode — send the browser here
  consent: ConsentDetail;
  fipName?: string; // inapp
}

export interface AaProvider {
  readonly name: string;
  readonly sandbox: boolean;
  readonly mode: "inapp" | "redirect";
  listFips(): FipInfo[];
  createConsent(input: CreateConsentInput): Promise<ConsentResult>;
  consentStatus(ref: string): Promise<ConsentState>;
  fetchData(ref: string): Promise<FiAccountData[]>;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ─────────────────────────── Sandbox provider ─────────────────────────── */

const FIPS: Array<FipInfo & { masked: string; type: string; opening: number }> = [
  { fipId: "hdfc", fipName: "HDFC Bank", hue: 214, masked: "••4821", type: "CURRENT", opening: 850000 },
  { fipId: "icici", fipName: "ICICI Bank", hue: 24, masked: "••7310", type: "SAVINGS", opening: 320000 },
  { fipId: "axis", fipName: "Axis Bank", hue: 330, masked: "••2093", type: "CURRENT", opening: 500000 },
];

function generate(fipId: string, window: { from: string; to: string }): AaTransaction[] {
  const fip = FIPS.find((f) => f.fipId === fipId)!;
  const tx: AaTransaction[] = [];
  const startY = Number(window.from.slice(0, 4));
  const startM = Number(window.from.slice(5, 7));
  const bump = fip.fipId === "hdfc" ? 0 : fip.fipId === "icici" ? 20000 : 40000;
  for (let i = 3; i >= 1; i--) {
    const total = startY * 12 + (startM - 1) + (3 - i);
    const y = Math.floor(total / 12);
    const mm = String((total % 12) + 1).padStart(2, "0");
    const p = `aa-${fipId}-${y}${mm}`;
    const rows: Array<[string, string, number]> = [
      [`${y}-${mm}-01`, "NEFT credit — Meridian Retail Pvt Ltd", 250000 + bump + i * 5000],
      [`${y}-${mm}-05`, "Office rent — Prestige Estates", -85000],
      [`${y}-${mm}-06`, "AWS subscription", -38000],
      [`${y}-${mm}-15`, "Airtel business broadband", -5500],
      [`${y}-${mm}-18`, "UPI/swiggy-corporate/lunch", -2200 - i * 100],
      [`${y}-${mm}-24`, "Card spend — Amazon Business", -6800],
    ];
    rows.forEach(([date, description, amt], k) => tx.push({ date, description, amountINR: String(amt), reference: `${p}-${k}` }));
  }
  return tx.filter((t) => t.date >= window.from && t.date <= window.to);
}

export function decodeHandle(handle: string): { fipId: string; from: string; to: string } | null {
  if (!handle.startsWith("sbx_")) return null;
  try {
    const p = JSON.parse(Buffer.from(handle.slice(4), "base64url").toString("utf8")) as { fipId: string; from: string; to: string };
    return p.fipId && p.from && p.to ? { fipId: p.fipId, from: p.from, to: p.to } : null;
  } catch {
    return null;
  }
}

class SandboxAaProvider implements AaProvider {
  readonly name = "Sandbox AA";
  readonly sandbox = true;
  readonly mode = "inapp" as const;

  listFips(): FipInfo[] {
    return FIPS.map(({ fipId, fipName, hue }) => ({ fipId, fipName, hue }));
  }

  async createConsent({ fipId, window }: CreateConsentInput): Promise<ConsentResult> {
    if (!fipId) throw new Error("fipId required");
    const payload = { fipId, from: window.from, to: window.to, n: Math.random().toString(36).slice(2, 8) };
    const ref = "sbx_" + Buffer.from(JSON.stringify(payload)).toString("base64url");
    return {
      ref,
      consent: {
        fiTypes: ["Transactions", "Balance", "Profile"],
        purpose: "Financial management & CFO advisory (read-only)",
        fromDate: window.from,
        toDate: window.to,
        frequency: "Daily (auto-refresh)",
        expiry: addDays(window.to, 365),
      },
      fipName: fipName(fipId),
    };
  }

  async consentStatus(): Promise<ConsentState> {
    return "ACTIVE";
  }

  async fetchData(ref: string): Promise<FiAccountData[]> {
    const d = decodeHandle(ref);
    if (!d) throw new Error("Invalid consent reference");
    const fip = FIPS.find((f) => f.fipId === d.fipId);
    if (!fip) throw new Error(`Unknown FIP ${d.fipId}`);
    return [
      {
        account: {
          maskedAccountNumber: fip.masked,
          accountType: fip.type,
          openingBalance: String(fip.opening),
          openingDate: d.from,
        },
        transactions: generate(d.fipId, { from: d.from, to: d.to }),
      },
    ];
  }
}

/* ──────────────────────────── Setu provider ───────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (date: string, end = false) => `${date}T${end ? "23:59:59.000" : "00:00:00.000"}Z`;

class SetuAaProvider implements AaProvider {
  readonly name = "Setu AA";
  readonly sandbox = false;
  readonly mode = "redirect" as const;
  private base = process.env.AA_BASE_URL ?? "https://fiu-sandbox.setu.co";
  private token: { value: string; exp: number } | null = null;

  listFips(): FipInfo[] {
    return []; // Setu presents FIP selection on its own consent screen
  }

  /** Bearer token: a directly-supplied AA_ACCESS_TOKEN, or a client-credentials exchange. */
  private async accessToken(): Promise<string> {
    if (process.env.AA_ACCESS_TOKEN) return process.env.AA_ACCESS_TOKEN;
    if (this.token && this.token.exp > Date.now()) return this.token.value;
    const authUrl = process.env.AA_AUTH_URL;
    if (!authUrl) throw new Error("Set AA_ACCESS_TOKEN or AA_AUTH_URL");
    const res = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientID: process.env.AA_CLIENT_ID, secret: process.env.AA_CLIENT_SECRET }),
    });
    if (!res.ok) throw new Error(`AA auth failed (${res.status})`);
    const j = (await res.json()) as { access_token?: string; token?: string; data?: { token?: string } };
    const value = j.access_token ?? j.token ?? j.data?.token;
    if (!value) throw new Error("AA auth returned no token");
    this.token = { value, exp: Date.now() + 45 * 60 * 1000 };
    return value;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await this.accessToken()}`,
      "x-product-instance-id": process.env.AA_PRODUCT_INSTANCE_ID ?? "",
    };
  }

  async createConsent({ vua, window, redirectUrl }: CreateConsentInput): Promise<ConsentResult> {
    const res = await fetch(`${this.base}/consents`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        consentDuration: { unit: "MONTH", value: "12" },
        vua: vua ?? undefined,
        dataRange: { from: iso(window.from), to: iso(window.to, true) },
        context: [],
        redirectUrl,
        additionalParams: {},
      }),
    });
    if (!res.ok) throw new Error(`Setu create-consent failed (${res.status})`);
    const j = (await res.json()) as { id: string; url: string; status: string };
    return {
      ref: j.id,
      redirectUrl: j.url,
      consent: {
        fiTypes: ["Transactions", "Balance", "Profile"],
        purpose: "Financial management & CFO advisory (read-only)",
        fromDate: window.from,
        toDate: window.to,
        frequency: "Daily (auto-refresh)",
        expiry: addDays(window.to, 365),
      },
    };
  }

  async consentStatus(ref: string): Promise<ConsentState> {
    const res = await fetch(`${this.base}/consents/${ref}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`Setu consent status failed (${res.status})`);
    const j = (await res.json()) as { status: ConsentState };
    return j.status;
  }

  async fetchData(ref: string): Promise<FiAccountData[]> {
    const h = await this.headers();
    // 1. Open a data session against the approved consent.
    const win = { from: iso("2000-01-01"), to: iso(new Date().toISOString().slice(0, 10), true) };
    const sRes = await fetch(`${this.base}/sessions`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ consentId: ref, dataRange: win, format: "json" }),
    });
    if (!sRes.ok) throw new Error(`Setu create-session failed (${sRes.status})`);
    const session = (await sRes.json()) as { id: string };

    // 2. Poll until the FIP delivers data (Setu returns it decrypted).
    let data: SetuSession | null = null;
    for (let i = 0; i < 8; i++) {
      const dRes = await fetch(`${this.base}/sessions/${session.id}`, { headers: h });
      if (!dRes.ok) throw new Error(`Setu fetch-session failed (${dRes.status})`);
      data = (await dRes.json()) as SetuSession;
      if (data.status === "COMPLETED" || data.status === "PARTIAL") break;
      await sleep(1500);
    }
    if (!data) throw new Error("Setu returned no data");

    // 3. Map ReBIT deposit schema → our normalized shape.
    const out: FiAccountData[] = [];
    for (const fip of data.fips ?? []) {
      for (const acc of fip.accounts ?? []) {
        if (acc.status && acc.status !== "DELIVERED") continue;
        const a = acc.data?.account;
        if (!a) continue;
        const raw = a.transactions?.transaction ?? [];
        const transactions: AaTransaction[] = raw.map((t) => ({
          date: (t.transactionTimestamp ?? t.valueDate ?? "").slice(0, 10),
          description: t.narration ?? t.txnId ?? "Bank transaction",
          amountINR: (t.type === "DEBIT" ? "-" : "") + String(t.amount),
          reference: t.txnId ?? t.reference ?? `${acc.maskedAccNumber}-${t.transactionTimestamp}`,
        }));
        const net = transactions.reduce((s, t) => s + Number(t.amountINR), 0);
        const current = Number(a.summary?.currentBalance ?? "0");
        out.push({
          account: {
            maskedAccountNumber: acc.maskedAccNumber ?? "••••",
            accountType: a.summary?.type ?? "SAVINGS",
            openingBalance: String(Math.max(0, Math.round(current - net))),
            openingDate: win.from.slice(0, 10),
          },
          transactions,
        });
      }
    }
    return out;
  }
}

interface SetuSession {
  status: string;
  fips?: Array<{
    fipID?: string;
    accounts?: Array<{
      maskedAccNumber?: string;
      status?: string;
      data?: {
        account?: {
          summary?: { currentBalance?: string; type?: string };
          transactions?: { transaction?: Array<{ type?: string; amount?: string; transactionTimestamp?: string; valueDate?: string; narration?: string; txnId?: string; reference?: string }> };
        };
      };
    }>;
  }>;
}

/* ──────────────────────────── selection ───────────────────────────────── */

export const fipName = (fipId: string): string => FIPS.find((f) => f.fipId === fipId)?.fipName ?? fipId;

/** Real Setu wiring needs the client pair + a product instance. */
export const aaConfigured = (): boolean =>
  Boolean(process.env.AA_CLIENT_ID && process.env.AA_CLIENT_SECRET && process.env.AA_PRODUCT_INSTANCE_ID);

let provider: AaProvider | null = null;
export function getAaProvider(): AaProvider {
  if (!provider) provider = aaConfigured() ? new SetuAaProvider() : new SandboxAaProvider();
  return provider;
}
