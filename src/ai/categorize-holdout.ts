/**
 * Held-out bank lines for the categorization eval.
 *
 * WRITTEN BEFORE ANY FIX, AND NOT TO BE TUNED AGAINST.
 *
 * The development set (categorize-cases.ts) is what fixes are designed while
 * looking at. That makes it a biased judge: a rule written to pass one of its
 * traps raises its score without making the categorizer any better at lines
 * it has never seen. This set exists to catch exactly that. It was committed
 * before the step-2 changes, uses different vendors, different banks'
 * narration styles (SBI, Kotak, Yes, PNB alongside HDFC, ICICI, Axis) and
 * different kinds of trap, and no default rule may be added because a line
 * here needed one. If a fix only improves the development set, it did not
 * work.
 *
 * SYNTHETIC. Written for this file; no customer statement, no real account.
 */

import type { CategorizeCase } from "./categorize-eval.js";

export const CATEGORIZE_HOLDOUT: readonly CategorizeCase[] = [
  /* ---------------- software ---------------- */
  { id: "h-sw-adobe-ach", description: "ACH DR ADOBE SYSTEMS SOFTWARE IRELAND 88120", amount: "-4230.00", expect: "acc_software" },
  { id: "h-sw-freshworks-upi", description: "UPI-FRESHWORKS TECHNOLOGIES-freshworks@kotak-KKBK0000958-610233", amount: "-7080.00", expect: "acc_software" },
  { id: "h-sw-atlassian-pos", description: "POS 5241XXXXXXXX7788 ATLASSIAN PTY LTD", amount: "-2912.00", expect: "acc_software" },
  { id: "h-sw-godaddy-bil", description: "BIL/ONL/000887766/GODADDY INDIA DOMAINS", amount: "-1499.00", expect: "acc_software" },
  { id: "h-sw-github-sbi", description: "TO TRANSFER-UPI/DR/610344/GitHub/github@icici/Copilot", amount: "-850.00", expect: "acc_software" },

  /* ---------------- marketing ---------------- */
  { id: "h-mk-sulekha-upi", description: "UPI/DR/610355/SULEKHA COM NEW MEDIA/sulekha@yesbank/Leads", amount: "-4500.00", expect: "acc_marketing" },
  { id: "h-mk-flex-imps", description: "IMPS/P2A/610366/SHREE PRINTS FLEX HOARDING", amount: "-8200.00", expect: "acc_marketing" },

  /* ---------------- travel ---------------- */
  { id: "h-tr-redbus-upi", description: "UPI-REDBUS IN-redbus@axisbank-UTIB0000100-610377", amount: "-1350.00", expect: "acc_travel" },
  { id: "h-tr-airindia-pos", description: "POS 5241XXXXXXXX7788 AIR INDIA LTD WEB", amount: "-8765.00", expect: "acc_travel" },
  { id: "h-tr-irctc-sbi", description: "TO TRANSFER-UPI/DR/610388/IRCTC eTicketing/irctc@ybl/Ticket", amount: "-2240.00", expect: "acc_travel" },

  /* ---------------- utilities ---------------- */
  { id: "h-ut-bses-bil", description: "BIL/ONL/000887767/BSES RAJDHANI POWER", amount: "-5120.00", expect: "acc_utilities" },
  { id: "h-ut-vi-ach", description: "ACH D- VODAFONE IDEA LTD-VI112233", amount: "-649.00", expect: "acc_utilities" },
  { id: "h-ut-mgl-upi", description: "UPI/DR/610399/MAHANAGAR GAS LTD/mgl@hdfcbank/Bill", amount: "-1180.00", expect: "acc_utilities" },
  { id: "h-ut-airtel-broadband", description: "BIL BPAY AIRTEL BROADBAND 0801234567", amount: "-1413.00", expect: "acc_utilities" },

  /* ---------------- rent ---------------- */
  { id: "h-rn-verma-neft", description: "NEFT DR-VERMA ESTATES-OFFICE RENT OCT 26-PUNB0123400", amount: "-38000.00", expect: "acc_rent" },
  { id: "h-rn-shop-upi", description: "UPI/DR/610411/SHOP RENT NOV/landlord@okicici", amount: "-15000.00", expect: "acc_rent" },

  /* ---------------- salary ---------------- */
  { id: "h-sl-sal-abbrev", description: "NEFT DR-SAL OCT 2026-RAHUL VERMA-KKBK0000958", amount: "-42000.00", expect: "acc_salary" },
  {
    id: "h-sl-salary-advance",
    description: "IMPS/P2A/610422/SALARY ADVANCE AMIT K",
    amount: "-10000.00",
    expect: "review",
    why: "An advance against salary is money the employee owes back, not a salary expense.",
  },

  /* ---------------- bank charges ---------------- */
  { id: "h-bc-chq-book", description: "CHGS FOR CHQ BOOK ISSUE", amount: "-118.00", expect: "acc_bank_charges" },
  { id: "h-bc-atm-chrg", description: "ATM TRANSACTION CHRG 3RD PARTY", amount: "-23.60", expect: "acc_bank_charges" },
  { id: "h-bc-consolidated", description: "CONSOLIDATED CHARGES FOR A/C 61234", amount: "-354.00", expect: "acc_bank_charges" },

  /* ---------------- food ---------------- */
  { id: "h-fd-bikanervala-upi", description: "UPI/DR/610433/BIKANERVALA FOODS/bikaner@paytm/Order", amount: "-760.00", expect: "acc_meals" },
  { id: "h-fd-starbucks-pos", description: "POS 5241XXXXXXXX7788 TATA STARBUCKS PVT", amount: "-845.00", expect: "acc_meals" },
  {
    id: "h-fd-blinkit-upi",
    description: "UPI-BLINKIT COMMERCE-blinkit@hdfcbank-HDFC0000001-610444",
    amount: "-1260.00",
    expect: "review",
    why: "Quick commerce sells groceries, cleaning supplies and snacks; the narration cannot say which.",
  },

  /* ---------------- fuel ---------------- */
  { id: "h-fu-shell-pos", description: "POS 5241XXXXXXXX7788 SHELL INDIA MARKETS", amount: "-3500.00", expect: "acc_vehicle_fuel" },
  { id: "h-fu-nayara-pos", description: "POS 1234XXXXXXXX4321 NAYARA ENERGY RO 2231", amount: "-2800.00", expect: "acc_vehicle_fuel" },

  /* ---------------- insurance ---------------- */
  { id: "h-is-lombard-ach", description: "ACH D- ICICI LOMBARD GIC LTD-POL7731", amount: "-14200.00", expect: "acc_insurance" },
  { id: "h-is-star-nach", description: "NACH DR STAR HEALTH AND ALLIED INSUR", amount: "-9600.00", expect: "acc_insurance" },

  /* ---------------- taxes paid ---------------- */
  { id: "h-tx-gst-sbi-epay", description: "E-PAY GST CHALLAN CPIN 26101122334455 SBI", amount: "-21640.00", expect: "acc_gst_payable" },
  { id: "h-tx-tds-nsdl", description: "TIN 281 TDS NSDL CHALLAN 0510308", amount: "-9800.00", expect: "acc_taxes_payable" },

  /* ---------------- cash ---------------- */
  { id: "h-ca-nfs-atm", description: "NFS ATM WDL 610455 SBI MALL ROAD", amount: "-5000.00", expect: "acc_cash" },
  { id: "h-ca-cdm-deposit", description: "CASH DEPOSIT CDM 004512 INDIRANAGAR", amount: "40000.00", expect: "acc_cash" },

  /* ---------------- interest ---------------- */
  { id: "h-in-sb-interest", description: "SB INTEREST CREDITED Q2", amount: "734.00", expect: "acc_interest_income" },
  { id: "h-in-fd-interest", description: "INTEREST ON FD 50100098877 CREDITED", amount: "5210.00", expect: "acc_interest_income" },
  {
    id: "h-in-od-charged",
    description: "OD INTEREST CHARGED FOR SEP 2026",
    amount: "-4180.00",
    expect: "acc_interest_expense",
    why: "Money out. Overdraft interest is an expense.",
  },

  /* ---------------- money in ---------------- */
  { id: "h-rc-cashfree", description: "NEFT CR-CASHFREE PAYMENTS INDIA-SETTLEMENT 1410", amount: "56300.25", expect: "acc_sales" },
  {
    id: "h-rc-client-neft",
    description: "NEFT CR-YESB0000012-ORBIT DESIGN STUDIO-PROJECT PAYMENT",
    amount: "85000.00",
    expect: "review",
    why: "A client paying an invoice; which invoice is a reconciliation question.",
  },
  { id: "h-rc-loan-disbursal", description: "LOAN DISBURSEMENT CREDIT BL 7788123", amount: "500000.00", expect: "acc_loans" },

  /* ---------------- traps, different from the development set ---------------- */
  {
    id: "h-trap-ads-infosoft",
    description: "NEFT DR-ADS INFOSOFT PVT LTD-AMC RENEWAL",
    amount: "-18000.00",
    expect: "review",
    why: "ADS is part of an IT vendor's name; an annual maintenance contract is not advertising.",
  },
  {
    id: "h-trap-salary-account-closure",
    description: "SALARY ACCOUNT CLOSURE CHARGES",
    amount: "-590.00",
    expect: "acc_bank_charges",
    why: "A bank fee that mentions a salary account. It is not salary.",
  },
  {
    id: "h-trap-airtel-wallet",
    description: "UPI/DR/610466/AIRTEL PAYMENTS BANK/WALLET LOAD",
    amount: "-2000.00",
    expect: "review",
    why: "Loading a wallet moves money, it doesn't pay a phone bill.",
  },
  {
    id: "h-trap-jiomart",
    description: "UPI-JIOMART RELIANCE RETAIL-jiomart@sbi-SBIN0000001-610477",
    amount: "-3120.00",
    expect: "review",
    why: "JioMart is a grocery marketplace, not the Jio telecom bill.",
  },
  {
    id: "h-trap-interest-subvention",
    description: "INTEREST SUBVENTION CREDIT MSME SCHEME",
    amount: "12000.00",
    expect: "review",
    why: "A government subsidy against interest paid; its treatment is a judgement, not interest earned.",
  },
  {
    id: "h-trap-rent-refund-in",
    description: "IMPS/P2A/610488/RENT REFUND EXCESS PAID",
    amount: "5000.00",
    expect: "review",
    why: "Rent overpaid and returned. Crediting it to the rent expense might be right, but it is money in against an expense account and deserves a look.",
  },
  {
    id: "h-trap-uber-freight",
    description: "NEFT DR-UBER FREIGHT LOGISTICS-LR 22341",
    amount: "-26500.00",
    expect: "review",
    why: "Freight for goods is a cost of the goods, not staff travel.",
  },
  {
    id: "h-trap-legal-heir",
    description: "NEFT CR-LEGAL HEIR SETTLEMENT PROCEEDS",
    amount: "250000.00",
    expect: "review",
    why: "Money in that mentions \"legal\" is not a professional fee in any direction.",
  },
];
