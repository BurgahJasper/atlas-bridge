import { describe, expect, it } from 'vitest';
import type { Milestone } from '@atlas/contracts';
import { distractorsFor, pickFocusMilestone, seedFocusMission } from './mission-seed.js';

const SHA_1 = '1111111111111111111111111111111111111111';
const SHA_2 = '2222222222222222222222222222222222222222';
const SHA_3 = '3333333333333333333333333333333333333333';

function ms(sha: string, rank: number, title: string): Milestone {
  return {
    id: `ms_${rank}`,
    repositoryId: 'repo_o_r',
    snapshotId: `snap_${rank}`,
    sha,
    title,
    rank,
    changeKind: 'release',
    changeSummary: '',
    time: '2026-01-01T00:00:00Z',
    evidenceRefs: [{ sha }],
  };
}

describe('pickFocusMilestone (real change grounding)', () => {
  const ordered = [ms(SHA_1, 0, 'v1'), ms(SHA_2, 1, 'v2'), ms(SHA_3, 2, 'v3')];

  it('picks the milestone that changed the most files', () => {
    const focus = pickFocusMilestone(
      ordered,
      new Map([
        [SHA_2, ['src/a.ts']],
        [SHA_3, ['src/a.ts', 'src/b.ts']],
      ]),
    );
    expect(focus?.milestone.sha).toBe(SHA_3);
    expect(focus?.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns null when no milestone has changed files (no invented mission)', () => {
    expect(pickFocusMilestone(ordered, new Map())).toBeNull();
  });
});

describe('distractorsFor', () => {
  it('never offers a changed file as a wrong answer', () => {
    const picks = distractorsFor(['README.md', 'src/a.ts', 'src/b.ts', 'docs/x.md'], ['src/a.ts']);
    expect(picks).not.toContain('src/a.ts');
    expect(picks).not.toContain('README.md');
    expect(picks.length).toBe(2);
    expect(picks[0]).toMatch(/\.ts$/); // source files first
  });
});

describe('seedFocusMission', () => {
  const mission = seedFocusMission({
    repository: { id: 'repo_o_r', owner: 'o', name: 'r' },
    milestone: ms(SHA_3, 2, 'v3 release'),
    changedFiles: ['src/a.ts'],
    distractorFiles: ['src/b.ts', 'docs/x.md'],
    scopeSha: SHA_1,
  });

  it('has at least three steps and a measurable final criterion (FR-06)', () => {
    expect(mission.steps.length).toBeGreaterThanOrEqual(3);
    const last = mission.steps[mission.steps.length - 1]!;
    expect(last.kind).toBe('edit');
    expect(last.validation).toEqual({ type: 'pattern', file: 'README.md', regex: SHA_3.slice(0, 7) });
  });

  it('quiz offers real choices, with exactly one correct answer', () => {
    const quiz = mission.steps.find((s) => s.kind === 'quiz')!;
    expect(quiz.options).toEqual(['src/a.ts', 'src/b.ts', 'docs/x.md']);
    expect(quiz.validation).toEqual({ type: 'quiz', oneOf: ['src/a.ts'] });
  });

  it('comprehension needs the changed file name, not a generic phrase', () => {
    const comprehension = mission.steps.find((s) => s.kind === 'comprehension')!;
    expect(comprehension.validation).toMatchObject({ type: 'text-match', mustInclude: ['a.ts'] });
  });

  it('omits the quiz when fewer than two distractors exist', () => {
    const small = seedFocusMission({
      repository: { id: 'repo_o_r', owner: 'o', name: 'r' },
      milestone: ms(SHA_3, 2, 'v3'),
      changedFiles: ['src/a.ts'],
      distractorFiles: ['src/b.ts'],
      scopeSha: SHA_1,
    });
    expect(small.steps.some((s) => s.kind === 'quiz')).toBe(false);
    expect(small.steps.length).toBe(3);
  });
});
