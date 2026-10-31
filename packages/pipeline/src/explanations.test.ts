import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '@atlas/store';
import type { Claim, EvidenceRef, TimelineStory } from '@atlas/contracts';
import { createPipeline } from './pipeline.js';
import {
  fallbackTimelineStory,
  filterUnverifiedStory,
} from './explanations.js';
import { buildTinyFixture, TINY_FIXTURE_URL, SHA_C } from './test-fixtures.js';
import type { AnalysisJob, Store } from '@atlas/contracts';

async function waitForJob(store: Store, id: string): Promise<AnalysisJob> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const job = await store.getJob(id);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('job timeout');
}

function claim(refs: EvidenceRef[], text = 'c'): Claim {
  return { text, basis: 'inferred', confidence: 'low', evidenceRefs: refs };
}

const shas = new Set(['1111111111111111111111111111111111111111']);
const paths = new Set(['src/index.ts']);

describe('citation validation (TRD §5.2, §5.3)', () => {
  it('strips refs that do not resolve to fetched facts', () => {
    const story: TimelineStory = {
      snapshotSha: SHA_C,
      milestones: [
        {
          milestoneId: 'ms',
          sha: SHA_C,
          title: 't',
          narrative: 'n',
          claims: [
            claim([
              { sha: '1111111111111111111111111111111111111111', path: 'src/index.ts' },
              { sha: '9999999999999999999999999999999999999999' }, // unknown sha
              { sha: '1111111111111111111111111111111111111111', path: 'src/ghost.ts' }, // unknown path
            ]),
            claim([{ sha: '9999999999999999999999999999999999999999' }]), // fully invalid
          ],
        },
      ],
      locale: 'en',
      summary: 's',
      claims: [],
      untranslatedTerms: [],
      offline: false,
    };
    const filtered = filterUnverifiedStory(story, shas, paths);
    const partClaims = filtered.milestones[0]!.claims;
    expect(partClaims.length).toBe(1);
    expect(partClaims[0]!.evidenceRefs).toEqual([
      { sha: '1111111111111111111111111111111111111111', path: 'src/index.ts' },
    ]);
  });

  it('keeps sha-only refs when the path inventory is empty', () => {
    const story: TimelineStory = {
      snapshotSha: SHA_C,
      milestones: [],
      locale: 'es',
      summary: 's',
      claims: [claim([{ sha: '1111111111111111111111111111111111111111' }])],
      untranslatedTerms: [],
      offline: true,
    };
    const filtered = filterUnverifiedStory(story, shas, new Set());
    expect(filtered.claims.length).toBe(1);
  });

  it('produces a clearly-labeled deterministic offline fallback', () => {
    const bundle = {
      repositoryName: 'octokit/atlas-demo-repo',
      headSha: SHA_C,
      milestones: [
        {
          milestoneId: 'ms',
          sha: SHA_C,
          title: 'v1.0.0 finalize',
          changeKind: 'release',
          changedFiles: ['README.md'],
          patchExcerpts: [],
          commitMessageSubject: 'feat: finalize v1.0.0',
        },
      ],
      readmeExcerpt: '# atlas-demo-repo',
      knownShas: new Set([SHA_C]),
      knownPaths: new Set(['README.md']),
    };
    const story = fallbackTimelineStory(bundle, 'es');
    expect(story.offline).toBe(true);
    expect(story.locale).toBe('es');
    expect(story.milestones[0]!.claims[0]!.evidenceRefs[0]!.path).toBe('README.md');
  });
});

describe('explanation service (TRD §6.1 /api/explanations)', () => {
  it('explains history and individual nodes from the offline provider', async () => {
    const store = createMemoryStore();
    const pipeline = createPipeline({ store, fixture: buildTinyFixture() });
    const { jobId } = await pipeline.analyze({ url: TINY_FIXTURE_URL, locale: 'en' });
    await waitForJob(store, jobId);
    const repositoryId = 'repo_octokit_atlas-demo-repo';
    const history = await pipeline.history(repositoryId);
    const sha = history[0]!.sha;
    const graph = await pipeline.graph(repositoryId, sha);
    const fileNode = graph.nodes.find((n) => n.type === 'file');
    expect(fileNode).toBeDefined();

    const nodeResponse = await pipeline.explain({
      repositoryId,
      snapshotSha: sha,
      subject: fileNode!.id,
      task: 'node',
      locale: 'es',
      level: 'beginner',
    });
    expect(nodeResponse.kind).toBe('node');
    if (nodeResponse.kind === 'node') {
      expect(nodeResponse.explanation.locale).toBe('es');
      expect(nodeResponse.explanation.claims.length).toBeGreaterThan(0);
      for (const ref of nodeResponse.explanation.claims[0]!.evidenceRefs) {
        expect(ref.path).toBe(fileNode!.path);
      }
    }

    await expect(() =>
      pipeline.explain({
        repositoryId,
        snapshotSha: sha,
        subject: 'node:/nonexistent.ts',
        task: 'node',
        locale: 'en',
        level: 'beginner',
      }),
    ).rejects.toThrow(/not-found: node/);
  });
});
