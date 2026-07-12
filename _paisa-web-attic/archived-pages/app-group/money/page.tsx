import { Suspense } from "react";
import { Link2 } from "lucide-react";
import { getMoney, getTransactions, getConnections } from "@/lib/data";
import { ReviewQueue } from "@/components/review-queue";
import { AddAccountForm } from "@/components/add-account-form";
import { ImportStatementForm } from "@/components/import-statement-form";
import { ConnectBankDialog, ConnectionsCard, AaResultBanner } from "@/components/connect-bank";
import { MetricTile } from "@/components/app/metric-tile";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Card, CardHeader, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { displayDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const money = await getMoney();
  const tx = await getTransactions(12);
  const connections = await getConnections();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Suspense>
        <AaResultBanner />
      </Suspense>
      <Reveal>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title mb-1">Money</h1>
            <p className="page-sub">Bank position, transactions, and the categorisation review queue.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectBankDialog
              trigger={
                <Button>
                  <Link2 size={15} /> Connect a bank
                </Button>
              }
            />
            <AddAccountForm asOf={money.asOf} />
            <ImportStatementForm accounts={money.bankAccounts} />
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <Card className="mb-4 p-[22px]">
          <CardHeader>
            <div>
              <CardTitle>Connected banks</CardTitle>
              <CardSub className="mt-0.5">Live, consent-based transactions via the Account Aggregator network</CardSub>
            </div>
            <Badge tone="blue" size="sm" dot>
              account aggregator
            </Badge>
          </CardHeader>
          <div className="mt-3">
            <ConnectionsCard connections={connections} />
          </div>
        </Card>
      </Reveal>

      <Stagger className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StaggerItem>
          <MetricTile label="Cash on hand" value={money.cashCompact} title={money.cash} sub="across bank & cash accounts" />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Inflows (MTD)" value={money.monthInflows} sub="month to date" />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Outflows (MTD)" value={money.monthOutflows} sub="month to date" />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Net burn"
            value={money.burnPositive ? "None" : money.burn ?? "—"}
            sub={money.burnPositive ? "cash-flow positive" : "trailing 3-month avg"}
          />
        </StaggerItem>
      </Stagger>

      <div className="mb-4 grid gap-3.5 lg:grid-cols-2">
        <Reveal delay={0.06}>
          <Card className="h-full p-[22px]">
            <CardTitle>Needs review</CardTitle>
            <CardSub className="mb-1.5 mt-0.5">Bank lines the categoriser wouldn&apos;t guess — file them yourself.</CardSub>
            <ReviewQueue lines={money.review} targets={money.categorizeTargets} />
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full p-[22px]">
            <CardTitle>Recurring &amp; subscriptions</CardTitle>
            <CardSub className="mb-1.5 mt-0.5">Detected from 3+ stable monthly occurrences.</CardSub>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th className="num">Monthly</th>
                  <th className="num">Next</th>
                </tr>
              </thead>
              <tbody>
                {money.recurring.map((r) => (
                  <tr key={r.name + r.account}>
                    <td>
                      <b className="text-ink">{r.name}</b>{" "}
                      {r.isSubscription && <Badge tone="blue" size="sm">subscription</Badge>}
                      <div className="text-[11.5px] text-ink-3">
                        {r.account} · {r.annualized}/yr
                      </div>
                    </td>
                    <td className="num text-ink">{r.monthly}</td>
                    <td className="num text-ink-2">{displayDate(r.next)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.06}>
        <Card className="mb-4 p-[22px]">
          <CardTitle>Accounts</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">Ledger balances as of today.</CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {money.accounts.map((a) => (
                  <tr key={a.code}>
                    <td className="tabnum text-ink-3">{a.code}</td>
                    <td>
                      <b className="text-ink">{a.name}</b> {a.isCash && <Badge tone="emerald" size="sm">cash</Badge>}
                    </td>
                    <td className="capitalize text-ink-2">{a.type.toLowerCase()}</td>
                    <td className="num font-[600] text-ink">{a.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.1}>
        <Card className="p-[22px]">
          <CardTitle>Transactions</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">Latest cash movements, auto-categorised on import.</CardSub>
          <table className="dtable">
            <tbody>
              {tx.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <b className="text-ink">{r.narration}</b>
                    <div className="text-[11.5px] text-ink-3">
                      {r.category} · {r.date}
                    </div>
                  </td>
                  <td className={`num font-[600] ${r.direction === "in" ? "text-emerald" : "text-ink"}`}>
                    {r.direction === "in" ? "+" : "−"}
                    {r.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Reveal>
    </div>
  );
}
