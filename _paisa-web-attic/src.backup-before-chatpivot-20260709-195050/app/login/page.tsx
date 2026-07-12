"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { BrandMark } from "@/components/app/brand";
import { GoogleButton, OrDivider } from "@/components/app/google-button";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

const OAUTH_ERRORS: Record<string, string> = {
  google_unconfigured: "Google sign-in isn't set up yet — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.",
  google_denied: "Google sign-in was cancelled.",
  google_state: "That Google sign-in link expired. Please try again.",
  google_email: "Your Google account email isn't verified.",
  google_failed: "Couldn't complete Google sign-in. Please try again.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const oauthError = OAUTH_ERRORS[params.get("error") ?? ""] ?? null;
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    if (res.ok) {
      router.push(params.get("next") ?? "/");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Login failed");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-[24px] border border-line bg-surface p-7 shadow-[var(--shadow-lg)]"
    >
      <div className="mb-6 flex items-center gap-2.5 lg:hidden">
        <BrandMark size={34} />
        <span className="font-display text-[20px] font-[650] tracking-[-0.02em] text-ink">paisa</span>
      </div>

      <h1 className="font-display text-[21px] font-[650] tracking-[-0.02em] text-ink">Welcome back</h1>
      <p className="card-sub mb-5 mt-1 leading-relaxed">Sign in to see where your money went — and what to do next.</p>

      {oauthError && (
        <div className="animate-pop-in mb-4 rounded-xl bg-rose/10 px-3.5 py-2.5 text-[12.5px] font-[600] text-rose">
          {oauthError}
        </div>
      )}

      <GoogleButton next={next} />
      <OrDivider label="or with a username" />

      <Field label="Username" className="mb-3.5">
        <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus />
      </Field>
      <Field label="Password" className="mb-5">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>

      {error && (
        <div className="animate-pop-in mb-4 rounded-xl bg-rose/10 px-3.5 py-2.5 text-[12.5px] font-[600] text-rose">
          {error}
        </div>
      )}

      <Button type="submit" disabled={busy || !user || !password} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      <p className="mt-5 text-center text-[12px] text-ink-3">
        New to Paisa?{" "}
        <Link href="/signup" className="font-[650] text-blue-deep no-underline">
          Create an account
        </Link>
      </p>
      <p className="mt-2 text-center text-[11.5px] text-ink-3">
        Demo credentials: <b className="text-ink-2">adarsh</b> / <b className="text-ink-2">paisa123</b>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
