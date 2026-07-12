import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border border-transparent font-[650] tracking-[0.01em] whitespace-nowrap",
  {
    variants: {
      tone: {
        emerald: "bg-emerald/12 text-emerald",
        blue: "bg-blue/12 text-blue-deep",
        purple: "bg-purple/14 text-purple",
        cyan: "bg-cyan/12 text-cyan",
        amber: "bg-amber/14 text-amber",
        rose: "bg-rose/12 text-rose",
        muted: "bg-surface-2 text-ink-3",
        outline: "border-line text-ink-2",
      },
      size: {
        sm: "px-[9px] py-[3px] text-[10.5px]",
        md: "px-2.5 py-1 text-[11.5px]",
      },
    },
    defaultVariants: { tone: "muted", size: "sm" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
