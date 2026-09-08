/**
 * STANDING AUTHORITY — how work gets finished without a person in the loop.
 *
 * `flows.ts` states the rule this file has to live with rather than break:
 *
 *   "A flow proposes. Approving is still what posts, and the approval is
 *    still attributed. A flow that could post unattended would be automation
 *    a controller switches off after the first surprise."
 *
 * That rule is right, and it is also the reason the product currently hands
 * a finance team a queue instead of finishing their month. Both are true at
 * once, so the way out is not to give agents a new power. It is to notice
 * that the missing thing was never permission to post — it was a way for a
 * controller to say, in advance and in writing, *which* approvals they are
 * willing to have made on their behalf.
 *
 * So nothing here posts. A standing authority approves, through the same
 * `AgentEngine.approve()` every human uses, which stays the single path to
 * the ledger. What changes is only who the approver is: a bounded, revocable
 * grant that names the person who gave it.
 *
 * WHY NOT A CONFIDENCE SCORE. That was the obvious design and it is wrong
 * for this work. A prepaid amortisation is not probably correct — it is
 * arithmetic over a schedule, and if it is wrong the code is wrong, not the
 * guess. Attaching a number between 0 and 1 to a deterministic posting
 * invents a doubt that does not exist, and then invites someone to tune a
 * threshold against it. Confidence belongs where judgement genuinely lives —
 * categorising a bank line — and not here.
 *
 * WHAT MAKES IT SAFE, and each of these is a refusal reason below, because
 * an automation that cannot say why it declined is not auditable:
 *
 *   - It is scoped to one kind of finding, not to "agents".
 *   - It only ever approves a proposal that already carries a proposed entry.
 *     A finding with no entry is one where the right action was ambiguous;
 *     ambiguity is exactly what a human is for.
 *   - Two ceilings: one per posting, and one per sweep. The second is the
 *     blast radius — the answer to "what is the most this can do before
 *     anyone notices".
 *   - An optional account allowlist, so a grant for prepaid amortisation
 *     cannot reach into payroll.
 *   - The period must be OPEN. A soft-closed period is a controller mid-close
 *     and is precisely when an unexpected posting does the most damage.
 *   - It expires, and it can be revoked, and both are recorded.
 *
 * WHAT MAKES IT HONEST. `settle()` returns what it refused and why, not just
 * what it did, and the registry counts approvals against reversals. A
 * standing authority whose postings keep getting reversed is one a controller
 * should narrow — and that is a fact about the books, not an opinion, so it
 * is measured here rather than argued about.
 */

import { Paise, ZERO, add, cmp, formatINR } from "../money.js";
import { EventBus } from "../events.js";
import type { PeriodKey } from "./periods.js";
import type { Proposal, ProposalKind } from "./agents.js";

export class AuthorityError extends Error {}

/**
 * A grant, in the shape a controller would write it on paper.
 *
 * `note` is required and not decorative: a grant nobody can explain a year
 * later is one that gets revoked in a panic during an audit.
 */
export interface StandingAuthority {
  readonly id: string;
  readonly kind: ProposalKind;
  /** The most this may approve in a single posting. */
  readonly maxAmount: Paise;
  /** The most this may approve across one sweep. The blast radius. */
  readonly maxPerSweep: Paise;
  /** Accounts it may touch. `null` means any — deliberate, and rarely right. */
  readonly accounts: readonly string[] | null;
  readonly grantedBy: string;
  readonly grantedAt: string;
  /** ISO date. A grant with no end is a grant nobody revisits. */
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly note: string;
}

export interface GrantInput {
  readonly id?: string;
  readonly kind: ProposalKind;
  readonly maxAmount: Paise;
  readonly maxPerSweep: Paise;
  readonly accounts?: readonly string[] | null;
  readonly expiresAt?: string | null;
  readonly note: string;
}

/** Why a proposal was left for a person. Always a sentence, never a code. */
export type Refusal = { readonly proposalId: string; readonly reason: string };

export interface SettleResult {
  readonly approved: readonly { proposalId: string; entryId: string | null; authorityId: string }[];
  readonly refused: readonly Refusal[];
  readonly totalApproved: Paise;
}

