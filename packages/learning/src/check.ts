// Deterministic mission scoring — TRD §5.2: "Use deterministic pre- and
// post-checks; scoring cannot rely only on model self-evaluation." The model
// NEVER decides whether a step passed; this file does, from the contract's
// ValidationSpec union (FR-07: static validation only, no untrusted execution).
import type {
  Mission,
  MissionCheckRequest,
  MissionCheckResponse,
  MissionSubmission,
  ValidationSpec,
} from '@atlas/contracts';

import { feedbackFor } from './feedback.js';

/** Regex/input size guard: specs and files come from untrusted authors. */
export const MAX_PATTERN_INPUT = 200_000;

export interface EvalContext {
  /** Returns current file content (submission-edited) or null when absent. */
  fileContent(path: string): string | null;
}

export interface StepEval {
  passed: boolean;
  failedRule: string | null;
  feedback: string;
}

/** Collapse hostile whitespace THEN lowercase, for tolerant comparisons. */
function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const ok = (): StepEval => ({ passed: true, failedRule: null, feedback: feedbackFor('correct') });

function fail(rule: string, key: Parameters<typeof feedbackFor>[0], vars?: Record<string, string | number>): StepEval {
  return { passed: false, failedRule: rule, feedback: feedbackFor(key, 'en', vars) };
}

export function evaluateStep(
  spec: ValidationSpec,
  submission: MissionSubmission,
  ctx: EvalContext,
): StepEval {
  switch (spec.type) {
    case 'quiz':
      return evalQuiz(spec, submission);
    case 'text-match':
      return evalTextMatch(spec, submission);
    case 'pattern':
      return evalPattern(spec, ctx);
    case 'diff-touches':
      return evalDiffTouches(spec, ctx);
    default: {
      // Exhaustive by construction; never reached with typed specs.
      return fail('id-mismatch', 'unknown-step');
    }
  }
}

function evalQuiz(
  spec: Extract<ValidationSpec, { type: 'quiz' }>,
  submission: MissionSubmission,
): StepEval {
  const answer = submission.quizAnswer;
  if (typeof answer !== 'string' || norm(answer).length === 0) {
    return fail('missing-answer', 'missing-answer');
  }
  const oneOf = new Set(spec.oneOf.map(norm));
  if (!oneOf.has(norm(answer))) {
    return fail('quiz-answer', 'try-again');
  }
  return ok();
}

function evalTextMatch(
  spec: Extract<ValidationSpec, { type: 'text-match' }>,
  submission: MissionSubmission,
): StepEval {
  // `mustInclude: []` is the documented trivially-passing gate used by `read`
  // steps (FR-06 builder): read steps pass on navigation, not evaluation.
  if (spec.mustInclude.length === 0) {
    return ok();
  }
  const answer = submission.answerText ?? '';
  if (answer.trim().length === 0) {
    return fail('missing-answer', 'missing-answer');
  }
  // Hostile whitespace padding cannot inflate the word count (trim + split).
  const words = answer.trim().split(/\s+/).filter(Boolean);
  if (spec.minLength !== undefined && words.length < spec.minLength) {
    return fail('too-short', 'answer-too-short');
  }
  const caseSensitive = spec.caseSensitive === true;
  const prepare = (needle: string): string => {
    const collapsed = needle.replace(/\s+/g, ' ');
    return caseSensitive ? collapsed : collapsed.toLowerCase();
  };
  const haystack = prepare(answer);
  let found = 0;
  for (const needle of spec.mustInclude) {
    if (haystack.includes(prepare(needle))) found += 1;
  }
  // Generic feedback only — the needles themselves are never revealed (§5.2).
  if (found < spec.mustInclude.length) {
    return fail('missing-key-terms', 'missing-key-terms', { found, total: spec.mustInclude.length });
  }
  return ok();
}

function evalPattern(
  spec: Extract<ValidationSpec, { type: 'pattern' }>,
  ctx: EvalContext,
): StepEval {
  const content = ctx.fileContent(spec.file);
  if (content === null) {
    return fail('file-not-found', 'file-not-found');
  }
  // The regex source is untrusted: bound its size and catch compile errors.
  if (spec.regex.length > MAX_PATTERN_INPUT) {
    return fail('invalid-pattern', 'invalid-pattern');
  }
  let regex: RegExp;
  try {
    regex = new RegExp(spec.regex, spec.flags ?? '');
  } catch {
    return fail('invalid-pattern', 'invalid-pattern');
  }
  const bounded =
    content.length > MAX_PATTERN_INPUT ? content.slice(0, MAX_PATTERN_INPUT) : content;
  if (!regex.test(bounded)) {
    return fail('regex-mismatch', 'regex-mismatch');
  }
  return ok();
}

function evalDiffTouches(
  spec: Extract<ValidationSpec, { type: 'diff-touches' }>,
  ctx: EvalContext,
): StepEval {
  const content = ctx.fileContent(spec.path);
  if (content === null) {
    return fail('file-not-found', 'file-not-found');
  }
  const haystack = norm(content);
  for (const needle of spec.mustNotInclude ?? []) {
    if (haystack.includes(norm(needle))) {
      return fail('forbidden-content', 'forbidden-content');
    }
  }
  return ok();
}

/**
 * Full deterministic mission check (TRD §6.1 /api/missions/:id/check).
 * Returns a MissionCheckResponse typed exactly per @atlas/contracts.
 */
export function checkMission(mission: Mission, request: MissionCheckRequest): MissionCheckResponse {
  const step = request.missionId === mission.id
    ? mission.steps.find((s) => s.id === request.submission.stepId)
    : undefined;
  if (!step) {
    // Mission/step id mismatch surfaces as an explicit failure (no guessing).
    return {
      passed: false,
      completedStepId: null,
      feedback: feedbackFor('unknown-step'),
      failedRule: 'id-mismatch',
    };
  }
  const files = new Map<string, string>(
    (request.submission.editedFiles ?? []).map((f) => [f.path, f.content]),
  );
  const ctx: EvalContext = { fileContent: (path) => files.get(path) ?? null };
  const result = evaluateStep(step.validation, request.submission, ctx);
  return {
    passed: result.passed,
    completedStepId: result.passed ? step.id : null,
    feedback: result.feedback,
    failedRule: result.failedRule,
  };
}
