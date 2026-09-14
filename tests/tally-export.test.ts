/**
 * The Tally export: the right voucher type per bank line, amounts that sum to
 * zero the way Tally signs them, ledgers under sensible groups, and nothing
 * exported that was never a bank line or was reversed.
 */
import { describe, it, expect } from "vitest";
import { Platform, parseINR } from "../src/index.js";
import { bankVouchers, tallyLedgersXml, tallyVouchersXml, tallyGroup } from "../src/tally-export.js";

const booked = () => {
  const org = new Platform().createOrganization(`tally_${Math.random().toString(36).slice(2)}`, "Tally Traders");
  org.banking.importStatement(
    [
      { reference: "UTR1", date: "2026-07-03", description: "SMS CHARGES QTR", amount: parseINR("-17.70") },
      { reference: "UTR2", date: "2026-07-05", description: "ATM WDL 0412 KORAMANGALA", amount: parseINR("-5000") },
      { reference: "UTR3", date: "2026-07-09", description: "NEFT CR-ZENITH LABS & CO <INV 41>", amount: parseINR("150000") },
      { reference: "UTR4", date: "2026-08-01", description: "SMS CHARGES QTR", amount: parseINR("-17.70") },
    ],
    "priya",
  );
  org.banking.categorize("UTR3", "acc_ar", "priya");
  return org;
};

const input = (org: ReturnType<typeof booked>, from = "2026-07-01", to = "2026-07-31") => ({
  chart: org.chart,
  entries: org.journal.between(from, to),
  bankAccountIds: new Set(["acc_bank"]),
});

describe("vouchers", () => {
  it("makes a Payment for money out, a Receipt for money in, and a Contra for cash", () => {
    const org = booked();
    const types = Object.fromEntries(bankVouchers(input(org)).map((v) => [v.reference, v.type]));
    expect(types).toEqual({ UTR1: "Payment", UTR2: "Contra", UTR3: "Receipt" });
  });

  it("signs amounts the way Tally does, so every voucher sums to zero", () => {
    const org = booked();
    const { xml, vouchers } = tallyVouchersXml(input(org));
    expect(vouchers).toBe(3);
    for (const v of xml.split("<VOUCHER ").slice(1)) {
      const amounts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Math.round(Number(m[1]) * 100));
      expect(amounts).toHaveLength(2);
      expect(amounts[0]! + amounts[1]!).toBe(0);
      const debits = [...v.matchAll(/<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>(-?[\d.]+)/g)];
      expect(debits).toHaveLength(1);
      expect(Number(debits[0]![1])).toBeLessThan(0);
    }
    // money out: the expense is debited, the bank credited
    const payment = xml.split("<VOUCHER ").find((v) => v.includes('VCHTYPE="Payment"'))!;
    expect(payment).toMatch(/<LEDGERNAME>Bank Charges<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-17.70<\/AMOUNT>/);
    expect(payment).toMatch(/<LEDGERNAME>Bank<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>17.70<\/AMOUNT>/);
    expect(payment).toContain("<DATE>20260703</DATE>");
  });

  it("escapes narrations, and exports only the month asked for", () => {
    const org = booked();
    const { xml } = tallyVouchersXml(input(org));
    expect(xml).toContain("ZENITH LABS &amp; CO &lt;INV 41&gt;");
    expect(xml).not.toContain("UTR4");
  });

  it("leaves out entries that were reversed, and entries that were never bank lines", () => {
    const org = booked();
    const target = org.journal.all().find((e) => e.referenceId === "UTR1")!;
    org.journal.reverse(target.id, "priya", "booked twice", "2026-07-20");
    org.journal.post({
      date: "2026-07-21",
      narration: "Manual accrual",
      lines: [
        { accountId: "acc_rent", side: "DEBIT", amount: parseINR("1000") },
        { accountId: "acc_ap", side: "CREDIT", amount: parseINR("1000") },
      ],
      sourceModule: "manual",
      referenceId: null,
      createdBy: "priya",
    });
    expect(bankVouchers(input(org)).map((v) => v.reference)).toEqual(["UTR2", "UTR3"]);
  });
});

describe("ledgers", () => {
  it("creates each ledger the vouchers use once, under its Tally group", () => {
    const org = booked();
    const { xml, ledgers } = tallyLedgersXml(input(org));
    expect(ledgers).toBe(4);
    expect(xml).toMatch(/<LEDGER NAME="Bank" ACTION="Create">[\s\S]*?<PARENT>Bank Accounts<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="Cash" ACTION="Create">[\s\S]*?<PARENT>Cash-in-Hand<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="Accounts Receivable" ACTION="Create">[\s\S]*?<PARENT>Sundry Debtors<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="Bank Charges" ACTION="Create">[\s\S]*?<PARENT>Indirect Expenses<\/PARENT>/);
  });

  it("puts tax, loans and sales where a CA expects them", () => {
    const chart = booked().chart;
    const banks = new Set(["acc_bank"]);
    expect(tallyGroup(chart.get("acc_gst_payable"), banks)).toBe("Duties & Taxes");
    expect(tallyGroup(chart.get("acc_loans"), banks)).toBe("Loans (Liability)");
    expect(tallyGroup(chart.get("acc_sales"), banks)).toBe("Sales Accounts");
    expect(tallyGroup(chart.get("acc_interest_income"), banks)).toBe("Indirect Incomes");
  });
});
