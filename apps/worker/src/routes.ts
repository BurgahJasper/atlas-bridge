import type { Express, Request, Response, NextFunction } from 'express';
import {
  AnalyzeRequestSchema,
  ExplanationRequestSchema,
  MissionCheckRequestSchema,
  ContributionPreviewRequestSchema,
  ContributionSubmitRequestSchema,
} from '@atlas/contracts';
import type { Pipeline } from '@atlas/pipeline';

/**
 * REST surface — exactly the TRD §6.1 v1 endpoint table plus /healthz.
 * All model + GitHub access happens server-side; no secrets are ever
 * reflected in responses (TRD §7).
 */
// TRD §6.1

export interface ServerLimits {
  /** Global per-IP cap (default 60 / 5 min). */
  globalMax?: number;
  /** Analyze cap per IP (default 5 / hour). */
  analyzeMax?: number;
  globalWindowMs?: number;
  analyzeWindowMs?: number;
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

function wrap(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

export function registerRoutes(
  app: Express,
  deps: { pipeline: Pipeline; limits?: ServerLimits },
  limiters: { global: Check; analyze: Check },
): void {
  const { pipeline } = deps;
  const json400 = (res: Response, detail: string): void => {
    res.status(400).json({ error: detail });
  };

  // POST /api/repos/analyze — validate, queue, return jobId (TRD §6.1)
  app.post(
    '/api/repos/analyze',
    wrap(async (req, res) => {
      // Validate first: malformed requests must not burn analyze quota (TRD §8).
      const parsed = AnalyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        json400(res, 'unsupported-url: expected { url, locale }');
        return;
      }
      const gate = limiters.analyze.check(ipOf(req));
      if (!gate.allowed) {
        res.status(429).json({ error: 'rate-limited', retryAfterMs: gate.retryAfterMs });
        return;
      }
      const { jobId } = await pipeline.analyze(parsed.data);
      res.status(202).json({ jobId });
    }),
  );

  // GET /api/jobs/:id (TRD §6.1)
  app.get(
    '/api/jobs/:id',
    wrap(async (req, res) => {
      const job = await pipeline.getJob(req.params['id'] ?? '');
      if (!job) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json(job);
    }),
  );

  // GET /api/repos/:repositoryId/overview (TRD §6.1)
  app.get(
    '/api/repos/:repositoryId/overview',
    wrap(async (req, res) => {
      res.json(await pipeline.overview(req.params['repositoryId'] ?? ''));
    }),
  );

  // GET /api/repos/:repositoryId/history (TRD §6.1)
  app.get(
    '/api/repos/:repositoryId/history',
    wrap(async (req, res) => {
      res.json(await pipeline.history(req.params['repositoryId'] ?? ''));
    }),
  );

  // GET /api/snapshots/:sha/graph?repositoryId= (TRD §6.1)
  app.get(
    '/api/snapshots/:sha/graph',
    wrap(async (req, res) => {
      const repositoryId = req.query['repositoryId'];
      if (typeof repositoryId !== 'string' || repositoryId.length === 0) {
        json400(res, 'repositoryId query parameter is required');
        return;
      }
      res.json(await pipeline.graph(repositoryId, req.params['sha'] ?? ''));
    }),
  );

  // POST /api/explanations (TRD §6.1) — never trusts arbitrary client evidence
  app.post(
    '/api/explanations',
    wrap(async (req, res) => {
      const parsed = ExplanationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        json400(res, 'invalid explanation request');
        return;
      }
      res.json(await pipeline.explain(parsed.data));
    }),
  );

  // GET /api/missions?repositoryId= (TRD §6.1)
  app.get(
    '/api/missions',
    wrap(async (req, res) => {
      const repositoryId = req.query['repositoryId'];
      if (typeof repositoryId !== 'string' || repositoryId.length === 0) {
        json400(res, 'repositoryId query parameter is required');
        return;
      }
      res.json(await pipeline.listMissions(repositoryId));
    }),
  );

  // POST /api/missions/:id/check (TRD §6.1) — deterministic evaluation
  app.post(
    '/api/missions/:id/check',
    wrap(async (req, res) => {
      const parsed = MissionCheckRequestSchema.safeParse({
        ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
        missionId: req.params['id'],
      });
      if (!parsed.success) {
        json400(res, 'invalid mission check request');
        return;
      }
      res.json(await pipeline.checkMissionStep(parsed.data));
    }),
  );

  // POST /api/contributions/preview (TRD §6.1)
  app.post(
    '/api/contributions/preview',
    wrap(async (req, res) => {
      const parsed = ContributionPreviewRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        json400(res, 'invalid contribution preview request');
        return;
      }
      res.json(await pipeline.previewContribution(parsed.data));
    }),
  );

  // POST /api/contributions/submit (TRD §6.1) — explicit confirmation gate
  app.post(
    '/api/contributions/submit',
    wrap(async (req, res) => {
      const parsed = ContributionSubmitRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        json400(res, 'invalid contribution submit request (confirmed: true required)');
        return;
      }
      res.json(await pipeline.submitContribution(parsed.data));
    }),
  );

  // GET /healthz — exempt from rate limiting (TRD §8 service health)
  app.get('/healthz', (_req, res) => {
    res.json(pipeline.healthz());
  });
}

export interface Check {
  check(key: string): { allowed: boolean; retryAfterMs: number };
}

function ipOf(req: Request): string {
  return req.ip ?? 'unknown';
}
