/**
 * Bank statement CSV → BankStatementLine[].
 *
 * This is the first door a real company's money comes through, so the rule
 * throughout is: never guess. A row this file cannot read unambiguously is
 * rejected with a reason and handed back, because a statement line invented
 * or mis-signed here becomes a journal entry, a reconciliation that ties to
 * nothing, and a figure the assistant will later state with confidence.
 *
 * WHAT MAKES INDIAN EXPORTS AWKWARD
 *
 * There is no common format. HDFC writes Withdrawal Amt./Deposit Amt., SBI
 * writes Debit/Credit, Axis writes DR/CR, Kotak writes one Amount column
 * with a separate Dr/Cr flag. Most of them print several lines of account
 * preamble above the header row, and a legal footer below the data. So the
 * header is searched for rather than assumed to be line one, and trailing
 * junk falls out as rejected rows rather than corrupting the import.
 *
 * THE DATE TRAP
 *
 * 03/04/2025 is 3 April in Mumbai and 4 March in New York, and nothing in
 * the row says which. Getting it wrong silently moves a transaction across
 * a month boundary — into a period that may already be closed. So the
 * convention is inferred from the whole file (a day > 12 anywhere proves
 * D/M; a month > 12 proves M/D), a file containing both is refused outright
 * rather than half-read, and when every date is ambiguous the assumption
 * actually used is reported back so a person can see it.
 */

import { Paise, ZERO, parseINR, MoneyError } from "./money.js";
import type { BankStatementLine } from "./banking.js";

export class StatementParseError extends Error {
  override name = "StatementParseError";
}

/** A row that could not be read, kept with the reason instead of dropped. */
export interface RejectedRow {
  /** 1-based line number in the uploaded file, so a person can go look. */
  readonly line: number;
  readonly reason: string;
  readonly raw: string;
}

export type DateConvention = "DMY" | "MDY" | "YMD";

export interface ParsedStatement {
  readonly lines: readonly BankStatementLine[];
  readonly rejected: readonly RejectedRow[];
  /** Which date reading was used, and whether the file actually proved it. */
  readonly dateConvention: DateConvention;
  readonly dateConventionProven: boolean;
  /** Header text that was mapped, so a wrong mapping is visible not silent. */
  readonly columns: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * RFC4180-ish split: quoted fields may contain commas, newlines and doubled
 * quotes. Written out rather than pulled in, because a bank export with a
 * narration like `NEFT DR-HDFC0001, MUMBAI` is the common case, not an edge.
 */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A BOM survives Excel round-trips and would otherwise become part of the
  // first header name, so no column would match it.
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
};

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Longest match wins, so "closingbalance" cannot be claimed by "balance"
 * and, more importantly, "withdrawalamt" is not read as an "amt" column.
 */
const MATCHERS = {
  // Transaction date beats value date: value date is when the bank credited
  // interest, transaction date is when the thing happened.
  date: ["transactiondate", "txndate", "trandate", "postingdate", "date"],
  valueDate: ["valuedate", "valuedt"],
  description: ["transactionremarks", "narration", "particulars", "description", "remarks", "details", "transactiondetails"],
  reference: ["chequenumber", "chqrefno", "chqrefnumber", "refnocchequeno", "referencenumber", "utrnumber", "refno", "reference", "chqno", "utr"],
  debit: ["withdrawalamtinr", "withdrawalamount", "withdrawalamt", "withdrawal", "debitamount", "debit", "paidout", "dr"],
  credit: ["depositamtinr", "depositamount", "depositamt", "deposit", "creditamount", "credit", "paidin", "cr"],
  amount: ["transactionamount", "amountinr", "amount", "amt"],
  drcr: ["drcr", "crdr", "debitcreditindicator", "transactiontype", "indicator"],
  balance: ["closingbalance", "runningbalance", "balanceinr", "balance", "bal"],
} as const;

type Field = keyof typeof MATCHERS;

