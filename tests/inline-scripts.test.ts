/**
 * Every inline script the site serves has to parse.
 *
 * These pages are built as one big template literal each, which means the
 * page's own escaping and JavaScript's escaping share a single backslash. A
 * `\'` written to protect an apostrophe inside a JS string is consumed by the
 * template literal, so what reaches the browser is a bare quote that ends the
 * string early — and the whole script dies at parse time, silently. Nothing
 * throws on the server, the HTML is served with a 200, and the page renders
 * as a static shell: every value stays on its placeholder.
 *
 * That is exactly what had happened to /app. It is invisible to any test that
 * checks status codes or markup, so this one parses what is actually shipped.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";

process.env.PAISA_SESSION_SECRET ??= "test-secret-that-is-long-enough-to-pass";

// @ts-expect-error — demo/ is plain JS, not part of the typed src build
const { handle } = await import("../demo/app.js");

interface Reply { status: number; body: string; cookies: readonly string[]; }

const call = async (url: string, cookie = ""): Promise<Reply> => {
  const req: any = Readable.from([]);
  req.method = "GET";
  req.url = url;
  req.headers = { host: "localhost:4000", ...(cookie ? { cookie } : {}) };

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
  return { status, body: payload, cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [raw] };
};

/**
 * Every <script> block that the browser will actually parse as JavaScript.
 *
 * A `type` that is not a JS type — the JSON-LD the marketing pages carry, for
 * one — is data the browser never compiles, so feeding it to a JS parser
 * would fail for a reason that is not a bug.
 */
const JS_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);

const inlineScripts = (html: string): string[] =>
  [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs]) => {
      if (/\ssrc=/.test(attrs!)) return false;
      const type = /\stype=["']?([^"'\s>]*)/.exec(attrs!)?.[1] ?? "";
      return JS_TYPES.has(type.toLowerCase());
    })
    .map((m) => m[2]!)
    .filter((code) => code.trim().length > 0);

/**
 * Parses without running. `new Function` compiles the body and throws a
 * SyntaxError on exactly the failure this file exists to catch, while never
 * executing code that expects a document.
 */
const parses = (code: string) => {
  new Function(code);
};

describe("the scripts that actually ship", () => {
  it("serves /app with an inline script that parses", async () => {
    // /app wants a session; /try hands an anonymous visitor a sandbox one.
    const trying = await call("/try");
    const cookie = trying.cookies.map((c) => c.split(";")[0]).join("; ");

    const app = await call("/app", cookie);
    expect(app.status).toBe(200);

    const scripts = inlineScripts(app.body);
    expect(scripts.length).toBeGreaterThan(0);
    for (const [i, code] of scripts.entries())
      expect(() => parses(code), `/app inline script #${i}`).not.toThrow();
  });

  it("serves every other page with inline scripts that parse", async () => {
    for (const path of ["/", "/login", "/signup", "/auth/callback", "/site/contact"]) {
      const reply = await call(path);
      expect(reply.status, path).toBe(200);
      for (const [i, code] of inlineScripts(reply.body).entries())
        expect(() => parses(code), `${path} inline script #${i}`).not.toThrow();
    }
  });

  it("would have caught the apostrophe that killed the dashboard", () => {
    // The shape of the bug, so this file documents what it is guarding.
    const asShipped = `const s = '<div>That didn't go through</div>';`;
    expect(() => parses(asShipped)).toThrow();
  });
});
