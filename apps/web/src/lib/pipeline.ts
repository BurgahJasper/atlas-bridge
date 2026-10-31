import path from 'node:path';
import type { Locale } from '@atlas/contracts';
import type {
  AnalysisJob,
  LearnerProgress,
  Milestone,
  MissionCheckRequest,
  MissionCheckResponse,
  Repository,
  Snapshot,
} from '@atlas/contracts';
import type { Store } from '@atlas/contracts';
import { createFileStore, createPgStore } from '@atlas/store';
import { createAutoProvider } from '@atlas/ai';
import { createFixtureAwarePipeline } from '@atlas/pipeline';
import { getEnv } from './env';
import { decodeSlug, encodeSlug } from './slug';
import type { AtlasPipeline } from './pipeline-types';
import { createWorkerPipeline } from './worker-pipeline';

/**
 * Web-side pipeline singleton (TRD §4 BFF layer).
 *
 * - The `@atlas/store` instance is created HERE so the web layer can also serve
 *   /api/progress and slug→repositoryId resolution without touching the
 *   pipeline package's internals.
 * - Embedded mode (demo default): createFixtureAwarePipeline with the curated
 *   octokit/request.js routed to the offline fixture client (TRD §10.1 ticket 2,
 *   §11 reliability) and labeled offline at the UI (FR-08).
 * - Worker mode: pipeline calls proxy over REST (lib/worker-pipeline).
 */

interface AtlasRuntime {
  pipeline: AtlasPipeline;
  store: Store;
  mode: 'embedded' | 'worker';
  /** AI provider ref for diagnostics only; duck-typed access to `offline`. */
  aiProvider: unknown | null;
}

export interface PipelineDiagnostics {
  ok: boolean;
  repositoryCount: number;
  cachedExplanations: number;
  aiOffline: boolean;
  mode: 'embedded' | 'worker';
  modelId: string;
  hosted: boolean;
}

const runtimeKey = '__atlas_web_pipeline__';

function buildRuntime(): AtlasRuntime {
  const env = getEnv();

  // Postgres is the durable production backend. Vercel serverless functions
  // cannot write to the deployed project directory, so use writable /tmp
  // as a best-effort demo fallback when no database has been configured.
  // /tmp is ephemeral and is NOT shared across function instances; configure
  // DATABASE_URL before relying on saved analyses or learner progress.
  const dataDir = process.env.ATLAS_DATA_DIR
    ?? (process.env.VERCEL
      ? path.join('/tmp', 'atlas-bridge')
      : path.resolve(process.cwd(), '..', '..', '.atlas-data'));
  const store: Store = env.databaseUrl
    ? createPgStore(env.databaseUrl as string)
    : createFileStore(path.join(dataDir, 'store.jsonl'));

  if (env.mode === 'worker' && env.workerUrl) {
    const pipeline = createWorkerPipeline({ baseUrl: env.workerUrl });
    return { pipeline, store, mode: 'worker', aiProvider: null };
  }

  // Embedded (demo default). createAutoProvider degrades cleanly to the
  // offline fixture provider when no key is configured; the web layer only
  // reads its `offline` flag for disclosure (never consumes secrets here).
  // The pinned demo stays deterministic and self-contained on serverless.
  // Live Gemma remains available for local/worker deployments; the public
  // serverless fixture uses the visibly labeled offline provider instead.
  const aiProvider = createAutoProvider({
    apiKey: process.env.VERCEL ? undefined : (env.geminiApiKey ?? undefined),
    localAdapterUrl: env.gemmaLocalAdapterUrl ?? undefined,
    modelId: env.gemmaModelId,
  });

  const pipeline = createFixtureAwarePipeline({
    fixtureName: 'octokit-request-js',
    store,
    ai: aiProvider,
    githubToken: env.githubToken ?? undefined,
  }) as unknown as AtlasPipeline;

  return { pipeline, store, mode: 'embedded', aiProvider };
}

function getRuntime(): AtlasRuntime {
  const g = globalThis as { [runtimeKey]?: AtlasRuntime };
  if (!g[runtimeKey]) {
    g[runtimeKey] = buildRuntime();
  }
  return g[runtimeKey]!;
}

export function getPipeline(): AtlasPipeline {
  return getRuntime().pipeline;
}

export function getStore(): Store {
  return getRuntime().store;
}

export function getPipelineMode(): 'embedded' | 'worker' {
  return getRuntime().mode;
}

/** Duck-typed read of the AI provider's offline disclosure flag (FR-08). */
export function isAiOffline(): boolean {
  const { aiProvider } = getRuntime();
  if (aiProvider && typeof aiProvider === 'object' && 'offline' in aiProvider) {
    return Boolean((aiProvider as { offline?: boolean }).offline);
  }
  return false;
}

export async function pipelineDiagnostics(): Promise<PipelineDiagnostics> {
  const env = getEnv();
  try {
    const health = await getPipeline().healthz();
    return {
      ok: health.ok,
      repositoryCount: health.repositoryCount,
      cachedExplanations: health.cachedExplanations,
      aiOffline: isAiOffline(),
      mode: env.mode,
      modelId: env.gemmaModelId,
      hosted: Boolean(env.geminiApiKey) || Boolean(env.gemmaLocalAdapterUrl),
    };
  } catch {
    return {
      ok: false,
      repositoryCount: 0,
      cachedExplanations: 0,
      aiOffline: isAiOffline(),
      mode: env.mode,
      modelId: env.gemmaModelId,
      hosted: Boolean(env.geminiApiKey),
    };
  }
}

