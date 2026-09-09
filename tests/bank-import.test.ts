import { describe, it, expect } from "vitest";
import { parseStatementCsv, parseCsv, StatementParseError } from "../src/bank-import.js";

/* Real export shapes. Each bank names its columns differently and prints a
   preamble above the header, which is the whole reason this parser exists. */

const HDFC = `Account Statement for A/c No 50100XXXXXX
From 01/04/2025 To 30/04/2025

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
05/04/2025,NEFT DR-HDFC0001-ACME RETAIL,N123456789,05/04/2025,25000.00,,475000.00
18/04/2025,NEFT CR-ICIC0002-ZENITH LABS,N987654321,18/04/2025,,150000.00,625000.00
`;

const SBI = `Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
01-Apr-2025,01-Apr-2025,TO TRANSFER-UPI/DR/510/Swiggy,UPI510,842.50,,120000.00
02-Apr-2025,02-Apr-2025,BY TRANSFER-NEFT/CR/Orbit Systems,NEFT771,,88000.00,208000.00
`;

const KOTAK = `Sl. No.,Date,Description,Chq/Ref No.,Amount,Dr/Cr,Balance
1,2025-04-07,IMPS RENT PAYMENT,IMPS0007,"65,000.00",DR,"3,35,000.00"
2,2025-04-09,IMPS CLIENT PAYOUT,IMPS0009,"1,20,000.00",CR,"4,55,000.00"
`;

describe("splitting the file", () => {
  it("keeps commas and newlines that live inside a quoted narration", () => {
    const rows = parseCsv('a,b\n"NEFT DR-HDFC0001, MUMBAI",100\n');
    expect(rows[1]).toEqual(["NEFT DR-HDFC0001, MUMBAI", "100"]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('x\n"say ""hi"""\n')[1]).toEqual(['say "hi"']);
  });

  it("survives a BOM, which would otherwise become part of the first header", () => {
    expect(parseCsv("﻿Date,Amount\n")[0]).toEqual(["Date", "Amount"]);
  });
});

describe("reading a statement", () => {
  it("finds the header under the account preamble and signs by column", () => {
    const out = parseStatementCsv(HDFC);
    expect(out.rejected).toEqual([]);
    expect(out.lines).toEqual([
      { date: "2025-04-05", description: "NEFT DR-HDFC0001-ACME RETAIL", amount: -2500000n, reference: "N123456789" },
      { date: "2025-04-18", description: "NEFT CR-ICIC0002-ZENITH LABS", amount: 15000000n, reference: "N987654321" },
    ]);
  });

  it("prefers the transaction date over the value date", () => {
    expect(parseStatementCsv(HDFC).columns.date).toBe("Date");
    expect(parseStatementCsv(SBI).columns.date).toBe("Txn Date");
  });

  it("reads month names, and debit/credit under any spelling", () => {
    const out = parseStatementCsv(SBI);
    expect(out.lines.map((l) => l.amount)).toEqual([-84250n, 8800000n]);
    expect(out.lines[0]!.date).toBe("2025-04-01");
  });

  it("signs a single amount column by its Dr/Cr flag", () => {
    const out = parseStatementCsv(KOTAK);
    expect(out.rejected).toEqual([]);
    expect(out.lines.map((l) => l.amount)).toEqual([-6500000n, 12000000n]);
  });

  it("reports which columns it mapped, so a wrong guess is visible", () => {
    expect(parseStatementCsv(KOTAK).columns).toMatchObject({
      date: "Date", description: "Description", amount: "Amount", drcr: "Dr/Cr",
    });
  });
});

