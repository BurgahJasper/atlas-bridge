import { ApiError, errorFromStatus } from './errors';
import type { Milestone, Mission, MissionCheckResponse } from '@atlas/contracts';
import type { AtlasPipeline as AtlasPipelineShape } from './pipeline-types';

/**
 * REST adapter implementing the AtlasPipeline shape against apps/worker
 * (TRD §4: worker split to keep interactive requests responsive). Endpoint
 * paths mirror TRD §6.1 exactly. Non-2xx responses — including 429 rate
 * limits ('analysis paused') — surface as ApiError with stable codes.
 */

export type WorkerPipelineOptions = {
  baseUrl: string;
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}

async function workerFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(joinUrl(baseUrl, path), {
    ...init,
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return res;
}

async function workerJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await workerFetch(baseUrl, path, init);
  if (!res.ok) {
    let raw = '';
    try {
      raw = await res.text();
    } catch {
      raw = '';
    }
    throw errorFromStatus(res.status, raw.slice(0, 300));
  }
  return (await res.json()) as T;
}

/** Some endpoints may wrap arrays; normalize {milestones:[…]} / {missions:[…]} / bare arrays. */
function unwrapList<T>(value: unknown, keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const key of keys) {
      const v = (value as { [k: string]: unknown })[key];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

export function createWorkerPipeline(opts: WorkerPipelineOptions): AtlasPipelineShape {
  const base = opts.baseUrl;
  const post = (path: string, body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

  return {
    async analyze(input) {
      return workerJson(base, '/api/repos/analyze', post('/api/repos/analyze', input));
    },
    async getJob(id) {
      return workerJson(base, `/api/jobs/${encodeURIComponent(id)}`);
    },
    async overview(repositoryId) {
      return workerJson(base, `/api/repos/${encodeURIComponent(repositoryId)}/overview`);
    },
    async history(repositoryId) {
      const data = await workerJson<unknown>(base, `/api/repos/${encodeURIComponent(repositoryId)}/history`);
      return unwrapList<Milestone>(data, ['milestones', 'history']);
    },
    async graph(repositoryId, snapshotSha) {
      return workerJson(
        base,
        `/api/snapshots/${encodeURIComponent(snapshotSha)}/graph?repositoryId=${encodeURIComponent(repositoryId)}`,
      );
    },
    async explain(req) {
      return workerJson(base, '/api/explanations', post('/api/explanations', req));
    },
    async listMissions(repositoryId) {
      const data = await workerJson<unknown>(
        base,
        `/api/missions?repositoryId=${encodeURIComponent(repositoryId)}`,
      );
      return unwrapList<Mission>(data, ['missions']);
    },
    async checkMissionStep(request) {
      return workerJson(base, `/api/missions/${encodeURIComponent(request.missionId)}/check`, post('', request));
    },
    // Worker endpoint list (TRD §6.1) has no submit-progress endpoint; the web
    // layer records progress locally, so route submit through check semantics.
    async submitMissionStep(input) {
      const check = await workerJson<MissionCheckResponse>(base, `/api/missions/${encodeURIComponent(input.missionId)}/check`, post('', {
        missionId: input.missionId,
        submission: input.submission,
      }));
      return {
        passed: check.passed,
        completedStepId: check.completedStepId,
        progress: {
          id: `lp_${input.userOrAnonymousId}_${input.missionId}`,
          userOrAnonymousId: input.userOrAnonymousId,
          missionId: input.missionId,
          locale: 'en',
          completedSteps: check.completedStepId ? [check.completedStepId] : [],
          results: check.completedStepId
            ? [{ stepId: check.completedStepId, passed: check.passed, at: new Date().toISOString() }]
            : [],
          updatedAt: new Date().toISOString(),
        },
      };
    },
    async previewContribution(req) {
      return workerJson(base, '/api/contributions/preview', post('/api/contributions/preview', req));
    },
    async submitContribution(req) {
      return workerJson(base, '/api/contributions/submit', post('/api/contributions/submit', req));
    },
    async healthz() {
      try {
        return await workerJson(base, '/healthz');
      } catch (error) {
        if (error instanceof ApiError && error.code === 'not_found') {
          // Worker may expose diagnostics under /api/healthz instead.
          return workerJson(base, '/api/healthz');
        }
        throw error;
      }
    },
  };
}
