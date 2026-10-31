// Deterministic scoring tests (TRD §5.2, FR-07) + builder contract test.
import { describe, expect, it } from 'vitest';
import { MissionSchema, type Mission, type MissionSubmission, type ValidationSpec } from '@atlas/contracts';

import { checkMission, evaluateStep, MAX_PATTERN_INPUT } from './check.js';
import { feedbackFor } from './feedback.js';
import { buildBeginnerMission } from './mission-builders.js';

const FILE_PATH = 'src/router.ts';
const FILE_CONTENT = 'import { serve } from "http";\nexport const router = serve({ routes: [] });\n';
const CTX_FROM = (content: string | null) => ({ fileContent: (path: string) => (path === FILE_PATH ? content : null) });

const submission = (patch: Partial<MissionSubmission> = {}): MissionSubmission => ({
  stepId: 's1',
  ...patch,
});

describe('evaluateStep: quiz', () => {
  const spec: ValidationSpec = { type: 'quiz', oneOf: ['Node.js runtime'] };

  it('passes case/whitespace-tolerant answers', () => {
    const r = evaluateStep(spec, submission({ quizAnswer: '  node.JS\nruntime ' }), CTX_FROM(FILE_CONTENT));
    expect(r.passed).toBe(true);
    expect(r.failedRule).toBeNull();
  });

  it('fails wrong answers with a try-again feedback', () => {
    const r = evaluateStep(spec, submission({ quizAnswer: 'deno runtime' }), CTX_FROM(FILE_CONTENT));
    expect(r).toEqual({ passed: false, failedRule: 'quiz-answer', feedback: feedbackFor('try-again') });
  });

  it('fails when no answer was submitted at all', () => {
    const r = evaluateStep(spec, submission(), CTX_FROM(FILE_CONTENT));
    expect(r.passed).toBe(false);
    expect(r.failedRule).toBe('missing-answer');
  });
});

describe('evaluateStep: text-match', () => {
  it('auto-passes the read-step gate with empty mustInclude', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: [], minLength: 0 };
    expect(evaluateStep(spec, submission(), CTX_FROM(null)).passed).toBe(true);
  });

  it('is case-insensitive and tolerant of hostile whitespace between words', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: ['the router handles incoming requests'] };
    const needleSplitAcrossNewlines = submission({
      answerText: 'THE   \n\trouter\t\nhandles incoming\nrequests.',
    });
    expect(evaluateStep(spec, needleSplitAcrossNewlines, CTX_FROM(null)).passed).toBe(true);
  });

  it('honors caseSensitive when explicitly set', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: ['Router'], caseSensitive: true };
    expect(evaluateStep(spec, submission({ answerText: 'the router is ours' }), CTX_FROM(null)).passed).toBe(false);
    expect(evaluateStep(spec, submission({ answerText: 'the Router is ours' }), CTX_FROM(null)).passed).toBe(true);
  });

  it('enforces the minLength words threshold before key terms', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: ['router'], minLength: 8 };
    const keywordStuffing = submission({ answerText: 'router    \n\t' });
    expect(evaluateStep(spec, keywordStuffing, CTX_FROM(null)).feedback).toBe(feedbackFor('answer-too-short'));
  });

  it('reports only found/total counts, never the needles themselves', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: ['router', 'serves', 'graph'] };
    const r = evaluateStep(spec, submission({ answerText: 'a router serves HTTP' }), CTX_FROM(null));
    expect(r.passed).toBe(false);
    expect(r.failedRule).toBe('missing-key-terms');
    expect(r.feedback).toBe(feedbackFor('missing-key-terms', 'en', { found: 2, total: 3 }));
    expect(r.feedback).toContain('2/3');
    expect(r.feedback).not.toContain('graph');
  });

  it('Requires a non-empty answer when needles exist', () => {
    const spec: ValidationSpec = { type: 'text-match', mustInclude: ['x'] };
    const r = evaluateStep(spec, submission({ answerText: '' }), CTX_FROM(null));
    expect(r).toEqual({ passed: false, failedRule: 'missing-answer', feedback: feedbackFor('missing-answer') });
  });
});

