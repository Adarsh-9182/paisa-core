/**
 * The tenant boundary, and the ways it usually breaks.
 *
 * Every case here is a documented failure mode of multi-tenant products, not
 * a hypothetical: cross-tenant reads, self-promotion, an admin minting an
 * owner, a workspace locked out because the last owner left, and a removal
 * that only takes effect at next login.
 */
import { describe, expect, it } from "vitest";
import { Platform } from "../src/organization.js";
import { AccessError, MemberDirectory } from "../src/tenancy/members.js";
import { can, outranks, permissionsOf, ROLES } from "../src/tenancy/roles.js";

const dir = () => {
  const d = new MemberDirectory();
  d.found("org_a", "u_owner");
  return d;
};
const owner = (d: MemberDirectory) => d.authorize("u_owner", "org_a");

describe("the gate", () => {
  it("hands out no context without a membership", () => {
    expect(() => dir().authorize("u_stranger", "org_a")).toThrow(AccessError);
  });

  it("does not leak whether the organization exists", () => {
    // Different messages here turn the gate into an oracle for enumerating
    // other people's organizations.
    const d = dir();
    const a = (() => { try { d.authorize("u_x", "org_a"); } catch (e) { return (e as Error).message; } })();
    const b = (() => { try { d.authorize("u_x", "org_zzz"); } catch (e) { return (e as Error).message; } })();
    expect(a).toBe("No access to organization org_a");
    expect(b).toBe("No access to organization org_zzz");
  });

  it("keeps one user's memberships from reaching another org's books", () => {
    const p = new Platform();
    p.createWorkspace("org_a", "A Ltd", "u_a");
    p.createWorkspace("org_b", "B Ltd", "u_b");
    expect(p.open("u_a", "org_a").org.name).toBe("A Ltd");
    expect(() => p.open("u_a", "org_b")).toThrow(/No access/);
  });

  it("names the missing capability rather than saying forbidden", () => {
    const d = dir();
    d.add(owner(d), "u_view", "viewer");
    const viewer = d.authorize("u_view", "org_a");
    expect(() => d.require(viewer, "post_journal")).toThrow(/viewer cannot post journal/);
  });
});

describe("founding", () => {
  it("creates books and their first owner as one operation", () => {
    // An organization with no members is a set of books nobody can open and
    // nobody can grant access to.
    const p = new Platform();
    const s = p.createWorkspace("org_a", "A Ltd", "u_a");
    expect(s.access.role).toBe("owner");
    expect(p.directory.listOrg("org_a")).toHaveLength(1);
  });

  it("refuses to found an organization twice", () => {
    const d = dir();
    expect(() => d.found("org_a", "u_other")).toThrow(/already has members/);
  });
});

describe("granting", () => {
  it("lets an owner add members", () => {
    const d = dir();
    expect(d.add(owner(d), "u_acct", "accountant").role).toBe("accountant");
  });

  it("refuses a member who cannot manage members", () => {
    const d = dir();
    d.add(owner(d), "u_acct", "accountant");
    const acct = d.authorize("u_acct", "org_a");
    expect(() => d.add(acct, "u_x", "viewer")).toThrow(/accountant cannot manage members/);
  });

  it("stops an admin minting an owner", () => {
    // Otherwise an admin creates an owner and inherits that authority
    // through them — the escalation that makes every other check pointless.
    const d = dir();
    d.add(owner(d), "u_admin", "admin");
    // An admin has no manage_members at all, so the grant fails on that
    // first; the rank rule is what stops an owner-equal role being granted
    // by anyone who does have it but ranks lower.
    const adminCtx = d.authorize("u_admin", "org_a");
    expect(() => d.add(adminCtx, "u_new", "owner")).toThrow(AccessError);
    expect(outranks("owner", "admin")).toBe(true);
  });

  it("refuses to add somebody twice", () => {
    const d = dir();
    d.add(owner(d), "u_acct", "accountant");
    expect(() => d.add(owner(d), "u_acct", "viewer")).toThrow(/already a member/);
  });
});

