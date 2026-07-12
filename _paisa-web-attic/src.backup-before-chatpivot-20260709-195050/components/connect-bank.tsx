"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import {
  Landmark,
  ShieldCheck,
  Lock,
  Check,
  RefreshCw,
  Link2,
  Loader2,
  ChevronRight,
  Info,
  Unplug,
  ExternalLink,
} from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";

interface Fip {
  fipId: string;
  fipName: string;
  hue: number;
}
interface Consent {
  fiTypes: string[];
  purpose: string;
  fromDate: string;
  toDate: string;
  frequency: string;
  expiry: string;
}
interface Summary {
  posted: number;
  duplicates: number;
  needsReview: number;
}
export interface Conn {
  id: string;
  fipName: string;
  maskedAccount: string;
  status: "active" | "revoked";
  connectedAt: string;
  lastSyncedAt: string;
  txnCount: number;
}

type Step = "pick" | "consent" | "importing" | "done";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right font-[550] text-ink">{value}</dd>
    </div>
  );
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function ConnectBankDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("pick");
  const [fips, setFips] = React.useState<Fip[]>([]);
  const [sandbox, setSandbox] = React.useState(true);
  const [mode, setMode] = React.useState<"inapp" | "redirect">("inapp");
  const [vua, setVua] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [handle, setHandle] = React.useState("");
  const [consent, setConsent] = React.useState<Consent | null>(null);
  const [fipName, setFipName] = React.useState("");
  const [result, setResult] = React.useState<{ summary: Summary; masked: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep("pick");
    setError(null);
    setResult(null);
    setConsent(null);
    fetch("/api/aa/connect")
      .then((r) => r.json())
      .then((d) => {
        setFips(d.fips ?? []);
        setSandbox(Boolean(d.sandbox));
        setMode(d.mode === "redirect" ? "redirect" : "inapp");
      })
      .catch(() => setError("Couldn't reach the Account Aggregator."));
  }, [open]);

  // Real (Setu) mode: hand the user off to the AA to approve, then they return
  // via /api/aa/callback.
  async function startRedirect() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/aa/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vua: vua.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok || !d.redirect) throw new Error(d.error ?? "Could not start consent");
      window.location.href = d.redirect;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  async function pick(fip: Fip) {
    setBusy(true);
    setError(null);
    setFipName(fip.fipName);
    try {
      const r = await fetch("/api/aa/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fipId: fip.fipId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start consent");
      setHandle(d.handle);
      setConsent(d.consent);
      setStep("consent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
    setBusy(false);
  }

  async function approve() {
    setBusy(true);
    setError(null);
    setStep("importing");
    try {
      const r = await fetch("/api/aa/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Fetch failed");
      setResult({ summary: d.summary, masked: d.connection.maskedAccount });
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setStep("consent");
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary">
            <Link2 size={15} /> Connect a bank
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {step === "pick" && (
          <>
            <DialogTitle>Connect a bank</DialogTitle>
            <DialogDescription>
              Through the RBI Account Aggregator network — read-only, consent-based, and revocable anytime.
            </DialogDescription>
            {sandbox && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber">
                <Info size={14} className="mt-px shrink-0" /> Sandbox mode — demo bank data. Set AA_CLIENT_ID / AA_CLIENT_SECRET to link real banks via Setu/Finvu.
              </div>
            )}
            {mode === "redirect" ? (
              <div className="mt-4">
                <div className="rounded-2xl border border-line bg-surface-2 p-4 text-[12.5px] leading-relaxed text-ink-2">
                  You&apos;ll be securely redirected to your Account Aggregator to pick your bank and approve read-only
                  access. Paisa never sees your login or password.
                </div>
                <Field label="Mobile linked to your AA (optional)" className="mt-3">
                  <Input value={vua} onChange={(e) => setVua(e.target.value)} placeholder="9999999999@onemoney" />
                </Field>
                <div className="mt-4">
                  <Button onClick={startRedirect} disabled={busy}>
                    {busy ? "Starting…" : (
                      <>
                        Continue to your bank <ExternalLink size={14} />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-2">
                {fips.map((f) => (
                  <button
                    key={f.fipId}
                    disabled={busy}
                    onClick={() => pick(f)}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-blue/40 hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span
                      className="grid h-9 w-9 place-items-center rounded-lg"
                      style={{ background: `hsl(${f.hue} 70% 50% / 0.15)`, color: `hsl(${f.hue} 65% 52%)` }}
                    >
                      <Landmark size={17} />
                    </span>
                    <span className="flex-1 text-[14px] font-[600] text-ink">{f.fipName}</span>
                    {busy ? (
                      <Loader2 size={16} className="animate-spin text-ink-3" />
                    ) : (
                      <ChevronRight size={16} className="text-ink-3" />
                    )}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="mt-3 text-[12px] font-[600] text-rose">{error}</p>}
          </>
        )}

        {step === "consent" && consent && (
          <>
            <DialogTitle>Approve data sharing</DialogTitle>
            <DialogDescription>{fipName} will share the following with Paisa. You stay in control.</DialogDescription>
            <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
              <div className="flex items-center gap-1.5 text-[12px] font-[650] text-emerald">
                <ShieldCheck size={14} /> Read-only access
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {consent.fiTypes.map((t) => (
                  <Badge key={t} tone="blue" size="sm">
                    {t}
                  </Badge>
                ))}
              </div>
              <dl className="mt-3.5 space-y-2 text-[12.5px]">
                <Row label="Purpose" value={consent.purpose} />
                <Row label="Period" value={`${consent.fromDate} → ${consent.toDate}`} />
                <Row label="Refresh" value={consent.frequency} />
                <Row label="Consent expires" value={consent.expiry} />
              </dl>
              <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] text-ink-3">
                <Lock size={12} /> No username or password is ever shared. Revoke anytime from Money.
              </div>
            </div>
            {error && <p className="mt-3 text-[12px] font-[600] text-rose">{error}</p>}
            <div className="mt-4 flex gap-2">
              <Button onClick={approve} disabled={busy}>
                <Check size={15} /> Approve &amp; connect
              </Button>
              <Button variant="secondary" onClick={() => setStep("pick")} disabled={busy}>
                Back
              </Button>
            </div>
          </>
        )}

        {step === "importing" && (
          <>
            <DialogTitle>Fetching statements</DialogTitle>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 size={28} className="animate-spin text-blue" />
              <div className="font-display text-[15px] font-[600] text-ink">Securely fetching statements…</div>
              <div className="text-[12px] text-ink-3">{fipName} · via Account Aggregator</div>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <DialogTitle>Bank connected</DialogTitle>
            <div className="flex flex-col items-center gap-2.5 py-5 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald/12 text-emerald">
                <Check size={24} />
              </span>
              <div className="font-display text-[16px] font-[650] text-ink">
                {fipName} {result.masked} connected
              </div>
              <div className="text-[13px] text-ink-2">
                {result.summary.posted} posted · {result.summary.needsReview} need review
                {result.summary.duplicates ? ` · ${result.summary.duplicates} skipped` : ""}
              </div>
              <div className="max-w-[40ch] text-[11.5px] leading-relaxed text-ink-3">
                Auto-categorised through your ledger — anything unclear is queued for review, never guessed.
              </div>
              <Button className="mt-2" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const AA_MESSAGES: Record<string, { tone: string; text: string }> = {
  connected: { tone: "bg-emerald/10 text-emerald", text: "Bank connected — transactions imported through your ledger." },
  rejected: { tone: "bg-amber/10 text-amber", text: "Consent was declined at your Account Aggregator." },
  pending: { tone: "bg-amber/10 text-amber", text: "Consent is still pending approval — try Sync shortly." },
  expired: { tone: "bg-rose/10 text-rose", text: "That consent link expired. Please try again." },
  nodata: { tone: "bg-amber/10 text-amber", text: "No accounts were shared." },
  failed: { tone: "bg-rose/10 text-rose", text: "Couldn't complete the bank connection." },
  revoked: { tone: "bg-amber/10 text-amber", text: "Consent was revoked." },
};

/** Shows the outcome of a redirect-mode (Setu) connection when we land back on Money. */
export function AaResultBanner() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = React.useState(false);
  const key = params.get("aa");
  const msg = key ? AA_MESSAGES[key] : null;
  if (!msg || dismissed) return null;
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-[12.5px] font-[600] ${msg.tone}`}>
      {msg.text}
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}

export function ConnectionsCard({ connections }: { connections: Conn[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(url: string, id: string) {
    setBusy(id);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: id }),
    });
    setBusy(null);
    router.refresh();
  }

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="No banks connected"
        description="Link a bank via the Account Aggregator so your CFO reasons over live transactions."
      >
        <div className="mt-3">
          <ConnectBankDialog />
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {connections.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue/10 text-blue-deep">
            <Landmark size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="truncate text-[13.5px] text-ink">
                {c.fipName} <span className="text-ink-3">{c.maskedAccount}</span>
              </b>
              <Badge tone={c.status === "active" ? "emerald" : "muted"} size="sm" dot={c.status === "active"}>
                {c.status === "active" ? "connected" : "revoked"}
              </Badge>
            </div>
            <div className="text-[11.5px] text-ink-3">
              {c.txnCount} transactions · synced {relTime(c.lastSyncedAt)}
            </div>
          </div>
          {c.status === "active" && (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => act("/api/aa/sync", c.id)}>
                <RefreshCw size={13} className={busy === c.id ? "animate-spin" : ""} /> Sync
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => act("/api/aa/revoke", c.id)}>
                <Unplug size={13} /> Revoke
              </Button>
            </div>
          )}
        </div>
      ))}
      <div className="pt-1">
        <ConnectBankDialog trigger={<Button size="sm" variant="ghost"><Link2 size={14} /> Connect another bank</Button>} />
      </div>
    </div>
  );
}
