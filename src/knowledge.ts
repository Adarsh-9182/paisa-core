/**
 * Compliance knowledge base (spec 005).
 *
 * A curated, versioned corpus of Indian GST and income-tax provisions.
 * Retrieval is deterministic keyword scoring — no embeddings, no network —
 * so the same question always surfaces the same passages and the eval
 * benchmark in tests/knowledge.test.ts can pin behaviour exactly.
 *
 * The honesty contract, extending the Golden Rule to law:
 *   - The model may only state a rate/threshold/section it retrieved from
 *     here; retrieved text enters the verifier corpus as a tool result, so
 *     every legal figure in a narration is traceable to a cited entry.
 *   - Every entry carries `source` (act/section/notification) and `asOf`
 *     (the date the entry was last verified). Law changes by amendment,
 *     not retraining — updating this file IS the update mechanism.
 */

export interface RegulationEntry {
  /** Stable id, e.g. "cgst-s16-itc" — the eval benchmark pins these. */
  readonly id: string;
  readonly title: string;
  /** Act, section, notification — the citation the model must surface. */
  readonly source: string;
  /** Date this entry's content was last verified against the law. */
  readonly asOf: string;
  /** Lowercase match hints, including synonyms ("itc", "input tax credit"). */
  readonly tags: readonly string[];
  /** The provision itself. Figures exact — they feed the narration verifier. */
  readonly text: string;
}

export interface RegulationMatch {
  readonly entry: RegulationEntry;
  readonly score: number;
}

