"use client";

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Tiny bespoke sparkline with an animated draw and a soft area fill. */
export function Sparkline({
  data,
  color = "var(--chart-1)",
  width = 116,
  height = 38,
  fill = true,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  const reduce = useReducedMotion();
  const id = useId();
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (data.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - 2 * pad);

  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)} ${height - pad} L${pad} ${height - pad} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: [0.22, 0.7, 0.16, 1] }}
      />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r={2.4} fill={color} />
    </svg>
  );
}
