'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AnalysisJob, Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { githubUrlFor } from '@/lib/slug';
import { apiJson, isApiIssue } from '@/lib/client-api';
import { errorMessage, errorHint, ApiError } from '@/lib/errors';
import { Button, Progress, Skeleton } from '@/components/ui';

interface AnalysisGateProps {
  slug: string;
  /** Existing job id from a prior analyze call (query param ?job=…). */
  jobId?: string;
  locale: Locale;
  /** Start analysis automatically when no jobId is known (curated deep links). */
  autoStart: boolean;
}

type GateState = {
  jobId: string | null;
  status: AnalysisJob['status'] | 'starting';
  stage: string;
  progress: number;
  warnings: string[];
  error: string | null;
};

const INITIAL: GateState = { jobId: null, status: 'starting', stage: '', progress: 0, warnings: [], error: null };

/**
 * Loading/analysis gate (TRD §2.4 states: importing/analyzing — visible
 * progress, every failure with a next action). Polls /api/jobs/:id; on 'done'
 * it replaces the URL (dropping ?job=) and refreshes so the server page
 * re-renders with real data. Cancellation is intentionally absent: v1 jobs
 * are non-cancellable (TRD FR list has no cancel endpoint), so no fake control.
 */
export function AnalysisGate({ slug, jobId: initialJobId, locale, autoStart }: AnalysisGateProps) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ ...INITIAL, jobId: initialJobId ?? null });
  const startedRef = useRef(false);
  const lastProgressRef = useRef(Date.now());

  const startAnalysis = useCallback(async () => {
    startedRef.current = true;
    lastProgressRef.current = Date.now();
    setState((prev) => ({ ...prev, status: 'starting', error: null }));
    try {
      const ref = slug.split('__');
      const owner = ref[0] ?? '';
      const name = ref.slice(1).join('__');
      const data = await apiJson<{ jobId: string }>('/api/repos/analyze', {
        method: 'POST',
        body: JSON.stringify({ url: githubUrlFor({ owner, name }), locale }),
      });
      setState((prev) => ({ ...prev, jobId: data.jobId, status: 'queued' }));
    } catch (error) {
      const message = isApiIssue(error) ? errorMessage(error, locale) : t(locale, 'analysis.submitError');
      setState((prev) => ({ ...prev, status: 'error', error: message }));
    }
  }, [slug, locale]);

  useEffect(() => {
    if (!initialJobId && autoStart && !startedRef.current) {
      void startAnalysis();
    }
  }, [initialJobId, autoStart, startAnalysis]);

  useEffect(() => {
    if (!state.jobId) return;
    if (state.status === 'done' || state.status === 'error' || state.status === 'cancelled') return;
    let cancelled = false;
    const poll = async () => {
      try {
        const job = await apiJson<AnalysisJob>(`/api/jobs/${encodeURIComponent(state.jobId ?? '')}`);
        if (cancelled) return;
        if (job.stage !== state.stage || job.progress !== state.progress) lastProgressRef.current = Date.now();
        if ((job.status === 'queued' || job.status === 'running') && Date.now() - lastProgressRef.current > 45000) {
          setState((prev) => ({ ...prev, status: 'error', error: 'Analysis stalled. On Vercel, configure shared DATABASE_URL and a durable analysis worker; a GitHub token alone does not fix serverless background jobs.' }));
          return;
        }
        setState((prev) => ({
          ...prev,
          status: job.status,
          stage: job.stage ?? prev.stage,
          progress: job.progress ?? prev.progress,
          warnings: job.warnings ?? prev.warnings,
          error: job.error ?? null,
        }));
        if (job.status === 'done') {
          // Drop ?job= from the URL and re-render the server page with data.
          router.replace(`/explore/${slug}`);
          router.refresh();
        }
      } catch (error) {
        if (cancelled) return;
        const message = isApiIssue(error) ? errorMessage(error, locale) : t(locale, 'errors.generic');
        if (error instanceof ApiError && error.status === 404) {
          setState((prev) => ({ ...prev, status: 'error', error: message }));
        } else {
          // transient poll failures keep polling (worker restarts etc.)
          setTimeout(() => {
            if (!cancelled) void poll();
          }, 2000);
        }
      }
    };
    const timer = setTimeout(poll, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.jobId, state.status, state.stage, state.progress, router, slug, locale]);

  if (state.status === 'done') {
    return (
      <p aria-live="polite" className="text-sm">
        {t(locale, 'analysis.complete')}
      </p>
    );
  }

  if (state.status === 'error' || state.status === 'cancelled') {
    return (
      <div className="ab-card p-6" role="alert">
        <h2 className="ab-title">{t(locale, 'analysis.failedTitle')}</h2>
        {state.error ? (
          <p className="ab-prose text-muted mt-2 text-sm">
            {state.error} — {t(locale, 'analysis.failedNextAction')}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void startAnalysis()}>
            {t(locale, 'states.retryCta')}
          </Button>
          <Link href="/" className="ab-btn ab-btn-ghost">
            {t(locale, 'states.backHomeCta')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ab-card p-6">
      <h2 className="ab-title">{t(locale, 'analysis.progressTitle')}</h2>
      <p className="ab-prose text-muted mt-2 text-sm">{t(locale, 'analysis.progressBody')}</p>
      {state.error ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--ab-error)' }} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="mt-4 grid gap-2">
        <Progress value={state.progress} label={t(locale, 'a11y.jobProgress')} />
        <p aria-live="polite" className="text-sm text-muted">
          {state.status === 'starting' ? t(locale, 'hero.submitting') : `${state.stage || state.status} · ${Math.round(state.progress)}%`}
        </p>
        {state.warnings.length > 0 ? (
          <ul className="mt-1 grid gap-1">
            {state.warnings.map((warning, index) => (
              <li key={index} className="text-xs" style={{ color: 'var(--ab-warning)' }}>
                △ {warning}
              </li>
            ))}
          </ul>
        ) : null}
        <Skeleton height={12} className="mt-2" />
      </div>
    </div>
  );
}
