"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, Field } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SAMPLE = [
  "2026-07-02, AWS subscription, -42000, utr-aws-jul",
  "2026-07-03, Payment from Meridian Retail, 450000, utr-mer-jul",
  "2026-07-04, Zomato team lunch, -1800, utr-zom-01",
].join("\n");

interface Result {
  posted: number;
  duplicates: number;
  needsReview: number;
}

export function ImportStatementForm({ accounts }: { accounts: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [csv, setCsv] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/banking/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId, csv }),
      });
      const body = (await res.json().catch(() => ({}))) as Result & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Import rejected");
      return body;
    },
    onSuccess: (body) => {
      setResult({ posted: body.posted, duplicates: body.duplicates, needsReview: body.needsReview });
      setCsv("");
      router.refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Import rejected"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setError(null); setResult(null); } }}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Upload size={15} /> Import statement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogTitle>Import a bank statement</DialogTitle>
        <DialogDescription>
          Amount is signed: negative is money out. Recognised lines auto-post; the rest go to Needs review. Re-imports are de-duplicated.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setResult(null);
            mut.mutate();
          }}
          className="mt-4 grid gap-3"
        >
          <Field label="Deposit account">
            <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statement rows — date, description, amount, reference (one per line)">
            <textarea
              className={cn(
                "min-h-[132px] w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-[12px] text-ink outline-none",
                "placeholder:text-ink-3 transition-shadow focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]",
              )}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              placeholder={SAMPLE}
              required
            />
          </Field>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-[11.5px] font-[600] text-blue-deep underline-offset-2 hover:underline"
              onClick={() => setCsv(SAMPLE)}
            >
              Load sample
            </button>
          </div>

          {error && (
            <div className="rounded-xl bg-rose/10 px-3 py-2 text-[12.5px] font-[600] text-rose">{error}</div>
          )}
          {result && (
            <div className="rounded-xl bg-emerald/10 px-3 py-2 text-[12.5px] font-[600] text-emerald">
              {result.posted} posted · {result.duplicates} duplicate{result.duplicates === 1 ? "" : "s"} · {result.needsReview} sent to review
            </div>
          )}

          <div className="mt-1 flex gap-2">
            <Button type="submit" disabled={mut.isPending || !bankAccountId}>
              {mut.isPending ? "Importing…" : "Import"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
