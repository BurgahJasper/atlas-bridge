import { describe, expect, it } from 'vitest';
import type { AiProvider } from '@atlas/ai';
import { generateTimelineStory, buildHistoryBundle, type HistoryBundle } from './explanations.js';
import type { Repository } from '@atlas/contracts';

const SHA = 'a'.repeat(40);

function providerReturning(payload: unknown): AiProvider {
  return {
    modelId: 'test-model',
    offline: false,
    async generateText() {
      return { modelId: 'test-model', offline: false, text: JSON.stringify(payload) };
    },
    async generateJson<T>(): Promise<T> {
      return payload as T;
    },
  };
}

function bundle(): HistoryBundle {
  return buildHistoryBundle(
    { id: 'r', provider: 'github', owner: 'o', name: 'n', visibility: 'public', defaultBranch: 'main', licenseSpdx: null, description: null, stars: 0, lastIndexedAt: null } as Repository,
    [
      {
        id: 'ms1',
        repositoryId: 'r',
        snapshotId: 's1',
        sha: SHA,
        title: 'v1.0.0',
        rank: 0,
        changeKind: 'release',
        changeSummary: '',
        time: '2026-01-01T00:00:00Z',
        evidenceRefs: [{ sha: SHA }],
      },
    ],
    { changedFiles: new Map([[SHA, ['src/a.ts']]]), patchExcerpts: new Map(), commitSubjects: new Map() },
    [SHA],
    ['src/a.ts'],
    'readme',
  );
}

describe('generateTimelineStory output normalization (TRD §5.1/§6.2)', () => {
  it('accepts model JSON without a top-level claims array and flattens milestone claims', async () => {
    const story = await generateTimelineStory(
      providerReturning({
        summary: 'A release.',
        milestones: [
          {
            milestoneId: 'ms1',
            sha: SHA,
            title: 'v1.0.0',
            narrative: 'The first tagged release.',
            claims: [{ text: 'src/a.ts changed', basis: 'inferred', confidence: 'low', evidenceRefs: [{ sha: SHA, path: 'src/a.ts' }] }],
          },
        ],
        untranslatedTerms: ['fetch'],
      }),
      bundle(),
      'en',
    );
    expect(story.offline).toBe(false);
    expect(story.summary).toBe('A release.');
    expect(story.claims.length).toBe(1); // flattened from the milestone part
    expect(story.claims[0]!.evidenceRefs[0]!.path).toBe('src/a.ts');
    expect(story.untranslatedTerms).toEqual(['fetch']);
  });

  it('defaults missing per-milestone claims and untranslatedTerms instead of rejecting', async () => {
    const story = await generateTimelineStory(
      providerReturning({
        summary: 'Summary only.',
        milestones: [{ milestoneId: 'ms1', sha: SHA, title: 't', narrative: 'n' }],
      }),
      bundle(),
      'es',
    );
    expect(story.milestones[0]!.claims).toEqual([]);
    expect(story.untranslatedTerms).toEqual([]);
    expect(story.locale).toBe('es');
  });
});