export const KNOWLEDGE_BASE: readonly RegulationEntry[] = [
  {
    id: "gst-registration-threshold",
    title: "GST registration — turnover thresholds",
    source: "CGST Act 2017 s.22; Notification 10/2019-Central Tax",
    asOf: "2025-04-01",
    tags: ["registration", "register", "threshold", "limit", "turnover", "gstin", "mandatory", "compulsory"],
    text:
      "GST registration becomes mandatory when aggregate turnover in a financial year exceeds ₹40 lakh for suppliers of goods (normal-category states) or ₹20 lakh for suppliers of services or mixed supplies. In special-category states the limits are ₹20 lakh (goods) and ₹10 lakh (services). Registration is mandatory regardless of turnover for inter-state taxable supply of goods, persons liable under reverse charge, and most e-commerce sellers.",
  },
  {
    id: "gst-rate-slabs",
    title: "GST rate structure — two-slab regime",
    source: "56th GST Council meeting (2025-09-03); rate notifications effective 2025-09-22",
    asOf: "2025-09-22",
    tags: ["rate", "rates", "slab", "slabs", "structure", "percent", "demerit", "luxury", "merit"],
    text:
      "Since 2025-09-22 GST has two principal slabs: 5% (merit/essential goods and services) and 18% (the standard rate, and the default for most services). A 40% demerit rate applies to pan masala, tobacco products, aerated and caffeinated beverages, and luxury vehicles. The earlier 12% and 28% slabs were abolished; nil-rated and exempt categories continue.",
  },
  {
    id: "gst-software-services-rate",
    title: "GST on software and IT services",
    source: "SAC 9983 (998313 IT consulting, 998314 software design & development); rate schedule for services",
    asOf: "2025-09-22",
    tags: ["software", "it", "saas", "services", "sac", "998313", "998314", "rate", "export", "lut", "zero", "freelancer"],
    text:
      "Software and IT services — development, consulting, SaaS licensing — fall under SAC 9983 (998313 IT consulting, 998314 software design and development) and attract GST at 18%. Export of services (foreign client, consideration in convertible foreign exchange) is zero-rated: supply under a Letter of Undertaking (LUT) without charging GST, or pay IGST and claim refund.",
  },
  {
    id: "cgst-s16-itc-conditions",
    title: "Input tax credit — conditions to claim",
    source: "CGST Act 2017 s.16 (as amended); s.16(4) time limit",
    asOf: "2025-04-01",
    tags: ["itc", "input", "credit", "claim", "eligibility", "eligible", "conditions", "2b", "gstr2b", "180"],
    text:
      "ITC can be claimed only if ALL conditions of s.16 hold: (a) you hold a valid tax invoice or debit note; (b) the supplier reported the invoice and it appears in your GSTR-2B; (c) you actually received the goods or services; (d) the supplier has paid the tax to the government; and (e) you have filed your GSTR-3B. If you do not pay the supplier within 180 days, the credit must be reversed with interest. Time limit: ITC for a financial year must be claimed by the earlier of 30 November of the following year or the date of the annual return (s.16(4)).",
  },
  {
    id: "cgst-s17-5-blocked-itc",
    title: "Blocked input tax credit",
    source: "CGST Act 2017 s.17(5)",
    asOf: "2025-04-01",
    tags: ["itc", "blocked", "ineligible", "block", "denied", "food", "vehicle", "car", "club", "construction", "personal", "gift", "samples"],
    text:
      "ITC is blocked under s.17(5) even for business spend on: motor vehicles for transport of persons with approved seating of 13 or fewer (unless used for further supply, passenger transport, or driver training); food and beverages, outdoor catering, beauty treatment, health services and cosmetic surgery (unless resold as the same category or statutorily obligatory); club and fitness-centre memberships; employee vacation travel benefits; works-contract and construction services for immovable property other than plant and machinery; goods or services for personal consumption; and goods lost, stolen, destroyed, written off, or given as gifts or free samples.",
  },
  {
    id: "gst-composition-scheme",
    title: "Composition scheme — eligibility and rates",
    source: "CGST Act 2017 s.10; Notification 2/2019-Central Tax (Rate) for services",
    asOf: "2025-04-01",
    tags: ["composition", "composite", "scheme", "small", "cmp08", "gstr4", "quarterly", "presumptive"],
    text:
      "The composition scheme is open when aggregate turnover in the preceding financial year was at most ₹1.5 crore (₹75 lakh in special-category states). Tax rates: 1% of turnover for manufacturers and traders, 5% for restaurants not serving alcohol; a separate 6% scheme covers service providers with turnover up to ₹50 lakh. Composition dealers cannot collect tax from customers, cannot claim ITC, and cannot make inter-state outward supplies; they pay quarterly via CMP-08 and file GSTR-4 annually.",
  },
  {
    id: "gst-return-due-dates",
    title: "GST return due dates",
    source: "CGST Rules — rr.59-61, 80; QRMP scheme notifications",
    asOf: "2025-04-01",
    tags: ["gstr", "gstr1", "gstr3b", "gstr9", "gstr9c", "due", "date", "deadline", "return", "annual", "qrmp", "monthly", "file", "filing"],
    text:
      "Monthly filers: GSTR-1 (outward supplies) by the 11th of the following month; GSTR-3B (summary return and tax payment) by the 20th of the following month. QRMP scheme (turnover up to ₹5 crore): quarterly GSTR-1 by the 13th of the month after the quarter, GSTR-3B by the 22nd or 24th depending on state, with monthly tax via PMT-06 by the 25th. Annual return GSTR-9 by 31 December following the financial year (mandatory above ₹2 crore turnover); GSTR-9C self-certified reconciliation is additionally required above ₹5 crore.",
  },
  {
    id: "gst-e-invoicing",
    title: "E-invoicing — who must comply",
    source: "Notification 10/2023-Central Tax (effective 2023-08-01); r.48(4) CGST Rules",
    asOf: "2025-04-01",
    tags: ["einvoice", "einvoicing", "invoicing", "invoice", "irn", "irp", "b2b", "threshold", "mandatory"],
    text:
      "E-invoicing is mandatory for registered persons whose aggregate turnover exceeded ₹5 crore in any financial year from 2017-18 onward (effective 2023-08-01). Covered documents — B2B invoices, credit/debit notes, and exports — must be registered on an Invoice Registration Portal to obtain an IRN and QR code before issue; an invoice required to carry an IRN but issued without one is not a valid invoice, and the buyer's ITC is at risk.",
  },
  {
    id: "gst-reverse-charge",
    title: "Reverse charge mechanism (RCM)",
    source: "CGST Act 2017 s.9(3), s.9(4); Notification 13/2017-Central Tax (Rate)",
    asOf: "2025-04-01",
    tags: ["reverse", "charge", "rcm", "recipient", "gta", "legal", "advocate", "sponsorship", "director", "import"],
    text:
      "Under reverse charge the RECIPIENT pays the GST instead of the supplier. Notified cases under s.9(3) include: goods transport agency (GTA) services, legal services from an advocate or firm of advocates to a business entity, sponsorship services to a company or partnership, services of a director to their company, and import of services. The recipient pays the tax in cash and may claim it as ITC if otherwise eligible. s.9(4) applies reverse charge to purchases from unregistered suppliers only in notified cases (chiefly real-estate promoters).",
  },
  {
    id: "it-44ada-presumptive-professionals",
    title: "Presumptive taxation for professionals — s.44ADA",
    source: "Income-tax Act 1961 s.44ADA (limits enhanced by Finance Act 2023, AY 2024-25 onward)",
    asOf: "2025-04-01",
    tags: ["44ada", "presumptive", "professional", "freelancer", "consultant", "gross", "receipts", "50", "audit", "books"],
    text:
      "Resident individuals and partnership firms (not LLPs) in specified professions — legal, medical, engineering, architecture, accountancy, technical consultancy, interior decoration, and notified professions — may declare 50% of gross receipts as deemed profit under s.44ADA. Limit: gross receipts up to ₹50 lakh, extended to ₹75 lakh where cash receipts are at most 5% of total receipts. No further expense deductions; books of account and tax audit are not required if the presumptive income is declared; advance tax is a single instalment by 15 March.",
  },
  {
    id: "it-44ad-presumptive-business",
    title: "Presumptive taxation for small business — s.44AD",
    source: "Income-tax Act 1961 s.44AD (limits enhanced by Finance Act 2023, AY 2024-25 onward)",
    asOf: "2025-04-01",
    tags: ["44ad", "presumptive", "business", "turnover", "small", "8", "6", "digital", "trader", "shop"],
    text:
      "Resident individuals, HUFs and partnership firms (not LLPs) with an eligible business may declare deemed profit under s.44AD: 8% of turnover, or 6% for amounts received digitally or by account-payee instruments. Limit: turnover up to ₹2 crore, extended to ₹3 crore where cash receipts are at most 5% of turnover. Not available to professionals covered by s.44ADA, commission or brokerage income, or agency business. Opting out after using the scheme bars re-entry for 5 assessment years (s.44AD(4)).",
  },
  {
    id: "it-new-regime-slabs",
    title: "Income-tax slabs — new regime, FY 2025-26",
    source: "Income-tax Act 1961 s.115BAC as amended by Finance Act 2025 (FY 2025-26 / AY 2026-27)",
    asOf: "2025-04-01",
    tags: ["slab", "slabs", "regime", "new", "115bac", "rebate", "87a", "salary", "income", "rate", "personal", "standard", "deduction"],
    text:
      "New-regime slabs for FY 2025-26 (AY 2026-27): income up to ₹4,00,000 — nil; ₹4,00,001–₹8,00,000 — 5%; ₹8,00,001–₹12,00,000 — 10%; ₹12,00,001–₹16,00,000 — 15%; ₹16,00,001–₹20,00,000 — 20%; ₹20,00,001–₹24,00,000 — 25%; above ₹24,00,000 — 30%. The s.87A rebate makes tax nil where taxable income does not exceed ₹12,00,000; with the ₹75,000 standard deduction, salaried income up to ₹12,75,000 is tax-free. The new regime is the default; the old regime requires opting out.",
  },
  {
    id: "it-80c-80d-deductions",
    title: "Old-regime deductions — 80C, 80CCD(1B), 80D",
    source: "Income-tax Act 1961 ss.80C, 80CCD(1B), 80D (old regime only)",
    asOf: "2025-04-01",
    tags: ["80c", "80d", "80ccd", "deduction", "deductions", "ppf", "elss", "nps", "insurance", "premium", "old", "regime", "save", "saving"],
    text:
      "Under the OLD regime only: s.80C allows up to ₹1,50,000 across PPF, ELSS, EPF, life-insurance premium, home-loan principal, 5-year tax-saver FDs and children's tuition; s.80CCD(1B) allows an additional ₹50,000 for NPS; s.80D allows ₹25,000 for self-and-family health-insurance premiums plus ₹25,000 for parents (₹50,000 if they are senior citizens). These deductions are NOT available under the default new regime, which instead offers lower slab rates (employer NPS under s.80CCD(2) remains available).",
  },
  {
    id: "it-tds-common-sections",
    title: "TDS on professional fees, contractors, rent — FY 2025-26",
    source: "Income-tax Act 1961 ss.194J, 194C, 194-I (thresholds revised by Finance Act 2025, from 2025-04-01)",
    asOf: "2025-04-01",
    tags: ["tds", "deduct", "194j", "194c", "194i", "professional", "fees", "contractor", "rent", "threshold", "withholding"],
    text:
      "TDS for FY 2025-26: s.194J — professional fees 10% (fees for technical services 2%), threshold ₹50,000 per payee per year; s.194C — contractor payments 1% (individual/HUF payee) or 2% (others), threshold ₹30,000 per single payment or ₹1,00,000 aggregate per year; s.194-I — rent 10% for land or building and 2% for plant and machinery, threshold ₹50,000 per month. Individuals and HUFs not subject to tax audit are generally outside these sections; s.194M covers their large payments above ₹50 lakh.",
  },
  {
    id: "it-advance-tax",
    title: "Advance tax — instalments and due dates",
    source: "Income-tax Act 1961 ss.208, 211; interest under ss.234B, 234C",
    asOf: "2025-04-01",
    tags: ["advance", "tax", "instalment", "installment", "june", "september", "december", "march", "234b", "234c", "quarterly"],
    text:
      "Advance tax applies when estimated tax liability for the year is ₹10,000 or more. Instalments: 15% by 15 June, 45% (cumulative) by 15 September, 75% by 15 December, and 100% by 15 March. Taxpayers under presumptive schemes (s.44AD / s.44ADA) pay the whole amount in one instalment by 15 March. Shortfall or deferment attracts interest under ss.234B and 234C.",
  },
] as const;

