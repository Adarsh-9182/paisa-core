"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, Sparkles, MoonStar, Upload, FileDown, PlusCircle } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { NAV } from "@/lib/nav";

/** ⌘K / Ctrl+K palette: navigate · ask the AI · quick actions. */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const ask = (q: string) => {
    if (!q.trim()) return;
    setOpen(false);
    window.dispatchEvent(new CustomEvent("paisa:ask", { detail: q.trim() }));
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm data-[state=open]:animate-[fadeIn_0.18s_ease]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[15vh] z-[60] w-[92vw] max-w-[580px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-elevated shadow-[var(--shadow-lg)] data-[state=open]:animate-[popIn_0.2s_var(--ease-spring)]"
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command shouldFilter loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={16} className="shrink-0 text-ink-3" />
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search, navigate, or ask your AI CFO…"
                autoFocus
              />
              <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] font-[600] text-ink-3">ESC</kbd>
            </div>
            <CommandList>
              <CommandEmpty>No matches — press Enter to ask the AI instead.</CommandEmpty>

              {query.trim() && (
                <CommandGroup heading="Ask AI">
                  <CommandItem value={`ask ${query}`} onSelect={() => ask(query)}>
                    <Sparkles size={16} className="text-blue" />
                    <span className="truncate">
                      Ask: <span className="text-ink">“{query.trim()}”</span>
                    </span>
                    <span className="ml-auto text-[11px] text-ink-3">verified answer</span>
                  </CommandItem>
                </CommandGroup>
              )}

              <CommandGroup heading="Navigate">
                {NAV.map((n) => {
                  const Icon = n.icon;
                  return (
                    <CommandItem key={n.href} value={`go ${n.label} ${n.hint}`} onSelect={() => go(n.href)}>
                      <Icon size={16} className="text-ink-3" />
                      {n.label}
                      <span className="ml-auto text-[11px] text-ink-3">{n.hint}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>

              <CommandGroup heading="Quick actions">
                <CommandItem value="record trade investment" onSelect={() => go("/investments")}>
                  <PlusCircle size={16} className="text-ink-3" />
                  Record a trade
                </CommandItem>
                <CommandItem value="import bank statement" onSelect={() => go("/money")}>
                  <Upload size={16} className="text-ink-3" />
                  Import bank statement
                </CommandItem>
                <CommandItem value="generate report export" onSelect={() => go("/reports")}>
                  <FileDown size={16} className="text-ink-3" />
                  Generate a report
                </CommandItem>
                <CommandItem
                  value="toggle theme dark light appearance"
                  onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                >
                  <MoonStar size={16} className="text-ink-3" />
                  Toggle appearance
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
