import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { CommandPalette } from "@/components/app/command-palette";
import { MobileTabBar } from "@/components/app/mobile-tabbar";
import { PageTransition } from "@/components/motion/page-transition";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getBrief } from "@/lib/data";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { displayName } from "@/lib/users";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const brief = await getBrief();
  const jar = await cookies();
  const username = (await verifySessionToken(jar.get(SESSION_COOKIE)?.value)) ?? "adarsh";
  const userName = await displayName(username);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="app-canvas flex h-screen flex-col">
        <TopBar />
        <div className="relative z-[1] grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[248px_1fr]">
          <Sidebar health={{ score: brief.health.score, grade: brief.health.grade }} userName={userName} />
          <main className="overflow-y-auto px-5 py-6 pb-24 md:px-8 md:py-8 md:pb-10">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <MobileTabBar />
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
