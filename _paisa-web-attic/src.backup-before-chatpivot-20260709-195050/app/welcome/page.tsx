import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Landmark, Sparkles, LayoutDashboard, ShieldCheck, Lock, ScrollText } from "lucide-react";
import { BrandMark } from "@/components/app/brand";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { displayName } from "@/lib/users";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Landmark,
    step: "Step 1",
    title: "Connect a bank",
    body: "A consent-first flow — you approve exactly what paisa may see, and you can revoke it anytime. Your transactions arrive already categorised.",
    href: "/money",
    cta: "Connect securely",
  },
  {
    icon: Sparkles,
    step: "Step 2",
    title: "Ask anything about your money",
    body: "“Where did my money go last month?” “What subscriptions should I cancel?” Every answer comes from your ledger — never a guess.",
    href: "/ask",
    cta: "Ask paisa",
  },
  {
    icon: LayoutDashboard,
    step: "Step 3",
    title: "See your money story",
    body: "Income, spending, savings, and what to do next — one dashboard that explains itself in plain language.",
    href: "/",
    cta: "Open dashboard",
  },
];

const TRUST = [
  { icon: ShieldCheck, text: "Consent-first connections" },
  { icon: Lock, text: "Bank-grade encryption" },
  { icon: ScrollText, text: "Every figure auditable" },
];

export default async function WelcomePage() {
  const jar = await cookies();
  const username = (await verifySessionToken(jar.get(SESSION_COOKIE)?.value)) ?? "adarsh";
  const name = (await displayName(username)).split(" ")[0];

  return (
    <div className="app-canvas min-h-screen px-4 py-12">
      <div className="mx-auto max-w-[880px]">
        <Reveal>
          <div className="flex flex-col items-center text-center">
            <BrandMark size={46} />
            <h1 className="font-display mt-5 text-[30px] font-[650] tracking-[-0.03em] text-ink">
              Welcome to paisa, {name}
            </h1>
            <p className="mt-2 max-w-[42ch] text-[14.5px] leading-relaxed text-ink-2">
              Three steps to a money life that finally makes sense — where it goes, why, and what to do next.
            </p>
          </div>
        </Reveal>

        <Stagger className="mt-9 grid gap-3.5 md:grid-cols-3" delay={0.08}>
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <StaggerItem key={s.title}>
                <Link
                  href={s.href}
                  className="group flex h-full flex-col rounded-[20px] border border-line bg-surface p-6 no-underline shadow-[var(--shadow-xs)] transition-all hover:border-line-strong hover:shadow-[var(--shadow-lg)]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue/10 text-blue-deep">
                    <Icon size={20} strokeWidth={1.9} />
                  </span>
                  <span className="mt-4 text-[11px] font-[650] uppercase tracking-[0.08em] text-ink-3">{s.step}</span>
                  <span className="mt-1 font-display text-[16.5px] font-[650] tracking-[-0.01em] text-ink">{s.title}</span>
                  <span className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-2">{s.body}</span>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-[650] text-blue-deep">
                    {s.cta}
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>

        <Reveal delay={0.25}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-2.5">
            {TRUST.map((t) => {
              const Icon = t.icon;
              return (
                <span key={t.text} className="inline-flex items-center gap-2 text-[12px] font-[550] text-ink-3">
                  <Icon size={13.5} strokeWidth={1.9} className="text-emerald" />
                  {t.text}
                </span>
              );
            })}
          </div>
          <p className="mt-7 text-center text-[12.5px] text-ink-3">
            In a hurry?{" "}
            <Link href="/" className="font-[650] text-blue-deep no-underline">
              Skip to your dashboard
            </Link>
          </p>
        </Reveal>
      </div>
    </div>
  );
}
