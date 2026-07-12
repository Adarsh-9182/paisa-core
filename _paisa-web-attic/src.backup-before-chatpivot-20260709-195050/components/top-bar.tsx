"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Sparkles, Command as CommandIcon, ShieldCheck, X, CircleAlert } from "lucide-react";
import { BrandMark } from "@/components/app/brand";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { ThinkingDots, PulseDot } from "@/components/motion/thinking";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Msg {
  id: string;
  role: "user" | "ai";
  text: string;
  tools?: string[];
  verified?: boolean;
  pending?: boolean;
}

const SUGGESTIONS = [
  "How long can we survive?",
  "Show unpaid invoices",
  "Prepare GST",
  "What subscriptions should I cancel?",
  "Can I hire an engineer at ₹1 lakh/month?",
];

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const md = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/_(.+?)_/g, "<i>$1</i>")
    .replace(/^ {2}• /gm, "&nbsp;&nbsp;• ")
    .replace(/\n/g, "<br>");

const prettyTool = (t: string) => t.replace(/_/g, " ");

const REASONING_STEPS = [
  "Reading the ledger…",
  "Calling engine tools…",
  "Cross-checking every figure…",
  "Verifying against tool outputs…",
];

function Reasoning() {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % REASONING_STEPS.length), 1100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rounded-2xl rounded-bl-sm border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-center gap-2 text-[12px] font-[600] text-blue-deep">
        <Sparkles size={13} />
        Reasoning
        <ThinkingDots className="text-blue-deep" />
      </div>
      <div className="mt-2 h-3 w-2/3 rounded-full shimmer" />
      <div className="mt-1.5 h-3 w-5/6 rounded-full shimmer" />
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          className="mt-2 text-[11.5px] text-ink-3"
        >
          {REASONING_STEPS[i]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function TopBar() {
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [open, setOpen] = React.useState(false);
  const logRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const reduce = useReducedMotion();

  const chat = useMutation({
    mutationFn: async ({ q, history }: { q: string; history: { role: "user" | "assistant"; text: string }[] }) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      return (await res.json()) as { answer: string; tools: string[]; verified: boolean };
    },
  });

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages, reduce]);

  const send = React.useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
      setOpen(true);
      // Prior completed turns become the model's conversation memory.
      const history = messages
        .filter((m) => !m.pending && m.text)
        .slice(-12)
        .map((m) => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), text: m.text }));
      const aid = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: q },
        { id: aid, role: "ai", text: "", pending: true },
      ]);
      try {
        const data = await chat.mutateAsync({ q, history });
        setMessages((m) =>
          m.map((x) =>
            x.id === aid ? { ...x, text: data.answer, tools: data.tools, verified: data.verified, pending: false } : x,
          ),
        );
        router.refresh();
      } catch {
        setMessages((m) =>
          m.map((x) =>
            x.id === aid
              ? { ...x, text: "Something went wrong reaching the engine — try again.", pending: false, verified: false }
              : x,
          ),
        );
      }
    },
    [chat, router, messages],
  );

  React.useEffect(() => {
    const handler = (e: Event) => send((e as CustomEvent<string>).detail);
    window.addEventListener("paisa:ask", handler);
    return () => window.removeEventListener("paisa:ask", handler);
  }, [send]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
    setInput("");
  };

  const openPalette = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));

  return (
    <div className="glass sticky top-0 z-30 border-b border-line-soft">
      <header className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <BrandMark size={28} />
        </div>

        <form onSubmit={submit} className="relative flex flex-1 items-center">
          <Sparkles size={15} className="pointer-events-none absolute left-3.5 text-blue" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your AI CFO anything…"
            className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-24 text-[13px] text-ink outline-none transition-shadow placeholder:text-ink-3 focus:border-blue focus:shadow-[0_0_0_3px_var(--blue-soft)]"
          />
          <div className="absolute right-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={openPalette}
              className="hidden items-center gap-1 rounded-lg border border-line px-2 py-1 text-[10.5px] font-[600] text-ink-3 transition-colors hover:text-ink-2 sm:flex"
              aria-label="Open command palette"
            >
              <CommandIcon size={11} />K
            </button>
            <button
              type="submit"
              aria-label="Ask"
              className="grid h-7 w-7 place-items-center rounded-lg bg-blue text-white shadow-[var(--shadow-glow-primary)] transition-transform active:scale-95"
            >
              <ArrowUp size={15} />
            </button>
          </div>
        </form>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="hidden shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-[550] text-ink-2 transition-colors hover:text-ink sm:block"
          >
            {open ? "Hide" : "Chat"}
          </button>
        )}
        <ThemeToggle className="shrink-0 md:hidden" />
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 0.7, 0.16, 1] }}
            className="overflow-hidden border-t border-line-soft"
          >
            <div className="mx-auto max-w-[860px] px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={24} />
                  <b className="font-display text-[13.5px] text-ink">Paisa Intelligence</b>
                  <span className="flex items-center gap-1.5 text-[11px] text-emerald">
                    <PulseDot color="var(--emerald)" /> verified against your ledger
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid h-7 w-7 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <X size={15} />
                </button>
              </div>

              <div ref={logRef} className="flex max-h-[44vh] flex-col gap-3 overflow-y-auto pr-1">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <motion.div
                      key={m.id}
                      initial={reduce ? false : { opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="max-w-[85%] self-end rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[13px] leading-relaxed text-white"
                      style={{ background: "linear-gradient(150deg, #2f6bff, #6a49f2)" }}
                    >
                      {m.text}
                    </motion.div>
                  ) : m.pending ? (
                    <motion.div
                      key={m.id}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-[88%] self-start"
                    >
                      <Reasoning />
                    </motion.div>
                  ) : (
                    <motion.div
                      key={m.id}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-[88%] self-start rounded-2xl rounded-bl-sm border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink"
                    >
                      <span dangerouslySetInnerHTML={{ __html: md(m.text) }} />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {m.verified ? (
                          <Badge tone="emerald" size="sm">
                            <ShieldCheck size={11} /> verified
                          </Badge>
                        ) : (
                          <Badge tone="rose" size="sm">
                            <CircleAlert size={11} /> not verified
                          </Badge>
                        )}
                        {m.tools?.map((t) => (
                          <Badge key={t} tone="outline" size="sm" className="font-mono lowercase">
                            {prettyTool(t)}
                          </Badge>
                        ))}
                      </div>
                    </motion.div>
                  ),
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors hover:border-blue hover:text-blue-deep"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
