/**
 * Google sign-in.
 *
 * The verifier in src/auth/supabase.ts is already well tested; what was
 * untested is the route layer around it — which is where an OAuth flow
 * usually goes wrong. Three questions are asked here: is a token that did
 * not come from our project refused, does a verified stranger get a session
 * on somebody else's books, and does the page offer a button it cannot
 * honour.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { createHmac } from "node:crypto";

const JWT_SECRET = "supabase-jwt-secret-long-enough-for-hmac";
const PROJECT = "https://demoproject.supabase.co";

process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";
process.env.PAISA_SUPABASE_URL = PROJECT;
process.env.PAISA_SUPABASE_JWT_SECRET = JWT_SECRET;

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");
// @ts-expect-error — same
const { loginPage } = await import("../demo/login-page.js");
// @ts-expect-error — same
const { authorizeUrl, googleConfig, originOf } = await import("../demo/auth-google.js");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A token signed the way Supabase signs one, so only the claims vary. */
const token = (claims: Record<string, unknown>, secret = JWT_SECRET) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub: "6f1c9e2a-0000-4000-8000-000000000001",
    aud: "authenticated",
    iss: `${PROJECT}/auth/v1`,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: { provider: "google" },
    ...claims,
  });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

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
  // A distinct source per call. Sign-in is rate-limited per source now, and
  // these cases are about whether a token verifies — sharing one address
  // would have them throttle each other and assert the wrong refusal.
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
  const raw = headers.get("set-cookie");
  return {
    status,
    body: payload.startsWith("{") || payload.startsWith("[") ? JSON.parse(payload) : payload,
    location: headers.get("location") as string | undefined,
    cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
  };
};

/** The account app.js provisions at boot when PAISA_OWNER_EMAIL is unset. */
const ownerEmail = "owner@paisa.local";

describe("the door to Google", () => {
  it("hands the browser to Supabase and remembers where it was going", async () => {
    const reply = await call("GET", "/auth/google?next=%2Ferp");
    expect(reply.status).toBe(302);
    expect(reply.location).toBe(
      `${PROJECT}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent("http://localhost:4000/auth/callback")}`,
    );
    expect(reply.cookies.join()).toContain("paisa_next=%2Ferp");
  });

  it("refuses to remember a destination off this site", async () => {
    // An open redirect on a sign-in URL is how a convincing phish is built.
    for (const evil of ["//evil.test", "https://evil.test", "javascript:alert(1)"]) {
      const reply = await call("GET", `/auth/google?next=${encodeURIComponent(evil)}`);
      expect(reply.cookies.join(), evil).toContain("paisa_next=%2Fapp");
    }
  });

  it("keeps redirect_to fixed, so one URL satisfies Supabase's allow-list", () => {
    const config = googleConfig();
    const req = { headers: { host: "www.askpaisaai.com" } };
    expect(authorizeUrl(config, originOf(req, true))).toContain(
      encodeURIComponent("https://www.askpaisaai.com/auth/callback"),
    );
  });
});

describe("a token is not a session until it is verified", () => {
  it("refuses one signed with the wrong secret", async () => {
    const reply = await call("POST", "/api/auth/google", {
      body: { token: token({ email: ownerEmail }, "an-attackers-own-secret-key-here") },
    });
    expect(reply.status).toBe(401);
    expect(reply.cookies.join()).not.toContain("paisa_session");
  });

  it("refuses one that never expires, and one whose email is unconfirmed", async () => {
    for (const claims of [{ exp: undefined }, { email_confirmed_at: null }]) {
      const reply = await call("POST", "/api/auth/google", {
        body: { token: token({ email: ownerEmail, ...claims }) },
      });
      expect(reply.status, JSON.stringify(claims)).toBe(401);
    }
  });

  it("refuses a service_role token, which is not a person", async () => {
    const reply = await call("POST", "/api/auth/google", {
      body: { token: token({ email: ownerEmail, role: "service_role" }) },
    });
    expect(reply.status).toBe(401);
  });

  it("refuses garbage without throwing", async () => {
    for (const junk of ["", "not-a-token", "a.b.c"]) {
      const reply = await call("POST", "/api/auth/google", { body: { token: junk } });
      expect(reply.status, junk).toBe(401);
    }
  });
});

describe("an invited member signs in", () => {
  it("gets a Paisa session, on their own workspace, and lands where they were going", async () => {
    const sent = await call("GET", "/auth/google?next=%2Ferp");
    const breadcrumb = sent.cookies
      .find((c) => c.startsWith("paisa_next="))!
      .split(";")[0]!;

    const reply = await call("POST", "/api/auth/google", {
      cookie: breadcrumb,
      body: { token: token({ email: ownerEmail }) },
    });

    expect(reply.status).toBe(200);
    expect(reply.body.ok).toBe(true);
    expect(reply.body.next).toBe("/erp");
    expect(reply.cookies.join()).toContain("paisa_session=");
    // The breadcrumb is spent, not left lying around for the next visitor.
    expect(reply.cookies.join()).toContain("paisa_next=;");
  });

  it("opens the console that a session gates", async () => {
    const signIn = await call("POST", "/api/auth/google", {
      body: { token: token({ email: ownerEmail }) },
    });
    const session = signIn.cookies
      .find((c) => c.startsWith("paisa_session="))!
      .split(";")[0]!;

    const console_ = await call("GET", "/console", { cookie: session });
    expect(console_.status).toBe(200);
  });
});

describe("a verified Google identity still needs an invitation", () => {
  it("turns away an address nobody invited, and says so", async () => {
    // Supabase has proved they own this address, so naming it leaks nothing
    // they could not learn from their own inbox — and it is the one thing
    // that tells them what to do next.
    const reply = await call("POST", "/api/auth/google", {
      body: { token: token({ email: "stranger@example.com" }) },
    });
    expect(reply.status).toBe(403);
    expect(String(reply.body.error)).toContain("stranger@example.com");
    expect(reply.cookies.join()).not.toContain("paisa_session");
  });
});

describe("the button is not offered when it cannot work", () => {
  it("is absent with no Supabase project configured", () => {
    expect(loginPage(null, "/app", { google: false })).not.toContain("/auth/google");
  });

  it("is present, and carries the destination, when configured", () => {
    const html = loginPage(null, "/erp", { google: true });
    expect(html).toContain("/auth/google?next=%2Ferp");
    expect(html).toContain("Continue with Google");
  });

  it("never reflects a caller's destination as a raw attribute", () => {
    const html = loginPage(null, '/app" onload="alert(1)', { google: true });
    expect(html).not.toContain('onload="alert(1)');
  });
});

describe("nothing a caller sends is reflected as markup", () => {
  // /api/login bounces its own message back through ?error=, so the error on
  // this page is caller-supplied — and a sign-in page is where a reflected
  // script is most worth an attacker's trouble.
  it("escapes the error message", () => {
    const html = loginPage("<img src=x onerror=alert(1)>", "/app", { google: true });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("cannot be made to close the inline script early", () => {
    // safeNext keeps this a path on our site, but a path may contain "<".
    const html = loginPage(null, "/app</script><script>alert(1)</script>", { google: true });
    expect(html).not.toContain("/app</script><script>");
  });
});
