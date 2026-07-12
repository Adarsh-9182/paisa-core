"use client";

import * as React from "react";
import { animate, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Counts up to `value` on mount, formatting each frame with `format`.
 * Under reduced motion it renders the final value immediately.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 1.1,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = React.useState(() => format(reduce ? value : 0));

  React.useEffect(() => {
    if (reduce) {
      setDisplay(format(value));
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 0.7, 0.16, 1],
      onUpdate: (v) => setDisplay(format(v)),
    });
    return () => controls.stop();
    // re-run only when the target value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={cn("tabnum", className)}>{display}</span>;
}
