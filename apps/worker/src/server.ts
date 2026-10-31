import express from 'express';
import type { Express } from 'express';
import type { Store } from '@atlas/contracts';
import { GitHubError } from '@atlas/github';
import type { Pipeline } from '@atlas/pipeline';
import { createRateLimiter, type RateLimiter } from './ratelimit.js';
import { registerRoutes, type ServerLimits } from './routes.js';

/**
 * Worker HTTP server (TRD §4.1, §6.1, §7).
 * JSON only (1 MB body cap), CORS restricted to the web BFF origin, per-IP
 * rate limiting (60 req / 5 min; analyze capped at 5/hour), and a central
 * error mapper for GitHubError kinds (404 / 429 / 500).
 */
// TRD §6.1 / §7

export interface ServerDeps {
  store: Store;
  pipeline: Pipeline;
  corsOrigin?: string;
  limits?: ServerLimits;
}

interface LimiterWithRetry extends RateLimiter {
  check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number };
}

export function createServer(deps: ServerDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // CORS: exact-origin allowlist only (TRD §7 SSRF/security discipline).
  const origin = deps.corsOrigin ?? 'http://localhost:3000';
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const globalLimiter: LimiterWithRetry = createRateLimiter({
    max: deps.limits?.globalMax ?? 60,
    windowMs: deps.limits?.globalWindowMs ?? 5 * 60_000,
  });
  const analyzeLimiter: LimiterWithRetry = createRateLimiter({
    max: deps.limits?.analyzeMax ?? 5,
    windowMs: deps.limits?.analyzeWindowMs ?? 60 * 60_000,
  });

  // Global throttle; /healthz stays exempt so monitoring is never throttled.
  app.use((req, res, next) => {
    if (req.path === '/healthz') {
      next();
      return;
    }
    const gate = globalLimiter.check(req.ip ?? 'unknown');
    if (!gate.allowed) {
      res.status(429).json({ error: 'rate-limited', retryAfterMs: gate.retryAfterMs });
      return;
    }
    next();
  });

  registerRoutes(
    app,
    { pipeline: deps.pipeline, limits: deps.limits },
    { global: globalLimiter, analyze: analyzeLimiter },
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not-found' });
  });

  // Central error mapper (TRD §6.1 /api/jobs + §8 provider backoff).
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const kind = err instanceof GitHubError ? err.kind : undefined;
    const message = err instanceof Error ? err.message : String(err);
    if (kind === 'not-found' || message.startsWith('not-found:')) {
      // Pipeline "not-found:" prefix marks semantic 404s (TRD §2.4 states).
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if (kind === 'rate-limited') {
      const retryAfterMs = err instanceof GitHubError ? (err.retryAfterMs ?? 0) : 0;
      res.status(429).json({ error: 'rate-limited', retryAfterMs });
      return;
    }
    // Sanitized: no stack, no tokens, no source contents (TRD §7).
    res.status(500).json({ error: 'internal error', ...(process.env.NODE_ENV !== 'production' ? { detail: err instanceof Error ? err.message : String(err) } : {}) });
  });

  return app;
}
