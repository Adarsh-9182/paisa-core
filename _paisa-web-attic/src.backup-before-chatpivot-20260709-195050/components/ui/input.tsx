import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-[13.5px] text-ink outline-none",
        "placeholder:text-ink-3 transition-shadow duration-150",
        "focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13.5px] text-ink outline-none",
      "transition-shadow duration-150 focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11.5px] font-[600] text-ink-2">{label}</span>
      {children}
    </label>
  );
}
