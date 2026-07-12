/**
 * Minimal in-memory rate limiter for the auth endpoints — enough to blunt
 * credential stuffing on a single instance. Sliding window per key
 * (IP + route). For multi-instance deployments this moves to the shared
 * store along with the rest of persistence.
 */

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

const hits = new Map<string, number[]>();

/** Returns true when the caller is over the limit. */
export function rateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    // Shed stale keys so the map cannot grow without bound.
    for (const [k, v] of hits) if (v.every((t) => t <= windowStart)) hits.delete(k);
  }
  return recent.length > MAX_ATTEMPTS;
}

/** Best-effort client key: first hop of x-forwarded-for, else a shared bucket. */
export function clientKey(request: Request, route: string): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : "local";
  return `${route}:${ip}`;
}
