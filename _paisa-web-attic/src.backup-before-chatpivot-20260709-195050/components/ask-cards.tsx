"use client";

import { useRouter } from "next/navigation";
import {
  TrendingDown,
  Timer,
  ReceiptText,
  Landmark,
  Scissors,
  UserPlus,
  LineChart,
  FileText,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { Stagger, StaggerItem } from "@/components/motion/reveal";

const QUESTIONS: Array<{ q: string; hint: string; icon: LucideIcon }> = [
  { q: "How much did we spend last month?", hint: "P&L by category", icon: TrendingDown },
  { q: "How long can we survive?", hint: "Burn rate & runway", icon: Timer },
  { q: "Show unpaid invoices", hint: "Overdue & aging", icon: ReceiptText },
  { q: "Prepare GST", hint: "Position & deadlines", icon: Landmark },
  { q: "What subscriptions should I cancel?", hint: "Recurring spend audit", icon: Scissors },
  { q: "Can I hire an engineer at ₹1 lakh/month?", hint: "Scenario simulation", icon: UserPlus },
  { q: "Predict next quarter cash", hint: "Forecast + assumptions", icon: LineChart },
  { q: "Summarize business performance", hint: "The morning brief", icon: FileText },
];

export function AskCards() {
  const router = useRouter();

  function ask(q: string) {
    window.dispatchEvent(new CustomEvent("paisa:ask", { detail: q }));
    setTimeout(() => router.refresh(), 2500);
  }

  return (
    <Stagger className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4" gap={0.04}>
      {QUESTIONS.map((item) => {
        const Icon = item.icon;
        return (
          <StaggerItem key={item.q}>
            <button
              onClick={() => ask(item.q)}
              className="group flex h-full w-full flex-col rounded-2xl border border-line bg-surface p-4 text-left shadow-[var(--shadow-xs)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue/40 hover:shadow-[var(--shadow-md)]"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue/10 text-blue-deep">
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                <ArrowUpRight size={15} className="text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <b className="text-[13px] leading-snug text-ink">{item.q}</b>
              <span className="mt-1 text-[11.5px] text-ink-3">{item.hint}</span>
            </button>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
