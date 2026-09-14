/**
 * The booked month, in files Tally can import.
 *
 * Indian small businesses rarely keep their books in the tool that books
 * their bank lines: their CA keeps them in Tally. A month Paisa booked is only
 * finished for that business once it is in the CA's Tally, so the export is
 * part of the product, not an extra.
 *
 * Two files, because Tally imports them from two different menus:
 *
 *   ledgers   — one master per account the vouchers use, under the Tally
 *               group that account belongs in. Imported once; a ledger that
 *               already exists is reported by Tally and left alone.
 *   vouchers  — one voucher per bank line: Payment for money out, Receipt
 *               for money in, Contra when the other side is cash.
 *
 * Tally's XML signs amounts from the voucher's point of view: a debit ledger
 * carries ISDEEMEDPOSITIVE=Yes and a negative AMOUNT, a credit ledger the
 * opposite. Each voucher's amounts therefore sum to zero, which the tests pin.
 *
 * Ledger names are Paisa's account names. A CA whose Tally calls the bank
 * "HDFC Current A/c" renames the ledger once, or imports these into a fresh
 * company. Every voucher carries a REMOTEID built from the journal entry, so
 * the same month imported twice names the same vouchers.
 */

import type { ChartOfAccounts } from "./accounts.js";
import type { JournalEntry } from "./journal.js";

type Account = ReturnType<ChartOfAccounts["all"]>[number];

export interface TallyExportInput {
  readonly chart: ChartOfAccounts;
  /** Journal entries to consider; only bank lines that still stand are exported. */
  readonly entries: readonly JournalEntry[];
  /** The accounts statements were imported against. */
  readonly bankAccountIds: ReadonlySet<string>;
}

export interface TallyVoucher {
  readonly entryId: string;
  readonly type: "Payment" | "Receipt" | "Contra";
  readonly date: string;
  readonly reference: string | null;
  readonly narration: string;
  readonly bankLedger: string;
  readonly otherLedger: string;
  /** Paise, positive. */
  readonly amount: bigint;
}

const BANK_SOURCES = new Set(["banking", "banking_review"]);

