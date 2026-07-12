import { Sparkles, ShieldCheck, CircleAlert } from "lucide-react";
import { getAiLog } from "@/lib/data";
import { AskCards } from "@/components/ask-cards";
import { Reveal } from "@/components/motion/reveal";
import { Card, CardTitle, CardSub } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const log = await getAiLog();

  return (
    <div className="mx-auto max-w-[1040px]">
      <Reveal>
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-blue/10 text-blue-deep">
            <Sparkles size={20} strokeWidth={1.8} />
          </span>
          <div>
            <h1 className="page-title">Ask AI</h1>
            <p className="page-sub mt-0.5">
              Ask anything from the bar above — every figure is verified against the ledger before you see it.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <section className="mb-6">
          <AskCards />
        </section>
      </Reveal>

      <Reveal delay={0.1}>
        <Card className="p-[22px]">
          <CardTitle>Verified reasoning trail</CardTitle>
          <CardSub className="mb-3 mt-0.5">
            Every question, the engine tools consulted, and whether the answer passed verification.
          </CardSub>

          {log.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing yet"
              description="Ask your first question — it'll appear here with its full audit trail."
            />
          ) : (
            <div className="relative flex flex-col">
              <span className="absolute bottom-4 left-[13px] top-4 w-px bg-line" aria-hidden />
              {log.map((r, i) => (
                <div key={i} className="relative flex gap-3.5 py-3">
                  <span
                    className={`z-[1] mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-surface ${
                      r.verified ? "bg-emerald/12 text-emerald" : "bg-rose/12 text-rose"
                    }`}
                  >
                    {r.verified ? <ShieldCheck size={14} /> : <CircleAlert size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <b className="text-[13.5px] text-ink">{r.query}</b>
                      <Badge tone={r.verified ? "emerald" : "rose"} size="sm">
                        {r.verified ? "verified" : "rejected"}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-ink-2">
                      {r.answer.replace(/\*\*/g, "").replace(/_/g, "")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {r.tools.length > 0 ? (
                        r.tools.map((t) => (
                          <Badge key={t} tone="outline" size="sm" className="font-mono lowercase">
                            {t.replace(/_/g, " ")}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-ink-3">no tools consulted</span>
                      )}
                      <span className="ml-auto text-[10.5px] tabnum text-ink-3">
                        {new Date(r.at).toLocaleTimeString("en-IN")}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
