"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { BrandMark } from "@/components/app/brand";
import { GoogleButton, OrDivider } from "@/components/app/google-button";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, user, password }),
    });
    if (res.ok) {
      router.push("/welcome");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not create the account");
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <form
        onSubmit={submit}
        className="rounded-[24px] border border-line bg-surface p-7 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-6 flex items-center gap-2.5 lg:hidden">
          <BrandMark size={34} />
          <span className="font-display text-[20px] font-[650] tracking-[-0.02em] text-ink">paisa</span>
        </div>

        <h1 className="font-display text-[21px] font-[650] tracking-[-0.02em] text-ink">Create your account</h1>
        <p className="card-sub mb-5 mt-1 leading-relaxed">Two minutes to a clearer money life — private, consent-first, free.</p>

        <GoogleButton label="Sign up with Google" />
        <OrDivider label="or with a username" />

        <Field label="Your name" className="mb-3.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
        </Field>
        <Field label="Username" className="mb-3.5">
          <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" placeholder="letters, digits, . _ -" />
        </Field>
        <Field label="Password" className="mb-5">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="at least 8 characters"
          />
        </Field>

        {error && (
          <div className="animate-pop-in mb-4 rounded-xl bg-rose/10 px-3.5 py-2.5 text-[12.5px] font-[600] text-rose">
            {error}
          </div>
        )}

        <Button type="submit" disabled={busy || !name || !user || !password} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>

        <p className="mt-5 text-center text-[12px] text-ink-3">
          Already have an account?{" "}
          <Link href="/login" className="font-[650] text-blue-deep no-underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
