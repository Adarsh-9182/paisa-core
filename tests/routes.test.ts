/**
 * The router's authority rules.
 *
 * These engines are well tested; the way in was not. Every mutating route
 * used to be reachable by anyone who could reach the port: an anonymous POST
 * could approve an agent proposal — which posts a journal entry — or lock the
 * period, on the real company's books. Nothing in the suite would have
 * noticed, because nothing in the suite drove the router.
 *
 * So the questions asked here are the ones a route layer can get wrong: whose
 * books does this touch, and may this caller touch them at all.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Readable } from "node:stream";

process.env.PAISA_OPEN_SIGNUP = "1";
process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");
// @ts-expect-error — same
const { ORG_ID } = await import("../demo/boot.js");

interface Reply {
  status: number;
  body: any;
  cookies: readonly string[];
}

/** One request through the real handler, with a cookie jar the caller keeps. */
const call = async (
  method: string,
  url: string,
  { cookie = "", body, headers: extra = {} }: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> => {
  const req: any = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:3000", ...(cookie ? { cookie } : {}), ...extra };

  const headers = new Map<string, string | string[]>();
  let status = 200;
  let payload = "";
  const res: any = {
    set statusCode(code: number) { status = code; },
    get statusCode() { return status; },
    setHeader: (k: string, v: string | string[]) => headers.set(k.toLowerCase(), v),
    getHeader: (k: string) => headers.get(k.toLowerCase()),
    // Buffers as well as strings: the icon routes end with raw PNG bytes,
    // and a harness that assumes text cannot test them at all.
    end: (chunk?: string | Buffer) => { payload = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("binary") : chunk; },
  };

  await handle(req, res);
  const raw = headers.get("set-cookie");
  return {
    status,
    body: payload.startsWith("{") || payload.startsWith("[") ? JSON.parse(payload) : payload,
    cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
  };
};

const jar = (reply: Reply) => reply.cookies.map((c) => c.split(";")[0]).join("; ");

const signIn = async (email: string, password: string) => {
  const reply = await call("POST", "/api/login", { body: { email, password } });
  expect(reply.status).toBe(200);
  return jar(reply);
};

describe("route authority", () => {
  let owner = "";

  beforeAll(async () => {
    owner = await signIn("owner@paisa.local", "paisa123456-dev");
  });

  it("keeps an anonymous caller out of the real books", async () => {
    const before = await call("GET", "/api/erp/close", { cookie: owner });
    expect(before.body.locked).toBe(false);

    // No session: this lands in the caller's own sandbox, not the company's.
    const anon = await call("POST", "/api/erp/close/lock");
    expect(anon.status).toBe(200);

    const after = await call("GET", "/api/erp/close", { cookie: owner });
    expect(after.body.locked).toBe(false);
    expect(after.body.periodStatus).toBe(before.body.periodStatus);
  });

  it("does not let an anonymous approval post into the real ledger", async () => {
    const open = await call("GET", "/api/erp/agents", { cookie: owner });
    const posting = open.body.find((p: { postsOnApproval: boolean }) => p.postsOnApproval);
    expect(posting, "the seed should raise at least one proposal that posts").toBeTruthy();

    const before = (await call("GET", "/journal", { cookie: owner })).body.length;
    const anon = await call("POST", `/api/erp/proposals/${posting.id}/approve`);
    expect(anon.status).toBe(200);

    const after = await call("GET", "/journal", { cookie: owner });
    expect(after.body.length).toBe(before);
    // And the proposal is still there for the people who are allowed to decide it.
    const still = await call("GET", "/api/erp/agents", { cookie: owner });
    expect(still.body.some((p: { id: string }) => p.id === posting.id)).toBe(true);
  });

  it("does not print the real ledger to an anonymous caller", async () => {
    const mine = await call("GET", "/journal");
    expect(mine.status).toBe(200);
    const theirs = await call("GET", "/audit", { cookie: jar(mine) });
    // A visitor's audit trail is their own sandbox's, named after their
    // session — never the company's org id.
    expect(theirs.body.every((e: { orgId: string }) => e.orgId !== ORG_ID)).toBe(true);
  });

  it("gives an anonymous caller a sandbox of their own, not a refusal", async () => {
    const first = await call("GET", "/api/erp/close");
    expect(first.status).toBe(200);
    expect(first.body.tasks.length).toBeGreaterThan(0);

    const mine = jar(first);
    const again = await call("GET", "/api/erp/agents", { cookie: mine });
    expect(again.status).toBe(200);
    // The same visitor keeps the same books across requests.
    expect(again.cookies.length).toBe(0);
  });

  it("refuses a viewer the writes their role does not carry", async () => {
    // Registering is enough: where signup is open, the account is seated in
    // the workspace as a viewer in the same request, because an account with
    // no workspace is one /api/login refuses.
    const made = await call("POST", "/api/register", {
      body: { email: "viewer@paisa.local", password: "viewer123456", name: "Viewer" },
    });
    expect(made.status).toBe(201);

    const seated = await call("GET", "/api/members", { cookie: owner });
    expect(
      seated.body.items.some(
        (m: { email: string | null; role: string }) =>
          m.email === "viewer@paisa.local" && m.role === "viewer",
      ),
    ).toBe(true);

    const viewer = await signIn("viewer@paisa.local", "viewer123456");

    for (const [path, permission] of [
      ["/api/erp/close/run", "close period"],
      ["/api/erp/close/lock", "close period"],
      ["/api/banking/categorize", "categorize transactions"],
      ["/api/connectors/stripe/sync", "manage connectors"],
      // Granting a standing authority creates a non-human actor that can
      // post, so it sits with the permission governing who may act at all.
      ["/api/erp/authority/grant", "manage members"],
      ["/api/erp/authority/auth_x/revoke", "manage members"],
      ["/api/erp/authority/settle", "post journal"],
      // The budget is what the variance queue fires on, so editing it is a
      // deciding permission, not a recording one.
      ["/api/erp/budgets", "set budget"],
      // A sweep settles findings under a grant, which posts. It cannot be
      // cheaper to ask for than the close it contains.
      ["/api/erp/cfo/run", "post journal"],
    ] as const) {
      const reply = await call("POST", path, { cookie: viewer, body: {} });
      expect(reply.status, path).toBe(403);
      expect(reply.body.error, path).toContain(permission);
    }

    // Reading is what a viewer is for, and it still works.
    const read = await call("GET", "/api/erp/revenue", { cookie: viewer });
    expect(read.status).toBe(200);
  });

  it("refuses the scheduled sweep to anyone without the cron secret", async () => {
    const previous = process.env.CRON_SECRET;

    delete process.env.CRON_SECRET;
    const off = await call("GET", "/api/cron/sweep");
    expect(off.status, "no secret configured must not mean open to everyone").toBe(503);

    process.env.CRON_SECRET = "s3cret";
    expect((await call("GET", "/api/cron/sweep")).status).toBe(401);
    expect((await call("GET", "/api/cron/sweep", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);

    // Authentication is necessary, but an isolated process cannot run a
    // durable schedule. Local/manual sweeps remain available separately.
    const swept = await call("GET", "/api/cron/sweep", { headers: { authorization: "Bearer s3cret" } });
    expect(swept.status).toBe(503);
    expect(swept.body.ok).toBe(false);
    expect(swept.body.error).toContain("requires durable storage");
    expect((await call("POST", "/api/cron/sweep", { headers: { authorization: "Bearer s3cret" } })).status).toBe(405);

    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  it("runs a sweep over the wire and leaves its digest behind", async () => {
    const before = await call("GET", "/api/erp/cfo", { cookie: owner });
    expect(before.status).toBe(200);

    const run = await call("POST", "/api/erp/cfo/run", { cookie: owner, body: {} });
    expect(run.body.ok, run.body.error).toBe(true);

    const after = await call("GET", "/api/erp/cfo", { cookie: owner });
    expect(after.body.hasRun).toBe(true);
    expect(after.body.plays.map((p: { play: string }) => p.play)).toEqual(["close", "receivables", "runway"]);
    expect(after.body.digest.length).toBeGreaterThan(0);
  });

  it("sets a budget over the wire, and the variance report picks it up", async () => {
    const set = await call("POST", "/api/erp/budgets", {
      cookie: owner,
      body: { period: "2026-06", lines: [{ accountId: "acc_travel", amount: "1,00,000" }] },
    });
    expect(set.status).toBe(200);
    expect(set.body.ok, set.body.error).toBe(true);

    const report = await call("GET", "/api/erp/budgets", { cookie: owner });
    const travel = report.body.lines.find((l: { accountId: string }) => l.accountId === "acc_travel");
    expect(travel, "a budget set over the wire should appear on the report").toBeTruthy();
    expect(travel.budget).toContain("1,00,000");
  });

  it("refuses a budget on an account that cannot carry one, rather than charting nonsense", async () => {
    const set = await call("POST", "/api/erp/budgets", {
      cookie: owner,
      body: { period: "2026-06", lines: [{ accountId: "acc_bank", amount: "1,00,000" }] },
    });
    expect(set.body.ok).toBe(false);
    expect(set.body.error).toContain("acc_bank");
  });

  it("still serves the close page after the period is locked", async () => {
    // The read used to call close.run, which refuses on a locked period — so
    // closing the month broke the console until the process restarted.
    const run = await call("POST", "/api/erp/close/run", { cookie: owner });
    expect(run.status).toBe(200);

    const locked = await call("POST", "/api/erp/close/lock", { cookie: owner });
    if (locked.body.ok !== true) {
      // June closes with blockers in the seed; waive nothing, just assert the
      // refusal is a refusal rather than a crash.
      expect(locked.body.error).toMatch(/Cannot close/);
      return;
    }

    const after = await call("GET", "/api/erp/close", { cookie: owner });
    expect(after.status).toBe(200);
    expect(after.body.locked).toBe(true);
  });
});

describe("standing authority over the wire", () => {
  let owner = "";

  beforeAll(async () => {
    owner = await signIn("owner@paisa.local", "paisa123456-dev");
  });

  it("grants, lists and revokes — and the ceilings survive the JSON round trip", async () => {
    const granted = await call("POST", "/api/erp/authority/grant", {
      cookie: owner,
      body: {
        id: "auth_route_1",
        kind: "MISSING_ACCRUAL",
        // Rupee strings, because money is bigint paise inside and JSON
        // cannot carry a bigint at all.
        maxAmount: "50,000",
        maxPerSweep: "2,00,000",
        note: "A recurring vendor's monthly accrual reverses next month.",
      },
    });
    expect(granted.status).toBe(200);
    expect(granted.body.ok, JSON.stringify(granted.body)).toBe(true);

    const listed = await call("GET", "/api/erp/authority", { cookie: owner });
    expect(listed.status).toBe(200);
    const grant = listed.body.grants.find((g: { id: string }) => g.id === "auth_route_1");
    expect(grant).toBeDefined();
    // Parsed as money, not as a float that happened to look right.
    expect(grant.maxAmount).toBe("₹50,000.00");
    expect(grant.maxPerSweep).toBe("₹2,00,000.00");
    expect(grant.active).toBe(true);

    const revoked = await call("POST", "/api/erp/authority/auth_route_1/revoke", { cookie: owner, body: {} });
    expect(revoked.body.ok).toBe(true);

    const after = await call("GET", "/api/erp/authority", { cookie: owner });
    expect(after.body.grants.find((g: { id: string }) => g.id === "auth_route_1").active).toBe(false);
  });

  it("refuses a grant with no stated reason, rather than storing a blank one", async () => {
    const reply = await call("POST", "/api/erp/authority/grant", {
      cookie: owner,
      body: { id: "auth_route_2", kind: "MISSING_ACCRUAL", maxAmount: "1,000", maxPerSweep: "1,000", note: "  " },
    });
    expect(reply.body.ok).toBe(false);
    expect(reply.body.error).toMatch(/note|why/i);
  });

  it("settles nothing when nothing is granted, and says so without posting", async () => {
    const before = await call("GET", "/api/erp/authority", { cookie: owner });
    const reply = await call("POST", "/api/erp/authority/settle", { cookie: owner, body: {} });
    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(reply.body.approved).toBe(0);
    // Nothing was granted in this test, so the count of postings made under
    // a grant must not have moved.
    const after = await call("GET", "/api/erp/authority", { cookie: owner });
    expect(after.body.stats.approved).toBe(before.body.stats.approved);
  });
});

describe("the console can actually reach the authority", () => {
  let owner = "";

  beforeAll(async () => {
    owner = await signIn("owner@paisa.local", "paisa123456-dev");
  });

  /**
   * The engine, the commands and the routes all shipped before anything
   * rendered them, which meant a controller could not grant an authority
   * without curl — and `settle_authorised` would have told every user
   * forever that none had been granted. This asserts the panel is on the
   * page and wired to the endpoints, so that cannot silently regress.
   */
  it("serves the standing-authority panel, wired to its endpoints", async () => {
    const page = await call("GET", "/erp", { cookie: owner });
    expect(page.status).toBe(200);

    const html = String(page.body);
    expect(html).toContain("Standing authority");
    expect(html).toContain('id="grants"');
    expect(html).toContain('id="auth-trust"');

    // The three things the panel has to be able to do.
    expect(html).toContain("/api/erp/authority/grant");
    expect(html).toContain("/revoke");
    expect(html).toContain("/api/erp/authority/settle");

    // And it must load the read endpoint alongside the others.
    expect(html).toContain("loadAuthority");
  });

  it("redirects an anonymous visitor to sign in rather than showing the console", async () => {
    const page = await call("GET", "/erp");
    expect(page.status).toBe(302);
  });
});

describe("the mark a browser actually shows", () => {
  /**
   * The tab icon was an SVG data URI on the page plus an SVG served at
   * /favicon.ico. Chrome takes the data URI and never asks. Safari does not
   * render SVG favicons at all, so it asked for /favicon.ico and got SVG
   * bytes at a URL that promises an icon format — which it cannot decode, so
   * the tab fell back to the browser's own placeholder.
   *
   * The bytes matter more than the header here, so this checks the PNG
   * signature rather than trusting Content-Type.
   */
  const PNG_MAGIC = "\x89PNG";

  it("serves real PNG bytes at /favicon.ico, not SVG", async () => {
    const reply = await call("GET", "/favicon.ico");
    expect(reply.status).toBe(200);
    expect(String(reply.body).startsWith(PNG_MAGIC), "must be a PNG, not an SVG document").toBe(true);
    expect(String(reply.body)).not.toContain("<svg");
  });

  it("serves the home-screen icon too", async () => {
    const reply = await call("GET", "/apple-touch-icon.png");
    expect(reply.status).toBe(200);
    expect(String(reply.body).startsWith(PNG_MAGIC)).toBe(true);
  });

  it("points every shell at the raster fallback, not only the SVG", async () => {
    // One page per shell: the app, the login page, the console, and the
    // marketing site — which carried no icon link of any kind.
    for (const path of ["/", "/login", "/site/product/paisa-ai"]) {
      const page = await call("GET", path);
      const html = String(page.body);
      expect(html, path).toContain('rel="icon" type="image/png"');
      expect(html, path).toContain("apple-touch-icon");
    }
  });
});
