import { cn } from "@/lib/utils";

/**
 * Paisa mark — a graphite tile with an electric aperture glyph (a ring +
 * ascending stroke): precision + intelligence. No orange, no literal "P".
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center rounded-[9px]", className)}
      style={{
        width: size,
        height: size,
        background: "linear-gradient(150deg, #1b3a8f 0%, #2f6bff 45%, #6a49f2 100%)",
        boxShadow: "0 3px 12px rgba(47,107,255,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="7" stroke="white" strokeOpacity="0.95" strokeWidth="2" />
        <path d="M12 12 L18.5 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" fill="white" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[15px] font-[650] tracking-[-0.02em] text-ink", className)}>
      paisa
    </span>
  );
}