/** Bank lines in these entries that were booked and never reversed. */
export const bankVouchers = (input: TallyExportInput): readonly TallyVoucher[] => {
  const out: TallyVoucher[] = [];
  for (const e of input.entries) {
    if (!BANK_SOURCES.has(e.sourceModule) || e.reversedBy || e.reverses || e.lines.length !== 2) continue;
    const bank = e.lines.find((l) => input.bankAccountIds.has(l.accountId));
    const other = e.lines.find((l) => l !== bank);
    if (!bank || !other) continue;
    const otherAccount = input.chart.get(other.accountId);
    out.push({
      entryId: e.id,
      type: otherAccount.isCashEquivalent ? "Contra" : bank.side === "CREDIT" ? "Payment" : "Receipt",
      date: e.date,
      reference: e.referenceId,
      narration: e.narration,
      bankLedger: input.chart.get(bank.accountId).name,
      otherLedger: otherAccount.name,
      amount: bank.amount,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.entryId.localeCompare(b.entryId) : a.date < b.date ? -1 : 1));
};

/** The Tally group an account's ledger belongs under. */
export const tallyGroup = (account: Account, bankAccountIds: ReadonlySet<string>): string => {
  if (bankAccountIds.has(account.id)) return "Bank Accounts";
  if (account.isCashEquivalent) return "Cash-in-Hand";
  switch (account.id) {
    case "acc_ar":
      return "Sundry Debtors";
    case "acc_ap":
      return "Sundry Creditors";
    case "acc_equipment":
      return "Fixed Assets";
    case "acc_investments":
      return "Investments";
    case "acc_gst_itc":
    case "acc_gst_payable":
    case "acc_taxes_payable":
      return "Duties & Taxes";
    case "acc_loans":
      return "Loans (Liability)";
    case "acc_retained":
      return "Reserves & Surplus";
    case "acc_sales":
    case "acc_services":
      return "Sales Accounts";
  }
  switch (account.type) {
    case "ASSET":
      return "Current Assets";
    case "LIABILITY":
      return "Current Liabilities";
    case "EQUITY":
      return "Capital Account";
    case "REVENUE":
      return "Indirect Incomes";
    default:
      return "Indirect Expenses";
  }
};

const xml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

const amount = (paise: bigint): string => {
  const neg = paise < 0n;
  const a = neg ? -paise : paise;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};

const envelope = (reportName: string, messages: readonly string[]): string =>
  [
    "<ENVELOPE>",
    " <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    " <BODY>",
    "  <IMPORTDATA>",
    `   <REQUESTDESC><REPORTNAME>${reportName}</REPORTNAME></REQUESTDESC>`,
    "   <REQUESTDATA>",
    ...messages,
    "   </REQUESTDATA>",
    "  </IMPORTDATA>",
    " </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");

/** Ledger masters for every account the vouchers use. */
export const tallyLedgersXml = (input: TallyExportInput): { xml: string; ledgers: number } => {
  const used = new Map<string, Account>();
  const byName = new Map(input.chart.all().map((a) => [a.name, a]));
  for (const v of bankVouchers(input))
    for (const name of [v.bankLedger, v.otherLedger]) used.set(name, byName.get(name)!);
  const messages = [...used.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) =>
      [
        '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
        `     <LEDGER NAME="${xml(a.name)}" ACTION="Create">`,
        `      <NAME.LIST><NAME>${xml(a.name)}</NAME></NAME.LIST>`,
        `      <PARENT>${xml(tallyGroup(a, input.bankAccountIds))}</PARENT>`,
        "     </LEDGER>",
        "    </TALLYMESSAGE>",
      ].join("\n"),
    );
  return { xml: envelope("All Masters", messages), ledgers: messages.length };
};

/** One voucher per booked bank line. */
export const tallyVouchersXml = (input: TallyExportInput): { xml: string; vouchers: number } => {
  const vouchers = bankVouchers(input);
  const messages = vouchers.map((v) => {
    const date = v.date.replace(/-/g, "");
    // Money out: the other ledger is debited and the bank credited. Money in
    // (or cash into the bank): the bank is debited.
    const bankDebited = v.type === "Receipt" || (v.type === "Contra" && isBankDebit(v, input));
    const entry = (ledger: string, debit: boolean) =>
      [
        "      <ALLLEDGERENTRIES.LIST>",
        `       <LEDGERNAME>${xml(ledger)}</LEDGERNAME>`,
        `       <ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
        `       <AMOUNT>${amount(debit ? -v.amount : v.amount)}</AMOUNT>`,
        "      </ALLLEDGERENTRIES.LIST>",
      ].join("\n");
    return [
      '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
      `     <VOUCHER REMOTEID="paisa-${xml(v.entryId)}" VCHTYPE="${v.type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      `      <DATE>${date}</DATE>`,
      `      <EFFECTIVEDATE>${date}</EFFECTIVEDATE>`,
      `      <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>`,
      ...(v.reference ? [`      <REFERENCE>${xml(v.reference)}</REFERENCE>`] : []),
      `      <NARRATION>${xml(v.narration)}</NARRATION>`,
      "      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
      entry(v.otherLedger, !bankDebited),
      entry(v.bankLedger, bankDebited),
      "     </VOUCHER>",
      "    </TALLYMESSAGE>",
    ].join("\n");
  });
  return { xml: envelope("Vouchers", messages), vouchers: vouchers.length };
};

const isBankDebit = (v: TallyVoucher, input: TallyExportInput): boolean => {
  const e = input.entries.find((x) => x.id === v.entryId)!;
  return e.lines.find((l) => input.bankAccountIds.has(l.accountId))!.side === "DEBIT";
};
