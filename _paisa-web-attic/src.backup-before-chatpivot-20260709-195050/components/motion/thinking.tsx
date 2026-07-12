"use client";

import { cn } from "@/lib/utils";

/** Three blinking dots — the AI "thinking" pulse. */
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-current"
          style={{ animation: `thinkingBlink 1.1s ${i * 0.16}s infinite ease-in-out` }}
        />
      ))}
    </span>
  );
}

/** A single shimmering line — for streaming/thinking placeholders. */
export function ShimmerLine({ className }: { className?: string }) {
  return <span className={cn("block h-3 rounded-full shimmer", className)} />;
}

/** Live "pulse" dot used on status indicators. */
export function PulseDot({ className, color = "var(--emerald)" }: { className?: string; color?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      <span className="absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: color, animation: "pulseGlow 1.8s infinite" }} />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
