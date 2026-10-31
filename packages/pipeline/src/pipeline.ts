import { createAutoProvider } from '@atlas/ai';
import { createGitHubClient, createFixtureClient, parseGitHubRepoUrl } from '@atlas/github';
import {
  newId,
  type AnalysisJob,
  type ContributionPreviewRequest,
  type ContributionPreviewResponse,
  type ContributionSubmitRequest,
  type ExplanationRequest,
  type ExplanationResponse,
  type GraphSnapshot,
  type LearnerProgress,
  type Locale,
  type Milestone,
  type Mission,
  type MissionCheckRequest,
  type MissionCheckResponse,
  type Repository,
  type Snapshot,
  type Store,
} from '@atlas/contracts';
import { checkMission, mergeProgress } from '@atlas/learning';
import type { PipelineContext, PipelineOptionsInput } from './context.js';
import { analyzeJob } from './analysis.js';
import { createExplanationService, sortForHistory } from './explanations.js';
import { createContributionService } from './contribution.js';

/**
 * Orchestration core (TRD §4, §6.1). Owns the REST surface semantics used by
 * apps/worker; every method is store-backed so callers (web BFF or worker)
 * can read the same facts.
 */
// TRD §6.1 (endpoint table)

export interface Pipeline {
  /** POST /api/repos/analyze — enqueue & run bounded analysis (async). */
  analyze(input: { url: string; locale: Locale }): Promise<{ jobId: string }>;
  /** GET /api/jobs/:id */
  getJob(id: string): Promise<AnalysisJob | null>;
  /** GET /api/repos/:id/overview */
  overview(
    repositoryId: string,
  ): Promise<{
    repository: Repository;
    snapshots: Snapshot[];
    milestones: Milestone[];
    coverage: string;
    warnings: string[];
  }>;
  /** GET /api/repos/:id/history */
  history(repositoryId: string): Promise<Milestone[]>;
  /** GET /api/snapshots/:sha/graph */
  graph(repositoryId: string, snapshotSha: string): Promise<GraphSnapshot>;
  /** POST /api/explanations — history OR node explanations (cached). */
  explain(input: ExplanationRequest): Promise<ExplanationResponse>;
  /** GET /api/missions?repositoryId= */
  listMissions(repositoryId: string): Promise<Mission[]>;
  /** POST /api/missions/:id/check — deterministic validation (FR-07). */
  checkMissionStep(request: MissionCheckRequest): Promise<MissionCheckResponse>;
  /** Submit a validated step and persist learner progress (FR-12). */
  submitMissionStep(input: {
    userOrAnonymousId: string;
    missionId: string;
    submission: MissionCheckRequest['submission'];
    locale: Locale;
  }): Promise<{ passed: boolean; completedStepId: string | null; progress: LearnerProgress }>;
  /** POST /api/contributions/preview */
  previewContribution(input: ContributionPreviewRequest): Promise<ContributionPreviewResponse>;
  /** POST /api/contributions/submit */
  submitContribution(
    input: ContributionSubmitRequest,
  ): Promise<{ prUrl?: string; status: 'submitted' | 'reviewed' | 'failed'; note?: string }>;
  /** GET /healthz — process-local demo counters. */
  healthz():
    | { ok: true; repositoryCount: number; cachedExplanations: number }
    | { ok: false; reason: string };
}

export type { PipelineOptionsInput as PipelineOptions };

/** Hard ceiling for any analysis job before getJob reports a timeout (§8). */
const JOB_WATCHDOG_MS = 180_000;

/**
 * Default `ai` = createAutoProvider({}) so the pipeline always works: hosted
 * Gemma when keys exist, a clearly labeled offline mock otherwise (TRD §11).
 */
