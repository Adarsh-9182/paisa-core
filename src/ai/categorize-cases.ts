/**
 * Labelled bank lines for the categorization eval.
 *
 * SYNTHETIC. Every line here was written for this file in the shapes Indian
 * banks print — HDFC separates with slashes, ICICI with hyphens, Axis with
 * spaces; UPI, NEFT, IMPS, ACH, NACH, POS, ATM and bill-pay narrations. None
 * of it is a real customer's statement, and no real account numbers appear.
 *
 * Three kinds of case, deliberately mixed:
 *
 *   - ordinary lines the product has to book: SaaS, rent, salary, utilities,
 *     travel, bank charges, food, fuel, GST and TDS payments, cash
 *   - lines nobody could book without asking, labelled "review": transfers to
 *     a person, EMIs that mix principal and interest, marketplace purchases
 *   - traps, where a keyword appears inside something it does not mean:
 *     "PARENT" contains "rent", Uber Eats is food not travel, Legal Metrology
 *     is a government licence not a lawyer. These are the lines that measure
 *     precision, which is the number that matters most.
 *
 * Some expected accounts do not exist in today's chart of accounts. They are
 * listed in PROPOSED_ACCOUNTS: until they exist, sending those lines to
 * review is the correct behaviour, and booking them anywhere else is wrong.
 */

import type { CategorizeCase } from "./categorize-eval.js";

/** Accounts the eval expects that the chart does not have yet. */
export const PROPOSED_ACCOUNTS: Readonly<Record<string, { readonly name: string; readonly type: "EXPENSE" | "REVENUE" }>> = {
  acc_bank_charges: { name: "Bank Charges", type: "EXPENSE" },
  acc_meals: { name: "Meals & Refreshments", type: "EXPENSE" },
  acc_vehicle_fuel: { name: "Vehicle & Fuel", type: "EXPENSE" },
  acc_office_supplies: { name: "Office Supplies", type: "EXPENSE" },
  acc_insurance: { name: "Insurance", type: "EXPENSE" },
  acc_interest_expense: { name: "Interest Expense", type: "EXPENSE" },
  acc_rental_income: { name: "Rental Income", type: "REVENUE" },
};

