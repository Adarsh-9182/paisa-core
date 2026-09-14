/**
 * Three months of a second company's bank statement — HELD OUT.
 *
 * Written and committed together with the development set, before any change
 * to how keywords are proposed or learned. Do not design a fix by reading
 * these lines, and never add a rule or a stop-word because one of them needs
 * it: this set exists to show whether fixes found on the development set
 * carry over to a company, and a bank format, they were not built on.
 *
 * A Pune steel and auto-parts trader banking with ICICI, April to June 2026.
 * ICICI's formats differ from HDFC's in ways that matter for learning: the
 * UTR comes before the payee in NEFT and RTGS lines, and a UPI line puts the
 * payer's free-text note before the payee's handle.
 */

import type { CompanyMonths, MonthLine } from "./teach-eval.js";

const l = (payee: string, day: number, description: string, amount: string, account: string): MonthLine => ({
  payee,
  day,
  description,
  amount,
  account,
});

export const TEACH_HOLDOUT: CompanyMonths = {
  name: "HOLDOUT",
  bank: "ICICI",
  months: [
    [
      l("rent", 4, "NEFT-HDFCN52026040412345-KULKARNI ESTATES-WAREHOUSE RENT APR-50200012345678-HDFC0001234", "-120000", "acc_rent"),
      l("sal-rohit", 28, "INF/INFT/031245678901/Sal Apr 2026/ROHIT PAWAR", "-38000", "acc_salary"),
      l("sal-sneha", 28, "INF/INFT/031245678902/Sal Apr 2026/SNEHA JOSHI", "-41000", "acc_salary"),
      l("sal-vikas", 28, "MMT/IMPS/611812377001/SALARY APR/VIKAS SHINDE/SBIN0005678", "-26000", "acc_salary"),
      l("msedcl", 9, "BIL/BPAY/000412345678/MSEDCL/170012345678", "-18450", "acc_utilities"),
      l("zoho", 6, "PCD/4580XXXXXXXX3312/ZOHO CORPORATION/CHENNAI", "-2950", "acc_software"),
      l("vi", 11, "BIL/ONL/000412398801/VODAFONE IDEA/9822012345", "-1499", "acc_utilities"),
      l("ganesh-steel", 13, "NEFT-SBINN52026041312345-SHREE GANESH STEEL-INV 2241-30456789012-SBIN0001234", "-245000", "acc_inventory"),
      l("patil", 17, "NEFT-AXISCN0417345678-PATIL ENGINEERING WORKS-BILL 118-91702001234-UTIB0000045", "310000", "acc_ar"),
      l("deshmukh", 22, "RTGS-KKBKR52026042212345-DESHMUKH AUTO PARTS-PAYMENT-0512345678-KKBK0000789", "540000", "acc_ar"),
      l("shell", 8, "PCD/4580XXXXXXXX3312/SHELL CITYPOINT/PUNE", "-5200", "acc_vehicle_fuel"),
      l("iocl", 19, "PCD/4580XXXXXXXX3312/IOCL COCO WAKAD/PUNE", "-4800", "acc_vehicle_fuel"),
      l("gst", 20, "GST/CPIN/26042700123456/ICIC", "-64200", "acc_gst_payable"),
      l("tds", 7, "CBDT TAX/ITNS 281/0510308/00019", "-11200", "acc_taxes_payable"),
      l("ca-bhat", 10, "MMT/IMPS/610012377881/PROF FEES APR/CA NIKHIL BHAT/HDFC0000321", "-12000", "acc_professional"),
      l("water", 5, "UPI/610512377002/Water cans/aquafresh22@okicici/ICICI Bank", "-900", "acc_meals"),
      l("amol", 15, "MMT/IMPS/611512377003/petty cash/AMOL GAIKWAD/SBIN0009876", "-5000", "acc_cash"),
      l("indiamart", 12, "PCD/4580XXXXXXXX3312/INDIAMART INTERMESH/NOIDA", "-3540", "acc_marketing"),
      l("flipkart", 21, "UPI/612112377004/Payment/flipkart.payu@hdfcbank/HDFC BANK", "-1299", "acc_office_supplies"),
      l("razorpay", 16, "UPI/611612377005/Payment/razorpay.pvt@icici/ICICI Bank", "-4720", "acc_software"),
      l("sai-safety", 24, "NEFT-UTIBN52026042412345-SAI SAFETY EQUIPMENTS-QUOTE 77-91801003456-UTIB0000321", "-18600", "acc_equipment"),
    ],
    [
      l("rent", 4, "NEFT-HDFCN52026050412987-KULKARNI ESTATES-WAREHOUSE RENT MAY-50200012345678-HDFC0001234", "-120000", "acc_rent"),
      l("sal-rohit", 28, "INF/INFT/031298765401/Sal May 2026/ROHIT PAWAR", "-38000", "acc_salary"),
      l("sal-sneha", 28, "INF/INFT/031298765402/Sal May 2026/SNEHA JOSHI", "-41000", "acc_salary"),
      l("sal-vikas", 28, "MMT/IMPS/614812377101/SALARY MAY/VIKAS SHINDE/SBIN0005678", "-26000", "acc_salary"),
      l("msedcl", 9, "BIL/BPAY/000512377654/MSEDCL/170012345678", "-21030", "acc_utilities"),
      l("zoho", 6, "PCD/4580XXXXXXXX3312/ZOHO CORPORATION/CHENNAI", "-2950", "acc_software"),
      l("vi", 11, "BIL/ONL/000512377890/VODAFONE IDEA/9822012345", "-1499", "acc_utilities"),
      l("ganesh-steel", 13, "NEFT-SBINN52026051312987-SHREE GANESH STEEL-INV 2307-30456789012-SBIN0001234", "-198000", "acc_inventory"),
      l("patil", 19, "NEFT-AXISCN0519876543-PATIL ENGINEERING WORKS-BILL 131-91702001234-UTIB0000045", "275000", "acc_ar"),
      l("shell", 8, "PCD/4580XXXXXXXX3312/SHELL BANER/PUNE", "-4900", "acc_vehicle_fuel"),
      l("iocl", 19, "PCD/4580XXXXXXXX3312/IOCL COCO WAKAD/PUNE", "-5100", "acc_vehicle_fuel"),
      l("gst", 20, "GST/CPIN/26052700198765/ICIC", "-58900", "acc_gst_payable"),
      l("tds", 7, "CBDT TAX/ITNS 281/0510308/00052", "-11200", "acc_taxes_payable"),
      l("ca-bhat", 10, "MMT/IMPS/613012377882/PROF FEES MAY/CA NIKHIL BHAT/HDFC0000321", "-12000", "acc_professional"),
      l("water", 5, "UPI/613512377102/Apr water/aquafresh22@okicici/ICICI Bank", "-900", "acc_meals"),
      l("amol", 15, "MMT/IMPS/614512377103/site expenses/AMOL GAIKWAD/SBIN0009876", "-3200", "acc_travel"),
      l("indiamart", 12, "PCD/4580XXXXXXXX3312/INDIAMART INTERMESH/NOIDA", "-3540", "acc_marketing"),
      l("razorpay", 16, "UPI/614612377105/Payment/razorpay.pvt@icici/ICICI Bank", "-15000", "acc_marketing"),
      l("bajaj-loan", 18, "NEFT-BAJAJN52026051812345-BAJAJ FINANCE LIMITED-LOAN DISBURSAL-40500012345-HDFC0000001", "500000", "acc_loans"),
      l("mahindra", 26, "RTGS-UTIBR52026052612345-MAHINDRA FIRST CHOICE-VEHICLE BOOKING-91801009876-UTIB0000555", "-150000", "acc_equipment"),
    ],
    [
      l("rent", 4, "NEFT-HDFCN52026060412555-KULKARNI ESTATES-WAREHOUSE RENT JUN-50200012345678-HDFC0001234", "-120000", "acc_rent"),
      l("sal-rohit", 27, "INF/INFT/031234509871/Sal Jun 2026/ROHIT PAWAR", "-38000", "acc_salary"),
      l("sal-sneha", 27, "INF/INFT/031234509872/Sal Jun 2026/SNEHA JOSHI", "-41000", "acc_salary"),
      l("sal-vikas", 27, "MMT/IMPS/617812377201/SALARY JUN/VIKAS SHINDE/SBIN0005678", "-26000", "acc_salary"),
      l("msedcl", 9, "BIL/BPAY/000612377321/MSEDCL/170012345678", "-24310", "acc_utilities"),
      l("zoho", 6, "PCD/4580XXXXXXXX3312/ZOHO CORPORATION/CHENNAI", "-2950", "acc_software"),
      l("vi", 11, "BIL/ONL/000612377456/VODAFONE IDEA/9822012345", "-1499", "acc_utilities"),
      l("ganesh-steel", 13, "NEFT-SBINN52026061312555-SHREE GANESH STEEL-INV 2388-30456789012-SBIN0001234", "-262000", "acc_inventory"),
      l("patil", 17, "NEFT-AXISCN0618765432-PATIL ENGINEERING WORKS-BILL 144-91702001234-UTIB0000045", "298000", "acc_ar"),
      l("deshmukh", 22, "RTGS-KKBKR52026062212987-DESHMUKH AUTO PARTS-PAYMENT-0512345678-KKBK0000789", "480000", "acc_ar"),
      l("shell", 8, "PCD/4580XXXXXXXX3312/SHELL CITYPOINT/PUNE", "-5350", "acc_vehicle_fuel"),
      l("iocl", 19, "PCD/4580XXXXXXXX3312/IOCL COCO WAKAD/PUNE", "-4700", "acc_vehicle_fuel"),
      l("gst", 20, "GST/CPIN/26062700155501/ICIC", "-61700", "acc_gst_payable"),
      l("tds", 7, "CBDT TAX/ITNS 281/0510308/00088", "-11200", "acc_taxes_payable"),
      l("ca-bhat", 10, "MMT/IMPS/616012377883/PROF FEES JUN/CA NIKHIL BHAT/HDFC0000321", "-12000", "acc_professional"),
      l("water", 5, "UPI/616512377202/May water/aquafresh22@okicici/ICICI Bank", "-900", "acc_meals"),
      l("amol", 15, "MMT/IMPS/617512377203/tea snacks/AMOL GAIKWAD/SBIN0009876", "-1400", "acc_meals"),
      l("indiamart", 12, "PCD/4580XXXXXXXX3312/INDIAMART INTERMESH/NOIDA", "-3540", "acc_marketing"),
      l("flipkart", 21, "UPI/617112377204/Payment/flipkart.payu@hdfcbank/HDFC BANK", "-24999", "acc_equipment"),
      l("razorpay", 16, "UPI/617612377205/Payment/razorpay.pvt@icici/ICICI Bank", "-4720", "acc_software"),
      l("bajaj-emi", 5, "BIL/BPAY/000612377999/BAJAJ FINANCE LTD/4050CD12345678", "-22600", "acc_loans"),
      l("sms-chg", 30, "SMS CHGS APR-JUN 2026", "-17.70", "acc_bank_charges"),
      l("makemytrip", 23, "PCD/4580XXXXXXXX3312/MAKEMYTRIP INDIA/GURGAON", "-9800", "acc_travel"),
      l("lombard", 25, "BIL/ONL/000612377777/ICICI LOMBARD/4001234567", "-18200", "acc_insurance"),
    ],
  ],
};
