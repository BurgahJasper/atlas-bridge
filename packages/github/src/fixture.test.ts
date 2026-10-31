import { describe, expect, it } from 'vitest';
import type { CommitInfo } from './types.js';
import type { CuratedFixture } from './fixture.js';
import { createFixtureClient } from './fixture.js';
import { GitHubError } from './errors.js';

const FAKE_SHAS = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccccccccc'];
const [SHA_A, SHA_B, SHA_C] = FAKE_SHAS;

const commits: CommitInfo[] = [
  { sha: SHA_A, message: 'feat: seed atlas demo', committerDate: '2026-01-01T00:00:00Z', parents: [] },
  { sha: SHA_B, message: 'feat: add graph canvas', committerDate: '2026-01-02T00:00:00Z', parents: [SHA_A] },
  { sha: SHA_C, message: 'fix(examples): tighten fixture', committerDate: '2026-01-03T00:00:00Z', parents: [SHA_B] },
];

/* Curated demo fixture (TRD §10.1 item 7): immutable SHAs, no Date.now/random. */
const fixture: CuratedFixture = {
  generatedAt: '2026-10-31T00:00:00Z',
  notes: 'seeded demo window for octo/atlas-demo',
  repository: {
    owner: 'octo',
    name: 'atlas-demo',
    defaultBranch: 'main',
    description: 'Tiny curated repo for the pitch',
    licenseSpdx: 'MIT',
    stars: 17,
  },
  commits,
  tags: [{ tag: 'v1.0.0', sha: SHA_C }],
  milestones: [{ sha: SHA_C, title: 'v1.0.0', changeKind: 'release', reason: 'release tag v1.0.0' }],
  trees: {
    [SHA_C]: [
      { path: 'README.md', type: 'blob', size: 12, sha: 'readme1' },
      { path: 'src', type: 'tree', size: 0, sha: 'srctree' },
    ],
  },
  files: {
    [`${SHA_C}:README.md`]: '# atlas demo\nhello from the fixture store',
  },
  readme: { [SHA_C]: '# atlas demo' },
  compares: {
    [`${SHA_A}...${SHA_C}`]: [
      { path: 'README.md', status: 'modified', additions: 3, deletions: 1 },
      { path: 'src/graph.ts', previousPath: 'src/canvas.ts', status: 'renamed', additions: 10, deletions: 4 },
    ],
  },
};

describe('createFixtureClient', () => {
  it('serves repository meta', async () => {
    const client = createFixtureClient(fixture);
    await expect(client.fetchRepoMeta('octo', 'atlas-demo')).resolves.toMatchObject({
      owner: 'octo',
      name: 'atlas-demo',
      defaultBranch: 'main',
      licenseSpdx: 'MIT',
      stars: 17,
      visibility: 'public',
    });
  });

  it('returns commits ascending, truncated to limit (newest window)', async () => {
    const client = createFixtureClient(fixture);
    await expect(client.fetchCommits('octo', 'atlas-demo', 2)).resolves.toMatchObject([
      { sha: SHA_B },
      { sha: SHA_C },
    ]);
    await expect(client.fetchCommits('octo', 'atlas-demo', 10)).resolves.toMatchObject([
      { sha: SHA_A },
      { sha: SHA_B },
      { sha: SHA_C },
    ]);
  });

  it('serves comparisons by `baseSha...headSha` key', async () => {
    const client = createFixtureClient(fixture);
    const compare = await client.fetchCompare('octo', 'atlas-demo', SHA_A, SHA_C);
    expect(compare.files).toHaveLength(2);
    expect(compare.files[0]).toMatchObject({ path: 'README.md', status: 'modified' });
    expect(compare.files[1]).toMatchObject({ previousPath: 'src/canvas.ts', status: 'renamed' });
  });

  it('throws GitHubError kind not-found on compare key miss', async () => {
    const client = createFixtureClient(fixture);
    await expect(client.fetchCompare('octo', 'atlas-demo', SHA_B, SHA_C)).rejects.toSatisfy(
      (error: unknown) => error instanceof GitHubError && error.kind === 'not-found',
    );
  });

  it('serves trees and files keyed by sha/path', async () => {
    const client = createFixtureClient(fixture);
    await expect(client.fetchTree('octo', 'atlas-demo', SHA_C)).resolves.toHaveLength(2);
    await expect(client.fetchTree('octo', 'atlas-demo', SHA_C, 1)).resolves.toHaveLength(1);
    await expect(client.fetchFile('octo', 'atlas-demo', 'README.md', SHA_C)).resolves.toContain('# atlas demo');
    await expect(client.fetchFile('octo', 'atlas-demo', 'README.md', `${SHA_B}`)).rejects.toSatisfy(
      (error: unknown) => error instanceof GitHubError && error.kind === 'not-found',
    );
    await expect(client.fetchTree('octo', 'atlas-demo', `${SHA_A}`)).rejects.toSatisfy(
      (error: unknown) => error instanceof GitHubError && error.kind === 'not-found',
    );
  });

  it('rejects meta for repositories outside the fixture', async () => {
    const client = createFixtureClient(fixture);
    await expect(client.fetchRepoMeta('other', 'atlas-demo')).rejects.toSatisfy(
      (error: unknown) => error instanceof GitHubError && error.kind === 'not-found',
    );
  });
});
