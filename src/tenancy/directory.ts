/**
 * The durable directory — accounts, workspaces and memberships that survive
 * a restart.
 *
 * WHAT WAS WRONG
 *
 * AccountDirectory and MemberDirectory are Maps. The server built fresh ones
 * at every cold start and re-registered only the founding owner from the
 * environment, so on a serverless host every account that signed up, every
 * invited member and every role change silently disappeared the next time
 * an instance started. The ledger itself was already durable; the record of
 * who may open it was not. A per-customer ledger built on top of that would
 * have been a locked room whose key is thrown away every few minutes.
 *
 * THE DESIGN
 *
 * Directory changes are events on the same append-only action log the books
 * use, in a reserved stream. Nothing is applied to memory directly: a change
 * is validated, written to the log, and then arrives in memory the same way
 * every other instance receives it — by replay. There is one path, so an
 * instance that wrote a change and an instance that merely read it cannot
 * disagree about what happened.
 *
 * Two instances can make conflicting changes at the same moment — both
 * registering the same address, say. The log is ordered, so replay applies
 * the first and ignores the second, and the instance that lost is told so
 * rather than left holding an account nobody else can see.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Authority is checked when a change is written, not again on replay. A
 * membership granted by an owner last month stays granted even if that owner
 * has since been demoted; judging old decisions by today's roles would
 * silently rewrite history.
 */

import { ActionStore } from "../persistence/store.js";
import { hashPassword, validatePassword } from "../auth/password.js";
import {
  AccountDirectory,
  AccountError,
  StoredAccountRecord,
  UserAccount,
  isEmailShaped,
  newUserId,
  normalizeEmail,
} from "./accounts.js";
import { AccessContext, AccessError, Membership, MemberDirectory } from "./members.js";
import { Role, isRole } from "./roles.js";

/** The reserved stream. No organization id can collide with it. */
export const DIRECTORY_STREAM = "_directory";

type Payload = Readonly<Record<string, unknown>>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What the directory knows about a company, beyond who belongs to it. */
export interface WorkspaceMeta {
  readonly name: string;
  /**
   * The first period the company's books exist for, fixed when it is
   * founded. It cannot be derived later from "today": a ledger reopened next
   * month under a later first period would refuse to replay its own history.
   */
  readonly firstPeriod?: string;
}

export interface OwnerBootstrap {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly firstPeriod?: string;
}

export class DurableDirectory {
  /** Read these freely. Change them only through this class. */
  readonly accounts = new AccountDirectory();
  readonly members = new MemberDirectory();

  private meta = new Map<string, WorkspaceMeta>();
  private lastSeq = 0;
  private lastSyncAt = 0;
  private syncing: Promise<void> | null = null;

  private constructor(private readonly store: ActionStore) {}

  static async open(store: ActionStore): Promise<DurableDirectory> {
    await store.ready();
    const directory = new DurableDirectory(store);
    await directory.sync();
    return directory;
  }

