import { describe, expect, it } from 'vitest';
import type { Explanation, Repository } from '@atlas/contracts';
import { createMemoryStore } from './memory.js';

const repo: Repository = {
  id: 'repo_test',
  provider: 'github',
  owner: 'OctoKit',
  name: 'Request.js',
  visibility: 'public',
  defaultBranch: 'main',
  licenseSpdx: 'MIT',
  description: null,
  stars: 1,
  lastIndexedAt: null,
};

describe('createMemoryStore', () => {
  it('stores repositories with case-insensitive slug lookup', async () => {
    const store = createMemoryStore();
    await store.putRepository(repo);
    expect((await store.getRepositoryBySlug('octokit', 'request.js'))?.id).toBe('repo_test');
    expect(await store.getRepositoryBySlug('nobody', 'nothing')).toBeNull();
  });

  it('resolves snapshots by full or shortened sha', async () => {
    const store = createMemoryStore();
    await store.putSnapshot({
      id: 'snap_1',
      repositoryId: 'repo_test',
      sha: 'abcdef1234567890',
      rootSha: 'abcdef1234567890',
      time: '2026-01-01T00:00:00Z',
      sourceScope: { commitLimit: 30, maxMilestoneFiles: 40, maxFileBytes: 48000 },
      manifestKey: 'm',
      status: 'ready',
    });
    expect((await store.getSnapshotBySha('repo_test', 'abcdef'))?.id).toBe('snap_1');
  });

  it('caches explanations by explicit key (TRD §12)', async () => {
    const store = createMemoryStore();
    const explanation = { id: 'exp_1' } as unknown as Explanation;
    await store.putExplanation('history:sha:timeline:en:beginner', explanation);
    expect((await store.getExplanation('history:sha:timeline:en:beginner'))?.id).toBe('exp_1');
    expect(await store.getExplanation('history:sha:timeline:es:beginner')).toBeNull();
  });

  it('merges learner progress by user+mission key', async () => {
    const store = createMemoryStore();
    await store.putProgress({
      id: 'lp_1',
      userOrAnonymousId: 'anon',
      missionId: 'm1',
      locale: 'es',
      completedSteps: ['s1'],
      results: [],
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect((await store.getProgress('anon', 'm1'))?.completedSteps).toEqual(['s1']);
    expect(await store.getProgress('anon', 'other')).toBeNull();
  });
});
