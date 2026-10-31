// Learner progress (FR-12: persisted without unnecessary PII — only an opaque
// id, progress rows and an updatedAt timestamp from the contracts model).
import type { LearnerProgress, Locale, Mission, StepResult } from '@atlas/contracts';

export interface MergeProgressParams {
  userOrAnonymousId: string;
  missionId: string;
  locale: Locale;
  /** The step id the learner just passed deterministically (check.ts). */
  passedStepId: string;
}

/**
 * Appends a passing step to the learner's progress (or starts a fresh record).
 * Results are keyed per step id so retries never duplicate entries.
 */
export function mergeProgress(
  prev: LearnerProgress | null,
  params: MergeProgressParams,
): LearnerProgress {
  const now = new Date().toISOString();
  const base: LearnerProgress = prev ?? {
    id: `${params.userOrAnonymousId}:${params.missionId}`,
    userOrAnonymousId: params.userOrAnonymousId,
    missionId: params.missionId,
    locale: params.locale,
    completedSteps: [],
    results: [],
    updatedAt: now,
  };

  const completedSteps =
    base.completedSteps.includes(params.passedStepId)
      ? base.completedSteps
      : [...base.completedSteps, params.passedStepId];

  const results: StepResult[] = [
    ...base.results.filter((r) => r.stepId !== params.passedStepId),
    { stepId: params.passedStepId, passed: true, at: now },
  ];

  return {
    ...base,
    userOrAnonymousId: params.userOrAnonymousId,
    missionId: params.missionId,
    locale: params.locale,
    completedSteps,
    results,
    updatedAt: now,
  };
}

/**
 * Index of the first step the learner has not completed, clamped to
 * `mission.steps.length` (all done → length; callers treat that as completion).
 */
export function nextStepIndex(progress: LearnerProgress | null, mission: Mission): number {
  const done = new Set(progress?.completedSteps ?? []);
  const index = mission.steps.findIndex((s) => !done.has(s.id));
  return index === -1 ? mission.steps.length : index;
}
