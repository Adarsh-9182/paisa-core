"use client";

import { Sparkles, Lightbulb, Bell, TrendingUp, Tag, ReceiptText, Banknote, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion/reveal";
import type { ActivityItem, ActivityTone } from "@/lib/data";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  ai: Sparkles,
  rec: Lightbulb,
  rule: Bell,
  trade: TrendingUp,
  mark: Tag,
  invoice: ReceiptText,
  bank: Banknote,
};

const TONE: Record<ActivityTone, string> = {
  blue: "text-chart-1 bg-blue/10",
  emerald: "text-emerald bg-emerald/10",
  amber: "text-amber bg-amber/10",
  rose: "text-rose bg-rose/10",
  purple: "text-purple bg-purple/12",
  cyan: "text-cyan bg-cyan/10",
  muted: "text-ink-3 bg-surface-2",
};

function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="py-6 text-center text-[12.5px] text-ink-3">No activity yet.</p>;
  }
  return (
    <Stagger className="relative flex flex-col" gap={0.045}>
      {/* connecting spine */}
      <span className="absolute bottom-3 left-[15px] top-3 w-px bg-line" aria-hidden />
      {items.map((it, i) => {
        const Icon = ICONS[it.kind] ?? Activity;
        return (
          <StaggerItem key={i} className="relative flex items-start gap-3 py-2">
            <span
              className={cn(
                "z-[1] mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-surface",
                TONE[it.tone],
              )}
            >
              <Icon size={14} strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-[550] text-ink">{it.title}</p>
                <span className="shrink-0 text-[10.5px] tabnum text-ink-3">{relTime(it.at)}</span>
              </div>
              {it.detail && <p className="truncate text-[11.5px] text-ink-3">{it.detail}</p>}
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
