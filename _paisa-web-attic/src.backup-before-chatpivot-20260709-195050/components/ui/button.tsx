"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap select-none font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "text-white bg-blue shadow-[var(--shadow-glow-primary)] hover:-translate-y-px hover:brightness-[1.07]",
        secondary:
          "bg-surface text-ink border border-line hover:border-line-strong shadow-[var(--shadow-xs)] hover:shadow-[var(--shadow-sm)]",
        ghost: "text-blue-deep hover:bg-blue/10",
        soft: "bg-blue/10 text-blue-deep hover:bg-blue/[0.16]",
        approve: "text-white bg-emerald hover:-translate-y-px hover:brightness-[1.05]",
        destructive: "text-white bg-rose hover:-translate-y-px hover:brightness-[1.05]",
        outline: "border border-line text-ink-2 hover:text-ink hover:border-line-strong",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        md: "h-10 px-[18px] text-[13px] rounded-xl",
        lg: "h-12 px-6 text-sm rounded-xl",
        icon: "h-9 w-9 rounded-xl",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

/**
 * Magnetic button — subtly leans toward the cursor with a spring, then snaps
 * back. Falls back to a plain Button under reduced-motion.
 */
export const MagneticButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, onMouseMove, onMouseLeave, style, ...props }, ref) => {
    const reduce = useReducedMotion();
    const [t, setT] = React.useState({ x: 0, y: 0 });

    if (reduce) return <Button ref={ref} className={className} variant={variant} size={size} {...props} />;

    return (
      <motion.button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        animate={{ x: t.x, y: t.y }}
        transition={{ type: "spring", stiffness: 320, damping: 18, mass: 0.4 }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setT({ x: (e.clientX - r.left - r.width / 2) * 0.28, y: (e.clientY - r.top - r.height / 2) * 0.4 });
          onMouseMove?.(e);
        }}
        onMouseLeave={(e) => {
          setT({ x: 0, y: 0 });
          onMouseLeave?.(e);
        }}
        style={style}
        {...(props as React.ComponentProps<typeof motion.button>)}
      />
    );
  },
);
MagneticButton.displayName = "MagneticButton";