describe('evaluateStep: pattern (guarded)', () => {
  const goodRegex: ValidationSpec = { type: 'pattern', file: FILE_PATH, regex: '^import .*$', flags: 'm' };

  it('passes when the file matches and fails otherwise', () => {
    expect(evaluateStep(goodRegex, submission(), CTX_FROM(FILE_CONTENT)).passed).toBe(true);
    expect(evaluateStep(goodRegex, submission(), CTX_FROM('export {}')).failedRule).toBe('regex-mismatch');
  });

  it('fails cleanly on invalid regex from untrusted authors', () => {
    const invalid: ValidationSpec = { type: 'pattern', file: FILE_PATH, regex: 'unbalanced([' };
    expect(evaluateStep(invalid, submission(), CTX_FROM(FILE_CONTENT))).toEqual({
      passed: false,
      failedRule: 'invalid-pattern',
      feedback: feedbackFor('invalid-pattern'),
    });
  });

  it('caps oversized regex sources at MAX_PATTERN_INPUT', () => {
    const huge: ValidationSpec = { type: 'pattern', file: FILE_PATH, regex: 'a'.repeat(MAX_PATTERN_INPUT + 1) };
    expect(evaluateStep(huge, submission(), CTX_FROM(FILE_CONTENT)).failedRule).toBe('invalid-pattern');
  });

  it('caps oversized file input before testing', () => {
    const tooLong = 'x'.repeat(MAX_PATTERN_INPUT + 10);
    // 'x$' with 'm' would match at end of the unbounded file; bounded test must still succeed deterministically.
    const spec: ValidationSpec = { type: 'pattern', file: FILE_PATH, regex: '^x+$', flags: 'm' };
    expect(evaluateStep(spec, submission(), CTX_FROM(tooLong)).passed).toBe(true);
  });

  it('reports a missing file instead of throwing', () => {
    expect(evaluateStep(goodRegex, submission(), CTX_FROM(null)).failedRule).toBe('file-not-found');
  });
});

describe('evaluateStep: diff-touches', () => {
  const edit: ValidationSpec = { type: 'diff-touches', path: FILE_PATH, mustNotInclude: ['TODO: hack'] };

  it('passes when the file was edited in the sandbox', () => {
    expect(evaluateStep(edit, submission(), CTX_FROM(FILE_CONTENT + '// done')).passed).toBe(true);
  });

  it('fails when the file was not submitted', () => {
    expect(evaluateStep(edit, submission(), CTX_FROM(null)).failedRule).toBe('file-not-found');
  });

  it('rejects forbidden content case-insensitively', () => {
    const r = evaluateStep(edit, submission(), CTX_FROM(FILE_CONTENT + '// todo: HACK the core'));
    expect(r.passed).toBe(false);
    expect(r.failedRule).toBe('forbidden-content');
  });
});

