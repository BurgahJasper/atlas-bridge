// Progress flow tests (FR-12) — deterministic except timestamps (ISO-checked).
import { describe, expect, it } from 'vitest';
import type { Mission } from '@atlas/contracts';

import { buildBeginnerMission } from './mission-builders.js';
import { mergeProgress, nextStepIndex } from './progress.js';

const MINOR_MISSION: Mission = {
  id: 'm-progress',
  repoId: 'acme/widget',
  scopeSha: 'abc123',
  title: 'Progress demo',
  rubric: [],
  maintainerApproved: false,
  estimatedMinutes: 5,
  steps: [
    { id: 's1', kind: 'read', instructions: { en: 'a', es: 'b' }, targetPaths: [], validation: { type: 'quiz', oneOf: [] } },
    { id: 's2', kind: 'quiz', instructions: { en: 'a', es: 'b' }, targetPaths: [], validation: { type: 'quiz', oneOf: [] } },
  ],
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('mergeProgress', () => {
  it('creates a new record when prev is null', () => {
    const p = mergeProgress(null, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'es', passedStepId: 's1' });
    expect(p.id).toBe('anon-1:m-progress');
    expect(p.userOrAnonymousId).toBe('anon-1');
    expect(p.missionId).toBe('m-progress');
    expect(p.locale).toBe('es');
    expect(p.completedSteps).toEqual(['s1']);
    expect(p.results).toHaveLength(1);
    expect(p.results[0]).toMatchObject({ stepId: 's1', passed: true });
    expect(p.updatedAt).toMatch(ISO_RE);
  });

  it('appends subsequent steps and refreshes updatedAt', () => {
    const first = mergeProgress(null, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's1' });
    const second = mergeProgress(first, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's2' });
    expect(second.completedSteps).toEqual(['s1', 's2']);
    expect(second.results.map((r) => r.stepId)).toEqual(['s1', 's2']);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(ISO_RE.test(second.updatedAt)).toBe(true);
  });

  it('re-passing a step replaces its result instead of duplicating it', () => {
    const first = mergeProgress(null, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's1' });
    const again = mergeProgress(first, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's1' });
    expect(again.completedSteps).toEqual(['s1']);
    expect(again.results.filter((r) => r.stepId === 's1')).toHaveLength(1);
  });

  it('keeps the inputs intact (pure function, no shared mutation)', () => {
    const first = mergeProgress(null, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's1' });
    mergeProgress(first, { userOrAnonymousId: 'anon-1', missionId: 'm-progress', locale: 'en', passedStepId: 's2' });
    expect(first.completedSteps).toEqual(['s1']);
  });
});

describe('nextStepIndex', () => {
  it('points at the first uncompleted step and clamps on completion', () => {
    expect(nextStepIndex(null, MINOR_MISSION)).toBe(0);
    const p1 = mergeProgress(null, { userOrAnonymousId: 'u', missionId: 'm-progress', locale: 'en', passedStepId: 's1' });
    expect(nextStepIndex(p1, MINOR_MISSION)).toBe(1);
    const p2 = mergeProgress(p1, { userOrAnonymousId: 'u', missionId: 'm-progress', locale: 'en', passedStepId: 's2' });
    expect(nextStepIndex(p2, MINOR_MISSION)).toBe(MINOR_MISSION.steps.length);
  });

  it('works with the 4-step beginner mission built from real data (FR-06 path)', () => {
    const mission = buildBeginnerMission({
      missionId: 'm-beginner',
      repositoryId: 'acme/widget',
      scopeSha: 'abc123',
      readmeText: 'Widget.',
      sourceFile: { path: 'src/router.ts', content: 'export const router;' },
      quizOptions: ['A', 'B'],
      quizCorrectAnswer: 'A',
      comprehensionNeedlesPerLocale: { en: ['router'], es: ['enrutador'] },
      editInstructionsPerLocale: { en: 'Comment the routes array.', es: 'Comenta el array de rutas.' },
    });
    expect(nextStepIndex(null, mission)).toBe(0);
    let progress: ReturnType<typeof mergeProgress> | null = null;
    for (const step of mission.steps) {
      progress = mergeProgress(progress, { userOrAnonymousId: 'u', missionId: mission.id, locale: 'es', passedStepId: step.id });
    }
    expect(nextStepIndex(progress, mission)).toBe(mission.steps.length);
    expect(progress?.completedSteps).toHaveLength(4);
  });
});
