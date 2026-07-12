import { getInvoices } from "@/lib/data";
import { MetricTile } from "@/components/app/metric-tile";
import { AgingBars } from "@/components/charts/aging-bars";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Card, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const statusTone: Record<string, "emerald" | "blue" | "amber" | "muted"> = {
  PAID: "emerald",
  SENT: "blue",
  PARTIALLY_PAID: "amber",
  DRAFT: "muted",
  CANCELLED: "muted",
};

export default async function InvoicesPage() {
  const inv = await getInvoices();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <h1 className="page-title mb-1">Invoices</h1>
        <p className="page-sub mb-5">Receivables, aging, and every invoice on the ledger.</p>
      </Reveal>

      <Stagger className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StaggerItem>
          <MetricTile label="Outstanding" value={inv.totals.outstanding} sub={`${inv.totals.openCount} open invoices`} />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Overdue" value={inv.totals.overdueAmount} sub={`${inv.totals.overdueCount} past due`} />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Aging 31–60 days"
            value={inv.aging.find((b) => b.label === "31-60 days")?.amount ?? "₹0.00"}
            sub="follow up this week"
          />
        </StaggerItem>
        <StaggerItem>
          <MetricTile
            label="Aging 60+ days"
            value={inv.aging.find((b) => b.label === "60+ days")?.amount ?? "₹0.00"}
            sub="escalate"
          />
        </StaggerItem>
      </Stagger>

      <Reveal delay={0.06}>
        <Card className="mb-4 p-[22px]">
          <CardTitle>Receivables aging</CardTitle>
          <CardSub className="mb-3 mt-0.5">Open amounts by how far past due they are.</CardSub>
          <AgingBars data={inv.aging} />
        </Card>
      </Reveal>

      <Reveal delay={0.1}>
        <Card className="p-[22px]">
          <CardTitle>All invoices</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">Newest first · every transition posted to the ledger.</CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Issued</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((i) => (
                  <tr key={i.number}>
                    <td className="font-[600] tabnum text-ink">{i.number}</td>
                    <td className="text-ink">{i.customer}</td>
                    <td className="tabnum text-ink-2">{i.issueDate}</td>
                    <td className="tabnum" style={{ color: i.overdue ? "var(--rose)" : "var(--ink-2)" }}>
                      {i.dueDate}
                    </td>
                    <td className="num text-ink">{i.total}</td>
                    <td className="num font-[600] text-ink">{i.outstanding}</td>
                    <td>
                      <Badge tone={i.overdue ? "rose" : statusTone[i.status] ?? "muted"} size="sm">
                        {i.overdue ? "OVERDUE" : i.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