describe('checkMission', () => {
  const mission: Mission = {
    id: 'mission-1',
    repoId: 'acme-widget',
    scopeSha: 'deadbeef',
    title: 'First steps',
    rubric: ['read', 'explain'],
    maintainerApproved: false,
    estimatedMinutes: 10,
    steps: [
      {
        id: 's1',
        kind: 'read',
        instructions: { en: 'Read.', es: 'Lee.' },
        targetPaths: ['README.md'],
        validation: { type: 'text-match', mustInclude: [] },
      },
      {
        id: 's2',
        kind: 'quiz',
        instructions: { en: 'Quiz.', es: 'Cuestionario.' },
        targetPaths: ['src/router.ts'],
        validation: { type: 'quiz', oneOf: ['yes'] },
      },
    ],
  };

  it('completes a step deterministically with the typed response shape', () => {
    const r = checkMission(mission, {
      missionId: 'mission-1',
      submission: { stepId: 's1', answerText: '' },
    });
    expect(r).toEqual({
      passed: true,
      completedStepId: 's1',
      feedback: feedbackFor('correct'),
      failedRule: null,
    });
  });

  it('fails with id-mismatch for unknown mission or step ids', () => {
    const wrongMission = checkMission(mission, { missionId: 'mission-9', submission: { stepId: 's1' } });
    expect(wrongMission).toEqual({
      passed: false,
      completedStepId: null,
      feedback: feedbackFor('unknown-step'),
      failedRule: 'id-mismatch',
    });
    const wrongStep = checkMission(mission, { missionId: 'mission-1', submission: { stepId: 'sX' } });
    expect(wrongStep.failedRule).toBe('id-mismatch');
  });

  it('uses only the submission.editedFiles map as the eval context', () => {
    const r = checkMission(mission, {
      missionId: 'mission-1',
      submission: {
        stepId: 's2',
        quizAnswer: 'yes',
        editedFiles: [{ path: 'src/router.ts', content: '// edited' }],
      },
    });
    expect(r.completedStepId).toBe('s2');
  });
});

describe('buildBeginnerMission (FR-06): real-data beginner mission', () => {
  const built = buildBeginnerMission({
    missionId: 'm-beginner',
    repositoryId: 'acme/widget',
    scopeSha: 'beefcafe',
    readmeText: 'Widget does things. ' + 'more '.repeat(900),
    sourceFile: { path: FILE_PATH, content: FILE_CONTENT },
    quizOptions: ['Node.js runtime', 'Deno', 'Bun'],
    quizCorrectAnswer: 'Node.js runtime',
    comprehensionNeedlesPerLocale: { en: ['router', 'serves'], es: ['enrutador'] },
    editInstructionsPerLocale: {
      en: 'Add a comment explaining the routes array.',
      es: 'Añade un comentario que explique el array de rutas.',
    },
  });

  it('has 4 localized steps and its final step is the measurable diff-touches criterion', () => {
    const missionSchemaParse = MissionSchema.parse(built);
    expect(missionSchemaParse.steps).toHaveLength(4); // FR-06: at least 3 steps
    expect(missionSchemaParse.steps[3]?.kind).toBe('edit');
    expect(missionSchemaParse.steps[3]?.validation).toEqual({ type: 'diff-touches', path: FILE_PATH });
    expect(missionSchemaParse.estimatedMinutes).toBe(15);
    for (const step of built.steps) {
      expect(Object.keys(step.instructions).sort()).toEqual(['en', 'es']);
    }
    expect(built.rubric.some((line) => line.includes(FILE_PATH))).toBe(true);
  });

  it('drives the full deterministic end-to-end check flow', () => {
    const read = checkMission(built, { missionId: 'm-beginner', submission: { stepId: `${built.id}-s1-read` } });
    expect(read.passed).toBe(true);
    const comprehend = checkMission(built, {
      missionId: 'm-beginner',
      submission: { stepId: `${built.id}-s2-comprehension`, answerText: 'the router serves requests for the widget module and others' },
    });
    expect(comprehend.completedStepId).toBe(`${built.id}-s2-comprehension`);
    const quiz = checkMission(built, {
      missionId: 'm-beginner',
      submission: { stepId: `${built.id}-s3-quiz`, quizAnswer: ' node.js RUNTIME ' },
    });
    expect(quiz.passed).toBe(true);
    const edit = checkMission(built, {
      missionId: 'm-beginner',
      submission: {
        stepId: `${built.id}-s4-edit`,
        editedFiles: [{ path: FILE_PATH, content: FILE_CONTENT + '// routes: [] holds route configs' }],
      },
    });
    expect(edit.passed).toBe(true);
    expect(edit.completedStepId).toBe(`${built.id}-s4-edit`);
  });
});
