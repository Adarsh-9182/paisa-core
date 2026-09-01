/**
 * SEO surface for the marketing site.
 *
 * One canonical host, one source of truth for the page list. The sitemap is
 * generated from the same PRODUCTS/SOLUTIONS/COMPARISONS arrays the nav and
 * the pages themselves are built from, so a new product page cannot ship
 * without appearing in the sitemap.
 *
 * The apex domain only answers on "/", so www is the canonical host — every
 * canonical, og:url and sitemap entry is absolute against it.
 */

import { PRODUCTS, SOLUTIONS, COMPARISONS } from "./content.js";

export const SITE_URL = "https://www.askpaisaai.com";

/** Marketing pages, in the order a crawler should meet them. */
const STATIC_PATHS = [
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/site/continuous-close", priority: "0.8", changefreq: "monthly" },
  { path: "/site/about", priority: "0.7", changefreq: "monthly" },
  { path: "/site/customers", priority: "0.6", changefreq: "monthly" },
  { path: "/site/partners", priority: "0.6", changefreq: "monthly" },
  { path: "/site/resources", priority: "0.6", changefreq: "monthly" },
  { path: "/site/docs", priority: "0.6", changefreq: "monthly" },
  { path: "/site/contact", priority: "0.5", changefreq: "yearly" },
];

/** Paths the crawler should never index: the app, the console, and auth. */
export const NOINDEX_PATHS = ["/app", "/erp", "/login"];

export const absolute = (path) => `${SITE_URL}${path}`;

export const sitemapXml = () => {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    ...STATIC_PATHS,
    ...PRODUCTS.map((p) => ({ path: `/site/product/${p.slug}`, priority: "0.8", changefreq: "monthly" })),
    ...SOLUTIONS.map((s) => ({ path: `/site/solution/${s.slug}`, priority: "0.7", changefreq: "monthly" })),
    ...COMPARISONS.map((c) => ({ path: `/site/compare/${c.slug}`, priority: "0.7", changefreq: "monthly" })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url>\n    <loc>${absolute(u.path)}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
};

export const robotsTxt = () =>
  [
    "User-agent: *",
    "Allow: /",
    ...NOINDEX_PATHS.map((p) => `Disallow: ${p}`),
    "Disallow: /api/",
    "Disallow: /journal",
    "Disallow: /trial-balance",
    "Disallow: /balance-sheet",
    "Disallow: /profit-and-loss",
    "Disallow: /audit",
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");

/**
 * Organization + SoftwareApplication, emitted on the home page only.
 * Claims stay inside what the site itself says: no rating, no review count,
 * no customer numbers — the honesty note in the footer applies here too.
 */
export const homeJsonLd = () =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Paisa",
        url: SITE_URL,
        description:
          "Paisa is an AI-native ERP for finance teams: a perpetual general ledger, a close that proves itself, and an AI CFO that cannot invent a figure.",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Paisa",
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        name: "Paisa",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Accounting and ERP",
        operatingSystem: "Web",
        url: SITE_URL,
        publisher: { "@id": `${SITE_URL}/#organization` },
        description:
          "Perpetual general ledger with ASC 606 revenue recognition, multi-entity consolidation, GST compliance for India, and an AI CFO whose every figure is verified against the ledger.",
      },
    ],
  });

/**
 * Host canonicalisation.
 *
 * The same site currently answers on three hosts — the apex, www, and a
 * vercel.app subdomain — all returning 200 with identical content. Three
 * copies of a page compete with each other in an index, and the canonical
 * tag only *suggests* which one wins. A 301 settles it.
 *
 * This is deliberately opt-in through an environment variable rather than
 * inferred. Inferring "is this production" from the hostname would redirect
 * preview deployments and local development to the live site, which is a far
 * worse failure than a duplicate page: it makes a preview untestable and
 * silently sends a developer's traffic to production.
 *
 * Set PAISA_CANONICAL_HOST=www.askpaisaai.com in the production
 * environment only.
 */
export const canonicalHost = () => process.env.PAISA_CANONICAL_HOST?.trim().toLowerCase() || null;

/**
 * Where this request should have gone, or null if it is already there.
 *
 * The path and query are preserved: a 301 that drops the path sends every
 * deep link to the home page and throws away exactly the ranking it was
 * meant to consolidate.
 */
export const canonicalRedirect = (host, url) => {
  const target = canonicalHost();
  if (!target) return null;
  const actual = (host ?? "").split(":")[0].toLowerCase();
  if (!actual || actual === target) return null;
  return `https://${target}${url || "/"}`;
};

/**
 * A non-canonical host must not be indexed even while it still answers —
 * a 301 takes time to be recrawled, and a preview deployment should never
 * be indexed at all.
 */
export const isCanonicalHost = (host) => {
  const target = canonicalHost();
  if (!target) return true; // nothing declared: not our business to guess
  return (host ?? "").split(":")[0].toLowerCase() === target;
};
