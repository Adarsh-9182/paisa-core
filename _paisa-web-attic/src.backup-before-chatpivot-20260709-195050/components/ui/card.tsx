import * as React from "react";
import { cn } from "@/lib/utils";

/** Base surface. `interactive` adds hover lift; `glass` frosts the background. */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean; glass?: boolean }
>(({ className, interactive, glass, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-[20px] border border-line bg-surface shadow-[var(--shadow-sm)]",
      glass && "glass border-[var(--glass-border)]",
      interactive &&
        "transition-all duration-[250ms] ease-[var(--ease-out-quint)] hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-md)]",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("font-display text-[15.5px] font-[650] tracking-[-0.02em] text-ink", className)}
      {...props}
    />
  );
}

export function CardSub({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-ink-3", className)} {...props} />;
}
