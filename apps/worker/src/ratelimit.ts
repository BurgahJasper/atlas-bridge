/**
 * In-memory per-IP rate limiting (TRD §8 rate-limit SLO, §7 abuse throttle).
 * Pure factory so tests can drive it deterministically; keyed by client IP.
 * Redis-backed distributed limiting is deferred to v1.5 (TRD §10.2).
 */

export interface RateLimiter {
  check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number };
}

export interface RateLimiterOptions {
  max: number;
  windowMs: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const max = Math.max(options.max, 0);
  const windowMs = Math.max(options.windowMs, 1);
  const hits = new Map<string, { count: number; windowStart: number }>();
  return {
    check(key: string) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        entry = { count: 0, windowStart: now };
        hits.set(key, entry);
      }
      if (entry.count >= max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(windowMs - (now - entry.windowStart), 0),
        };
      }
      entry.count += 1;
      return { allowed: true, remaining: max - entry.count, retryAfterMs: 0 };
    },
  };
}
