/**
 * Accounts an Indian small business's bank statement needs.
 *
 * The default chart had nowhere to put the lines every Indian statement is
 * full of — the bank's own fees, food, fuel, insurance, interest paid on an
 * overdraft, rent received — so the categorizer could only send them to a
 * person or book them somewhere wrong.
 *
 * Layered on top of defaultChart() the way the ERP accounts are, rather than
 * edited into it, because other modules depend on that chart's exact shape.
 * Adding them is idempotent, and a company whose history was recorded before
 * they existed replays unchanged: nothing in its log refers to them.
 *
 * Codes sit clear of both the default chart (4000–4300, 5000–5700) and the
 * ERP extension (4400–4510, 5800–5910).
 */

import { AccountType, ChartOfAccounts } from "./accounts.js";

export interface IndiaAccountDef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
}

export const INDIA_SMB_ACCOUNTS: readonly IndiaAccountDef[] = [
  { id: "acc_rental_income", code: "4600", name: "Rental Income", type: "REVENUE" },
  { id: "acc_bank_charges", code: "6000", name: "Bank Charges", type: "EXPENSE" },
  { id: "acc_meals", code: "6100", name: "Meals & Refreshments", type: "EXPENSE" },
  { id: "acc_vehicle_fuel", code: "6200", name: "Vehicle & Fuel", type: "EXPENSE" },
  { id: "acc_office_supplies", code: "6300", name: "Office Supplies", type: "EXPENSE" },
  { id: "acc_insurance", code: "6400", name: "Insurance", type: "EXPENSE" },
  { id: "acc_interest_expense", code: "6500", name: "Interest Expense", type: "EXPENSE" },
];

/** Idempotent: an account already present is left alone. Returns the chart. */
export const indiaSmbAccounts = (chart: ChartOfAccounts): ChartOfAccounts => {
  const existing = new Set(chart.all().map((a) => a.id));
  for (const d of INDIA_SMB_ACCOUNTS) {
    if (existing.has(d.id)) continue;
    chart.add({ id: d.id, code: d.code, name: d.name, type: d.type, parentId: null, isCashEquivalent: false, active: true });
  }
  return chart;
};
