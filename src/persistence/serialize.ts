/**
 * bigint-safe JSON for the action log.
 *
 * Money is a bigint everywhere in Paisa, and JSON has no bigint. Rather
 * than lose precision at the storage boundary — the one place a financial
 * system must not — amounts are tagged and restored exactly.
 *
 * The tag is explicit ({"$paise":"12345"}) rather than a bare string,
 * because a bare string is indistinguishable from a legitimate string
 * field and the ambiguity would surface as a wrong number years later.
 */

export const PAISE_TAG = "$paise";

export type Serialized = unknown;

/** Encode a value for storage, tagging every bigint. */
export const encode = (value: unknown): Serialized => {
  if (typeof value === "bigint") return { [PAISE_TAG]: value.toString() };
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Map) return { $map: [...value.entries()].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Set) return { $set: [...value.values()].map(encode) };
  if (typeof value === "object") {
    const out: Record<string, Serialized> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = encode(v);
    return out;
  }
  return value;
};

/** Decode a stored value, restoring every tagged bigint. */
export const decode = (value: Serialized): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  const obj = value as Record<string, unknown>;
  if (typeof obj[PAISE_TAG] === "string") return BigInt(obj[PAISE_TAG] as string);
  if (Array.isArray(obj.$map)) return new Map((obj.$map as [unknown, unknown][]).map(([k, v]) => [decode(k), decode(v)]));
  if (Array.isArray(obj.$set)) return new Set((obj.$set as unknown[]).map(decode));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = decode(v);
  return out;
};

export const toJson = (value: unknown): string => JSON.stringify(encode(value));
export const fromJson = (text: string): unknown => decode(JSON.parse(text));
