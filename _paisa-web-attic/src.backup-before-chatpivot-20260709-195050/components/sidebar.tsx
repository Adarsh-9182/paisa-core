"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { NAV } from "@/lib/nav";
import { BrandMark, Wordmark } from "@/components/app/brand";
import { HealthRing } from "@/components/app/health-ring";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Sidebar({
  health,
  userName,
}: {
  health: { score: number; grade: string };
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const initials =
    userName
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="hidden h-full flex-col border-r border-line-soft bg-surface/40 px-3 py-4 md:flex">
      <Link href="/" className="mb-5 flex items-center gap-2.5 px-2 no-underline">
        <BrandMark size={30} />
        <Wordmark />
        <Badge tone="blue" size="sm" className="ml-auto">
          core
        </Badge>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-[500] no-underline transition-colors",
                active ? "text-blue-deep" : "text-ink-2 hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-0 -z-0 rounded-xl border border-blue/20 bg-blue/10"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span
                className={cn(
                  "relative z-[1] grid h-7 w-7 place-items-center rounded-lg transition-colors",
                  active ? "text-blue-deep" : "text-ink-3 group-hover:text-ink-2",
                )}
              >
                <Icon size={17} strokeWidth={1.8} />
              </span>
              <span className="relative z-[1]">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Financial health */}
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-xs)]">
        <HealthRing score={health.score} size={54} stroke={5} />
        <div className="min-w-0">
          <div className="text-[10px] font-[650] uppercase tracking-[0.09em] text-ink-3">Financial health</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="font-display text-[15px] font-[650] text-ink">{health.grade}</span>
            <span className="text-[11px] text-ink-3">grade</span>
          </div>
        </div>
      </div>

      {/* User + theme */}
      <div className="flex items-center gap-2.5 rounded-2xl px-1.5 py-1.5">
        <div
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[12.5px] font-[650] text-white"
          style={{ background: "linear-gradient(150deg, #2f6bff, #6a49f2)", boxShadow: "0 3px 10px rgba(47,107,255,0.3)" }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-ink">{userName}</b>
          <span className="block truncate text-[11px] text-ink-3">Nimbus Labs Pvt Ltd</span>
        </div>
        <ThemeToggle className="h-8 w-8" />
        <button
          onClick={logout}
          title="Sign out"
          aria-label="Sign out"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-rose/10 hover:text-rose"
        >
          <LogOut size={15} strokeWidth={1.8} />
        </button>
      </div>
    </aside>
  );
}
