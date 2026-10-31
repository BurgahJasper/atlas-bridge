import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './ratelimit.js';

describe('rate limiter (TRD §8, §7)', () => {
  it('allows up to max hits per window then blocks with retryAfterMs', () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    expect(limiter.check('ip1').allowed).toBe(true);
    expect(limiter.check('ip1').allowed).toBe(true);
    const denied = limiter.check('ip1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('resets a key once its window elapses', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 10 });
    expect(limiter.check('x').allowed).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.check('x').allowed).toBe(true);
        resolve();
      }, 15);
    });
  });
});
