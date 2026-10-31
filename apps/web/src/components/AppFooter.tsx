'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { apiJson } from '@/lib/client-api';
import { Badge } from './ui';

interface PipelineStatusPayload {
  ok: boolean;
  repositoryCount: number;
  cachedExplanations: number;
  aiOffline: boolean;
  mode: string;
}

/** Footer status chip: reads web-side diagnostics (no secrets, TRD §7). */
export function StatusChip({ locale }: { locale: Locale }) {
  const [status, setStatus] = useState<PipelineStatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiJson<PipelineStatusPayload>('/api/pipeline-status')
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-2 text-xs" aria-label={t(locale, 'settings.statusAria')}>
      <span aria-hidden="true">{failed || (status ? !status.ok : true) ? '○' : '●'}</span>
      {t(locale, 'footer.statusLabel')}:{' '}
      {failed ? <Badge tone="error">{t(locale, 'settings.statusDown')}</Badge> : null}
      {status ? (
        <>
          <Badge tone={status.aiOffline ? 'warning' : 'action'}>
            {status.aiOffline ? 'offline' : status.mode === 'worker' ? `worker · ${status.mode}` : 'embedded'}
          </Badge>
          <span className="text-muted">×{status.repositoryCount}</span>
        </>
      ) : (
        <span className="text-muted ab-pulse">{t(locale, 'common.loading')}</span>
      )}
    </span>
  );
}

export function AppFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="mt-auto border-t border-line px-4 py-6">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <p>© 2026 {t(locale, 'brand')} — {t(locale, 'footer.license')}</p>
        <p className="max-w-prose">{t(locale, 'footer.disclosure')}</p>
        <StatusChip locale={locale} />
      </div>
    </footer>
  );
}
