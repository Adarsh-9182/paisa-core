/**
 * Signing up.
 *
 * /login and /signup are one page in two modes, and the mode is the only
 * thing a visitor picks. What is asserted here is the part that is easy to
 * get wrong once there are two doors: that the sign-up door does not become
 * an open one, that a mangled ?mode= lands on the safer half, and that an
 * account created at the door can actually get through it — an account with
 * no workspace is one /api/login refuses, which would make signing up a dead
 * end one second after choosing a password.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";

process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";
process.env.PAISA_OPEN_SIGNUP = "1";

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");
// @ts-expect-error — same
const { loginPage, loginMode } = await import("../demo/login-page.js");

interface Reply { status: number; body: any; location: string | undefined; cookies: readonly string[]; }

let callNumber = 0;

const call = async (
  method: string,
  url: string,
  { cookie = "", body }: { cookie?: string; body?: unknown } = {},
): Promise<Reply> => {
  const req: any = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  // A distinct source per call: sign-in is rate-limited per source, and these
  // cases are about the doors, not about the throttle.
  req.headers = {
    host: "localhost:4000",
    "x-forwarded-for": `203.0.113.${(callNumber = (callNumber + 1) % 250) + 1}`,
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
  const raw = headers.get("set-cookie");
  return {
    status,
    body: payload.startsWith("{") || payload.startsWith("[") ? JSON.parse(payload) : payload,
    location: headers.get("location") as string | undefined,
    cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
  };
};

describe("the two doors", () => {
  it("serves sign-up and sign-in from the same page, in different modes", async () => {
    const signin = await call("GET", "/login");
    const signup = await call("GET", "/signup");

    expect(signin.status).toBe(200);
    expect(signup.status).toBe(200);
    expect(String(signin.body)).toContain("Welcome back");
    expect(String(signup.body)).toContain("Create your account");
  });

  it("offers each door the way to the other, carrying `next` with it", () => {
    expect(loginPage(null, "/erp", { mode: "signin", signup: true })).toContain("/signup?next=%2Ferp");
    expect(loginPage(null, "/erp", { mode: "signup", signup: true })).toContain("/login?next=%2Ferp");
  });

  it("treats anything that is not `signup` as the sign-in half", () => {
    for (const junk of ["", "SIGNUP", "signin", "../signup", null, undefined, 7, {}])
      expect(loginMode(junk), String(junk)).toBe("signin");
    expect(loginMode("signup")).toBe("signup");
  });

  it("says accounts are made by invitation when signup is closed", () => {
    const html = loginPage(null, "/app", { mode: "signup", signup: false });
    expect(html).toContain("invite-only");
    // No form to fill in that could not succeed.
    expect(html).not.toContain('action="/api/register"');
  });

  it("lets a new account through the door it just came in by", async () => {
    const made = await call("POST", "/api/register", {
      body: { email: "newcomer@paisa.local", password: "newcomer123456", name: "Newcomer" },
    });
    expect(made.status).toBe(201);

    // The point of the seat: the very next call is the one the sign-up page
    // makes, and it has to come back with a session rather than a 403.
    const signedIn = await call("POST", "/api/login", {
      body: { email: "newcomer@paisa.local", password: "newcomer123456" },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.cookies.join()).toContain("paisa_session=");
  });

  it("seats a newcomer as a viewer, never as somebody who can post", async () => {
    await call("POST", "/api/register", {
      body: { email: "reader@paisa.local", password: "reader123456", name: "Reader" },
    });
    const signedIn = await call("POST", "/api/login", {
      body: { email: "reader@paisa.local", password: "reader123456" },
    });
    const cookie = signedIn.cookies.join(";").split(";")[0]!;

    const me = await call("GET", "/api/me", { cookie });
    expect(me.body.role).toBe("viewer");

    const write = await call("POST", "/api/erp/close/run", { cookie, body: {} });
    expect(write.status).toBe(403);
  });

  it("sends somebody who is already signed in on to where they were headed", async () => {
    const signedIn = await call("POST", "/api/login", {
      body: { email: "newcomer@paisa.local", password: "newcomer123456" },
    });
    const cookie = signedIn.cookies.join(";").split(";")[0]!;

    const reply = await call("GET", "/signup?next=%2Ferp", { cookie });
    expect(reply.status).toBe(302);
    expect(reply.location).toBe("/erp");
  });

  it("refuses to bounce a signed-in visitor off-site", async () => {
    const signedIn = await call("POST", "/api/login", {
      body: { email: "newcomer@paisa.local", password: "newcomer123456" },
    });
    const cookie = signedIn.cookies.join(";").split(";")[0]!;

    for (const evil of ["//evil.test", "https://evil.test", "/\\evil.test"]) {
      const reply = await call("GET", `/signup?next=${encodeURIComponent(evil)}`, { cookie });
      expect(reply.location, evil).toBe("/app");
    }
  });
});
