import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { getPipelineMode, pipelineDiagnostics } from '@/lib/pipeline';
import { handle, jsonOk } from '@/lib/api-utils';

// Web-side pipeline-status. In worker mode this proxies the worker's
// /healthz (with a hard timeout) and merges web-local diagnostics; embedded
// mode answers from the in-process pipeline + AI provider disclosure flag.
// Never returns secrets (TRD §7).

const HEALTH_TIMEOUT_MS = 4000;

interface HealthPayload {
  ok: boolean;
  repositoryCount: number;
  cachedExplanations: number;
  aiOffline?: boolean;
  mode?: string;
}

async function fetchWorkerHealth(url: string): Promise<HealthPayload | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as HealthPayload;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    const env = getEnv();
    const local = await pipelineDiagnostics();
    const payload: HealthPayload & { mode: string; modelId: string; hosted: boolean } = {
      ok: local.ok,
      repositoryCount: local.repositoryCount,
      cachedExplanations: local.cachedExplanations,
      aiOffline: local.aiOffline,
      mode: getPipelineMode(),
      modelId: local.modelId,
      hosted: local.hosted,
    };
    if (getPipelineMode() === 'worker' && env.workerUrl) {
      const workerHealth = await fetchWorkerHealth(`${env.workerUrl.replace(/\/$/, '')}/healthz`);
      if (workerHealth) {
        payload.ok = workerHealth.ok;
        payload.repositoryCount = workerHealth.repositoryCount;
        payload.cachedExplanations = workerHealth.cachedExplanations;
        payload.aiOffline = workerHealth.aiOffline ?? payload.aiOffline;
      } else {
        payload.ok = false;
      }
    }
    return jsonOk(payload);
  });
}