export const CATEGORIZE_CASES: readonly CategorizeCase[] = [
  /* ---------------- software ---------------- */
  { id: "sw-aws-pos", description: "POS 4521XXXXXXXX1234 AWS SERVICES", amount: "-18432.60", expect: "acc_software" },
  { id: "sw-gcp-ach", description: "ACH D- GOOGLE CLOUD INDIA PVT LTD-GCP77341", amount: "-9120.00", expect: "acc_software" },
  { id: "sw-github-upi-hdfc", description: "UPI/DR/412345678901/GITHUB INC/github@hdfcbank/Payment", amount: "-3350.00", expect: "acc_software" },
  { id: "sw-figma-neft", description: "NEFT DR-FIGMA INC-N261234567", amount: "-6200.00", expect: "acc_software" },
  { id: "sw-slack-imps-icici", description: "IMPS-409812345678-SLACK TECHNOLOGIES-ICIC0000001", amount: "-2890.00", expect: "acc_software" },
  { id: "sw-notion-upi-icici", description: "UPI-NOTION LABS-notion@icici-ICIC0000001-409813", amount: "-1680.00", expect: "acc_software" },
  { id: "sw-zoho-ach", description: "ACH D- ZOHO CORPORATION PVT LTD-ZB44120", amount: "-2400.00", expect: "acc_software" },
  { id: "sw-microsoft-bil", description: "BIL/ONL/000123456/MICROSOFT INDIA/OFFICE365", amount: "-5760.00", expect: "acc_software" },
  { id: "sw-canva-upi-axis", description: "UPI DR 412398 CANVA canva@okaxis", amount: "-499.00", expect: "acc_software" },
  { id: "sw-openai-pos", description: "POS 1234XXXXXXXX9876 OPENAI CHATGPT SUBSCR", amount: "-1999.00", expect: "acc_software" },

  /* ---------------- marketing ---------------- */
  { id: "mk-google-ads-ach", description: "ACH D- GOOGLE ADS INDIA-ADWORDS88123", amount: "-25000.00", expect: "acc_marketing" },
  { id: "mk-meta-ads-pos", description: "POS 4521XXXXXXXX1234 FACEBK META ADS", amount: "-12000.00", expect: "acc_marketing" },
  { id: "mk-linkedin-neft", description: "NEFT DR-LINKEDIN TECHNOLOGY-INV998812", amount: "-8400.00", expect: "acc_marketing" },
  { id: "mk-justdial-upi", description: "UPI/DR/412377/JUSTDIAL LTD/justdial@hdfcbank/Listing", amount: "-6000.00", expect: "acc_marketing" },

  /* ---------------- travel ---------------- */
  { id: "tr-uber-upi-axis", description: "UPI DR 412311 UBER INDIA uber@axisbank", amount: "-412.00", expect: "acc_travel" },
  { id: "tr-ola-upi-icici", description: "UPI-OLA CABS-ola@icici-ICIC0000001-409877", amount: "-286.00", expect: "acc_travel" },
  { id: "tr-mmt-pos", description: "POS 4521XXXXXXXX1234 MAKEMYTRIP INDIA PVT", amount: "-14230.00", expect: "acc_travel" },
  { id: "tr-irctc-upi", description: "UPI/DR/412355/IRCTC/irctc@sbi/Ticket", amount: "-1845.00", expect: "acc_travel" },
  { id: "tr-indigo-pos", description: "POS 1234XXXXXXXX9876 INDIGO AIRLINES 6E", amount: "-6412.00", expect: "acc_travel" },
  { id: "tr-rapido-upi", description: "UPI/DR/412366/RAPIDO/rapido@ybl/Ride", amount: "-96.00", expect: "acc_travel" },

  /* ---------------- utilities ---------------- */
  { id: "ut-bescom-bil", description: "BIL/ONL/000223344/BESCOM ELECTRICITY BILL", amount: "-4312.00", expect: "acc_utilities" },
  { id: "ut-airtel-bil", description: "BIL/ONL/000223345/AIRTEL POSTPAID BILL", amount: "-1178.82", expect: "acc_utilities" },
  { id: "ut-jio-ach", description: "ACH D- RELIANCE JIO INFOCOMM-JIO5541", amount: "-999.00", expect: "acc_utilities" },
  { id: "ut-msedcl-bil", description: "BIL/ONL/000223346/MSEDCL ELECTRICITY", amount: "-3890.00", expect: "acc_utilities" },
  { id: "ut-act-upi", description: "UPI/DR/412388/ACT FIBERNET/actfibernet@hdfcbank/Broadband", amount: "-1060.00", expect: "acc_utilities" },
  { id: "ut-tatapower-bil", description: "BIL BPAY TATA POWER DDL CA 60001234", amount: "-2750.00", expect: "acc_utilities" },

  /* ---------------- rent ---------------- */
  { id: "rn-office-neft", description: "NEFT DR-SHARMA PROPERTIES-OFFICE RENT SEP26", amount: "-45000.00", expect: "acc_rent" },
  { id: "rn-landlord-imps", description: "IMPS-409899-RAJESH KUMAR-RENT", amount: "-28000.00", expect: "acc_rent" },
  {
    id: "rn-received-upi",
    description: "UPI/CR/412301/MEHTA TRADERS/RENT RECEIVED FLAT 2B",
    amount: "22000.00",
    expect: "acc_rental_income",
    why: "Money in. Rent received is income; booking it to Office Rent credits an expense.",
  },

  /* ---------------- salary ---------------- */
  { id: "sl-neft", description: "NEFT DR-SALARY SEP 2026-PRIYA SHARMA", amount: "-65000.00", expect: "acc_salary" },
  { id: "sl-bulk", description: "SALARY PAYOUT BULK UPLOAD NEFT BATCH 22", amount: "-412000.00", expect: "acc_salary" },

  /* ---------------- professional fees ---------------- */
  { id: "pf-ca-neft", description: "NEFT DR-CA FEES Q2-GUPTA AND ASSOCIATES", amount: "-18000.00", expect: "acc_professional" },
  { id: "pf-legal-imps", description: "IMPS-409845-LEGAL RETAINER-KHAITAN AND CO", amount: "-50000.00", expect: "acc_professional" },
  { id: "pf-vakilsearch-upi", description: "UPI-VAKILSEARCH-vakil@icici-ICIC0000001-409866", amount: "-5999.00", expect: "acc_professional" },

  /* ---------------- interest ---------------- */
  { id: "in-paid-credit", description: "INTEREST PAID TILL 30-SEP-2026", amount: "1842.00", expect: "acc_interest_income" },
  { id: "in-capitalised", description: "CREDIT INTEREST CAPITALISED", amount: "912.00", expect: "acc_interest_income" },
  {
    id: "in-od-debit",
    description: "INTEREST DEBITED OD A/C 50200012345678",
    amount: "-6420.00",
    expect: "acc_interest_expense",
    why: "Money out. Interest charged on an overdraft is an expense, not income.",
  },
  {
    id: "in-loan-recovery",
    description: "LOAN INTEREST RECOVERY 998877",
    amount: "-3310.00",
    expect: "acc_interest_expense",
    why: "Money out. Interest paid on a loan.",
  },

  /* ---------------- money in ---------------- */
  {
    id: "rc-customer-neft",
    description: "NEFT CR-ICIC0000123-ZENITH LABS PVT LTD-INV-2026-041",
    amount: "150000.00",
    expect: "review",
    why: "A customer receipt settles an invoice. Matching it is reconciliation, not a category.",
  },
  { id: "rc-razorpay-settlement", description: "NEFT CR-RAZORPAY SOFTWARE PVT LTD-SETTLEMENT 26SEP", amount: "84210.40", expect: "acc_sales" },
  {
    id: "rc-person-upi",
    description: "UPI/CR/412302/SUNIL/sunil@ybl/Payment",
    amount: "5000.00",
    expect: "review",
    why: "Money from a person's name: a sale, a loan, a refund — nobody can tell without asking.",
  },

  /* ---------------- bank charges ---------------- */
  { id: "bc-sms", description: "SMS CHARGES QTR SEP-26", amount: "-17.70", expect: "acc_bank_charges" },
  { id: "bc-neft-chrg", description: "CHRG: NEFT CHARGES INCL GST", amount: "-5.90", expect: "acc_bank_charges" },
  { id: "bc-card-fee", description: "DEBIT CARD ANNUAL FEE+GST", amount: "-589.00", expect: "acc_bank_charges" },
  { id: "bc-minbal", description: "MIN BAL CHGS AUG 2026", amount: "-590.00", expect: "acc_bank_charges" },
  { id: "bc-imps-chrg", description: "IMPS CHRG 409812345678", amount: "-5.90", expect: "acc_bank_charges" },

  /* ---------------- food ---------------- */
  { id: "fd-swiggy-upi", description: "UPI/DR/412312/SWIGGY/swiggy@icici/Order", amount: "-642.00", expect: "acc_meals" },
  { id: "fd-zomato-upi", description: "UPI-ZOMATO LTD-zomato@hdfcbank-HDFC0000001-409822", amount: "-518.00", expect: "acc_meals" },
  { id: "fd-chaayos-pos", description: "POS 4521XXXXXXXX1234 CHAAYOS CYBER HUB", amount: "-380.00", expect: "acc_meals" },
  { id: "fd-dominos-upi", description: "UPI DR 412333 DOMINOS PIZZA dominos@axisbank", amount: "-1123.00", expect: "acc_meals" },

  /* ---------------- fuel ---------------- */
  { id: "fu-hpcl-pos", description: "POS 4521XXXXXXXX1234 HPCL ANAND FUELS", amount: "-3000.00", expect: "acc_vehicle_fuel" },
  { id: "fu-iocl-pos", description: "POS 1234XXXXXXXX9876 INDIAN OIL CORP COCO", amount: "-2500.00", expect: "acc_vehicle_fuel" },
  { id: "fu-bpcl-upi", description: "UPI/DR/412344/BPCL PETROL PUMP/bpcl@sbi/Fuel", amount: "-2000.00", expect: "acc_vehicle_fuel" },

  /* ---------------- supplies and marketplaces ---------------- */
  { id: "os-staples-upi", description: "UPI/DR/412355/STAPLES STATIONERY/staples@ybl/Order", amount: "-1460.00", expect: "acc_office_supplies" },
  {
    id: "os-amazon-pos",
    description: "POS 4521XXXXXXXX1234 AMAZON PAY INDIA",
    amount: "-3899.00",
    expect: "review",
    why: "Amazon sells everything. The narration cannot say whether this was a monitor, stationery or a gift.",
  },
  { id: "os-flipkart-upi", description: "UPI/DR/412356/FLIPKART/flipkart@axisbank/Order", amount: "-7499.00", expect: "review", why: "A marketplace, like Amazon." },
  { id: "os-dmart-pos", description: "POS 1234XXXXXXXX9876 DMART AVENUE SUPERMARTS", amount: "-2310.00", expect: "review", why: "Pantry, cleaning supplies or personal groceries." },

  /* ---------------- insurance ---------------- */
  { id: "is-lic-ach", description: "ACH D- LIC OF INDIA-PREM 55123412", amount: "-12400.00", expect: "acc_insurance" },
  { id: "is-ergo-nach", description: "NACH DR HDFC ERGO GENERAL INS 7781", amount: "-8600.00", expect: "acc_insurance" },

  /* ---------------- taxes paid ---------------- */
  { id: "tx-gst-cpin", description: "GST PMT CPIN 26091234567890 CBIC", amount: "-38420.00", expect: "acc_gst_payable" },
  { id: "tx-tds-281", description: "ITNS 281 TDS CHALLAN OLTAS 0512345", amount: "-14500.00", expect: "acc_taxes_payable" },
  { id: "tx-advance-280", description: "ITNS 280 ADVANCE TAX CHALLAN", amount: "-60000.00", expect: "acc_taxes_payable" },

  /* ---------------- cash ---------------- */
  { id: "ca-atm-wdl", description: "ATM WDL 409812 MG ROAD BLR", amount: "-10000.00", expect: "acc_cash", why: "Moves money from bank to cash; not an expense." },
  { id: "ca-cash-dep", description: "CASH DEP BRANCH 0123 KORAMANGALA", amount: "25000.00", expect: "acc_cash" },

  /* ---------------- loans and owner ---------------- */
  { id: "ln-emi-hdfc", description: "EMI 12 OF 36 HDFC BANK LOAN 998877", amount: "-24310.00", expect: "review", why: "An EMI is principal and interest together; the split comes from the loan schedule." },
  { id: "ln-bajaj-nach", description: "NACH DR BAJAJ FINANCE EMI 22145", amount: "-8900.00", expect: "review", why: "Same as any EMI." },
  { id: "ow-self-transfer", description: "IMPS-409877-ADARSH BHARDWAJ-SELF TRANSFER", amount: "-50000.00", expect: "review", why: "Owner drawings or a salary — the owner decides." },
  { id: "ow-capital-in", description: "NEFT CR-ADARSH BHARDWAJ-CAPITAL INFUSION", amount: "200000.00", expect: "acc_capital" },

  /* ---------------- traps: keyword inside something it does not mean ---------------- */
  {
    id: "trap-parent-company",
    description: "NEFT DR-PARENT COMPANY-INTERCO SETTLEMENT",
    amount: "-100000.00",
    expect: "review",
    why: "\"rent\" appears inside PARENT. An intercompany settlement is never rent.",
  },
  {
    id: "trap-rentokil",
    description: "UPI/DR/412367/RENTOKIL PCI PEST CONTROL/rentokil@hdfcbank",
    amount: "-2360.00",
    expect: "review",
    why: "RENTOKIL starts with \"rent\". Pest control is a repair and maintenance cost.",
  },
  {
    id: "trap-awsm-fashion",
    description: "POS 4521XXXXXXXX1234 AWSM FASHION STORE",
    amount: "-2899.00",
    expect: "review",
    why: "AWSM is not AWS.",
  },
  {
    id: "trap-slacks-apparel",
    description: "UPI DR 412377 SLACKS APPAREL slacks@okaxis",
    amount: "-1799.00",
    expect: "review",
    why: "SLACKS is not Slack.",
  },
  {
    id: "trap-uber-eats",
    description: "UPI DR 412378 UBER EATS INDIA ubereats@axisbank",
    amount: "-460.00",
    expect: "acc_meals",
    why: "Food delivery, not travel, even though the payee is Uber.",
  },
  {
    id: "trap-ola-electric-service",
    description: "UPI/DR/412379/OLA ELECTRIC SERVICE CENTRE/olaelectric@hdfcbank",
    amount: "-3450.00",
    expect: "review",
    why: "A scooter repair from Ola Electric, not a cab ride.",
  },
  {
    id: "trap-legal-metrology",
    description: "NEFT DR-LEGAL METROLOGY DEPT-LICENCE FEE 2026",
    amount: "-1500.00",
    expect: "review",
    why: "A government licence fee. \"Legal\" here is not a lawyer.",
  },
  {
    id: "trap-notion-press",
    description: "IMPS-409880-NOTION PRESS PUBLISHING-BOOK PRINT",
    amount: "-9800.00",
    expect: "review",
    why: "A book printer that happens to be called Notion.",
  },
  {
    id: "trap-zoho-payroll",
    description: "ACH D- ZOHO PAYROLL-ZP88123",
    amount: "-1200.00",
    expect: "review",
    why: "Either the Zoho Payroll subscription or wages paid through it; the amount suggests the fee, but nobody should guess.",
  },
  {
    id: "trap-interest-free-emi-fee",
    description: "UPI/DR/412381/AMAZON/INTEREST FREE EMI PROCESSING FEE",
    amount: "-199.00",
    expect: "review",
    why: "A processing fee that mentions interest. Booking it as interest income inverts it.",
  },
  {
    id: "trap-rent-deposit-refund",
    description: "NEFT CR-SHARMA PROPERTIES-RENT DEPOSIT REFUND",
    amount: "90000.00",
    expect: "review",
    why: "A security deposit returned is an asset coming back, not rent income and not a negative rent expense.",
  },
];
