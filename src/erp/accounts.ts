/**
 * ERP chart extension — the accounts the Rillet-class modules need.
 *
 * defaultChart() stays untouched (the SMB core depends on its exact shape);
 * erpAccounts() layers the subledger control accounts on top of any chart.
 * Control accounts matter: the close ties each subledger back to its GL
 * account, and that tie-out is only possible if the account exists here.
 */

import { ChartOfAccounts, AccountType } from "../accounts.js";

export interface ErpAccountDef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly isCashEquivalent: boolean;
}

/** Added on top of defaultChart(); ids are stable and referenced by the modules. */
export const ERP_ACCOUNTS: readonly ErpAccountDef[] = [
  // Contract assets / liabilities — the ASC 606 pair.
  { id: "acc_unbilled_ar", code: "1150", name: "Unbilled Receivable (Contract Asset)", type: "ASSET", isCashEquivalent: false },
  { id: "acc_deferred_revenue", code: "2400", name: "Deferred Revenue (Contract Liability)", type: "LIABILITY", isCashEquivalent: false },

  // Amortisation / depreciation.
  { id: "acc_prepaid", code: "1250", name: "Prepaid Expenses", type: "ASSET", isCashEquivalent: false },
  { id: "acc_accum_depreciation", code: "1550", name: "Accumulated Depreciation", type: "ASSET", isCashEquivalent: false },
  { id: "acc_depreciation_expense", code: "5900", name: "Depreciation Expense", type: "EXPENSE", isCashEquivalent: false },
  { id: "acc_amortization_expense", code: "5910", name: "Amortization Expense", type: "EXPENSE", isCashEquivalent: false },

  // Accruals.
  { id: "acc_accrued_liabilities", code: "2500", name: "Accrued Liabilities", type: "LIABILITY", isCashEquivalent: false },

  // Multi-entity.
  { id: "acc_ic_receivable", code: "1600", name: "Intercompany Receivable", type: "ASSET", isCashEquivalent: false },
  { id: "acc_ic_payable", code: "2600", name: "Intercompany Payable", type: "LIABILITY", isCashEquivalent: false },
  { id: "acc_cta", code: "3200", name: "Cumulative Translation Adjustment", type: "EQUITY", isCashEquivalent: false },

  // FX.
  { id: "acc_fx_gain", code: "4400", name: "Foreign Exchange Gain", type: "REVENUE", isCashEquivalent: false },
  { id: "acc_fx_loss", code: "5800", name: "Foreign Exchange Loss", type: "EXPENSE", isCashEquivalent: false },

  // Subscription revenue gets its own line so SaaS metrics are unambiguous.
  { id: "acc_subscription_revenue", code: "4500", name: "Subscription Revenue", type: "REVENUE", isCashEquivalent: false },
  { id: "acc_usage_revenue", code: "4510", name: "Usage Revenue", type: "REVENUE", isCashEquivalent: false },
];

/** Idempotent: adding twice is a no-op, so a chart can be upgraded safely. */
export const erpAccounts = (chart: ChartOfAccounts): ChartOfAccounts => {
  const existing = new Set(chart.all().map((a) => a.id));
  for (const d of ERP_ACCOUNTS) {
    if (existing.has(d.id)) continue;
    chart.add({
      id: d.id,
      code: d.code,
      name: d.name,
      type: d.type,
      parentId: null,
      isCashEquivalent: d.isCashEquivalent,
      active: true,
    });
  }
  return chart;
};