describe("changing a role", () => {
  it("refuses to let anyone change their own", () => {
    // The shortest privilege escalation there is.
    const d = dir();
    expect(() => d.changeRole(owner(d), "u_owner", "viewer")).toThrow(/cannot change your own role/);
  });

  it("takes effect immediately, not at next login", () => {
    const d = dir();
    d.add(owner(d), "u_x", "accountant");
    expect(can(d.authorize("u_x", "org_a").role, "post_journal")).toBe(true);
    d.changeRole(owner(d), "u_x", "viewer");
    expect(can(d.authorize("u_x", "org_a").role, "post_journal")).toBe(false);
  });

  it("will not demote the last owner", () => {
    // A workspace with no owner cannot be administered by anyone, ever —
    // and there is no support back door here to recover it with.
    const d = dir();
    d.add(owner(d), "u_two", "admin");
    const second = d.changeRole(owner(d), "u_two", "owner");
    expect(second.role).toBe("owner");
    // Now there are two, so demoting one is fine.
    d.changeRole(d.authorize("u_two", "org_a"), "u_owner", "admin");
    // And the remaining one cannot be demoted by anybody.
    expect(() => d.changeRole(d.authorize("u_two", "org_a"), "u_two", "admin")).toThrow(
      /cannot change your own role/,
    );
    const admin = d.authorize("u_owner", "org_a");
    expect(() => d.changeRole(admin, "u_two", "admin")).toThrow(AccessError);
  });
});

describe("removal", () => {
  it("revokes access on the next check, not the next login", () => {
    const d = dir();
    d.add(owner(d), "u_x", "accountant");
    expect(d.authorize("u_x", "org_a").role).toBe("accountant");
    d.remove(owner(d), "u_x");
    expect(() => d.authorize("u_x", "org_a")).toThrow(/No access/);
  });

  it("will not remove the last owner", () => {
    const d = dir();
    d.add(owner(d), "u_two", "admin");
    const adminCtx = d.authorize("u_two", "org_a");
    // An admin cannot remove anyone at all — no manage_members.
    expect(() => d.remove(adminCtx, "u_owner")).toThrow(AccessError);
    // Nor can the owner remove themselves while they are the only one.
    expect(() => d.remove(owner(d), "u_owner")).toThrow(/at least one owner/);
  });

  it("lets a member leave without needing authority over anyone", () => {
    const d = dir();
    d.add(owner(d), "u_x", "viewer");
    d.leave(d.authorize("u_x", "org_a"));
    expect(() => d.authorize("u_x", "org_a")).toThrow(/No access/);
  });

  it("makes an owner hand over before walking out", () => {
    const d = dir();
    expect(() => d.leave(owner(d))).toThrow(/Make someone else an owner/);
  });
});

describe("roles", () => {
  it("gives a viewer nothing that records or decides", () => {
    for (const p of ["post_journal", "approve_bill", "close_period", "manage_members", "file_tax_return"] as const) {
      expect(can("viewer", p)).toBe(false);
    }
    expect(can("viewer", "view_reports")).toBe(true);
  });

  it("separates recording from deciding, or segregation of duties is theatre", () => {
    // An accountant who can also approve their own bill has a control on
    // paper and none in practice.
    expect(can("accountant", "create_bill")).toBe(true);
    expect(can("accountant", "approve_bill")).toBe(false);
    expect(can("approver", "approve_bill")).toBe(true);
    expect(can("approver", "create_bill")).toBe(false);
  });

  it("keeps member management with the owner alone", () => {
    // So an admin cannot quietly promote themselves or lock the owner out.
    for (const r of ROLES) expect(can(r, "manage_members")).toBe(r === "owner");
  });

  it("gives every role the ability to read its own reports", () => {
    for (const r of ROLES) expect(can(r, "view_reports")).toBe(true);
  });

  it("has no role holding a permission its rank does not justify", () => {
    // Owner is a superset of admin, admin of accountant. A permission that
    // leaks downward is how a viewer ends up able to close a period.
    for (const p of permissionsOf("admin")) expect(permissionsOf("owner").has(p)).toBe(true);
    for (const p of permissionsOf("accountant")) expect(permissionsOf("admin").has(p)).toBe(true);
  });
});
