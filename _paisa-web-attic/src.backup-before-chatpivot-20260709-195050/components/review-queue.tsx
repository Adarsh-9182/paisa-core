"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Check, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";

export interface ReviewLine {
  reference: string;
  date: string;
  description: string;
  amount: string;
  direction: "in" | "out";
}

export function ReviewQueue({
  lines,
  targets,
}: {
  lines: ReviewLine[];
  targets: { id: string; name: string; type: string }[];
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const router = useRouter();

  const mut = useMutation({
    mutationFn: async ({ reference, accountId }: { reference: string; accountId: string }) => {
      await fetch("/api/banking/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, accountId }),
      });
    },
    onSettled: () => {
      setPending(null);
      router.refresh();
    },
  });

  if (lines.length === 0)
    return <EmptyState icon={Inbox} title="Inbox zero" description="Every imported line is categorised — nothing waiting for review." />;

  return (
    <div className="flex flex-col">
      {lines.map((l) => {
        const candidates = targets.filter((t) => (l.direction === "out" ? t.type === "EXPENSE" : t.type === "REVENUE"));
        return (
          <div
            key={l.reference}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
          >
            <div>
              <b className="block text-[13px] text-ink">{l.description}</b>
              <span className="text-[11.5px] text-ink-3">
                {l.date} · <span className={l.direction === "out" ? "text-ink-2" : "text-emerald"}>{l.direction === "out" ? "−" : "+"}{l.amount}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Select
                className="h-9 w-[190px] text-[12.5px]"
                value={choice[l.reference] ?? ""}
                onChange={(e) => setChoice((c) => ({ ...c, [l.reference]: e.target.value }))}
              >
                <option value="">Pick an account…</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="approve"
                disabled={!choice[l.reference] || pending === l.reference}
                onClick={() => {
                  setPending(l.reference);
                  mut.mutate({ reference: l.reference, accountId: choice[l.reference] });
                }}
              >
                <Check size={14} /> Categorise
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
