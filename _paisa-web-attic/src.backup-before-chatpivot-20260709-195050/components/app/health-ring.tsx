"use client";

import { motion, useReducedMotion } from "framer-motion";

function toneFor(score: number) {
  if (score >= 75) return "var(--emerald)";
  if (score >= 50) return "var(--amber)";
  return "var(--rose)";
}

/** Animated radial gauge for the 0–100 financial health score. */
export function HealthRing({
  score,
  size = 64,
  stroke = 6,
  showValue = true,
  glow = true,
}: {
  score: number;
  size?: number;
  stroke?: number;
  showValue?: boolean;
  glow?: boolean;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = toneFor(score);

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: reduce ? circ * (1 - pct) : circ }}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: 1.2, ease: [0.22, 0.7, 0.16, 1] }}
          style={glow ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
        />
      </svg>
      {showValue && (
        <div
          className="absolute font-display font-[650] tabnum text-ink"
          style={{ fontSize: size * 0.3 }}
        >
          {score}
        </div>
      )}
    </div>
  );
}