/** What the caller must supply so this file never reaches for a global. */
export interface AuthorityContext {
  /** Approves through the normal path — this module has no other way in. */
  approve(proposalId: string, actor: string): Proposal;
  /** OPEN / SOFT_CLOSED / CLOSED for the proposal's own period. */
  periodStatus(period: PeriodKey): string;
  /** True once the entry that a posting produced has been reversed. */
  isReversed(entryId: string): boolean;
}

/** The actor string that lands in the ledger, and reads as what it is. */
export const actorFor = (a: StandingAuthority): string => `standing-authority:${a.id}`;

/**
 * Everything that has to be true before a grant may approve one proposal.
 *
 * Written as one function returning a sentence rather than a chain of guards
 * so that the refusal is the same object whether it came from a sweep, a dry
 * run, or a controller asking "why didn't it take this one".
 */
export function refusalFor(
  authority: StandingAuthority,
  proposal: Proposal,
  ctx: { periodStatus(period: PeriodKey): string; spentThisSweep: Paise; now: string },
): string | null {
  if (authority.revokedAt) return `authority ${authority.id} was revoked on ${authority.revokedAt}`;
  if (authority.expiresAt && authority.expiresAt < ctx.now)
    return `authority ${authority.id} expired on ${authority.expiresAt}`;
  if (proposal.status !== "OPEN") return `proposal is already ${proposal.status}`;
  if (proposal.kind !== authority.kind)
    return `authority covers ${authority.kind}, this is ${proposal.kind}`;

  // A finding with no entry is one where the right action was ambiguous.
  // Ambiguity is the one thing a standing grant must never resolve.
  if (!proposal.proposedEntry) return "proposal carries no entry — it needs a decision, not an approval";

  const amount = proposal.proposedEntry.amount;
  if (cmp(amount, authority.maxAmount) > 0)
    return `${formatINR(amount)} is over the ${formatINR(authority.maxAmount)} per-posting limit`;

  const after = add(ctx.spentThisSweep, amount);
  if (cmp(after, authority.maxPerSweep) > 0)
    return `${formatINR(after)} would pass the ${formatINR(authority.maxPerSweep)} limit for one sweep`;

  if (authority.accounts) {
    const allowed = new Set(authority.accounts);
    const { debitAccountId, creditAccountId } = proposal.proposedEntry;
    if (!allowed.has(debitAccountId) || !allowed.has(creditAccountId))
      return `entry touches ${debitAccountId}/${creditAccountId}, outside this authority's accounts`;
  }

  const status = ctx.periodStatus(proposal.period);
  if (status !== "OPEN") return `${proposal.period} is ${status} — a person should decide during a close`;

  return null;
}

export interface AuthorityStats {
  readonly granted: number;
  readonly active: number;
  /** Postings made under a grant, ever. */
  readonly approved: number;
  /** Of those, how many a human later reversed. The trust number. */
  readonly reversed: number;
}

export class AuthorityRegistry {
  private readonly grants = new Map<string, StandingAuthority>();
  /** Entry ids produced under a grant, so reversals can be counted later. */
  private readonly produced: string[] = [];
  private seq = 0;

