/**
 * Chart of Accounts — configurable per organization, integrity preserved.
 * Account type fixes the normal balance side; the accounting equation is
 * enforced structurally, not by convention.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type Side = "DEBIT" | "CREDIT";

export const NORMAL_BALANCE: Record<AccountType, Side> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
};

export interface Account {
  readonly id: string;
  readonly orgId: string;
  readonly code: string; // e.g. "1010"
  readonly name: string;
  readonly type: AccountType;
  readonly parentId: string | null;
  readonly isCashEquivalent: boolean; // participates in cash-flow statement
  readonly active: boolean;
}

export class ChartError extends Error {
  override name = "ChartError";
}

export class ChartOfAccounts {
  private byId = new Map<string, Account>();
  private byCode = new Map<string, string>(); // code -> id

  constructor(public readonly orgId: string) {}

  add(a: Omit<Account, "orgId">): Account {
    if (this.byId.has(a.id)) throw new ChartError(`Duplicate account id ${a.id}`);
    if (this.byCode.has(a.code)) throw new ChartError(`Duplicate account code ${a.code}`);
    if (a.parentId !== null) {
      const parent = this.byId.get(a.parentId);
      if (!parent) throw new ChartError(`Unknown parent ${a.parentId}`);
      if (parent.type !== a.type)
        throw new ChartError(`Child type ${a.type} must match parent type ${parent.type}`);
    }
    const acct: Account = { ...a, orgId: this.orgId };
    this.byId.set(acct.id, acct);
    this.byCode.set(acct.code, acct.id);
    return acct;
  }

  get(id: string): Account {
    const a = this.byId.get(id);
    if (!a) throw new ChartError(`Unknown account ${id}`);
    return a;
  }

  getByCode(code: string): Account {
    const id = this.byCode.get(code);
    if (!id) throw new ChartError(`Unknown account code ${code}`);
    return this.get(id);
  }

  all(): readonly Account[] {
    return [...this.byId.values()];
  }

  ofType(t: AccountType): readonly Account[] {
    return this.all().filter((a) => a.type === t);
  }
}

/** Default chart for an Indian SMB. */
export const defaultChart = (orgId: string): ChartOfAccounts => {
  const c = new ChartOfAccounts(orgId);
  const rows: Array<[string, string, string, AccountType, boolean]> = [
    ["acc_cash", "1000", "Cash", "ASSET", true],
    ["acc_bank", "1010", "Bank", "ASSET", true],
    ["acc_ar", "1100", "Accounts Receivable", "ASSET", false],
    ["acc_inventory", "1200", "Inventory", "ASSET", false],
    ["acc_gst_itc", "1300", "GST Input Tax Credit", "ASSET", false],
    ["acc_investments", "1400", "Investments", "ASSET", false],
    ["acc_equipment", "1500", "Equipment", "ASSET", false],
    ["acc_loans", "2000", "Loans Payable", "LIABILITY", false],
    ["acc_ap", "2100", "Accounts Payable", "LIABILITY", false],
    ["acc_gst_payable", "2200", "GST Payable", "LIABILITY", false],
    ["acc_taxes_payable", "2300", "Taxes Payable", "LIABILITY", false],
    ["acc_capital", "3000", "Owner's Capital", "EQUITY", false],
    ["acc_retained", "3100", "Retained Earnings", "EQUITY", false],
    ["acc_sales", "4000", "Sales", "REVENUE", false],
    ["acc_services", "4100", "Services", "REVENUE", false],
    ["acc_interest_income", "4200", "Interest Income", "REVENUE", false],
    ["acc_realized_gains", "4300", "Realized Investment Gains", "REVENUE", false],
    ["acc_salary", "5000", "Salary", "EXPENSE", false],
    ["acc_rent", "5100", "Office Rent", "EXPENSE", false],
    ["acc_marketing", "5200", "Marketing", "EXPENSE", false],
    ["acc_software", "5300", "Software", "EXPENSE", false],
    ["acc_travel", "5400", "Travel", "EXPENSE", false],
    ["acc_utilities", "5500", "Utilities", "EXPENSE", false],
    ["acc_professional", "5600", "Professional Fees", "EXPENSE", false],
    ["acc_realized_losses", "5700", "Realized Investment Losses", "EXPENSE", false],
  ];
  for (const [id, code, name, type, isCash] of rows) {
    c.add({ id, code, name, type, parentId: null, isCashEquivalent: isCash, active: true });
  }
  return c;
};
