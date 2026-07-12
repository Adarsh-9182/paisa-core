"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

export function AddAccountForm({ asOf }: { asOf: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = { name: "", code: "", openingINR: "", openingDate: asOf };
  const [form, setForm] = useState(empty);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const mut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/banking/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code || undefined,
          openingINR: form.openingINR || undefined,
          openingDate: form.openingDate,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Could not add account");
      }
    },
    onSuccess: () => {
      setForm({ ...empty });
      setOpen(false);
      router.refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not add account"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setError(null); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus size={15} /> Add bank account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add a bank account</DialogTitle>
        <DialogDescription>
          Creates a cash-equivalent asset account. Any opening balance posts a balanced entry against Owner&apos;s Capital.
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mut.mutate();
          }}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <Field label="Account name" className="col-span-2">
            <Input value={form.name} onChange={set("name")} placeholder="HDFC Current Account" required />
          </Field>
          <Field label="Code (optional)">
            <Input value={form.code} onChange={set("code")} placeholder="auto (1011)" />
          </Field>
          <Field label="Opening balance (₹)">
            <Input value={form.openingINR} onChange={set("openingINR")} placeholder="0" />
          </Field>
          <Field label="As of" className="col-span-2">
            <Input type="date" value={form.openingDate} onChange={set("openingDate")} />
          </Field>

          {error && (
            <div className="col-span-2 rounded-xl bg-rose/10 px-3 py-2 text-[12.5px] font-[600] text-rose">{error}</div>
          )}

          <div className="col-span-2 mt-1 flex gap-2">
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? "Adding…" : "Add account"}
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