  constructor(
    private readonly orgId: string,
    private readonly ctx: AuthorityContext,
    private readonly bus: EventBus,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  grant(input: GrantInput, grantedBy: string): StandingAuthority {
    if (!input.note.trim()) throw new AuthorityError("A standing authority needs a note saying why it exists");
    if (cmp(input.maxAmount, ZERO) <= 0) throw new AuthorityError("maxAmount must be positive");
    if (cmp(input.maxPerSweep, input.maxAmount) < 0)
      throw new AuthorityError("maxPerSweep cannot be below maxAmount — the sweep limit would block every posting");

    const at = this.clock().toISOString();
    const authority: StandingAuthority = {
      id: input.id ?? `auth_${++this.seq}`,
      kind: input.kind,
      maxAmount: input.maxAmount,
      maxPerSweep: input.maxPerSweep,
      accounts: input.accounts ?? null,
      grantedBy,
      grantedAt: at,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      revokedBy: null,
      note: input.note.trim(),
    };
    this.grants.set(authority.id, authority);
    this.bus.emit({
      orgId: this.orgId,
      type: "authority.granted",
      at,
      actor: grantedBy,
      payload: { authorityId: authority.id, kind: authority.kind, note: authority.note },
    });
    return authority;
  }

  revoke(id: string, actor: string): StandingAuthority {
    const a = this.grants.get(id);
    if (!a) throw new AuthorityError(`No standing authority ${id}`);
    if (a.revokedAt) return a;
    const at = this.clock().toISOString();
    const next: StandingAuthority = { ...a, revokedAt: at, revokedBy: actor };
    this.grants.set(id, next);
    this.bus.emit({ orgId: this.orgId, type: "authority.revoked", at, actor, payload: { authorityId: id } });
    return next;
  }

  get(id: string): StandingAuthority | undefined {
    return this.grants.get(id);
  }

  all(): readonly StandingAuthority[] {
    return [...this.grants.values()];
  }

  /**
   * Walk open proposals and approve the ones a grant covers.
   *
   * Ordered smallest first, deliberately. When the sweep ceiling is the
   * binding constraint, taking the small ones clears more of the queue and
   * leaves the large ones — the ones worth a person's attention — for a
   * person. Taking them largest-first would spend the whole allowance on the
   * single posting most deserving of review.
   */
  settle(proposals: readonly Proposal[]): SettleResult {
    const now = this.clock().toISOString();
    const approved: { proposalId: string; entryId: string | null; authorityId: string }[] = [];
    const refused: Refusal[] = [];
    let spent = ZERO as Paise;

    const open = proposals
      .filter((p) => p.status === "OPEN")
      .slice()
      .sort((a, b) => {
        const av = a.proposedEntry?.amount ?? (ZERO as Paise);
        const bv = b.proposedEntry?.amount ?? (ZERO as Paise);
        return cmp(av, bv);
      });

    for (const proposal of open) {
      const candidates = [...this.grants.values()].filter((a) => a.kind === proposal.kind);
      if (candidates.length === 0) {
        refused.push({ proposalId: proposal.id, reason: `no standing authority covers ${proposal.kind}` });
        continue;
      }

      let taken = false;
      let lastReason = "";
      for (const authority of candidates) {
        const reason = refusalFor(authority, proposal, {
          periodStatus: (p) => this.ctx.periodStatus(p),
          spentThisSweep: spent,
          now,
        });
        if (reason) {
          lastReason = reason;
          continue;
        }

        const decided = this.ctx.approve(proposal.id, actorFor(authority));
        if (decided.resultingEntryId) this.produced.push(decided.resultingEntryId);
        spent = add(spent, proposal.proposedEntry!.amount);
        approved.push({ proposalId: proposal.id, entryId: decided.resultingEntryId, authorityId: authority.id });
        this.bus.emit({
          orgId: this.orgId,
          type: "authority.approved",
          at: now,
          actor: actorFor(authority),
          payload: {
            authorityId: authority.id,
            grantedBy: authority.grantedBy,
            proposalId: proposal.id,
            entryId: decided.resultingEntryId,
          },
        });
        taken = true;
        break;
      }

      if (!taken) refused.push({ proposalId: proposal.id, reason: lastReason });
    }

    return { approved, refused, totalApproved: spent };
  }

  /**
   * The number that decides whether a grant should be widened or narrowed.
   *
   * Reversals are counted at read time rather than tracked as they happen,
   * because a reversal is a fact about the ledger and the ledger is the
   * thing that knows. Anything cached here would drift from it.
   */
  stats(): AuthorityStats {
    const all = [...this.grants.values()];
    const now = this.clock().toISOString();
    return {
      granted: all.length,
      active: all.filter((a) => !a.revokedAt && (!a.expiresAt || a.expiresAt >= now)).length,
      approved: this.produced.length,
      reversed: this.produced.filter((id) => this.ctx.isReversed(id)).length,
    };
  }
}
