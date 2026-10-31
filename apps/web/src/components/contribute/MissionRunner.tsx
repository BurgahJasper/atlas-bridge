'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ContributionPreviewResponse,
  LearnerProgress,
  Locale,
  Mission,
  MissionStep,
} from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { apiJson, getOrCreateAnonymousId, isApiIssue } from '@/lib/client-api';
import { errorMessage } from '@/lib/errors';
import { shuffledDeterministic } from '@/lib/graph-diff';
import { fileUrl, type RepoRef } from '@/lib/slug';
import { Badge, Button, Progress, Skeleton } from '@/components/ui';

/**
 * Mission board + runner (TRD §2.2 contribute, FR-06/FR-07/FR-10):
 * deterministic server-side validation for every step, hint ladder (never
 * auto-advances), practice edit against the REAL original file, and a PR
 * preview that is only submittable after explicit informed consent.
 */

interface CheckResult {
  passed: boolean;
  completedStepId: string | null;
  feedback: string;
  failedRule: string | null;
}

export function MissionBoard({
  slug,
  locale,
  repositoryId,
  repoRef,
  missions,
  initialMissionId,
}: {
  slug: string;
  locale: Locale;
  repositoryId: string;
  repoRef: RepoRef;
  missions: Mission[];
  initialMissionId: string | null;
}) {
  const [activeMissionId, setActiveMissionId] = useState<string | null>(initialMissionId);
  const active = missions.find((m) => m.id === activeMissionId) ?? null;

  if (missions.length === 0) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <h1 className="ab-display">{t(locale, 'contribute.noMissionsTitle')}</h1>
        <p className="ab-prose text-muted">{t(locale, 'contribute.noMissionsBody')}</p>
      </div>
    );
  }

  if (active) {
    return (
      <MissionRunner
        slug={slug}
        locale={locale}
        repositoryId={repositoryId}
        repoRef={repoRef}
        mission={active}
        onExit={() => setActiveMissionId(null)}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="ab-display">{t(locale, 'contribute.heading')}</h1>
        <p className="ab-prose text-muted mt-1">{t(locale, 'contribute.intro')}</p>
        <p className="mt-1 text-xs text-muted">{t(locale, 'contribute.anonymousNote')}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {missions.map((mission) => (
          <li key={mission.id} className="ab-card grid content-start gap-3 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ab-title">{mission.title}</h2>
              {mission.maintainerApproved ? <Badge tone="success">{t(locale, 'contribute.approvedBadge')}</Badge> : null}
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-muted">
              <span>{t(locale, 'contribute.estimatedLabel', { minutes: mission.estimatedMinutes })}</span>
              <span aria-hidden="true">·</span>
              <span>{t(locale, 'contribute.stepsCountLabel', { count: mission.steps.length })}</span>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'contribute.rubricLabel')}</h3>
              <ul className="mt-1 grid gap-1 text-sm">
                {mission.rubric.map((criterion, index) => (
                  <li key={index}>✓ {criterion}</li>
                ))}
              </ul>
            </div>
            <Button variant="primary" className="w-fit" onClick={() => setActiveMissionId(mission.id)}>
              {t(locale, 'contribute.missionCta')} →
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MissionRunner({
  slug,
  locale,
  repositoryId,
  repoRef,
  mission,
  onExit,
}: {
  slug: string;
  locale: Locale;
  repositoryId: string;
  repoRef: RepoRef;
  mission: Mission;
  onExit: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [anonId, setAnonId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [originalContent, setOriginalContent] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<ContributionPreviewResponse | null>(null);
  const [consent, setConsent] = useState(false);
  const [submission, setSubmission] = useState<{ prUrl?: string; status: string; note?: string } | null>(null);

  const step: MissionStep | undefined = mission.steps[stepIndex];
  const allCompleted = mission.steps.every((s) => completedSteps.includes(s.id));
  const targetPath = step?.targetPaths[0] ?? null;

  // Restore persisted anonymous progress (FR-12).
  useEffect(() => {
    const id = getOrCreateAnonymousId();
    setAnonId(id);
    apiJson<{ progress: LearnerProgress | null }>(
      `/api/progress?userOrAnonymousId=${encodeURIComponent(id)}&missionId=${encodeURIComponent(mission.id)}`,
    )
      .then(({ progress }) => {
        if (progress) setCompletedSteps(progress.completedSteps);
      })
      .catch(() => undefined);
  }, [mission.id]);

  // Load the REAL original file for edit steps (no fabricated starting buffer).
  useEffect(() => {
    if (!step || step.kind !== 'edit' || !targetPath) return;
    if (originalContent[targetPath] !== undefined) return;
    setFileError(null);
    apiJson<{ content: string }>(
      `/api/file?owner=${encodeURIComponent(repoRef.owner)}&name=${encodeURIComponent(repoRef.name)}&path=${encodeURIComponent(targetPath)}&sha=${encodeURIComponent(mission.scopeSha)}`,
    )
      .then(({ content }) => {
        setOriginalContent((prev) => ({ ...prev, [targetPath]: content }));
        setEditedContent((prev) => (prev[targetPath] === undefined ? { ...prev, [targetPath]: content } : prev));
      })
      .catch(() => setFileError(t(locale, 'contribute.originalUnavailable')));
  }, [step, targetPath, mission.scopeSha, repoRef, originalContent, locale]);

  const submitStep = useCallback(async () => {
    if (!step) return;
    setChecking(true);
    setResult(null);
    try {
      const submission: Record<string, unknown> = { stepId: step.id };
      if (step.kind === 'comprehension') submission.answerText = answerText;
      if (step.kind === 'quiz') submission.quizAnswer = quizAnswer ?? '';
      if (step.kind === 'edit' && targetPath) {
        submission.editedFiles = [{ path: targetPath, content: editedContent[targetPath] ?? '' }];
      }
      const response = await apiJson<CheckResult>(`/api/missions/${encodeURIComponent(mission.id)}/check`, {
        method: 'POST',
        body: JSON.stringify({ submission, userOrAnonymousId: anonId ?? 'anonymous', locale }),
      });
      setResult(response);
      if (response.passed && response.completedStepId) {
        setCompletedSteps((prev) => [...new Set([...prev, response.completedStepId!])]);
      }
    } catch (error) {
      setResult({
        passed: false,
        completedStepId: null,
        feedback: isApiIssue(error) ? errorMessage(error, locale) : t(locale, 'errors.generic'),
        failedRule: null,
      });
    } finally {
      setChecking(false);
    }
  }, [step, answerText, quizAnswer, editedContent, targetPath, mission.id, anonId, locale]);

  const fetchHint = useCallback(
    async (level: 1 | 2 | 3) => {
      if (!step) return;
      try {
        const hint = await apiJson<{ text: string }>('/api/hints', {
          method: 'POST',
          body: JSON.stringify({
            repositoryId,
            missionId: mission.id,
            stepId: step.id,
            learnerText: answerText,
            hintLevel: level,
            locale,
          }),
        });
        setHints((prev) => ({ ...prev, [level]: hint.text }));
      } catch {
        setHints((prev) => ({ ...prev, [level]: t(locale, 'errors.generic') }));
      }
    },
    [step, repositoryId, mission.id, answerText, locale],
  );

  const quizOptions = useMemo(() => {
    if (!step || step.validation.type !== 'quiz') return [];
    return shuffledDeterministic(step.options ?? step.validation.oneOf, `${mission.id}:${step.id}`);
  }, [step, mission.id]);

  const buildPreview = useCallback(async () => {
    const files = Object.entries(editedContent)
      .filter(([path, content]) => content !== originalContent[path])
      .map(([path, content]) => ({ path, content }));
    try {
      const response = await apiJson<ContributionPreviewResponse>('/api/contributions/preview', {
        method: 'POST',
        body: JSON.stringify({ missionId: mission.id, repositoryId, files }),
      });
      setPreview(response);
      setConsent(false);
    } catch (error) {
      setResult({
        passed: false,
        completedStepId: null,
        feedback: isApiIssue(error) ? errorMessage(error, locale) : t(locale, 'errors.generic'),
        failedRule: null,
      });
    }
  }, [editedContent, originalContent, mission.id, repositoryId, locale]);

  const submitContribution = useCallback(async () => {
    if (!preview || !consent) return;
    const files = Object.entries(editedContent)
      .filter(([path, content]) => content !== originalContent[path])
      .map(([path, content]) => ({ path, content }));
    const response = await apiJson<{ prUrl?: string; status: string; note?: string }>('/api/contributions/submit', {
      method: 'POST',
      body: JSON.stringify({ missionId: mission.id, repositoryId, files, confirmed: true }),
    });
    setSubmission(response);
  }, [preview, consent, editedContent, originalContent, mission.id, repositoryId]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="ab-display">{mission.title}</h1>
          <p className="text-sm text-muted">
            {t(locale, 'contribute.stepOf', { index: Math.min(stepIndex + 1, mission.steps.length), total: mission.steps.length })}
          </p>
        </div>
        <Button onClick={onExit}>← {t(locale, 'contribute.missionBoard')}</Button>
      </div>

      <Progress value={(completedSteps.length / mission.steps.length) * 100} label={t(locale, 'contribute.progressLabel')} />

      <ol className="flex flex-wrap gap-2" aria-label={t(locale, 'a11y.missionSteps')}>
        {mission.steps.map((s, index) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => {
                setStepIndex(index);
                setResult(null);
              }}
              className="ab-btn ab-btn-secondary text-xs"
              style={
                index === stepIndex
                  ? { background: 'var(--ab-action)', color: '#fff' }
                  : completedSteps.includes(s.id)
                    ? { borderColor: 'var(--ab-success)' }
                    : undefined
              }
            >
              {completedSteps.includes(s.id) ? '✓ ' : ''}
              {index + 1}. {t(locale, `step.${s.kind}Title`)}
            </button>
          </li>
        ))}
      </ol>

      {allCompleted ? (
        <section className="ab-card grid gap-4 p-6" aria-labelledby="completion-heading">
          <h2 id="completion-heading" className="ab-title">
            {t(locale, 'contribute.completionTitle')} 🎉
          </h2>
          <p className="ab-prose text-muted text-sm">{t(locale, 'contribute.completionBody')}</p>
          {!preview ? (
            <Button variant="primary" className="w-fit" onClick={() => void buildPreview()}>
              {t(locale, 'contribute.previewCta')} →
            </Button>
          ) : null}

          {preview ? (
            <div className="grid gap-3">
              <h3 className="text-sm font-bold">{t(locale, 'contribute.previewHeading')}</h3>
              <p className="text-xs text-muted">{t(locale, 'contribute.previewBody')}</p>
              <dl className="grid gap-1 text-sm">
                <div>
                  <dt className="inline font-semibold">{t(locale, 'contribute.branchLabel')}: </dt>
                  <dd className="ab-mono inline">{preview.branch}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">{t(locale, 'contribute.destinationLabel')}: </dt>
                  <dd className="ab-mono inline">{preview.destination}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">{t(locale, 'contribute.scopeLabel')}: </dt>
                  <dd className="inline">{preview.scopeSummary}</dd>
                </div>
              </dl>
              {preview.requiresOAuth ? (
                <p className="rounded-lg p-3 text-xs" style={{ background: 'var(--ab-raised)' }}>
                  {t(locale, 'contribute.requiresOAuthNotice')}
                </p>
              ) : null}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'contribute.diffLabel')}</h4>
                <pre className="ab-mono mt-1 max-h-80 overflow-auto rounded-lg p-3 text-xs" style={{ background: 'var(--ab-raised)' }}>
                  {preview.diff || '(no changes)'}
                </pre>
              </div>
              {!submission ? (
                <>
                  <label className="flex items-center gap-3 text-sm" style={{ minHeight: 44 }}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    {t(locale, 'contribute.consentLabel')}
                  </label>
                  <Button variant="primary" className="w-fit" disabled={!consent} onClick={() => void submitContribution()}>
                    {t(locale, 'contribute.submitCta')}
                  </Button>
                </>
              ) : (
                <p className="text-sm" role="status">
                  {submission.status === 'submitted' && submission.prUrl ? (
                    <>
                      {t(locale, 'contribute.resultSubmitted')}{' '}
                      <a href={submission.prUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        {submission.prUrl}
                      </a>
                    </>
                  ) : submission.status === 'failed' ? (
                    `${t(locale, 'contribute.resultFailed')} ${submission.note ?? ''}`
                  ) : (
                    `${t(locale, 'contribute.resultReviewed')} ${submission.note ?? ''}`
                  )}
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : step ? (
        <section className="ab-card grid gap-4 p-6" aria-labelledby="step-heading">
          <h2 id="step-heading" className="ab-title">
            {t(locale, `step.${step.kind}Title`)}
          </h2>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'contribute.instructionsLabel')}</h3>
            <p className="ab-prose mt-1 text-sm">{step.instructions[locale] ?? step.instructions.en}</p>
          </div>

          {targetPath ? (
            <p className="text-sm">
              <span className="text-muted">{t(locale, 'step.targetLabel')}: </span>
              <a
                href={fileUrl(repoRef, mission.scopeSha, targetPath)}
                target="_blank"
                rel="noopener noreferrer"
                className="ab-mono underline"
                style={{ color: 'var(--ab-action-text)' }}
              >
                {targetPath}
              </a>
            </p>
          ) : null}

          {step.kind === 'comprehension' ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{t(locale, 'contribute.comprehensionPrompt')}</p>
              <label htmlFor="answer-text" className="text-sm font-semibold">
                {t(locale, 'contribute.answerLabel')}
              </label>
              <textarea
                id="answer-text"
                className="ab-input min-h-32"
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
              />
            </div>
          ) : null}

          {step.kind === 'quiz' ? (
            <fieldset>
              <legend className="text-sm font-semibold">{t(locale, 'contribute.quizPrompt')}</legend>
              <div className="mt-2 grid gap-2">
                {quizOptions.map((option) => (
                  <label key={option} className="flex items-center gap-3 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--ab-line)', minHeight: 44 }}>
                    <input
                      type="radio"
                      name={`quiz-${step.id}`}
                      checked={quizAnswer === option}
                      onChange={() => setQuizAnswer(option)}
                    />
                    <span className="ab-mono">{option}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {step.kind === 'edit' && targetPath ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{t(locale, 'contribute.editPrompt')}</p>
              <label htmlFor="file-editor" className="text-sm font-semibold">
                {t(locale, 'contribute.editorLabel', { path: targetPath })}
              </label>
              {originalContent[targetPath] === undefined && !fileError ? <Skeleton height={160} /> : null}
              {fileError ? <p className="text-xs text-muted">{fileError}</p> : null}
              <textarea
                id="file-editor"
                className="ab-input ab-mono min-h-64 text-[13px]"
                spellCheck={false}
                value={editedContent[targetPath] ?? ''}
                onChange={(e) => setEditedContent((prev) => ({ ...prev, [targetPath]: e.target.value }))}
              />
              <Button
                className="w-fit"
                onClick={() => {
                  if (originalContent[targetPath] !== undefined) {
                    setEditedContent((prev) => ({ ...prev, [targetPath]: originalContent[targetPath]! }));
                  }
                }}
              >
                {t(locale, 'contribute.reloadOriginal')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void submitStep()} disabled={checking}>
              {checking
                ? t(locale, 'contribute.checkingLabel')
                : step.kind === 'read'
                  ? t(locale, 'contribute.readDone')
                  : t(locale, 'contribute.checkLabel')}
            </Button>
            {result?.passed ? (
              <Badge tone="success">{t(locale, 'contribute.passed')}</Badge>
            ) : result ? (
              <Badge tone="warning">{t(locale, 'contribute.failed')}</Badge>
            ) : null}
            {result?.passed && stepIndex + 1 < mission.steps.length ? (
              <Button
                onClick={() => {
                  setStepIndex(stepIndex + 1);
                  setResult(null);
                }}
              >
                {t(locale, 'contribute.nextStepCta')} →
              </Button>
            ) : null}
          </div>

          {result && !result.passed ? (
            <p className="text-sm" role="alert" style={{ color: 'var(--ab-warning)' }}>
              {result.feedback}
            </p>
          ) : null}

          {/* Hint ladder (TRD §5.1: prefer hints; never auto-submit). */}
          <div className="grid gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'contribute.hintsHeading')}</h3>
            <div className="flex flex-wrap gap-2">
              {([1, 2, 3] as const).map((level) => (
                <Button key={level} className="text-xs" onClick={() => void fetchHint(level)}>
                  {t(locale, 'contribute.hintButton', { level })}
                </Button>
              ))}
            </div>
            {Object.entries(hints).map(([level, text]) => (
              <p key={level} className="rounded-lg p-3 text-sm" style={{ background: 'var(--ab-raised)' }}>
                {text}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
