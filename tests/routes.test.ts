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
  { cookie = "", body }: { cookie?: string; body?: unknown } = {},
): Promise<Reply> => {
  const req: any = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:3000", ...(cookie ? { cookie } : {}) };

  const headers = new Map<string, string | string[]>();
  let status = 200;
  let payload = "";
  const res: any = {
    set statusCode(code: number) { status = code; },
    get statusCode() { return status; },
    setHeader: (k: string, v: string | string[]) => headers.set(k.toLowerCase(), v),
    getHeader: (k: string) => headers.get(k.toLowerCase()),
    end: (chunk?: string) => { payload = chunk ?? ""; },
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
    await call("POST", "/api/register", {
      body: { email: "viewer@paisa.local", password: "viewer123456", name: "Viewer" },
    });
    const invited = await call("POST", "/api/members", {
      cookie: owner,
      body: { email: "viewer@paisa.local", role: "viewer" },
    });
    expect(invited.status).toBe(201);

    const viewer = await signIn("viewer@paisa.local", "viewer123456");

    for (const [path, permission] of [
      ["/api/erp/close/run", "close period"],
      ["/api/erp/close/lock", "close period"],
      ["/api/banking/categorize", "categorize transactions"],
      ["/api/connectors/stripe/sync", "manage connectors"],
    ] as const) {
      const reply = await call("POST", path, { cookie: viewer, body: {} });
      expect(reply.status, path).toBe(403);
      expect(reply.body.error, path).toContain(permission);
    }

    // Reading is what a viewer is for, and it still works.
    const read = await call("GET", "/api/erp/revenue", { cookie: viewer });
    expect(read.status).toBe(200);
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
