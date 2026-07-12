"use client";

import { Sparkles, ArrowRight } from "lucide-react";
import { SpotlightCard } from "@/components/motion/spotlight";
import { HealthRing } from "@/components/app/health-ring";
import { PulseDot } from "@/components/motion/thinking";
import { RecommendationList, type Rec } from "@/components/recommendations";

const CHIPS = ["How long can we survive?", "What should I cancel?", "Prepare GST"];

function Headline({ text }: { text: string }) {
  const parts = text.split(/(₹[\d,]+(?:\.\d{2})?)/g);
  let seen = 0;
  return (
    <p className="max-w-[54ch] font-display text-[19px] font-[560] leading-[1.5] tracking-[-0.01em] text-ink">
      {parts.map((p, i) =>
        p.startsWith("₹") ? (
          <b key={i} className={seen++ === 0 ? "text-emerald" : "text-blue-deep"}>
            {p}
          </b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export function BriefHero({
  headline,
  updatedLabel,
  health,
  recs,
}: {
  headline: string;
  updatedLabel: string;
  health: { score: number; grade: string };
  recs: Rec[];
}) {
  const ask = (q: string) => window.dispatchEvent(new CustomEvent("paisa:ask", { detail: q }));

  return (
    <SpotlightCard
      className="rounded-[24px] border border-line bg-surface shadow-[var(--shadow-md)]"
      glow="var(--glow-a)"
      radius={520}
    >
      {/* animated gradient hairline */}
      <div
        aria-hidden
        className="h-[3px] w-full"
        style={{
          background: "linear-gradient(90deg, var(--chart-1), var(--purple), var(--cyan), var(--chart-1))",
          backgroundSize: "300% 100%",
          animation: "gradientPan 8s ease-in-out infinite",
        }}
      />
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-[700] uppercase tracking-[0.1em] text-blue-deep">
              <Sparkles size={12} /> AI CFO · Morning brief
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              <PulseDot color="var(--emerald)" /> {updatedLabel}
            </span>
          </div>

          <Headline text={headline} />

          <div className="mt-4 flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => ask(c)}
                className="group inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors hover:border-blue hover:text-blue-deep"
              >
                {c}
                <ArrowRight size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>

          <div className="mt-4">
            <RecommendationList items={recs} collapsible />
          </div>
        </div>

        <div className="hidden flex-col items-center justify-center gap-2.5 border-l border-line pl-6 lg:flex">
          <HealthRing score={health.score} size={96} stroke={8} />
          <div className="text-center">
            <div className="font-display text-[15px] font-[650] text-ink">{health.grade}</div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-ink-3">Financial health</div>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}
