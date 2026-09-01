/**
 * Organization — the multi-tenant boundary. Every engine instance is
 * scoped to exactly one org; there is no code path that reads another
 * organization's data. One user can own multiple isolated organizations.
 */

import { ChartOfAccounts, defaultChart } from "./accounts.js";
import { JournalEngine } from "./journal.js";
import { Ledger } from "./ledger.js";
import { Statements } from "./statements.js";
import { CashFlowIntelligence } from "./cashflow.js";
import { HealthScorer } from "./health.js";
import { RulesEngine, standardRules } from "./rules.js";
import { EventBus } from "./events.js";
import { AccessContext, AccessError, MemberDirectory } from "./tenancy/members.js";
import { Permission } from "./tenancy/roles.js";
import { InvoiceEngine } from "./invoices.js";
import { GstEngine } from "./gst.js";
import { BankFeedEngine } from "./banking.js";
import { RecurringDetector } from "./recurring.js";
import { ForecastEngine } from "./forecast.js";
import { RecommendationEngine } from "./recommendations.js";
import { BriefComposer } from "./brief.js";
import { PortfolioEngine } from "./portfolio.js";
import { ActionQueue } from "./actions.js";

export interface Organization {
  readonly orgId: string;
  readonly name: string;
  readonly chart: ChartOfAccounts;
  readonly journal: JournalEngine;
  readonly ledger: Ledger;
  readonly statements: Statements;
  readonly cashflow: CashFlowIntelligence;
  readonly health: HealthScorer;
  readonly rules: RulesEngine;
  readonly bus: EventBus;
  readonly invoices: InvoiceEngine;
  readonly gst: GstEngine;
  readonly banking: BankFeedEngine;
  readonly recurring: RecurringDetector;
  readonly forecast: ForecastEngine;
  readonly recommendations: RecommendationEngine;
  readonly brief: BriefComposer;
  readonly portfolio: PortfolioEngine;
  /** Changes the AI CFO has proposed, none of which happen without approval. */
  readonly actions: ActionQueue;
}

/**
 * An authorised handle on one organization's books.
 *
 * Holding one is proof that membership was checked, so a function that takes
 * a TenantSession cannot be called with an unchecked user. That is the whole
 * mechanism: not a rule every route has to remember, but a type it cannot
 * obtain without passing the gate.
 */
export interface TenantSession {
  readonly access: AccessContext;
  readonly org: Organization;
  /** Throws AccessError unless this member holds the permission. */
  require(permission: Permission): void;
}

export class Platform {
  private orgs = new Map<string, Organization>();
  private members = new MemberDirectory();

  /**
   * Build the engines for an organization, with no membership attached.
   *
   * This is the unguarded construction path, used by seeding, tests and
   * demo fixtures. It hands back the raw Organization, so anything calling
   * it is already inside the trust boundary. Product code founds a workspace
   * with createWorkspace() and reaches the books through open().
   */

  createOrganization(orgId: string, name: string): Organization {
    if (this.orgs.has(orgId)) throw new Error(`Organization ${orgId} already exists`);
    const bus = new EventBus();
    const chart = defaultChart(orgId);
    const journal = new JournalEngine(orgId, chart, bus);
    const ledger = new Ledger(chart, journal);
    const statements = new Statements(chart, ledger, journal);
    const cashflow = new CashFlowIntelligence(chart, ledger, statements);
    const invoices = new InvoiceEngine(orgId, chart, journal, bus);
    const health = new HealthScorer(chart, ledger, statements, cashflow, invoices);
    const gst = new GstEngine(orgId, ledger, invoices);
    const banking = new BankFeedEngine(orgId, chart, journal, bus);
    const recurring = new RecurringDetector(chart, journal);
    const forecast = new ForecastEngine(statements, cashflow);
    const recommendations = new RecommendationEngine(orgId, statements, cashflow, invoices, gst, recurring, bus);
    const brief = new BriefComposer(statements, cashflow, health, invoices, gst, recommendations);
    const portfolio = new PortfolioEngine(orgId, journal, bus);
    const rules = new RulesEngine(orgId, bus);
    const actions = new ActionQueue(orgId, bus);
    for (const r of standardRules(orgId)) rules.add(r);
    const org: Organization = {
      orgId, name, chart, journal, ledger, statements, cashflow, health, rules, bus,
      invoices, gst, banking, recurring, forecast, recommendations, brief, portfolio, actions,
    };
    this.orgs.set(orgId, org);
    return org;
  }

  /**
   * Found a workspace: create the books and their first owner in one step.
   *
   * The two cannot be separate operations. An organization that exists with
   * no members is a set of books nobody can open and nobody can grant access
   * to — unrecoverable without a support back door, which is precisely the
   * thing that should not exist.
   */
  createWorkspace(orgId: string, name: string, ownerUserId: string): TenantSession {
    const org = this.createOrganization(orgId, name);
    this.members.found(orgId, ownerUserId);
    return this.open(ownerUserId, orgId);
  }

  /**
   * The only authorised way into an organization's books.
   *
   * This replaces `organization(orgId, memberships)`, which took the caller's
   * own idea of which orgs it belonged to. A boundary the caller supplies is
   * not a boundary — it is a convention, and the first route that forgets to
   * pass the right set is a cross-tenant read. Membership is now looked up
   * here, from the directory, and there is no argument a caller can pass to
   * influence the answer.
   */
  open(userId: string, orgId: string): TenantSession {
    // Authorize first: a caller must not be able to tell an organization that
    // exists from one that does not by which error comes back.
    const access = this.members.authorize(userId, orgId);
    const org = this.orgs.get(orgId);
    if (!org) throw new AccessError(`No access to organization ${orgId}`);
    return {
      access,
      org,
      require: (permission) => this.members.require(access, permission),
    };
  }

  /** Membership administration, for a caller that has already been authorised. */
  get directory(): MemberDirectory {
    return this.members;
  }
}
