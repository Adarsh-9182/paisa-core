"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/** A surface with a soft glow that follows the cursor — for hero cards only. */
export function SpotlightCard({
  children,
  className,
  glow = "var(--blue-soft)",
  radius = 380,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: string;
  radius?: number;
}) {
  const reduce = useReducedMotion();
  const [pos, setPos] = React.useState({ x: -9999, y: -9999 });
  const [active, setActive] = React.useState(false);

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      onMouseMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      {!reduce && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
          style={{
            opacity: active ? 1 : 0,
            background: `radial-gradient(${radius}px circle at ${pos.x}px ${pos.y}px, ${glow}, transparent 62%)`,
          }}
        />
      )}
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
