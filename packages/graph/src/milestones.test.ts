import { describe, expect, it } from 'vitest';
import type { CommitInfo } from '@atlas/github';
import { selectMilestones } from './milestones.js';

const commit = (
  sha: string,
  committerDate: string,
  message: string,
  parents: string[] = [],
  filesChanged?: string[],
): CommitInfo => ({
  sha,
  committerDate,
  message,
  parents,
  ...(filesChanged ? { filesChanged } : {}),
});

/* Ascending analysis window (TRD §4.2 step 1). */
const mergeParentSha = '9999999999999999999999999999999999999999';
const shas = ['1111111111111111111111111111111111111111', '2222222222222222222222222222222222222222', '3333333333333333333333333333333333333333', '4444444444444444444444444444444444444444', '5555555555555555555555555555555555555555', '6666666666666666666666666666666666666666'];
const firstSha = shas[0]!;
const lastSha = shas[shas.length - 1]!;

const wins = [
  commit(shas[0]!, '2026-01-01T00:00:00Z', 'chore: seed project'),
  commit(shas[1]!, '2026-01-02T00:00:00Z', 'feat: core module', [], ['a.ts', 'b.ts', 'c.ts']),
  commit(shas[2]!, '2026-01-03T00:00:00Z', 'merge: main', [mergeParentSha, shas[1]!]),
  commit(shas[3]!, '2026-01-04T00:00:00Z', 'fix: edge case', [shas[2]!], []),
  commit(shas[4]!, '2026-01-05T00:00:00Z', 'feat: wide refactor', [shas[3]!], ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']),
  commit(lastSha, '2026-01-06T00:00:00Z', 'docs: readme', [shas[4]!]),
];

describe('selectMilestones', () => {
  it('is deterministic: identical input yields identical output', () => {
    expect(JSON.stringify(selectMilestones(wins))).toBe(JSON.stringify(selectMilestones(wins)));
  });

  it('always includes the earliest and latest commit, ascending order', () => {
    const chosen = selectMilestones(wins);
    expect(chosen[0]).toMatchObject({ sha: firstSha, reason: 'earliest commit in window' });
    expect(chosen[chosen.length - 1]).toMatchObject({ sha: lastSha, reason: 'latest commit in window' });
    expect(chosen.map((m) => m.sha)).toEqual([...chosen.map((m) => m.sha)].sort()); // lexicographic here == date order
    expect(chosen.map((m) => m.sha)).toEqual([
      firstSha,
      shas[1]!, // second-widest filesChanged fill (3 files)
      shas[2]!, // merge commit
      shas[4]!, // widest filesChanged: 5 files
      lastSha,
    ]);
  });

  it('maps in-window tags to release milestones with real SHAs', () => {
    const chosen = selectMilestones(wins, { tags: [{ tag: 'v1.2.3', sha: shas[3]! }] });
    expect(chosen.find((m) => m.sha === shas[3])).toMatchObject({
      changeKind: 'release',
      title: 'v1.2.3',
      reason: 'release tag v1.2.3',
    });
  });

  it('detects merge commits', () => {
    const chosen = selectMilestones(wins);
    expect(chosen.find((m) => m.sha === shas[2])).toMatchObject({ changeKind: 'merge', reason: 'merge commit' });
  });

  it('trims to max while preserving boundaries', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      commit(`aaaa${String(index).padStart(36, '0')}`, `2026-02-0${index + 1}T00:00:00Z`, `commit ${index}`),
    );
    const chosen = selectMilestones(many, { min: 3, max: 5 });
    expect(chosen).toHaveLength(5);
    expect(chosen[0]!.sha).toBe(many[0]!.sha);
    expect(chosen[chosen.length - 1]!.sha).toBe(many[many.length - 1]!.sha);
    expect(chosen.map((m) => m.sha)).toEqual([...chosen.map((m) => m.sha)].sort());
  });

  it('honors min when the window allows, dedupes by sha (tag + boundary overlap)', () => {
    // The earliest commit is also a tagged merge: one entry only.
    const overlap = [
      commit(shas[0]!, '2026-01-01T00:00:00Z', 'merge: bootstrap', ['x1', 'x2']),
      commit(lastSha, '2026-01-02T00:00:00Z', 'feat: done'),
    ];
    const chosen = selectMilestones(overlap, { tags: [{ tag: 'v0.1.0', sha: firstSha }] });
    expect(chosen.map((m) => m.sha)).toEqual([firstSha, lastSha]);
  });

  it('returns 1 for a single-commit window', () => {
    expect(selectMilestones([commit(lastSha, '2026-01-01T00:00:00Z', 'solo')])).toEqual([
      { sha: lastSha, title: 'solo', changeKind: 'other', reason: 'earliest commit in window' },
    ]);
  });

  it('ignores tags outside the window (no fabricated SHAs)', () => {
    const chosen = selectMilestones(wins, { tags: [{ tag: 'ghost', sha: 'deadbeef' }] });
    expect(chosen.find((m) => m.reason.includes('ghost'))).toBeUndefined();
  });

  it('falls back to the message hint when filesChanged is unknown', () => {
    const plain = [
      commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-01-01T00:00:00Z', 'short'),
      commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2026-01-02T00:00:00Z', 'x'.repeat(400)),
      commit('cccccccccccccccccccccccccccccccccccccccc', '2026-01-03T00:00:00Z', 'tiny'),
    ];
    const chosen = selectMilestones(plain, { min: 3, max: 3 });
    expect(chosen.find((m) => m.sha === plain[1]!.sha)).toMatchObject({ changeKind: 'structural' });
  });

  it('tie-breaks equal committerDate by lexicographic sha', () => {
    const tied = [
      commit('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '2026-01-01T00:00:00Z', 'one'),
      commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-01-01T00:00:00Z', 'two'),
    ];
    const run = () => selectMilestones(tied).map((m) => m.sha);
    expect(run()).toEqual(run());
    expect(run()).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']);
  });
});
