"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Sparkline } from "@/components/charts/sparkline";
import { compactINR, plainInt } from "@/lib/money";
import { cn } from "@/lib/utils";

const FORMATTERS = { inr: compactINR, int: plainInt } as const;

function Delta({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return null;
  if (pct === 0)
    return (
      <span className="inline-flex items-center gap-0.5 font-[600] text-ink-3">
        <Minus size={12} /> 0%
      </span>
    );
  const up = pct > 0;
  const good = goodWhenUp ? up : !up;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-[600]", good ? "text-emerald" : "text-rose")}>
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(pct)}%
    </span>
  );
}

export function MetricTile({
  label,
  value,
  raw,
  format,
  deltaPct,
  goodWhenUp = true,
  sub,
  spark,
  sparkColor = "var(--chart-1)",
  title,
}: {
  label: string;
  value: string;
  raw?: number;
  format?: keyof typeof FORMATTERS;
  deltaPct?: number | null;
  goodWhenUp?: boolean;
  sub?: React.ReactNode;
  spark?: number[];
  sparkColor?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="group relative overflow-hidden rounded-[18px] border border-line bg-surface p-[17px] shadow-[var(--shadow-sm)] transition-all duration-[250ms] ease-[var(--ease-out-quint)] hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-md)]"
    >
      <div className="flex items-start justify-between">
        <span className="text-[12px] font-[550] text-ink-2">{label}</span>
        {deltaPct !== undefined && <span className="text-[11.5px]"><Delta pct={deltaPct ?? null} goodWhenUp={goodWhenUp} /></span>}
      </div>

      <div className="mt-1.5 font-display text-[25px] font-[640] tracking-[-0.025em] text-ink">
        {raw != null && format ? (
          <AnimatedNumber value={raw} format={FORMATTERS[format]} />
        ) : (
          <span className="tabnum">{value}</span>
        )}
      </div>

      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-[11.5px] leading-tight text-ink-3">{sub}</span>
        {spark && spark.length > 1 && (
          <div className="opacity-90">
            <Sparkline data={spark} color={sparkColor} width={92} height={30} />
          </div>
        )}
      </div>
    </div>
  );
}
