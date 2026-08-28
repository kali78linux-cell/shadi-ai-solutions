
/**
 * Shared in-memory rate limiter for API routes.
 *
 * Keyed by client IP (x-forwarded-for aware). Entries outside the window are
 * pruned on each check so the map cannot grow unbounded under load.
 *
 * NOTE: per-instance only. At multi-instance scale (Vercel multi-region /
 * several Node workers) move to a shared store (Upstash Redis / Supabase
 * table with TTL). Documented in PROJECT_STATUS.md scaling triggers.
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private lastPrune = 0;

  constructor(private limit: number, private windowMs: number) {}

  isAllowed(id: string): boolean {
    const now = Date.now();

    // Periodic full prune to keep memory bounded (every ~60s).
    if (now - this.lastPrune > 60_000) {
      for (const [key, stamps] of Array.from(this.requests)) {
        const alive = stamps.filter((t) => t > now - this.windowMs);
        if (alive.length === 0) this.requests.delete(key);
        else this.requests.set(key, alive);
      }
      this.lastPrune = now;
    }

    const windowStart = now - this.windowMs;
    const requestTimestamps = (this.requests.get(id) || []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (requestTimestamps.length >= this.limit) {
      return false;
    }

    requestTimestamps.push(now);
    this.requests.set(id, requestTimestamps);
    return true;
  }
}

/** Extracts a best-effort client identifier from proxy-aware headers. */
export function getClientId(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

