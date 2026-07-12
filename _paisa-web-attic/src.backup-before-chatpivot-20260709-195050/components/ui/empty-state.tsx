import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-1 grid h-11 w-11 place-items-center rounded-2xl border border-line bg-surface-2 text-ink-3">
          <Icon size={18} strokeWidth={1.6} />
        </div>
      )}
      <p className="font-display text-[14px] font-[600] text-ink">{title}</p>
      {description && <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      {children}
    </div>
  );
}