describe("the date trap", () => {
  it("proves day-first from a day past the twelfth", () => {
    const out = parseStatementCsv(`Date,Narration,Debit,Credit\n13/04/2025,X,100.00,\n03/04/2025,Y,,200.00\n`);
    expect(out.dateConvention).toBe("DMY");
    expect(out.dateConventionProven).toBe(true);
    expect(out.lines[1]!.date).toBe("2025-04-03");
  });

  it("proves month-first from a second component past the twelfth", () => {
    const out = parseStatementCsv(`Date,Narration,Debit,Credit\n04/13/2025,X,100.00,\n03/04/2025,Y,,200.00\n`);
    expect(out.dateConvention).toBe("MDY");
    expect(out.lines[1]!.date).toBe("2025-03-04");
  });

  it("says so when nothing in the file settles it, rather than claiming to know", () => {
    const out = parseStatementCsv(`Date,Narration,Debit,Credit\n03/04/2025,X,100.00,\n`);
    expect(out.dateConvention).toBe("DMY");
    expect(out.dateConventionProven).toBe(false);
    expect(out.lines[0]!.date).toBe("2025-04-03");
  });

  it("refuses a file that contradicts itself instead of half-reading it", () => {
    expect(() => parseStatementCsv(`Date,Narration,Debit,Credit\n13/04/2025,X,1.00,\n04/13/2025,Y,,2.00\n`))
      .toThrow(StatementParseError);
  });

  it("rejects a date that is not on the calendar", () => {
    const out = parseStatementCsv(`Date,Narration,Debit,Credit\n31/04/2025,X,100.00,\n`);
    expect(out.lines).toEqual([]);
    expect(out.rejected[0]!.reason).toContain("Unreadable date");
  });
});

describe("refusing rather than guessing", () => {
  const head = "Date,Narration,Debit,Credit\n";

  it("will not net a row that carries both a debit and a credit", () => {
    const out = parseStatementCsv(head + "05/04/2025,X,100.00,50.00\n");
    expect(out.lines).toEqual([]);
    expect(out.rejected[0]!.reason).toBe("Both a debit and a credit on one row");
  });

  it("reports the line number so a person can go and look", () => {
    const out = parseStatementCsv(head + "05/04/2025,X,100.00,50.00\n");
    expect(out.rejected[0]!.line).toBe(2);
  });

  it("keeps a row with no amount out of the ledger", () => {
    const out = parseStatementCsv(head + "05/04/2025,X,,\n");
    expect(out.rejected[0]!.reason).toBe("No amount on this row");
  });

  it("separates an unreadable amount from a blank one", () => {
    const out = parseStatementCsv(head + "05/04/2025,X,N/A,\n");
    expect(out.rejected[0]!.reason).toBe("Unreadable amount");
  });

  it("will not sign a bare magnitude when the flag column is blank", () => {
    const out = parseStatementCsv(`Date,Description,Amount,Dr/Cr\n05/04/2025,X,100.00,\n`);
    expect(out.rejected[0]!.reason).toBe("Amount with no debit/credit indicator");
  });

  it("refuses a flag it does not recognise", () => {
    const out = parseStatementCsv(`Date,Description,Amount,Dr/Cr\n05/04/2025,X,100.00,XX\n`);
    expect(out.rejected[0]!.reason).toContain("Unrecognised debit/credit flag");
  });

  it("drops a row with no description, which cannot be categorised later", () => {
    const out = parseStatementCsv(head + "05/04/2025,,100.00,\n");
    expect(out.rejected[0]!.reason).toBe("No description on this row");
  });

  it("reads a single signed amount column literally when there is no flag column", () => {
    const out = parseStatementCsv(`Date,Description,Amount\n05/04/2025,X,-750.25\n06/04/2025,Y,1000\n`);
    expect(out.lines.map((l) => l.amount)).toEqual([-75025n, 100000n]);
  });

  it("ignores the balance column when choosing the amount", () => {
    const out = parseStatementCsv(`Date,Narration,Debit,Credit,Closing Balance\n05/04/2025,X,,200.00,999999.00\n`);
    expect(out.lines[0]!.amount).toBe(20000n);
  });

  it("skips blank rows and the footer banks append", () => {
    const out = parseStatementCsv(HDFC + "\nThis is a computer generated statement.\n");
    expect(out.lines).toHaveLength(2);
    expect(out.rejected).toEqual([]);
  });

  it("refuses a file with no recognisable header", () => {
    expect(() => parseStatementCsv("hello\nworld\n")).toThrow(StatementParseError);
  });

  it("refuses an empty file", () => {
    expect(() => parseStatementCsv("")).toThrow(StatementParseError);
  });
});
