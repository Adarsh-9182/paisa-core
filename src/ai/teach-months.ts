/**
 * Three months of one company's bank statement, for the step 4 simulation.
 *
 * DEVELOPMENT set. Fixes may be designed by looking at these lines. The
 * held-out company in teach-months-holdout.ts may not be looked at for that.
 *
 * A Bengaluru design studio banking with HDFC, April to June 2026. Roughly
 * what such a statement holds: payroll, rent, card subscriptions, bills, tax
 * challans, customer receipts, a loan EMI, the owner's reimbursements, and a
 * few one-off purchases each month. Narrations follow HDFC's formats, with the
 * parts that change every month (UTRs, UPI references, cheque serials, month
 * names, invoice numbers) changing.
 *
 * Some payees are booked differently from month to month on purpose, because
 * real ones are: an employee reimbursed for cabs one month and lunch the next,
 * and a marketplace that sells stationery and monitors.
 */

import type { CompanyMonths, MonthLine } from "./teach-eval.js";

const l = (payee: string, day: number, description: string, amount: string, account: string): MonthLine => ({
  payee,
  day,
  description,
  amount,
  account,
});

export const TEACH_DEV: CompanyMonths = {
  name: "DEV",
  bank: "HDFC",
  months: [
    [
      l("rent", 3, "NEFT DR-SBIN0004321-SURESH NAIK-NETBANK, MUM-N093260418822-OFFICE RENT APR", "-85000", "acc_rent"),
      l("sal-priya", 28, "NEFT DR-ICIC0001234-PRIYA MENON-NETBANK, MUM-N118260455901-SAL APR26", "-65000", "acc_salary"),
      l("sal-arjun", 28, "IMPS-611812345678-ARJUN RAO-KKBK-XXXXXXX4410-SALARY APR", "-52000", "acc_salary"),
      l("sal-deepa", 28, "NEFT DR-HDFC0000456-DEEPA IYER-NETBANK, MUM-N118260455902-SAL APR26", "-48000", "acc_salary"),
      l("canva", 5, "ME DC SI 416021XXXXXX4821 CANVA", "-499", "acc_software"),
      l("gworkspace", 6, "ME DC SI 416021XXXXXX4821 GOOGLE WORKSPACE", "-1380", "acc_software"),
      l("adobe", 9, "ME DC SI 416021XXXXXX4821 ADOBE SYSTEMS", "-4230", "acc_software"),
      l("airtel", 10, "ACH D- AIRTEL BROADBAND-3004512876", "-1178", "acc_utilities"),
      l("bescom", 12, "UPI-BESCOM-bescom.billdesk@hdfcbank-HDFC0000001-610212345671-BILLPAY", "-6240", "acc_utilities"),
      l("zenith", 15, "NEFT CR-ICIC0000123-ZENITH LABS PVT LTD-INV 2026-041-ICICN26105123456", "150000", "acc_ar"),
      l("orbit", 18, "NEFT CR-YESB0000012-ORBIT FOODS LLP-PROJECT PAYMENT-YESBN26108765432", "85000", "acc_ar"),
      l("ca-mehta", 7, "IMPS-609712345111-MEHTA AND ASSOCIATES-HDFC-XXXXXXX9021-RETAINER APR", "-15000", "acc_professional"),
      l("bluetokai", 11, "POS 416021XXXXXX4821 BLUE TOKAI KORAMANGALA", "-1840", "acc_meals"),
      l("rapido", 14, "UPI-RAPIDO-rapido.bike@ybl-YESB0YBLUPI-610412398712-RIDE", "-240", "acc_travel"),
      l("gst", 20, "GSTN CPIN 26040012345678 HDFC", "-28400", "acc_gst_payable"),
      l("tds", 7, "ITNS 281 CHALLAN 0510308 00012", "-9500", "acc_taxes_payable"),
      l("imps-chg", 14, "IMPS CHGS 610412398712", "-5.90", "acc_bank_charges"),
      l("emi", 5, "EMI 4455621 CHQ S3120045 0426", "-32100", "acc_loans"),
      l("amazon", 16, "UPI-AMAZON PAY INDIA-amazonpay@apl-UTIB0000100-610612399981-ORDER", "-3499", "acc_office_supplies"),
      l("rahul", 19, "UPI-RAHUL VERMA-rahulv@ybl-SBIN0001111-610912311111-CAB BILLS", "-2340", "acc_travel"),
      l("swiggy", 22, "UPI-SWIGGY-swiggy@icici-ICIC0DC0099-611212322222-TEAM LUNCH", "-2860", "acc_meals"),
      l("croma", 24, "POS 416021XXXXXX4821 CROMA ELECTRONICS", "-18990", "acc_equipment"),
    ],
    [
      l("rent", 4, "NEFT DR-SBIN0004321-SURESH NAIK-NETBANK, MUM-N123260511731-OFFICE RENT MAY", "-85000", "acc_rent"),
      l("sal-priya", 28, "NEFT DR-ICIC0001234-PRIYA MENON-NETBANK, MUM-N148260567003-SAL MAY26", "-65000", "acc_salary"),
      l("sal-arjun", 28, "IMPS-614812399001-ARJUN RAO-KKBK-XXXXXXX4410-SALARY MAY", "-52000", "acc_salary"),
      l("sal-deepa", 28, "NEFT DR-HDFC0000456-DEEPA IYER-NETBANK, MUM-N148260567004-SAL MAY26", "-48000", "acc_salary"),
      l("canva", 5, "ME DC SI 416021XXXXXX4821 CANVA", "-499", "acc_software"),
      l("gworkspace", 6, "ME DC SI 416021XXXXXX4821 GOOGLE WORKSPACE", "-1380", "acc_software"),
      l("adobe", 9, "ME DC SI 416021XXXXXX4821 ADOBE SYSTEMS", "-4230", "acc_software"),
      l("airtel", 10, "ACH D- AIRTEL BROADBAND-3004598113", "-1178", "acc_utilities"),
      l("bescom", 12, "UPI-BESCOM-bescom.billdesk@hdfcbank-HDFC0000001-613212300456-BILLPAY", "-5810", "acc_utilities"),
      l("zenith", 15, "NEFT CR-ICIC0000123-ZENITH LABS PVT LTD-INV 2026-052-ICICN26135009911", "150000", "acc_ar"),
      l("ca-mehta", 7, "IMPS-612712345987-MEHTA AND ASSOCIATES-HDFC-XXXXXXX9021-RETAINER MAY", "-15000", "acc_professional"),
      l("bluetokai", 11, "POS 416021XXXXXX4821 BLUE TOKAI INDIRANAGAR", "-2120", "acc_meals"),
      l("rapido", 14, "UPI-RAPIDO-rapido.bike@ybl-YESB0YBLUPI-613412300871-RIDE", "-310", "acc_travel"),
      l("gst", 20, "GSTN CPIN 26050012398765 HDFC", "-31200", "acc_gst_payable"),
      l("tds", 7, "ITNS 281 CHALLAN 0510308 00047", "-9500", "acc_taxes_payable"),
      l("imps-chg", 14, "IMPS CHGS 613412300871", "-5.90", "acc_bank_charges"),
      l("emi", 5, "EMI 4455621 CHQ S3120046 0526", "-32100", "acc_loans"),
      l("amazon", 16, "UPI-AMAZON PAY INDIA-amazonpay@apl-UTIB0000100-613612300332-ORDER", "-2199", "acc_office_supplies"),
      l("rahul", 19, "UPI-RAHUL VERMA-rahulv@ybl-SBIN0001111-613912300145-CLIENT LUNCH", "-1860", "acc_meals"),
      l("swiggy", 22, "UPI-SWIGGY-swiggy@icici-ICIC0DC0099-614212300678-TEAM LUNCH", "-3140", "acc_meals"),
      l("capital", 23, "IMPS-614512300999-ANANYA KRISHNAN-HDFC-XXXXXXX0007-CAPITAL INFUSION", "200000", "acc_capital"),
      l("indigo", 24, "ME DC SI 416021XXXXXX4821 INDIGO AIRLINES", "-8420", "acc_travel"),
      l("pixel", 26, "NEFT DR-UTIB0000777-PIXEL PRINTS-NETBANK, MUM-N133260522210-BROCHURES", "-12500", "acc_marketing"),
    ],
    [
      l("rent", 3, "NEFT DR-SBIN0004321-SURESH NAIK-NETBANK, MUM-N153260611902-OFFICE RENT JUN", "-85000", "acc_rent"),
      l("sal-priya", 27, "NEFT DR-ICIC0001234-PRIYA MENON-NETBANK, MUM-N178260655120-SAL JUN26", "-65000", "acc_salary"),
      l("sal-arjun", 27, "IMPS-617812300222-ARJUN RAO-KKBK-XXXXXXX4410-SALARY JUN", "-52000", "acc_salary"),
      l("sal-deepa", 27, "NEFT DR-HDFC0000456-DEEPA IYER-NETBANK, MUM-N178260655121-SAL JUN26", "-48000", "acc_salary"),
      l("canva", 5, "ME DC SI 416021XXXXXX4821 CANVA", "-499", "acc_software"),
      l("gworkspace", 6, "ME DC SI 416021XXXXXX4821 GOOGLE WORKSPACE", "-1520", "acc_software"),
      l("adobe", 9, "ME DC SI 416021XXXXXX4821 ADOBE SYSTEMS", "-4230", "acc_software"),
      l("airtel", 10, "ACH D- AIRTEL BROADBAND-3004633007", "-1178", "acc_utilities"),
      l("bescom", 12, "UPI-BESCOM-bescom.billdesk@hdfcbank-HDFC0000001-616212300777-BILLPAY", "-7020", "acc_utilities"),
      l("zenith", 15, "NEFT CR-ICIC0000123-ZENITH LABS PVT LTD-INV 2026-063-ICICN26165004432", "150000", "acc_ar"),
      l("orbit", 17, "NEFT CR-YESB0000012-ORBIT FOODS LLP-PROJECT PAYMENT-YESBN26168001276", "85000", "acc_ar"),
      l("ca-mehta", 8, "IMPS-615712300444-MEHTA AND ASSOCIATES-HDFC-XXXXXXX9021-RETAINER JUN", "-15000", "acc_professional"),
      l("bluetokai", 11, "POS 416021XXXXXX4821 BLUE TOKAI KORAMANGALA", "-1760", "acc_meals"),
      l("rapido", 14, "UPI-RAPIDO-rapido.bike@ybl-YESB0YBLUPI-616412300913-RIDE", "-280", "acc_travel"),
      l("gst", 20, "GSTN CPIN 26060012377001 HDFC", "-27900", "acc_gst_payable"),
      l("tds", 7, "ITNS 281 CHALLAN 0510308 00081", "-9500", "acc_taxes_payable"),
      l("imps-chg", 14, "IMPS CHGS 616412300913", "-5.90", "acc_bank_charges"),
      l("emi", 5, "EMI 4455621 CHQ S3120047 0626", "-32100", "acc_loans"),
      l("amazon", 16, "UPI-AMAZON PAY INDIA-amazonpay@apl-UTIB0000100-616612300554-ORDER", "-45990", "acc_equipment"),
      l("rahul", 19, "UPI-RAHUL VERMA-rahulv@ybl-SBIN0001111-616912300321-PRINTER INK", "-1250", "acc_office_supplies"),
      l("swiggy", 22, "UPI-SWIGGY-swiggy@icici-ICIC0DC0099-617212300889-TEAM LUNCH", "-2410", "acc_meals"),
      l("interest", 28, "INTEREST PAID TILL 30-JUN-2026", "1240", "acc_interest_income"),
      l("linkedin", 18, "ME DC SI 416021XXXXXX4821 LINKEDIN JOBS", "-6500", "acc_marketing"),
      l("sharma-legal", 24, "NEFT DR-KKBK0000321-SHARMA LEGAL LLP-NETBANK, MUM-N163260618845-TRADEMARK FILING", "-11800", "acc_professional"),
    ],
  ],
};
