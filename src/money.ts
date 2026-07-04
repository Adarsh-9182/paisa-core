/**
 * Money — every rupee in Paisa is an integer count of paise, stored as a
 * branded bigint. Floating point never touches a financial figure.
 * Formatting happens only at the display boundary.
 */

declare const PAISE_BRAND: unique symbol;
export type Paise = bigint & { readonly [PAISE_BRAND]: true };

export const paise = (n: bigint | number): Paise => {
  if (typeof n === "number") {
    if (!Number.isInteger(n)) throw new MoneyError(`Non-integer paise amount: ${n}`);
    return BigInt(n) as Paise;
  }
  return n as Paise;
};

export const ZERO: Paise = paise(0n);

export class MoneyError extends Error {
  override name = "MoneyError";
}

export const add = (a: Paise, b: Paise): Paise => paise(a + b);
export const sub = (a: Paise, b: Paise): Paise => paise(a - b);
export const neg = (a: Paise): Paise => paise(-a);
export const abs = (a: Paise): Paise => (a < 0n ? neg(a) : a);
export const cmp = (a: Paise, b: Paise): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const sum = (xs: readonly Paise[]): Paise => xs.reduce<Paise>((acc, x) => add(acc, x), ZERO);

/** Multiply by a rational factor (num/den), rounding half away from zero. */
export const mulRatio = (a: Paise, num: bigint, den: bigint): Paise => {
  if (den === 0n) throw new MoneyError("Division by zero");
  const p = a * num;
  const q = p / den;
  const r = p % den;
  if (r === 0n) return paise(q);
  const roundUp = abs(paise(r * 2n)) >= (den < 0n ? -den : den);
  if (!roundUp) return paise(q);
  const sign = (p < 0n) !== (den < 0n) ? -1n : 1n;
  return paise(q + sign);
};

/** Parse "₹1,23,456.78", "123456.78", "-500" → Paise. */
export const parseINR = (input: string): Paise => {
  const cleaned = input.replace(/[₹,\s]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new MoneyError(`Cannot parse amount: "${input}"`);
  const sign = m[1] === "-" ? -1n : 1n;
  const rupees = BigInt(m[2]!);
  const fracRaw = m[3] ?? "0";
  const frac = BigInt(fracRaw.length === 1 ? fracRaw + "0" : fracRaw);
  return paise(sign * (rupees * 100n + frac));
};

/** Format paise → "₹1,23,456.78" with Indian digit grouping. */
export const formatINR = (a: Paise): string => {
  const negSign = a < 0n ? "-" : "";
  const v = a < 0n ? -a : a;
  const rupees = (v / 100n).toString();
  const fr = (v % 100n).toString().padStart(2, "0");
  let grouped: string;
  if (rupees.length <= 3) grouped = rupees;
  else {
    const head = rupees.slice(0, rupees.length - 3);
    const tail = rupees.slice(-3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return `${negSign}₹${grouped}.${fr}`;
};
