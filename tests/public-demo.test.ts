/**
 * The demo's front door.
 *
 * The console used to be reachable only with a session, which meant the one
 * button on every marketing page led to a sign-in form. `/try` opens it to a
 * visitor who asks, without opening it to anyone who guesses a URL — so the
 * questions here are the two that door can get wrong: does asking let you in,
 * and does not asking still keep you out.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";

process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");
// @ts-expect-error — same
const { robotsTxt } = await import("../demo/site/seo.js");

interface Reply {
  status: number;
  body: string;
  location: string | undefined;
  cookies: readonly string[];
}

const call = async (url: string, cookie = ""): Promise<Reply> => {
  const req: any = Readable.from([]);
  req.method = "GET";
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
    body: payload,
    location: headers.get("location") as string | undefined,
    cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw],
  };
};

/** The sandbox cookie a reply issued, in the form a browser would send back. */
const sandboxCookie = (reply: Reply): string => {
  const set = reply.cookies.find((c) => c.startsWith("paisa_demo="));
  if (!set) throw new Error("no sandbox cookie was issued");
  const [pair] = set.split(";");
  return pair ?? set;
};

describe("/try opens the console to a visitor who asks", () => {
  it("names a sandbox and sends the visitor to the app", async () => {
    const reply = await call("/try");
    expect(reply.status).toBe(302);
    expect(reply.location).toBe("/app");
    expect(sandboxCookie(reply)).toMatch(/^paisa_demo=demo_[a-z0-9]{8,24}$/);
  });

  it("names it once, so the console's parallel fetches share one set of books", async () => {
    // The cookie is issued on the redirect, before the page exists to fetch
    // anything — the failure this prevents is six runtimes per visitor.
    const first = await call("/try");
    const returning = await call("/try", sandboxCookie(first));
    expect(returning.cookies).toHaveLength(0);
    expect(returning.location).toBe("/app");
  });

  it("lets that visitor into the console and the ERP", async () => {
    const cookie = sandboxCookie(await call("/try"));
    for (const path of ["/app", "/erp", "/console"]) {
      const reply = await call(path, cookie);
      expect(reply.status, path).toBe(200);
      expect(reply.body.slice(0, 40), path).toContain("<!doctype html>");
    }
  });
});

describe("guessing the URL still does not open the console", () => {
  it("bounces a visitor who never asked, and remembers where they wanted to go", async () => {
    for (const path of ["/app", "/erp", "/console"]) {
      const reply = await call(path);
      expect(reply.status, path).toBe(302);
      expect(reply.location, path).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
  });

  it("bounces a forged sandbox cookie rather than trusting its shape", async () => {
    for (const forged of ["paisa_demo=../../etc/passwd", "paisa_demo=admin", "paisa_demo="]) {
      const reply = await call("/app", forged);
      expect(reply.status, forged).toBe(302);
      expect(reply.location, forged).toBe("/login?next=%2Fapp");
    }
  });
});

describe("crawlers are kept out of the sandbox minter", () => {
  it("asks them not to follow /try", () => {
    // Sandboxes are capped, and a crawler that follows /try on every visit
    // churns the cap for a page that is a redirect, not a result.
    expect(robotsTxt()).toContain("Disallow: /try");
  });
});
