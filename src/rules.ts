/**
 * Financial Rules Engine — configurable IF/THEN policies, fully separate
 * from AI prompts. Finance teams automate policy without touching code
 * or prompts. Rules evaluate deterministic engine outputs only.
 */

import { Paise, cmp, formatINR, parseINR } from "./money.js";
import { EventBus } from "./events.js";

export type RuleMetric =
  | "cash_on_hand"
  | "runway_days"
  | "monthly_net_burn"
  | "invoice_age_days"
  | "expense_amount";

export type RuleOp = "lt" | "lte" | "gt" | "gte" | "eq";

export interface Rule {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly metric: RuleMetric;
  readonly op: RuleOp;
  readonly threshold: Paise | number; // Paise for money metrics, number for day counts
  readonly action: "notify" | "require_approval" | "block";
  readonly message: string; // template; {value} and {threshold} interpolated
  readonly enabled: boolean;
}

export interface RuleFiring {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly action: Rule["action"];
  readonly message: string;
  readonly value: string;
}

const compare = (op: RuleOp, value: bigint | number, threshold: bigint | number): boolean => {
  const a = typeof value === "bigint" ? value : BigInt(Math.round(value));
  const b = typeof threshold === "bigint" ? threshold : BigInt(Math.round(threshold));
  switch (op) {
    case "lt": return a < b;
    case "lte": return a <= b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "eq": return a === b;
  }
};

export class RulesEngine {
  private rules: Rule[] = [];

  constructor(public readonly orgId: string, private bus: EventBus) {}

  add(rule: Rule): void {
    if (rule.orgId !== this.orgId) throw new Error("Rule belongs to a different organization");
    this.rules.push(rule);
  }

  all(): readonly Rule[] {
    return this.rules;
  }

  /** Evaluate a metric snapshot against all enabled rules for that metric. */
  evaluate(metric: RuleMetric, value: Paise | number, actor = "system"): readonly RuleFiring[] {
    const firings: RuleFiring[] = [];
    for (const r of this.rules) {
      if (!r.enabled || r.metric !== metric) continue;
      if (!compare(r.op, value as bigint | number, r.threshold as bigint | number)) continue;
      const fmt = (v: Paise | number) => (typeof v === "bigint" ? formatINR(v) : String(v));
      const firing: RuleFiring = {
        ruleId: r.id,
        ruleName: r.name,
        action: r.action,
        message: r.message.replace("{value}", fmt(value)).replace("{threshold}", fmt(r.threshold)),
        value: fmt(value),
      };
      firings.push(firing);
      this.bus.emit({
        orgId: this.orgId,
        type: "rule.fired",
        at: new Date().toISOString(),
        actor,
        payload: { ruleId: r.id, action: r.action, message: firing.message },
      });
    }
    return firings;
  }
}

/** Convenience factory for common Indian SMB policies. */
export const standardRules = (orgId: string): Rule[] => [
  {
    id: "rule_low_cash",
    orgId,
    name: "Low cash balance",
    metric: "cash_on_hand",
    op: "lt",
    threshold: parseINR("5,00,000"),
    action: "notify",
    message: "Cash balance {value} fell below {threshold}. Notify CFO.",
    enabled: true,
  },
  {
    id: "rule_big_expense",
    orgId,
    name: "Large expense approval",
    metric: "expense_amount",
    op: "gt",
    threshold: parseINR("1,00,000"),
    action: "require_approval",
    message: "Expense of {value} exceeds {threshold} and requires approval.",
    enabled: true,
  },
  {
    id: "rule_overdue_invoice",
    orgId,
    name: "Invoice overdue reminder",
    metric: "invoice_age_days",
    op: "gt",
    threshold: 30,
    action: "notify",
    message: "Invoice is {value} days old (limit {threshold}). Send reminder.",
    enabled: true,
  },
  {
    id: "rule_short_runway",
    orgId,
    name: "Short runway warning",
    metric: "runway_days",
    op: "lt",
    threshold: 90,
    action: "notify",
    message: "Runway is {value} days, below the {threshold}-day safety floor.",
    enabled: true,
  },
];