export function createPipeline(options: PipelineOptionsInput): Pipeline {
  const ai = options.ai ?? createAutoProvider({});
  const liveClient = options.github ?? createGitHubClient({ token: options.githubToken });
  const fixture = options.fixture ?? null;
  const fixtureClient = fixture ? createFixtureClient(fixture) : null;

  const ctx: PipelineContext = {
    store: options.store,
    ai,
    liveClient,
    fixture,
    fixtureClient,
    githubWriteToken: options.githubWriteToken,
    // Fixture routing (TRD §10.1.2): fixture data only for the fixture repo.
    clientFor(owner, name) {
      const isFixtureRepo =
        fixture !== null && fixture.repository.owner === owner && fixture.repository.name === name;
      return isFixtureRepo && fixtureClient ? fixtureClient : liveClient;
    },
    graphCache: new Map(),
    compareCache: new Map(),
    counters: { repositoryIds: new Set(), explanationKeys: new Set() },
  };

  const explanations = createExplanationService(ctx);
  const contributions = createContributionService(ctx);

  return {
    analyze(input) {
      return analyzeJob(ctx, input);
    },

    async getJob(id) {
      const job = await ctx.store.getJob(id);
      if (!job) return null;
      // Watchdog (TRD §8: "timeout + partial recovery rather than indefinite
      // spinner"). A job that never reaches a terminal state within the hard
      // budget flips to a retryable error — the UI must never hang on a stage.
      if (
        (job.status === 'queued' || job.status === 'running') &&
        Date.now() - new Date(job.createdAt).getTime() > JOB_WATCHDOG_MS
      ) {
        job.status = 'error';
        job.error = `timeout: analysis exceeded ${Math.round(JOB_WATCHDOG_MS / 1000)}s without completing; retry (large repos are analyzed as bounded slices)`;
        job.updatedAt = new Date().toISOString();
        await ctx.store.putJob(job);
      }
      return job;
    },

    async overview(repositoryId) {
      const repository = await ctx.store.getRepository(repositoryId);
      if (!repository) throw new Error(`not-found: repository ${repositoryId}`);
      const snapshots = (await ctx.store.getSnapshotsForRepository(repositoryId)).sort(
        (a, b) => a.time.localeCompare(b.time),
      );
      const milestones = sortForHistory(await ctx.store.getMilestones(repositoryId));
      const scope = snapshots[0]?.sourceScope;
      // FR-02 snippet attached to every response: explicit analysis scope.
      const coverage = scope
        ? `bounded: latest ${scope.commitLimit} commits, 3–5 milestones, ≤${scope.maxMilestoneFiles} files/milestone, ≤${scope.maxFileBytes} bytes/file, no code execution`
        : 'bounded analysis';
      const warnings = warningsFor(snapshots);
      return { repository, snapshots, milestones, coverage, warnings };
    },

    async history(repositoryId) {
      const milestones = await ctx.store.getMilestones(repositoryId);
      if (milestones.length === 0) {
        const exists = await ctx.store.getRepository(repositoryId);
        if (!exists) throw new Error(`not-found: repository ${repositoryId}`);
      }
      return sortForHistory(milestones);
    },

    async graph(repositoryId, snapshotSha) {
      // Accept full or shortened SHAs; resolve via the snapshot registry.
      const snapshot = await ctx.store.getSnapshotBySha(repositoryId, snapshotSha);
      if (!snapshot) throw new Error(`not-found: snapshot ${snapshotSha}`);
      const graph =
        ctx.graphCache.get(`${repositoryId}:${snapshot.sha}`) ??
        (await ctx.store.getGraph(`${repositoryId}:${snapshot.sha}`));
      if (!graph) {
        // TRD §4.2: process-local cache; worker restarts lose graphs by design.
        throw new Error('graph not loaded for this snapshot in this process; re-run analysis');
      }
      return graph;
    },

    explain(input) {
      return explanations.explain(input);
    },

    listMissions(repositoryId) {
      return ctx.store.getMissions(repositoryId);
    },

    async checkMissionStep(request: MissionCheckRequest): Promise<MissionCheckResponse> {
      // TRD FR-07: validation is fully deterministic (@atlas/learning engine).
      const mission = await ctx.store.getMission(request.missionId);
      if (!mission) throw new Error(`not-found: mission ${request.missionId}`);
      return checkMission(mission, request);
    },

    async submitMissionStep(input) {
      const mission = await ctx.store.getMission(input.missionId);
      if (!mission) throw new Error(`not-found: mission ${input.missionId}`);
      const request: MissionCheckRequest = {
        missionId: input.missionId,
        submission: input.submission,
      };
      // TRD FR-07: deterministic engine scoring; no model self-evaluation.
      const check = await checkMission(mission, request);
      let progress = await ctx.store.getProgress(input.userOrAnonymousId, input.missionId);
      if (check.completedStepId) {
        // Completed steps are unioned into persisted progress (FR-12).
        progress = await mergeLatest(
          ctx.store,
          progress,
          input.userOrAnonymousId,
          input.missionId,
          input.locale,
          check.completedStepId,
        );
      }
      return {
        passed: check.passed,
        completedStepId: check.completedStepId,
        progress:
          progress ?? {
            id: newId('prog'),
            userOrAnonymousId: input.userOrAnonymousId,
            missionId: input.missionId,
            locale: input.locale,
            completedSteps: [],
            results: [],
            updatedAt: new Date().toISOString(),
          },
      };
    },

    previewContribution(input) {
      return contributions.previewContribution(input);
    },

    submitContribution(input) {
      return contributions.submitContribution(input);
    },

    healthz() {
      return {
        ok: true as const,
        repositoryCount: ctx.counters.repositoryIds.size,
        cachedExplanations: ctx.counters.explanationKeys.size,
      };
    },
  };
}

async function mergeLatest(
  store: Store,
  prev: LearnerProgress | null,
  userOrAnonymousId: string,
  missionId: string,
  locale: Locale,
  passedStepId: string,
): Promise<LearnerProgress> {
  const next = mergeProgress(prev, { userOrAnonymousId, missionId, locale, passedStepId });
  await store.putProgress(next);
  return next;
}

function warningsFor(snapshots: Snapshot[]): string[] {
  const warnings: string[] = [];
  if (snapshots.some((s) => s.status === 'rate-limited')) {
    warnings.push('analysis hit GitHub rate limiting; some milestones may be incomplete');
  }
  if (snapshots.some((s) => s.status === 'partial')) {
    warnings.push('some milestones could not be fully ingested');
  }
  if (snapshots.some((s) => s.status === 'stale')) {
    warnings.push('snapshot data is stale; re-run analysis to refresh');
  }
  for (const snapshot of snapshots) {
    for (const note of snapshot.notes ?? []) {
      if (!warnings.includes(note)) warnings.push(note);
    }
  }
  return warnings;
}