const classify = (header: string): Field | null => {
  const n = norm(header);
  if (!n) return null;
  let best: { field: Field; len: number } | null = null;
  for (const [field, keys] of Object.entries(MATCHERS) as [Field, readonly string[]][]) {
    for (const k of keys) {
      // Exact beats contains, and a longer key beats a shorter one.
      const hit = n === k ? k.length + 100 : n.includes(k) ? k.length : 0;
      if (hit > 0 && (!best || hit > best.len)) best = { field, len: hit };
    }
  }
  return best ? best.field : null;
};

interface Mapping {
  readonly headerLine: number;
  readonly index: Partial<Record<Field, number>>;
  readonly headers: readonly string[];
}

/**
 * The header is the first row that names a date column and some way of
 * reading an amount. Anything above it is the account preamble banks print.
 */
const findHeader = (rows: readonly string[][]): Mapping | null => {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]!;
    if (cells.length < 3) continue;
    const index: Partial<Record<Field, number>> = {};
    cells.forEach((cell, i) => {
      const f = classify(cell);
      // First column of a kind wins; a later "Value Date" must not overwrite
      // the "Transaction Date" already found.
      if (f && index[f] === undefined) index[f] = i;
    });
    const hasDate = index.date !== undefined || index.valueDate !== undefined;
    const hasMoney = index.debit !== undefined || index.credit !== undefined || index.amount !== undefined;
    if (hasDate && hasMoney) return { headerLine: r, index, headers: cells };
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const NUMERIC = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})$/;
const NAMED = /^(\d{1,2})[\s/\-]([A-Za-z]{3,})[\s/\-](\d{2,4})$/;

const fullYear = (y: number) => (y >= 100 ? y : 2000 + y);

/** Real calendar check: 31 April must not silently roll into 1 May. */
const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * What the file proves about its own date order, before any row is trusted.
 * Returns null when the file contradicts itself, which is a refusal.
 */
const inferConvention = (
  samples: readonly string[],
): { convention: DateConvention; proven: boolean } | null => {
  let dmy = false, mdy = false, ymd = false;
  for (const raw of samples) {
    const t = raw.trim();
    if (NAMED.test(t)) { dmy = true; continue; }
    const m = NUMERIC.exec(t);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (m[1]!.length === 4) { ymd = true; continue; }
    if (a > 12) dmy = true;
    if (b > 12) mdy = true;
  }
  if (dmy && mdy) return null;
  if (ymd && !dmy && !mdy) return { convention: "YMD", proven: true };
  if (mdy) return { convention: "MDY", proven: true };
  if (dmy) return { convention: "DMY", proven: true };
  // Nothing in the file settles it. Indian statements are day-first, and the
  // caller is told this was an assumption rather than a reading.
  return { convention: "DMY", proven: false };
};

const parseDate = (raw: string, conv: DateConvention): string | null => {
  const t = raw.trim();
  if (!t) return null;

  const named = NAMED.exec(t);
  if (named) {
    const mo = MONTHS[named[2]!.slice(0, 3).toLowerCase()];
    return mo ? iso(fullYear(Number(named[3])), mo, Number(named[1])) : null;
  }

  const m = NUMERIC.exec(t);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
  if (m[1]!.length === 4) return iso(a, b, c);
  if (conv === "MDY") return iso(fullYear(c), a, b);
  return iso(fullYear(c), b, a);
};

/* ------------------------------------------------------------------ */
/* Amounts                                                             */
/* ------------------------------------------------------------------ */

/** Empty, "-" and "0.00" all mean "not this column" on a bank export. */
const readAmount = (cell: string | undefined): Paise | null => {
  const t = (cell ?? "").trim().replace(/(cr|dr)$/i, "").trim();
  if (!t || t === "-" || t === "–") return null;
  try {
    const v = parseINR(t);
    return v === ZERO ? null : v;
  } catch (err) {
    if (err instanceof MoneyError) return null;
    throw err;
  }
};

/** Present but unreadable, as opposed to deliberately blank. */
const isUnreadable = (cell: string | undefined): boolean => {
  const t = (cell ?? "").trim().replace(/(cr|dr)$/i, "").trim();
  if (!t || t === "-" || t === "–") return false;
  try { parseINR(t); return false; } catch { return true; }
};

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

