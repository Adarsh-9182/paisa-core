"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";

const KINDS = ["STOCK", "ETF", "MUTUAL_FUND", "FIXED_DEPOSIT", "GOLD", "BOND"] as const;

export function TradeForm({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = { side: "BUY", symbol: "", name: "", kind: "STOCK", date: asOf, qty: "", priceINR: "", feesINR: "" };
  const [form, setForm] = useState(empty);

  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const mut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/portfolio/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, feesINR: form.feesINR || undefined }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Trade rejected");
      }
    },
    onSuccess: () => {
      setForm({ ...empty });
      setOpen(false);
      router.refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Trade rejected"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus size={15} /> Record trade
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogTitle>Record a trade</DialogTitle>
        <DialogDescription>
          Buys move cash into Investments; sells realize P&amp;L. Every trade posts a balanced journal entry.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mut.mutate();
          }}
          className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <Field label="Side">
            <Select value={form.side} onChange={set("side")}>
              <option>BUY</option>
              <option>SELL</option>
            </Select>
          </Field>
          <Field label="Symbol">
            <Input value={form.symbol} onChange={set("symbol")} placeholder="NIFTYBEES" required />
          </Field>
          <Field label="Name" className="col-span-2">
            <Input value={form.name} onChange={set("name")} placeholder="Nippon India Nifty 50 BeES" required />
          </Field>
          <Field label="Type">
            <Select value={form.kind} onChange={set("kind")}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={set("date")} required />
          </Field>
          <Field label="Quantity">
            <Input value={form.qty} onChange={set("qty")} placeholder="100" required />
          </Field>
          <Field label="Price / unit (₹)">
            <Input value={form.priceINR} onChange={set("priceINR")} placeholder="255.40" required />
          </Field>
          <Field label="Fees (₹, optional)" className="col-span-2">
            <Input value={form.feesINR} onChange={set("feesINR")} placeholder="0" />
          </Field>

          {error && (
            <div className="col-span-full rounded-xl bg-rose/10 px-3 py-2 text-[12.5px] font-[600] text-rose">{error}</div>
          )}

          <div className="col-span-full mt-1 flex gap-2">
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Posting…" : "Post to ledger"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
