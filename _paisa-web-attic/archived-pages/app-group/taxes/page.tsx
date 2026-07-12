import { getGst } from "@/lib/data";
import { RecommendationList } from "@/components/recommendations";
import { MetricTile } from "@/components/app/metric-tile";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Card, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { displayDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  const gst = await getGst();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <h1 className="page-title mb-1">Taxes &amp; GST</h1>
        <p className="page-sub mb-5">Position for {gst.periodLabel}, the filing calendar, and prepared returns.</p>
      </Reveal>

      <Stagger className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StaggerItem>
          <MetricTile label="Output tax" value={gst.outputTax} sub={`GST collected · ${gst.periodLabel}`} />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Input tax credit" value={gst.itc} sub={`ITC accrued · ${gst.periodLabel}`} />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="Net payable" value={gst.netPayable} sub="output − ITC" />
        </StaggerItem>
        <StaggerItem>
          <MetricTile label="GST payable balance" value={gst.payableBalance} sub="on the ledger today" />
        </StaggerItem>
      </Stagger>

      {gst.gstRecommendations.length > 0 && (
        <Reveal delay={0.06}>
          <div className="mb-4">
            <RecommendationList items={gst.gstRecommendations} />
          </div>
        </Reveal>
      )}

      <Reveal delay={0.1}>
        <Card className="p-[22px]">
          <CardTitle>Filing calendar</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">
            GSTR-1 due the 11th, GSTR-3B the 20th of the following month. Submission always needs your approval.
          </CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Return</th>
                  <th>Period</th>
                  <th>Due date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {gst.filings.map((f) => (
                  <tr key={f.form + f.period}>
                    <td>
                      <b className="text-ink">{f.form}</b>
                      <div className="text-[11.5px] text-ink-3">{f.note}</div>
                    </td>
                    <td className="tabnum text-ink-2">{f.period}</td>
                    <td className="tabnum text-ink-2">{displayDate(f.dueDate)}</td>
                    <td>
                      {f.daysLeft < 0 ? (
                        <Badge tone="rose" size="sm">{-f.daysLeft}d overdue</Badge>
                      ) : f.daysLeft <= 10 ? (
                        <Badge tone="amber" size="sm">{f.daysLeft}d left</Badge>
                      ) : (
                        <Badge tone="muted" size="sm">{f.daysLeft}d left</Badge>
                      )}
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
