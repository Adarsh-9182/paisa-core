import { formatINR, type Paise } from "paisa-core";

export const inr = (p: Paise): string => formatINR(p);

/** Compact Indian notation: ₹52.5L, ₹1.20 Cr, ₹80.0k */
export const inrCompact = (p: Paise): string => {
  const r = Number(p) / 100;
  const abs = Math.abs(r);
  const sign = r < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
};

export const rupees = (p: Paise): number => Number(p) / 100;

export const pctChange = (cur: bigint, prev: bigint): number | null =>
  prev !== 0n ? Number(((cur - prev) * 1000n) / prev) / 10 : null;

export const displayDate = (iso: string): string =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export const displayDateLong = (iso: string): string =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
