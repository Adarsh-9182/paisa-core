"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface CashPoint {
  month: string;
  kind: "actual" | "forecast";
  closing: number;
  closingLabel: string;
  netLabel: string;
}

const POS = "var(--chart-pos)";
const FORECAST = "var(--chart-forecast)";

export function CashflowChart({ points }: { points: CashPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const gid = useId();

  const W = 560;
  const H = 220;
  const padL = 46;
  const padR = 42;
  const padT = 18;
  const padB = 28;

  const ys = points.map((p) => p.closing);
  const yMax = Math.max(...ys) * 1.08;
  const yMin = Math.min(0, Math.min(...ys));
  const x = (i: number) => padL + (i * (W - padL - padR)) / (points.length - 1);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
  const fmtL = (v: number) => `₹${(v / 1e5).toFixed(0)}L`;

  const lastActual = points.map((p) => p.kind).lastIndexOf("actual");
  const path = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map((p, k) => `${k ? "L" : "M"}${x(from + k)} ${y(p.closing)}`)
      .join(" ");

  const grid = [0, 1, 2, 3].map((k) => yMin + ((yMax - yMin) * k) / 3);
  const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en", { month: "short" });
  const draw = reduce ? {} : { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 1.2, ease: [0.22, 0.7, 0.16, 1] as const } };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Monthly closing cash — actuals then forecast"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={POS} stopOpacity="0.16" />
            <stop offset="100%" stopColor={POS} stopOpacity="0" />
          </linearGradient>
        </defs>

        {grid.map((v, k) => (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--chart-axis)">
              {fmtL(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--chart-axis)">
            {monthName(p.month)}
          </text>
        ))}

        <motion.path
          d={`${path(0, lastActual)} L${x(lastActual)} ${y(yMin)} L${x(0)} ${y(yMin)} Z`}
          fill={`url(#${gid})`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        />
        <motion.path d={path(0, lastActual)} fill="none" stroke={POS} strokeWidth={2.25} strokeLinecap="round" {...draw} />
        {lastActual < points.length - 1 && (
          <motion.path
            d={path(lastActual, points.length - 1)}
            fill="none"
            stroke={FORECAST}
            strokeWidth={2.25}
            strokeDasharray="5 5"
            strokeLinecap="round"
            {...draw}
          />
        )}

        {[lastActual, points.length - 1].map((i) => {
          const color = points[i].kind === "actual" ? POS : FORECAST;
          return (
            <g key={i}>
              <circle cx={x(i)} cy={y(points[i].closing)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2.5} />
              <text x={x(i)} y={y(points[i].closing) - 11} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={color}>
                {points[i].closingLabel}
              </text>
            </g>
          );
        })}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--chart-axis)" strokeWidth={1} strokeDasharray="2 3" />
        )}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - padL - padR) / (2 * (points.length - 1))}
            y={0}
            width={(W - padL - padR) / (points.length - 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[112%] whitespace-nowrap rounded-xl border border-line bg-elevated px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-[var(--shadow-md)]"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].closing) / H) * 100}%` }}
        >
          <b>
            {points[hover].month}
            {points[hover].kind === "forecast" ? " · forecast" : ""}
          </b>
          <br />
          <span className="text-ink-2">
            Closing {points[hover].closingLabel} · Net {points[hover].netLabel}
          </span>
        </div>
      )}

      <div className="mt-1.5 flex gap-4 text-[11.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3.5" style={{ borderTop: `2.5px solid ${POS}`, borderRadius: 2 }} />
          Closing cash (actual)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3.5" style={{ borderTop: `2.5px dashed ${FORECAST}`, borderRadius: 2 }} />
          Forecast
        </span>
      </div>
    </div>
  );
}