// ── Slug → repositoryId resolution (TRD §2.2; pipeline lacks slug lookup) ───
// Strategy: 1) web-owned Store slug index (authoritative); then 2) overview()
// attempts over plausible ids (worker mode). No id-format assumption: the
// first id for which overview() succeeds wins.

export interface OverviewPayload {
  repository: Repository;
  snapshots: Snapshot[];
  milestones: Milestone[];
  coverage: string;
  warnings: string[];
}

export interface ResolvedOverview extends OverviewPayload {
  repositoryId: string;
}

async function tryOverview(repositoryId: string): Promise<OverviewPayload | null> {
  try {
    return await getPipeline().overview(repositoryId);
  } catch {
    return null;
  }
}

export async function getOverviewBySlug(
  slug: string,
  opts: { selfHeal?: boolean; locale?: Locale } = {},
): Promise<ResolvedOverview | null> {
  const ref = decodeSlug(slug);
  if (!ref) return null;

  const ids: string[] = [];
  try {
    const repo = await getStore().getRepositoryBySlug(ref.owner, ref.name);
    if (repo) ids.push(repo.id);
  } catch {
    // Store lookup is best-effort; worker mode still resolves via overview().
  }
  ids.push(encodeSlug(ref), `${ref.owner}/${ref.name}`, `${ref.owner}-${ref.name}`, slug);

  for (const id of ids) {
    const overview = await tryOverview(id);
    if (overview) return { ...overview, repositoryId: id };
  }

  // The curated demo is reconstructed locally from the committed fixture on
  // every cold serverless invocation. The analysis is awaited for this one
  // fixture (see analyzeJob); no database, background worker, or GitHub key.
  if (process.env.VERCEL && slug === 'octokit__request.js') {
    await getPipeline().analyze({
      url: 'https://github.com/octokit/request.js',
      locale: opts.locale ?? 'en',
    });
    for (const id of ids) {
      const overview = await tryOverview(id);
      if (overview) return { ...overview, repositoryId: id };
    }
  }

  // Self-heal (opt-in, bounded): kick off an analysis and poll briefly, then
  // retry resolution. Page renders gate ongoing progress client-side.
  if (opts.selfHeal) {
    const job = await startBoundedAnalyze(`https://github.com/${ref.owner}/${ref.name}`, opts.locale ?? 'en');
    if (job && job.status === 'done') {
      for (const id of ids) {
        const overview = await tryOverview(id);
        if (overview) return { ...overview, repositoryId: id };
      }
    }
  }
  return null;
}

/** Start an analysis and poll with a strict time budget; returns the latest job snapshot or null. */
export async function startBoundedAnalyze(url: string, locale: Locale, budgetMs = 12_000): Promise<AnalysisJob | null> {
  const pipeline = getPipeline();
  try {
    const { jobId } = await pipeline.analyze({ url, locale });
    const deadline = Date.now() + budgetMs;
    let latest: AnalysisJob | null = null;
    while (Date.now() < deadline) {
      latest = await pipeline.getJob(jobId);
      if (!latest || latest.status === 'done' || latest.status === 'error' || latest.status === 'cancelled') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return latest;
  } catch {
    return null;
  }
}

// ── Mission check + web-owned progress recording (FR-12) ────────────────────
// The worker endpoint list (TRD §6.1) has no progress-read endpoint, so the
// web layer keeps LearnerProgress in its own Store keyed by anonymous id and
// merges every validated step. Idempotent; embedded mode shares this store.

export async function checkAndRecord(input: {
  missionId: string;
  submission: MissionCheckRequest['submission'];
  userOrAnonymousId: string;
  locale: Locale;
}): Promise<MissionCheckResponse & { progress: LearnerProgress | null }> {
  const pipeline = getPipeline();
  const check = await pipeline.checkMissionStep({ missionId: input.missionId, submission: input.submission });

  let progress: LearnerProgress | null = null;
  try {
    const store = getStore();
    const existing = await store.getProgress(input.userOrAnonymousId, input.missionId);
    const completedSteps = new Set(existing?.completedSteps ?? []);
    const results = [...(existing?.results ?? [])];
    if (check.passed && check.completedStepId) {
      completedSteps.add(check.completedStepId);
      if (!results.some((r) => r.stepId === check.completedStepId)) {
        results.push({ stepId: check.completedStepId, passed: true, at: new Date().toISOString() });
      }
    }
    progress = {
      id: existing?.id ?? `lp_${input.userOrAnonymousId}_${input.missionId}`,
      userOrAnonymousId: input.userOrAnonymousId,
      missionId: input.missionId,
      locale: input.locale,
      completedSteps: [...completedSteps],
      results,
      updatedAt: new Date().toISOString(),
    };
    await store.putProgress(progress);
  } catch {
    // Progress persistence is best-effort; the validation result still returns.
    progress = null;
  }
  return { ...check, progress };
}