/** Words too common to signal intent — never scored. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for",
  "from", "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or",
  "our", "should", "that", "the", "this", "to", "we", "what", "when", "which",
  "who", "will", "with", "you", "your",
]);

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t)); // 1-char tokens ("s.44AD" → "s") are noise

interface IndexedEntry {
  readonly entry: RegulationEntry;
  readonly tagSet: ReadonlySet<string>;
  readonly titleSet: ReadonlySet<string>;
  readonly bodySet: ReadonlySet<string>;
  /** Body term frequencies + length for the BM25 tie-breaker. */
  readonly tf: ReadonlyMap<string, number>;
  readonly len: number;
}

const INDEX: readonly IndexedEntry[] = KNOWLEDGE_BASE.map((entry) => {
  const bodyTokens = tokenize(entry.text);
  const tf = new Map<string, number>();
  for (const t of bodyTokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return {
    entry,
    tagSet: new Set(entry.tags.flatMap(tokenize)),
    titleSet: new Set(tokenize(entry.title)),
    bodySet: new Set(bodyTokens),
    tf,
    len: bodyTokens.length,
  };
});

const AVG_LEN = INDEX.reduce((s, e) => s + e.len, 0) / INDEX.length;
/** Document frequency per body term, for IDF. */
const DF: ReadonlyMap<string, number> = (() => {
  const df = new Map<string, number>();
  for (const e of INDEX) for (const t of e.bodySet) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
})();

const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Classic Okapi BM25 over an entry's body — deterministic, no dependencies. */
const bm25 = (e: IndexedEntry, tokens: readonly string[]): number => {
  let score = 0;
  for (const t of tokens) {
    const tf = e.tf.get(t);
    if (!tf) continue;
    const df = DF.get(t) ?? 0;
    const idf = Math.log(1 + (INDEX.length - df + 0.5) / (df + 0.5));
    score += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + (BM25_B * e.len) / AVG_LEN));
  }
  return score;
};

