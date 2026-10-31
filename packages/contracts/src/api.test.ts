import { describe, expect, it } from 'vitest';
import {
  AnalyzeRequestSchema,
  ExplanationRequestSchema,
  ExplanationResponseSchema,
  MissionCheckResponseSchema,
  TimelineStorySchema,
  explanationCacheKey,
  newId,
} from './index.js';

describe('contracts: API schemas (TRD §6.1/§6.2)', () => {
  it('accepts a well-formed analyze request and defaults locale', () => {
    const parsed = AnalyzeRequestSchema.parse({ url: 'https://github.com/octokit/request.js' });
    expect(parsed.locale).toBe('en');
  });

  it('validates the representative explanation response (discriminated by kind)', () => {
    const story = TimelineStorySchema.parse({
      snapshotSha: 'a'.repeat(40),
      milestones: [],
      locale: 'es',
      summary: 'resumen',
      claims: [],
      untranslatedTerms: ['useEffect'],
    });
    const response = ExplanationResponseSchema.parse({ kind: 'history', story });
    expect(response.kind).toBe('history');
    expect(story.offline).toBe(false); // default
  });

  it('rejects malformed explanation requests', () => {
    expect(
      ExplanationRequestSchema.safeParse({ repositoryId: '', snapshotSha: 'x', subject: 'timeline', task: 'history', locale: 'en', level: 'beginner' }).success,
    ).toBe(false);
  });

  it('mission check responses are typed', () => {
    const ok = MissionCheckResponseSchema.parse({ passed: true, completedStepId: 's1', feedback: 'ok', failedRule: null });
    expect(ok.passed).toBe(true);
  });

  it('cache keys are stable and ids are prefixed', () => {
    const key = explanationCacheKey({ snapshotSha: 'abc', subject: 'timeline', task: 'history', locale: 'en', level: 'beginner' });
    expect(key).toBe('history:abc:timeline:en:beginner');
    expect(newId('job')).toMatch(/^job_[a-z0-9]{12}$/);
  });
});
