import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '@atlas/store';
import { createPipeline } from './pipeline.js';
import { analyzeJob } from './analysis.js';
import { buildTinyFixture, TINY_FIXTURE_URL } from './test-fixtures.js';
import type { AnalysisJob, Store } from '@atlas/contracts';

async function waitForJob(store: Store, id: string): Promise<AnalysisJob> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const job = await store.getJob(id);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('analysis job did not settle in time');
}

describe('bounded analysis pipeline (TRD §4.2)', () => {
  it('runs the full stage ladder offline on a curated fixture', async () => {
    const store = createMemoryStore();
    const pipeline = createPipeline({ store, fixture: buildTinyFixture() });

    const { jobId } = await pipeline.analyze({ url: TINY_FIXTURE_URL, locale: 'en' });
    const job = await waitForJob(store, jobId);
    expect(job.status).toBe('done');
    expect(job.error).toBeUndefined();
    expect(job.progress).toBe(100);
    expect(job.stage).toBe('done');
    // Honest notes, not failures: the tiny fixture has no import edges and a
    // single milestone, so there is no real change to build a mission from.
    expect(job.warnings.some((w) => w.startsWith('no import relationships'))).toBe(true);
    expect(job.warnings.some((w) => w.startsWith('no changed files'))).toBe(true);
    expect(job.snapshotIds.length).toBe(1);

    // FR-01: repository identity persisted from fixture meta.
    expect(job.owner).toBe('octokit');
    const repositoryId = `repo_${job.owner}_${job.name}`;

    // FR-02/§6.1 overview: coverage scope + ready snapshots.
    const overview = await pipeline.overview(repositoryId);
    expect(overview.repository.defaultBranch).toBe('main');
    expect(overview.repository.visibility).toBe('public');
    expect(overview.snapshots.length).toBe(1);
    expect(overview.snapshots[0]!.status).toBe('ready');
    expect(overview.coverage).toContain('bounded: latest 30 commits');
    expect(overview.coverage).toContain('no code execution');
    expect(overview.warnings.some((w) => w.startsWith('no import relationships'))).toBe(true);

    // FR-03: milestone + change summary from deltaSummary.
    const history = await pipeline.history(repositoryId);
    expect(history.length).toBe(1);
    expect(history[0]!.sha).toBe('3333333333333333333333333333333333333333');
    expect(history[0]!.changeSummary.length).toBeGreaterThan(0);
    expect(history[0]!.changeKind).toBe('release');

    // FR-04: deterministic graph exposure is cache-backed per TRD §4.2.
    const graph = await pipeline.graph(repositoryId, history[0]!.sha);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.snapshotId).toBe(overview.snapshots[0]!.id);

    // FR-05: EN + ES stories were persisted; offline fallback is labeled.
    const versions = await Promise.all(
      (['en', 'es'] as const).map((locale) =>
        pipeline.explain({
          repositoryId,
          snapshotSha: history[0]!.sha,
          subject: 'timeline',
          task: 'history',
          locale,
          level: 'beginner',
        }),
      ),
    );
    for (const response of versions) {
      expect(response.kind).toBe('history');
      if (response.kind === 'history') {
        expect(response.story.offline).toBe(true);
        // Labeled offline output in either locale: mock narrative OR the
        // deterministic fallback (both are disclosed, never disguised).
        expect(response.story.summary).toMatch(/offline|sin conexión/i);
        for (const claim of response.story.claims) {
          expect(claim.evidenceRefs.length).toBeGreaterThan(0); // TRD §5.3
        }
      }
    }
    expect(pipeline.healthz()).toMatchObject({
      ok: true,
      repositoryCount: 1,
      cachedExplanations: 2,
    });

    // FR-06 needs a real change to ground a mission. A single-milestone window
    // has none, so no mission is invented (TRD §5.2); the job explains why.
    const missions = await pipeline.listMissions(repositoryId);
    expect(missions.length).toBe(0);
  });

  it('rejects unsafe/invalid URLs without throwing', async () => {
    const store = createMemoryStore();
    const pipeline = createPipeline({ store, fixture: buildTinyFixture() });
    const { jobId } = await pipeline.analyze({ url: 'not a url', locale: 'en' });
    const job = await waitForJob(store, jobId);
    expect(job.status).toBe('error');
    expect(job.error).toBe('unsupported-url');

    await expect(() => pipeline.overview('repo_none_nope')).rejects.toThrow(/not-found/);
  });

  it('surfaces snapshot resolution failures before touching the graph cache', async () => {
    const store = createMemoryStore();
    const pipeline = createPipeline({ store, fixture: buildTinyFixture() });
    await expect(() => pipeline.graph('repo_octokit_atlas-demo-repo', '0000000')).rejects.toThrow(
      /not-found: snapshot/,
    );
  });
});
