import { ShieldCheck, Lock, ScrollText } from "lucide-react";
import { BrandMark } from "@/components/app/brand";

const PROOF = [
  { icon: ShieldCheck, text: "You approve every bank connection — consent-first, revocable anytime" },
  { icon: Lock, text: "Bank-grade encryption; your data is never sold" },
  { icon: ScrollText, text: "Every figure traced to your ledger — the AI never guesses" },
];

/** Split-screen auth: a dark brand showcase (left) + the theme-aware form (right). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — always dark, a mission-control showcase */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: "radial-gradient(120% 120% at 0% 0%, #141a2e 0%, #0a0b12 55%, #08090d 100%)" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 grid-texture opacity-[0.5]" />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-24 h-80 w-80 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(47,107,255,0.5), transparent 70%)", animation: "float 9s ease-in-out infinite" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 bottom-16 h-72 w-72 rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(106,73,242,0.5), transparent 70%)", animation: "float 11s ease-in-out infinite reverse" }}
        />

        <div className="relative flex items-center gap-2.5">
          <BrandMark size={34} />
          <span className="font-display text-[18px] font-[650] tracking-[-0.02em]">paisa</span>
          <span className="ml-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-[600] tracking-wide text-white/70">
            your money, explained
          </span>
        </div>

        <div className="relative max-w-[26ch]">
          <h2 className="font-display text-[34px] font-[600] leading-[1.12] tracking-[-0.03em]">
            One app for your entire money life.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-white/60">
            Paisa sees where your money goes, explains it in plain language, and tells you what to do
            next — an AI that shows its work and never invents a number.
          </p>
          <ul className="mt-8 space-y-3">
            {PROOF.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.text} className="flex items-center gap-3 text-[13px] text-white/80">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/8 text-[#7aa8ff]">
                    <Icon size={15} strokeWidth={1.9} />
                  </span>
                  {p.text}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="relative text-[11.5px] text-white/40">Consent-first · every figure verified against your ledger</div>
      </div>

      {/* Form panel */}
      <div className="app-canvas relative grid place-items-center px-4 py-10">
        <div className="relative z-[1] w-full max-w-[400px] animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
