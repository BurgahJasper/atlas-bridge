import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '@atlas/store';
import type { AnalysisJob } from '@atlas/contracts';
import { createPipeline } from './pipeline.js';

function staleJob(): AnalysisJob {
  return {
    id: 'job_stuck',
    kind: 'analyze',
    repoUrl: 'https://github.com/o/r',
    owner: 'o',
    name: 'r',
    locale: 'en',
    status: 'queued',
    stage: 'ingest-graphs',
    progress: 42,
    snapshotIds: [],
    warnings: [],
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(), // 10 min ago
    updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
}

describe('job watchdog (TRD §8: no indefinite spinner)', () => {
  it('flips a job stuck in ingest-graphs to a retryable timeout error', async () => {
    const store = createMemoryStore();
    await store.putJob(staleJob());
    const pipeline = createPipeline({ store });
    const job = await pipeline.getJob('job_stuck');
    expect(job?.status).toBe('error');
    expect(job?.error).toMatch(/^timeout:/);
    // Terminal state is persisted, not just computed for this read.
    expect((await store.getJob('job_stuck'))?.status).toBe('error');
  });

  it('leaves fresh running jobs alone', async () => {
    const store = createMemoryStore();
    const fresh = { ...staleJob(), id: 'job_fresh', createdAt: new Date().toISOString() };
    await store.putJob(fresh);
    const pipeline = createPipeline({ store });
    expect((await pipeline.getJob('job_fresh'))?.status).toBe('queued');
  });
});