  /* ---------------------------------------------------------------- */
  /* Replay                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Pull everything written since the last look.
   *
   * A caller never shares a pull that started before it arrived: a change
   * written a moment ago is not in a read that began a moment before that,
   * and handing that read back as "synced" is how a user signs up and is
   * then told their account does not exist.
   */
  async sync(): Promise<void> {
    while (this.syncing) await this.syncing;
    this.syncing = this.pull().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /**
   * Sync unless this instance looked within the last `maxAgeMs`.
   *
   * For the read path: every request needs a reasonably current view of who
   * may do what, but a database round trip on every static asset is waste.
   * Writes always sync fully first.
   */
  async freshen(maxAgeMs = 1000): Promise<void> {
    if (Date.now() - this.lastSyncAt > maxAgeMs) await this.sync();
  }

  private async pull(): Promise<void> {
    const rows = await this.store.after(DIRECTORY_STREAM, this.lastSeq);
    for (const row of rows) {
      this.apply(row.action.type, row.action.payload);
      this.lastSeq = row.seq;
    }
    this.lastSyncAt = Date.now();
  }

  /** Every conflict rule lives here: first writer wins, later duplicates are ignored. */
  private apply(type: string, p: Payload): void {
    switch (type) {
      case "account.registered":
        this.accounts.restore({
          userId: str(p.userId),
          email: str(p.email),
          displayName: str(p.displayName),
          createdAt: str(p.createdAt),
          passwordHash: str(p.passwordHash),
        });
        return;

      case "account.passwordChanged":
        this.accounts.setPasswordHash(str(p.userId), str(p.passwordHash));
        return;

      case "workspace.founded": {
        const orgId = str(p.orgId);
        if (!this.meta.has(orgId))
          this.meta.set(orgId, {
            name: str(p.name) || orgId,
            ...(str(p.firstPeriod) ? { firstPeriod: str(p.firstPeriod) } : {}),
          });
        if (this.members.listOrg(orgId).length) return;
        this.members.restore({
          userId: str(p.ownerUserId),
          orgId,
          role: "owner",
          addedAt: str(p.at),
          addedBy: "system",
        });
        return;
      }

      case "member.added": {
        const role = str(p.role);
        if (!isRole(role) || this.members.find(str(p.userId), str(p.orgId))) return;
        this.members.restore({
          userId: str(p.userId),
          orgId: str(p.orgId),
          role,
          addedAt: str(p.addedAt),
          addedBy: str(p.addedBy),
        });
        return;
      }

      case "member.roleChanged": {
        const role = str(p.role);
        const current = this.members.find(str(p.userId), str(p.orgId));
        if (current && isRole(role)) this.members.restore({ ...current, role });
        return;
      }

      case "member.removed":
        this.members.restoreRemoval(str(p.userId), str(p.orgId));
        return;

      // An event type this build does not know was written by a newer one.
      // Skipping it keeps an old instance serving during a rolling deploy.
      default:
        return;
    }
  }

  private async write(type: string, payload: Record<string, unknown>, actor: string): Promise<void> {
    await this.store.append(DIRECTORY_STREAM, { type, payload, actor });
    await this.sync();
  }

  /**
   * The caller's authority as the log stands now, not as their cookie
   * remembers it. A context captured before a demotion must not carry the
   * old role into a write.
   */
  private current(actor: AccessContext): AccessContext {
    return this.members.authorize(actor.userId, actor.orgId);
  }

  /* ---------------------------------------------------------------- */
  /* Accounts                                                          */
  /* ---------------------------------------------------------------- */

  async register(email: string, password: string, displayName?: string): Promise<UserAccount> {
    await this.sync();
    const normalized = normalizeEmail(email);
    if (!isEmailShaped(normalized)) throw new AccountError("That does not look like an email address");
    validatePassword(password);
    if (this.accounts.findByEmail(normalized)) throw new AccountError("An account with that email already exists");

    const record: StoredAccountRecord = {
      userId: newUserId(),
      email: normalized,
      displayName: displayName?.trim() || normalized.split("@")[0]!,
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(password),
    };
    await this.write("account.registered", { ...record }, record.userId);

    // Another instance may have registered the same address between our sync
    // and our write. The log kept whichever came first; if that was not us,
    // this caller has no account and must be told.
    const winner = this.accounts.findByEmail(normalized);
    if (!winner || winner.userId !== record.userId)
      throw new AccountError("An account with that email already exists");
    return winner;
  }

  async changePassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    await this.sync();
    const account = this.accounts.get(userId);
    if (!account) throw new AccountError("No such account");
    if (!(await this.accounts.authenticate(account.email, currentPassword)))
      throw new AccountError("Current password is incorrect");
    validatePassword(nextPassword);
    await this.write("account.passwordChanged", { userId, passwordHash: await hashPassword(nextPassword) }, userId);
  }

