"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export interface AllocationSlice {
  kind: string;
  pct: number;
  value: string;
}

export function AllocationDonut({
  data,
  centerLabel,
  centerValue,
}: {
  data: AllocationSlice[];
  centerLabel?: string;
  centerValue?: string;
}) {
  if (!data.length) return null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <div className="relative h-[152px] w-[152px] shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="pct"
              nameKey="kind"
              innerRadius={50}
              outerRadius={72}
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
              animationDuration={900}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && <span className="font-display text-[17px] font-[650] tabnum text-ink">{centerValue}</span>}
            {centerLabel && <span className="text-[10px] font-[600] uppercase tracking-[0.08em] text-ink-3">{centerLabel}</span>}
          </div>
        )}
      </div>

      {/* Legend = the relief rule: identity by label + value, never color alone */}
      <ul className="flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={d.kind} className="flex items-center gap-2.5 text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="flex-1 truncate capitalize text-ink-2">{d.kind}</span>
            <span className="tabnum font-[600] text-ink">{d.value}</span>
            <span className="w-10 text-right tabnum text-ink-3">{d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