/** Minimum score to count as a match — one weak body hit is noise, not law. */
const MIN_SCORE = 2;

/**
 * Deterministic hybrid retrieval (the Perplexity recipe at curated-corpus
 * scale): field-weighted hit scoring is the primary rank — tag hit 3,
 * title hit 2, body hit 1 per query token, summed — and equal scores break
 * by Okapi BM25 over the body (graded term-frequency relevance), then by
 * corpus order. The primary score is unchanged from spec 005, so the eval
 * benchmark's pins hold; BM25 only refines within ties.
 */
export const searchKnowledge = (query: string, limit = 3): RegulationMatch[] => {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];
  const scored = INDEX.map((indexed, order) => {
    let score = 0;
    for (const t of tokens) {
      if (indexed.tagSet.has(t)) score += 3;
      else if (indexed.titleSet.has(t)) score += 2;
      else if (indexed.bodySet.has(t)) score += 1;
    }
    return { entry: indexed.entry, score, bm25: bm25(indexed, tokens), order };
  });
  return scored
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.bm25 - a.bm25 || a.order - b.order)
    .slice(0, limit)
    .map(({ entry, score }) => ({ entry, score }));
};

export const getRegulation = (id: string): RegulationEntry | undefined =>
  KNOWLEDGE_BASE.find((e) => e.id === id);
