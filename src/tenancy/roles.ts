/**
 * Who may do what.
 *
 * Paisa has been a single-user product: one password in an environment
 * variable, one actor id hard-coded in the demo server, and a Permission
 * union with four members that nothing outside the AI orchestrator consulted.
 * That is not a small gap on the way to selling this — it means the product
 * cannot hold two customers, and every other feature is a feature on a demo.
 *
 * The design rule here is that authority is *derived*, never assigned.
 * Permissions are not stored per user; a role is stored, and permissions are
 * computed from it. Storing a permission set per user is how an account ends
 * up with a capability nobody can explain the origin of, and how a role
 * change fails to revoke something.
 */

export type Permission =
  // Reading
  | "view_reports"
  | "view_payroll"
  | "access_ai_cfo"
  | "export_data"
  // Recording
  | "create_invoice"
  | "create_bill"
  | "post_journal"
  | "categorize_transactions"
  // Deciding — the ones that move money or close a period
  | "approve_payments"
  | "approve_bill"
  | "close_period"
  | "file_tax_return"
  // Administration
  | "manage_members"
  | "manage_connectors";

export type Role = "owner" | "admin" | "accountant" | "approver" | "viewer";

export const ROLES: readonly Role[] = ["owner", "admin", "accountant", "approver", "viewer"];

const VIEWER: readonly Permission[] = ["view_reports", "access_ai_cfo"];

/**
 * The accountant records; the approver decides. They are deliberately
 * different roles rather than one "finance" role with everything, because
 * segregation of duties is only real if the permissions can actually be held
 * by different people. An accountant who can also approve their own bill has
 * a control on paper and none in practice.
 */
const ACCOUNTANT: readonly Permission[] = [
  ...VIEWER,
  "export_data",
  "create_invoice",
  "create_bill",
  "post_journal",
  "categorize_transactions",
];

const APPROVER: readonly Permission[] = [...VIEWER, "export_data", "approve_payments", "approve_bill"];

/**
 * Admins run the workspace and can do the accounting. They cannot manage
 * members — that is the owner's, so an admin cannot quietly promote
 * themselves or lock the owner out.
 */
const ADMIN: readonly Permission[] = [
  ...ACCOUNTANT,
  "approve_payments",
  "approve_bill",
  "close_period",
  "file_tax_return",
  "view_payroll",
  "manage_connectors",
];

const OWNER: readonly Permission[] = [...ADMIN, "manage_members"];

const BY_ROLE: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  viewer: new Set(VIEWER),
  accountant: new Set(ACCOUNTANT),
  approver: new Set(APPROVER),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export const permissionsOf = (role: Role): ReadonlySet<Permission> => BY_ROLE[role];

export const can = (role: Role, permission: Permission): boolean => BY_ROLE[role].has(permission);

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

/**
 * Roles ordered by authority, for the one comparison that matters: nobody may
 * grant a role above their own. Without this an admin could mint an owner and
 * inherit their authority through them.
 */
const RANK: Readonly<Record<Role, number>> = { viewer: 0, accountant: 1, approver: 1, admin: 2, owner: 3 };

export const outranks = (a: Role, b: Role): boolean => RANK[a] > RANK[b];
export const rankOf = (role: Role): number => RANK[role];
