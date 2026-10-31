'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  Claim,
  GlossaryTerm,
  LearningLevel,
  Locale,
  Milestone,
  TimelineStory,
} from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { glossaryForTerms, fallbackEntries } from '@/lib/glossary';
import { shuffledDeterministic } from '@/lib/graph-diff';
import type { RepoRef } from '@/lib/slug';
import { Badge, Button, Progress, Select } from '@/components/ui';
import { ClaimList } from '@/components/Provenance';
import { ProvenanceNotice } from '@/components/explore/InsightPanel';

/**
 * Learning trail (TRD §2.2 learn, FR-11): one lesson per milestone, a
 * data-grounded checkpoint per lesson, and a glossary. Checkpoints are derived
 * from REAL claim metadata (basis explicit vs inferred) — never invented
 * questions. Level + step stay in the URL so locale switches keep position.
 */
export function LessonRunner({
  slug,
  locale,
  level,
  story,
  milestones,
  repoRef,
  initialStep,
}: {
  slug: string;
  locale: Locale;
  level: LearningLevel;
  story: TimelineStory;
  milestones: Milestone[];
  repoRef: RepoRef;
  initialStep: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), story.milestones.length));

  const parts = story.milestones;
  const finished = step >= parts.length;
  const part = finished ? null : parts[step]!;
  const milestone = part ? (milestones.find((m) => m.id === part.milestoneId) ?? null) : null;

  const setQuery = (nextStep: number, nextLevel: LearningLevel = level) => {
    router.replace(`/explore/${slug}/learn?step=${nextStep}&level=${nextLevel}`, { scroll: false });
  };

  const goTo = (nextStep: number) => {
    setStep(nextStep);
    setQuery(nextStep);
  };

  const glossary = useMemo(() => {
    const covered = glossaryForTerms(story.untranslatedTerms);
    return [...covered, ...fallbackEntries(story.untranslatedTerms, covered, locale)];
  }, [story.untranslatedTerms, locale]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ab-display">{t(locale, 'learn.heading')}</h1>
            <p className="ab-prose text-muted mt-1 text-sm">{t(locale, 'learn.intro')}</p>
          </div>
          <Select
            label={t(locale, 'learn.levelLabel')}
            value={level}
            onChange={(value) => {
              setQuery(step, value as LearningLevel);
              router.refresh();
            }}
            options={[
              { value: 'beginner', label: t(locale, 'learn.levelBeginner') },
              { value: 'intermediate', label: t(locale, 'learn.levelIntermediate') },
              { value: 'advanced', label: t(locale, 'learn.levelAdvanced') },
            ]}
          />
        </div>

        <Progress
          value={parts.length > 0 ? (Math.min(step, parts.length) / parts.length) * 100 : 0}
          label={t(locale, 'learn.progressLabel')}
        />
        <p className="text-sm text-muted" aria-live="polite">
          {finished
            ? t(locale, 'learn.finishHeading')
            : t(locale, 'learn.stepOf', { index: step + 1, total: parts.length })}
        </p>

        {finished ? (
          <section className="ab-card p-6">
            <h2 className="ab-title">{t(locale, 'learn.finishHeading')}</h2>
            <p className="ab-prose text-muted mt-2 text-sm">{t(locale, 'learn.finishBody')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/explore/${slug}/contribute`} className="ab-btn ab-btn-primary">
                {t(locale, 'overview.contributeCta')} →
              </Link>
              <Button onClick={() => goTo(0)}>{t(locale, 'learn.startLesson')}</Button>
            </div>
          </section>
        ) : part ? (
          <section className="ab-card grid gap-4 p-6" aria-labelledby="lesson-title">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="history">{milestone?.changeKind ?? 'milestone'}</Badge>
              {milestone ? <span className="ab-mono text-xs text-muted">{milestone.sha.slice(0, 10)}</span> : null}
            </div>
            <h2 id="lesson-title" className="ab-title">
              {part.title}
            </h2>
            <p className="ab-prose">{part.narrative}</p>

            <div>
              <h3 className="text-sm font-bold">{t(locale, 'learn.readClaims')}</h3>
              <div className="mt-2">
                <ClaimList claims={part.claims} repoRef={repoRef} locale={locale} />
              </div>
            </div>

            <Checkpoint part={part} locale={locale} seed={`${part.milestoneId}:${step}`} />

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => goTo(Math.max(step - 1, 0))} disabled={step === 0}>
                ← {t(locale, 'common.previous')}
              </Button>
              <Button variant="primary" onClick={() => goTo(step + 1)}>
                {step + 1 >= parts.length ? t(locale, 'learn.finishHeading') : t(locale, 'common.next')} →
              </Button>
            </div>
          </section>
        ) : null}

        <ProvenanceNotice story={story} locale={locale} />
      </div>

      <aside className="ab-card h-fit p-4" aria-labelledby="glossary-heading">
        <h2 id="glossary-heading" className="ab-title">
          {t(locale, 'learn.glossaryHeading')}
        </h2>
        <p className="mt-1 text-xs text-muted">{t(locale, 'learn.glossaryBody')}</p>
        {glossary.length > 0 ? (
          <dl className="mt-3 grid gap-3">
            {glossary.map((entry: GlossaryTerm) => (
              <div key={entry.term}>
                <dt className="ab-mono text-sm font-semibold">{entry.term}</dt>
                <dd className="text-sm text-muted">{entry.translations[locale] ?? entry.translations.en ?? '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-muted">{t(locale, 'learn.glossaryEmpty')}</p>
        )}
      </aside>
    </div>
  );
}

/**
 * Checkpoint (TRD §2.2 learn): "which statement is explicitly documented?"
 * Correct answers are claims whose basis is 'explicit'; distractors are
 * 'inferred' claims from the same milestone. Fully deterministic.
 */
function Checkpoint({ part, locale, seed }: { part: TimelineStory['milestones'][number]; locale: Locale; seed: string }) {
  const [picked, setPicked] = useState<string | null>(null);
  const explicit = part.claims.filter((c) => c.basis === 'explicit');
  const inferred = part.claims.filter((c) => c.basis === 'inferred');

  const options = useMemo(() => {
    if (explicit.length === 0 || inferred.length === 0) return null;
    const correct = explicit[0]!;
    const distractors = inferred.slice(0, 2);
    return {
      correctText: correct.text,
      items: shuffledDeterministic([correct, ...distractors], seed),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, part.milestoneId]);

  const answered = picked !== null;
  const correct = picked !== null && picked === options?.correctText;

  return (
    <section className="rounded-lg border p-4" style={{ borderColor: 'var(--ab-line)' }} aria-labelledby="checkpoint-heading">
      <h3 id="checkpoint-heading" className="text-sm font-bold">
        {t(locale, 'learn.checkpointHeading')}
      </h3>
      {!options ? (
        <p className="mt-2 text-sm text-muted">{t(locale, 'learn.checkpointUnavailable')}</p>
      ) : (
        <>
          <p className="mt-2 text-sm">{t(locale, 'learn.checkpointExplicitQuestion')}</p>
          <ul className="mt-3 grid gap-2">
            {options.items.map((claim: Claim) => {
              const isCorrect = claim.text === options.correctText;
              const isPicked = picked === claim.text;
              return (
                <li key={claim.text.slice(0, 60)}>
                  <button
                    type="button"
                    disabled={answered}
                    onClick={() => setPicked(claim.text)}
                    className="w-full rounded-lg border p-3 text-left text-sm"
                    style={{
                      borderColor: answered && isCorrect ? 'var(--ab-success)' : isPicked ? 'var(--ab-action)' : 'var(--ab-line)',
                      background: answered && isCorrect ? 'var(--ab-success-soft)' : undefined,
                    }}
                  >
                    {claim.text}
                  </button>
                </li>
              );
            })}
          </ul>
          {answered ? (
            <p className="mt-3 text-sm" role="status" style={{ color: correct ? 'var(--ab-success)' : 'var(--ab-warning)' }}>
              {correct ? t(locale, 'learn.checkpointExplicitCorrect') : t(locale, 'learn.checkpointIncorrect')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
