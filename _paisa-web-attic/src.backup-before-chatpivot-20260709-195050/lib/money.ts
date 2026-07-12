/** Client-safe number formatters (number-based mirror of format.ts). */

export function compactINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function groupedINR(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function plainInt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}
