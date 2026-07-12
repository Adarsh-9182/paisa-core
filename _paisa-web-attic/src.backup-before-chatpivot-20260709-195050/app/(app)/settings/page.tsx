import { getSettings } from "@/lib/data";
import { Reveal } from "@/components/motion/reveal";
import { Card, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getSettings();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <h1 className="page-title mb-1">Settings</h1>
        <p className="page-sub mb-5">Organisation, policies, and how the AI is wired.</p>
      </Reveal>

      <div className="mb-4 grid gap-3.5 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <Card className="h-full p-[22px]">
            <CardTitle className="mb-2.5">Organisation</CardTitle>
            <table className="dtable">
              <tbody>
                <tr>
                  <td className="text-ink-2">Name</td>
                  <td className="num font-[600] text-ink">{s.org.name}</td>
                </tr>
                <tr>
                  <td className="text-ink-2">Organisation ID</td>
                  <td className="num tabnum text-ink">{s.org.id}</td>
                </tr>
                <tr>
                  <td className="text-ink-2">Reporting period</td>
                  <td className="num tabnum text-ink">
                    {s.org.periodFrom} → {s.org.asOf}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          <Card className="h-full p-[22px]">
            <CardTitle className="mb-2.5">AI CFO</CardTitle>
            <table className="dtable">
              <tbody>
                <tr>
                  <td className="text-ink-2">Provider</td>
                  <td className="num font-[600] text-ink">{s.provider}</td>
                </tr>
                <tr>
                  <td className="text-ink-2">Number verification</td>
                  <td className="num">
                    <Badge tone="emerald" size="sm">enforced</Badge>
                  </td>
                </tr>
                <tr>
                  <td className="text-ink-2">Payment execution</td>
                  <td className="num">
                    <Badge tone="muted" size="sm">no code path exists</Badge>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="card-sub mt-2.5">
              Every figure the AI states is checked against engine tool outputs before you see it. Set{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink-2">ANTHROPIC_API_KEY</code> and restart to route chat through Claude.
            </p>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.06}>
        <Card className="mb-4 p-[22px]">
          <CardTitle>Policy rules</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">IF/THEN policies the engine evaluates — configuration, not prompts.</CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Condition</th>
                  <th>Action</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.rules.map((r) => (
                  <tr key={r.name}>
                    <td className="font-[600] text-ink">{r.name}</td>
                    <td className="tabnum text-ink-2">
                      {r.metric} {r.op} {r.threshold}
                    </td>
                    <td>
                      <Badge tone={r.action === "require_approval" ? "blue" : "purple"} size="sm">
                        {r.action.replace("_", " ")}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={r.enabled ? "emerald" : "muted"} size="sm" dot={r.enabled}>
                        {r.enabled ? "enabled" : "off"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.1}>
        <Card className="mb-4 p-[22px]">
          <CardTitle>Auto-categorisation</CardTitle>
          <CardSub className="mb-2.5 mt-0.5">Bank lines matching these keywords post straight to the ledger; everything else waits for review.</CardSub>
          <div className="flex flex-wrap gap-1.5">
            {s.categorization.map((c) => (
              <Badge key={c.keyword} tone="muted" size="md" className="font-mono">
                {c.keyword} → {c.label}
              </Badge>
            ))}
          </div>
        </Card>
      </Reveal>

      <Reveal delay={0.14}>
        <Card className="p-[22px]">
          <CardTitle>Chart of accounts</CardTitle>
          <CardSub className="mb-1.5 mt-0.5">The account structure every engine posts against.</CardSub>
          <div className="overflow-x-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {s.chart.map((a) => (
                  <tr key={a.code}>
                    <td className="tabnum text-ink-3">{a.code}</td>
                    <td className="font-[600] text-ink">
                      {a.name} {a.cash && <Badge tone="emerald" size="sm">cash</Badge>}
                    </td>
                    <td className="capitalize text-ink-2">{a.type.toLowerCase()}</td>
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
