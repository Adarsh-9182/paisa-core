/**
 * SEO, as rules rather than as a checklist.
 *
 * Every case here corresponds to something the live site is currently doing
 * wrong or could start doing wrong: the same page served on three hosts, a
 * redirect that eats the path, a preview deployment quietly indexed, a
 * sitemap that lists a page the app disallows.
 */
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — the marketing site is plain JS by design.
import { canonicalRedirect, isCanonicalHost, robotsTxt, sitemapXml, NOINDEX_PATHS, SITE_URL, homeJsonLd } from "../demo/site/seo.js";

const withHost = (host: string | null, fn: () => void) => {
  if (host === null) delete process.env.PAISA_CANONICAL_HOST;
  else process.env.PAISA_CANONICAL_HOST = host;
  fn();
};

afterEach(() => delete process.env.PAISA_CANONICAL_HOST);

describe("one host", () => {
  it("redirects a non-canonical host, keeping the path and query", () => {
    // A 301 that drops the path sends every deep link to the home page and
    // throws away exactly the ranking it was meant to consolidate.
    withHost("www.askpaisaai.com", () => {
      expect(canonicalRedirect("paisa-coral.vercel.app", "/site/compare/rillet?ref=x")).toBe(
        "https://www.askpaisaai.com/site/compare/rillet?ref=x",
      );
    });
  });

  it("leaves the canonical host alone", () => {
    withHost("www.askpaisaai.com", () => {
      expect(canonicalRedirect("www.askpaisaai.com", "/")).toBeNull();
    });
  });

  it("ignores the port, so local development is not a different host", () => {
    withHost("localhost", () => {
      expect(canonicalRedirect("localhost:4310", "/")).toBeNull();
    });
  });

  it("is case-insensitive, because Host headers are", () => {
    withHost("www.askpaisaai.com", () => {
      expect(canonicalRedirect("WWW.AskPaisaAI.com", "/")).toBeNull();
    });
  });

  it("does nothing at all when no canonical host is declared", () => {
    // Inferring "this is production" from the hostname would redirect preview
    // deployments and local development at the live site — a far worse
    // failure than a duplicate page, because it makes a preview untestable.
    withHost(null, () => {
      expect(canonicalRedirect("paisa-coral.vercel.app", "/")).toBeNull();
      expect(isCanonicalHost("anything.example")).toBe(true);
    });
  });

  it("marks a non-canonical host noindex while the 301 propagates", () => {
    withHost("www.askpaisaai.com", () => {
      expect(isCanonicalHost("paisa-coral.vercel.app")).toBe(false);
      expect(isCanonicalHost("www.askpaisaai.com")).toBe(true);
    });
  });

  it("survives a missing Host header rather than throwing at the door", () => {
    withHost("www.askpaisaai.com", () => {
      expect(canonicalRedirect(undefined, "/")).toBeNull();
      expect(canonicalRedirect("", "/")).toBeNull();
    });
  });
});

describe("robots and sitemap agree with each other", () => {
  const sitemap = sitemapXml() as string;
  const robots = robotsTxt() as string;
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

  it("never lists a URL it also tells crawlers to avoid", () => {
    // A sitemap entry that robots.txt disallows is a contradiction Search
    // Console reports as an error, and it is easy to introduce by adding a
    // page under a disallowed prefix.
    const disallowed = robots
      .split("\n")
      .filter((l) => l.startsWith("Disallow: "))
      .map((l) => l.slice("Disallow: ".length).trim())
      .filter(Boolean);
    for (const loc of locs) {
      const path = loc.slice(SITE_URL.length) || "/";
      for (const rule of disallowed) {
        expect(path.startsWith(rule), `${path} is in the sitemap but disallowed by ${rule}`).toBe(false);
      }
    }
  });

  it("keeps the app, the console and auth out of the index", () => {
    for (const p of NOINDEX_PATHS as string[]) expect(robots).toContain(`Disallow: ${p}`);
    expect(robots).toContain("Disallow: /api/");
  });

  it("points at its own sitemap on the canonical host", () => {
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it("lists every URL exactly once, absolutely", () => {
    expect(new Set(locs).size).toBe(locs.length);
    for (const loc of locs) expect(loc.startsWith(`${SITE_URL}/`)).toBe(true);
  });

  it("has a home page entry, and it is the highest priority", () => {
    expect(locs).toContain(`${SITE_URL}/`);
    const priorities = [...sitemap.matchAll(/<priority>([^<]+)<\/priority>/g)].map((m) => Number(m[1]));
    expect(Math.max(...priorities)).toBe(1);
  });

  it("is valid enough to parse: one urlset, matching url tags", () => {
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((sitemap.match(/<url>/g) ?? []).length).toBe((sitemap.match(/<\/url>/g) ?? []).length);
    expect((sitemap.match(/<urlset/g) ?? []).length).toBe(1);
  });
});

describe("structured data", () => {
  const graph = JSON.parse(homeJsonLd() as string);

  it("is parseable JSON-LD with a schema.org context", () => {
    expect(graph["@context"]).toBe("https://schema.org");
    expect(Array.isArray(graph["@graph"])).toBe(true);
  });

  it("claims nothing it cannot show", () => {
    // No rating, no review count, no customer numbers. Rich-result markup
    // for things the page does not display is a manual-action risk, and the
    // site's own honesty note applies here too.
    const text = JSON.stringify(graph);
    for (const forbidden of ["aggregateRating", "reviewCount", "ratingValue", "Review"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("uses the canonical host for every identifier", () => {
    for (const node of graph["@graph"]) {
      if (node.url) expect(String(node.url).startsWith(SITE_URL)).toBe(true);
      if (node["@id"]) expect(String(node["@id"]).startsWith(SITE_URL)).toBe(true);
    }
  });
});
