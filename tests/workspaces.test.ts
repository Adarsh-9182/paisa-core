/**
 * Every company its own books — through the real router.
 *
 * Signing up used to seat a newcomer as a viewer on the one ledger this
 * deployment boots with, and every signed-in member was handed that ledger
 * whichever company they belonged to. These cases ask the questions that
 * failure answered wrongly: whose books does a new company see, can one
 * company's data reach another's, and does a real company's console work at
 * all on books that start empty and are dated today rather than in the seed.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { indiaBusinessDate } from "../src/erp/cfo-schedule.js";
import { periodOf, prevPeriod } from "../src/erp/periods.js";

process.env.PAISA_OPEN_SIGNUP = "1";
process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");
// @ts-expect-error — same
const { ERP_READS } = await import("../demo/erp-console.js");
// @ts-expect-error — same
const { resetWorkspaces } = await import("../demo/workspaces.js");

interface Reply { status: number; body: any; cookies: readonly string[]; }

let callNumber = 0;

const call = async (
  method: string,
  url: string,
  { cookie = "", body, raw }: { cookie?: string; body?: unknown; raw?: string } = {},
): Promise<Reply> => {
  const payloadIn = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  const req: any = Readable.from(payloadIn === undefined ? [] : [payloadIn]);
  req.method = method;
  req.url = url;
  // A distinct source per call, so the sign-in throttle stays out of these cases.
  req.headers = {
    host: "localhost:4000",
    "x-forwarded-for": `198.51.100.${(callNumber = (callNumber + 1) % 250) + 1}`,
    ...(cookie ? { cookie } : {}),
  };

  const headers = new Map<string, string | string[]>();
  let status = 200;
  let payload = "";
  const res: any = {
    set statusCode(c: number) { status = c; },
    get statusCode() { return status; },
    setHeader: (k: string, v: string | string[]) => headers.set(k.toLowerCase(), v),
    getHeader: (k: string) => headers.get(k.toLowerCase()),
    end: (chunk?: string) => { payload = chunk ?? ""; },
  };
  await handle(req, res);
  const rawCookies = headers.get("set-cookie");
  return {
    status,
    body: payload.startsWith("{") || payload.startsWith("[") ? JSON.parse(payload) : payload,
    cookies: rawCookies === undefined ? [] : Array.isArray(rawCookies) ? rawCookies : [rawCookies],
  };
};

const jar = (reply: Reply) => reply.cookies.map((c) => c.split(";")[0]).join("; ");

let companies = 0;
/** Sign up a fresh company and come back signed in to it. */
const newCompany = async (company: string) => {
  const email = `owner${++companies}-${Date.now().toString(36)}@company.in`;
  const made = await call("POST", "/api/register", {
    body: { email, password: "company-pass-2026", name: company, company },
  });
  expect(made.status).toBe(201);
  const signedIn = await call("POST", "/api/login", { body: { email, password: "company-pass-2026" } });
  expect(signedIn.status).toBe(200);
  return { email, cookie: jar(signedIn) };
};

const founder = async () => {
  const signedIn = await call("POST", "/api/login", { body: { email: "owner@paisa.local", password: "paisa123456-dev" } });
  expect(signedIn.status).toBe(200);
  return jar(signedIn);
};

/** A two-line HDFC-shaped export, dated today so it always falls inside the books. */
const statement = () => {
  const [y, m, d] = indiaBusinessDate().split("-");
  const day = `${d}/${m}/${y}`;
  return [
    "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    `${day},NEFT DR-ACME RETAIL SUPPLIES,N1001,${day},25000.00,,475000.00`,
    `${day},NEFT CR-ZENITH LABS INVOICE,N1002,${day},,150000.00,625000.00`,
  ].join("\n");
};

const reviewCount = async (cookie: string) =>
  (await call("GET", "/api/banking/review", { cookie })).body.items.length as number;

describe("a new company", () => {
  it("starts with empty books, while the founding company keeps its own", async () => {
    const { cookie } = await newCompany("Empty Books Pvt Ltd");
    expect((await call("GET", "/journal", { cookie })).body).toEqual([]);
    expect((await call("GET", "/journal", { cookie: await founder() })).body.length).toBeGreaterThan(0);
  });

  it("gets a working console on empty books — every screen answers", async () => {
    const { cookie } = await newCompany("Every Screen Traders");
    const paths = [
      "/app",
      "/api/me",
      ...["brief", "metrics", "cashflow", "upcoming", "transactions", "recommendations", "invoices"].map((n) => `/api/${n}`),
      ...[...ERP_READS].map((n: string) => `/api/erp/${n}`),
      "/api/banking/review",
      "/journal",
      "/trial-balance",
      "/balance-sheet",
      "/profit-and-loss",
      "/audit",
    ];
    for (const path of paths) {
      const reply = await call("GET", path, { cookie });
      expect(reply.status, `${path}: ${JSON.stringify(reply.body).slice(0, 200)}`).toBe(200);
    }
  });

  it("closes its own last completed month, dated today rather than in the seed", async () => {
    const { cookie } = await newCompany("Month End Co");
    const close = await call("GET", "/api/erp/close", { cookie });
    expect(close.body.period).toBe(prevPeriod(periodOf(indiaBusinessDate())));
  });

  it("gets answers from the assistant about its own books", async () => {
    const { cookie } = await newCompany("Asks Questions LLP");
    const reply = await call("POST", "/api/chat", { cookie, body: { message: "What is my cash position?" } });
    expect(reply.status).toBe(200);
    expect(typeof reply.body.answer).toBe("string");
  });

  it("cannot be created twice from one address", async () => {
    const { email } = await newCompany("Only Once");
    const again = await call("POST", "/api/register", {
      body: { email, password: "company-pass-2026", name: "Again", company: "Second Try" },
    });
    expect(again.status).toBe(400);
  });
});

describe("between companies", () => {
  it("keeps a statement one company imports out of every other company's books", async () => {
    const a = await newCompany("Importer Ltd");
    const b = await newCompany("Bystander Ltd");
    const ownerCookie = await founder();
    const founderBefore = await reviewCount(ownerCookie);

    const imported = await call("POST", "/api/banking/import", { cookie: a.cookie, raw: statement() });
    expect(imported.status).toBe(200);
    expect(imported.body.ok).toBe(true);
    expect(imported.body.read).toBe(2);

    expect(await reviewCount(a.cookie)).toBe(imported.body.needsReview);
    expect(await reviewCount(b.cookie)).toBe(0);
    expect(await reviewCount(ownerCookie)).toBe(founderBefore);
  });

  it("keeps a company's books when they are dropped from memory and rebuilt from the log", async () => {
    const a = await newCompany("Survives Eviction Ltd");
    const imported = await call("POST", "/api/banking/import", { cookie: a.cookie, raw: statement() });
    const before = await reviewCount(a.cookie);
    expect(before).toBe(imported.body.needsReview);

    resetWorkspaces();
    expect(await reviewCount(a.cookie)).toBe(before);
  });
});
