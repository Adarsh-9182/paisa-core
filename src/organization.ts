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
import { InvoiceEngine } from "./invoices.js";
import { GstEngine } from "./gst.js";
import { BankFeedEngine } from "./banking.js";
import { RecurringDetector } from "./recurring.js";
import { ForecastEngine } from "./forecast.js";
import { RecommendationEngine } from "./recommendations.js";
import { BriefComposer } from "./brief.js";
import { PortfolioEngine } from "./portfolio.js";

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
}

export class Platform {
  private orgs = new Map<string, Organization>();

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
    for (const r of standardRules(orgId)) rules.add(r);
    const org: Organization = {
      orgId, name, chart, journal, ledger, statements, cashflow, health, rules, bus,
      invoices, gst, banking, recurring, forecast, recommendations, brief, portfolio,
    };
    this.orgs.set(orgId, org);
    return org;
  }

  /** Access requires both userId membership and orgId — no cross-tenant reads. */
  organization(orgId: string, memberships: ReadonlySet<string>): Organization {
    if (!memberships.has(orgId))
      throw new Error(`Access denied: user is not a member of ${orgId}`);
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`Unknown organization ${orgId}`);
    return org;
  }
}