export const parseStatementCsv = (text: string): ParsedStatement => {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new StatementParseError("The file is empty.");

  const map = findHeader(rows);
  if (!map) {
    throw new StatementParseError(
      "No statement header found. Expected a row naming a date column and either " +
      "withdrawal/deposit columns, debit/credit columns, or an amount column.",
    );
  }

  const { index } = map;
  const dateCol = index.date ?? index.valueDate!;
  const body = rows.slice(map.headerLine + 1);

  const conv = inferConvention(body.map((r) => r[dateCol] ?? ""));
  if (!conv) {
    throw new StatementParseError(
      "This file mixes day-first and month-first dates, so no single reading is " +
      "correct for every row. Re-export it with ISO (YYYY-MM-DD) dates.",
    );
  }

  const lines: BankStatementLine[] = [];
  const rejected: RejectedRow[] = [];

  body.forEach((cells, i) => {
    const line = map.headerLine + i + 2; // 1-based, past the header
    const raw = cells.join(",");

    // Blank separator rows and the legal footer banks append.
    if (cells.every((c) => !c.trim())) return;

    const date = parseDate(cells[dateCol] ?? "", conv.convention);
    if (!date) {
      // A footer line has no date at all; that is not worth reporting as an
      // error, but a row with other content is.
      if (cells.filter((c) => c.trim()).length >= 3)
        rejected.push({ line, reason: `Unreadable date: "${(cells[dateCol] ?? "").trim()}"`, raw });
      return;
    }

    const debit = index.debit !== undefined ? readAmount(cells[index.debit]) : null;
    const credit = index.credit !== undefined ? readAmount(cells[index.credit]) : null;
    const plain = index.amount !== undefined ? readAmount(cells[index.amount]) : null;

    let amount: Paise | null = null;

    if (debit !== null && credit !== null) {
      // Both columns carrying a figure is a contradiction, not a net.
      rejected.push({ line, reason: "Both a debit and a credit on one row", raw });
      return;
    } else if (debit !== null) {
      amount = (debit < 0n ? debit : -debit) as Paise; // money out, whatever the sign printed
    } else if (credit !== null) {
      amount = (credit < 0n ? -credit : credit) as Paise;
    } else if (plain !== null) {
      const flag = index.drcr !== undefined ? (cells[index.drcr] ?? "").trim().toLowerCase() : "";
      if (flag) {
        const out = /^(dr|debit|d|w|withdrawal)/.test(flag);
        const inn = /^(cr|credit|c|dep|deposit)/.test(flag);
        if (!out && !inn) {
          rejected.push({ line, reason: `Unrecognised debit/credit flag: "${flag}"`, raw });
          return;
        }
        const mag = (plain < 0n ? -plain : plain) as Paise;
        amount = (out ? -mag : mag) as Paise;
      } else if (index.drcr !== undefined) {
        // The file has the column and left it blank: direction is unknown, and
        // the sign on a bare magnitude cannot be assumed.
        rejected.push({ line, reason: "Amount with no debit/credit indicator", raw });
        return;
      } else {
        amount = plain; // a single signed amount column, read literally
      }
    }

    if (amount === null) {
      const cols = [index.debit, index.credit, index.amount].filter((c) => c !== undefined) as number[];
      if (cols.some((c) => isUnreadable(cells[c])))
        rejected.push({ line, reason: "Unreadable amount", raw });
      else
        rejected.push({ line, reason: "No amount on this row", raw });
      return;
    }

    const description = (index.description !== undefined ? cells[index.description] ?? "" : "").trim();
    if (!description) {
      rejected.push({ line, reason: "No description on this row", raw });
      return;
    }

    lines.push({
      date,
      description,
      amount,
      reference: (index.reference !== undefined ? cells[index.reference] ?? "" : "").trim(),
    });
  });

  const columns: Record<string, string> = {};
  for (const [field, i] of Object.entries(index)) columns[field] = map.headers[i as number] ?? "";

  return {
    lines,
    rejected,
    dateConvention: conv.convention,
    dateConventionProven: conv.proven,
    columns,
  };
};
