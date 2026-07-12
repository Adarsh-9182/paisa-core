"use client";

import { motion, useReducedMotion } from "framer-motion";

export interface AgingBucket {
  label: string;
  count: number;
  amount: string;
  raw: number;
}

// Severity ramp: current is healthy, older is more serious.
const toneFor = (label: string) => {
  if (label === "Current") return "var(--chart-pos)";
  if (label.startsWith("1-30")) return "var(--chart-1)";
  if (label.startsWith("31-60")) return "var(--chart-forecast)";
  return "var(--chart-neg)";
};

export function AgingBars({ data }: { data: AgingBucket[] }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...data.map((b) => b.raw));

  return (
    <div className="flex flex-col gap-3">
      {data.map((b, i) => {
        const pct = (b.raw / max) * 100;
        const color = toneFor(b.label);
        return (
          <div key={b.label} className="grid grid-cols-[96px_1fr_150px] items-center gap-3">
            <span className="text-[12.5px] font-[600] text-ink-2">{b.label}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-track">
              <motion.div
                className="h-full rounded-full"
                style={{ background: color }}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, delay: i * 0.06, ease: [0.22, 0.7, 0.16, 1] }}
              />
            </div>
            <span className="text-right text-[12.5px] font-[600] tabnum text-ink">
              {b.amount} <span className="text-ink-3">({b.count})</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
