"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

const HREFS = ["/", "/ask", "/money", "/invoices", "/investments"];
const SHORT: Record<string, string> = { Overview: "Home", "Ask AI": "Ask" };

/** Bottom tab bar — the mobile navigation (sidebar is hidden < md). */
export function MobileTabBar() {
  const pathname = usePathname();
  const items = NAV.filter((n) => HREFS.includes(n.href));

  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-line-soft px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 md:hidden">
      {items.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-[550] no-underline transition-colors",
              active ? "text-blue-deep" : "text-ink-3",
            )}
          >
            <Icon size={19} strokeWidth={active ? 2.1 : 1.7} />
            {SHORT[n.label] ?? n.label}
          </Link>
        );
      })}
    </nav>
  );
}