  /* ---------------------------------------------------------------- */
  /* Workspaces and memberships                                        */
  /* ---------------------------------------------------------------- */

  workspaceName(orgId: string): string {
    return this.meta.get(orgId)?.name ?? orgId;
  }

  workspace(orgId: string): WorkspaceMeta | undefined {
    return this.meta.get(orgId);
  }

  /** Every founded company — for work that runs across all of them, like the daily sweep. */
  workspaceIds(): readonly string[] {
    return [...this.meta.keys()];
  }

  async found(orgId: string, name: string, ownerUserId: string, firstPeriod?: string): Promise<Membership> {
    if (firstPeriod !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(firstPeriod))
      throw new AccessError(`First period must be a month written YYYY-MM, not "${firstPeriod}"`);
    await this.sync();
    if (!this.accounts.get(ownerUserId)) throw new AccessError(`No account ${ownerUserId}`);
    if (this.members.listOrg(orgId).length) throw new AccessError(`Organization ${orgId} already has members`);

    await this.write(
      "workspace.founded",
      { orgId, name, ownerUserId, at: new Date().toISOString(), ...(firstPeriod ? { firstPeriod } : {}) },
      "system",
    );

    const owner = this.members.find(ownerUserId, orgId);
    if (!owner || owner.role !== "owner") throw new AccessError(`Organization ${orgId} already has members`);
    return owner;
  }

  async add(actor: AccessContext, userId: string, role: Role): Promise<Membership> {
    await this.sync();
    const authority = this.current(actor);
    if (!this.accounts.get(userId)) throw new AccessError(`No account ${userId}`);
    const granted = this.members.clone().add(authority, userId, role);
    await this.write("member.added", { ...granted }, authority.userId);
    return this.members.find(userId, authority.orgId) ?? granted;
  }

  async changeRole(actor: AccessContext, userId: string, role: Role): Promise<Membership> {
    await this.sync();
    const authority = this.current(actor);
    const changed = this.members.clone().changeRole(authority, userId, role);
    await this.write("member.roleChanged", { orgId: authority.orgId, userId, role: changed.role }, authority.userId);
    return this.members.find(userId, authority.orgId) ?? changed;
  }

  async remove(actor: AccessContext, userId: string): Promise<void> {
    await this.sync();
    const authority = this.current(actor);
    this.members.clone().remove(authority, userId);
    await this.write("member.removed", { orgId: authority.orgId, userId }, authority.userId);
  }

  async leave(ctx: AccessContext): Promise<void> {
    await this.sync();
    const authority = this.current(ctx);
    this.members.clone().leave(authority);
    await this.write("member.removed", { orgId: authority.orgId, userId: authority.userId }, authority.userId);
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * The founding owner, from the environment, exactly once across every
   * instance and every restart.
   *
   * Several instances cold-start together and all try this. They may all
   * write a registration; replay keeps the first, and the rest adopt it. The
   * environment stays the source of truth for the owner's password, so
   * rotating PAISA_PASSWORD and redeploying rotates the login.
   */
  async ensureOwner(opts: OwnerBootstrap): Promise<UserAccount> {
    await this.sync();
    if (!this.accounts.findByEmail(opts.email)) {
      try {
        await this.register(opts.email, opts.password, opts.displayName);
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
      }
    }

    const owner = this.accounts.findByEmail(opts.email);
    if (!owner) throw new AccountError("The owner account could not be created");

    if (!(await this.accounts.authenticate(opts.email, opts.password))) {
      validatePassword(opts.password);
      await this.write(
        "account.passwordChanged",
        { userId: owner.userId, passwordHash: await hashPassword(opts.password) },
        "system",
      );
    }

    if (!this.members.listOrg(opts.orgId).length) {
      try {
        await this.found(opts.orgId, opts.orgName, owner.userId, opts.firstPeriod);
      } catch (err) {
        if (!(err instanceof AccessError)) throw err;
      }
    }
    return owner;
  }
}
