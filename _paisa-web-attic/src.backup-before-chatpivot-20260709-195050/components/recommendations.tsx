"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Lightbulb, Check, X, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface Rec {
  id: string;
  title: string;
  problem: string;
  reason: string;
  impact: string | null;
  estimatedSavings: string | null;
  confidence: string;
  risk: string;
  requiresApproval: boolean;
  status: string;
}

const riskTone: Record<string, "emerald" | "amber" | "rose" | "muted"> = {
  low: "emerald",
  medium: "amber",
  high: "rose",
};

const confLevel = (c: string) => (c.toLowerCase() === "high" ? 3 : c.toLowerCase() === "medium" ? 2 : 1);

function ConfidenceMeter({ confidence }: { confidence: string }) {
  const level = confLevel(confidence);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
      <span className="flex items-end gap-0.5">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={cn("w-1 rounded-full", n <= level ? "bg-chart-1" : "bg-track")}
            style={{ height: 5 + n * 3 }}
          />
        ))}
      </span>
      {confidence} confidence
    </span>
  );
}

function RecCard({ r }: { r: Rec }) {
  const router = useRouter();
  const decide = useMutation({
    mutationFn: async (action: "approve" | "dismiss") => {
      await fetch(`/api/recommendations/${r.id}/${action}`, { method: "POST" });
    },
    onSettled: () => router.refresh(),
  });

  const impacts = [r.impact ? `Impact ${r.impact}` : null, r.estimatedSavings ? `Saves ${r.estimatedSavings}/yr` : null]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-purple/12 text-purple">
            <Lightbulb size={15} strokeWidth={1.9} />
          </span>
          <b className="text-[13.5px] leading-snug text-ink">{r.title}</b>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge tone={riskTone[r.risk] ?? "muted"} size="sm">
            {r.risk} risk
          </Badge>
          {r.requiresApproval && (
            <Badge tone="blue" size="sm">
              <ShieldCheck size={11} /> approval
            </Badge>
          )}
          {r.status !== "pending" && <Badge tone="muted" size="sm">{r.status}</Badge>}
        </div>
      </div>

      <p className="mt-2 pl-[38px] text-[12.5px] leading-relaxed text-ink-2">
        {r.problem} {r.reason}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pl-[38px]">
        <ConfidenceMeter confidence={r.confidence} />
        {impacts && <span className="text-[12px] font-[600] tabnum text-ink">{impacts}</span>}
      </div>

      {r.status === "pending" && (
        <div className="mt-3 flex gap-2 pl-[38px]">
          <Button size="sm" variant="approve" disabled={decide.isPending} onClick={() => decide.mutate("approve")}>
            <Check size={14} /> Approve
          </Button>
          <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate("dismiss")}>
            <X size={14} /> Dismiss
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export function RecommendationList({ items, collapsible = false }: { items: Rec[]; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);

  return (
    <div>
      {collapsible && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : `Review ${items.length} recommendation${items.length === 1 ? "" : "s"}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.dispatchEvent(new CustomEvent("paisa:ask", { detail: "Summarize business performance" }))}
          >
            <Sparkles size={14} /> Ask about this
          </Button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2.5"
          >
            {items.length === 0 && (
              <div className="rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-ink-3">
                No recommendations right now — everything is in order.
              </div>
            )}
            {items.map((r) => (
              <RecCard key={r.id} r={r} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
