'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { setClientCookie, apiJson } from '@/lib/client-api';
import { REDUCED_MOTION_COOKIE } from '@/lib/locale-shared';
import { Toggle, Button, Badge } from '@/components/ui';

interface Diagnostics {
  ok: boolean;
  repositoryCount: number;
  cachedExplanations: number;
  aiOffline: boolean;
  mode: string;
}

/**
 * Settings widgets (TRD §2.2 /settings): nothing here ever reads or displays
 * secrets; model disclosure is composed server-side from env keys only.
 */
export function ReducedMotionSetting({ initial, locale }: { initial: boolean; locale: Locale }) {
  const [enabled, setEnabled] = useState(initial);

  useEffect(() => {
    document.documentElement.dataset['abReducedMotion'] = enabled ? 'true' : 'false';
  }, [enabled]);

  return (
    <Toggle
      id="reduced-motion-setting"
      checked={enabled}
      onChange={(checked) => {
        setEnabled(checked);
        setClientCookie(REDUCED_MOTION_COOKIE, checked ? 'true' : 'false');
      }}
      label={t(locale, 'settings.reducedMotionLabel')}
      description={t(locale, 'settings.reducedMotionBody')}
    />
  );
}

export function ModelSourcePanel({
  locale,
  disclosure,
}: {
  locale: Locale;
  disclosure: { modelId: string; hosted: boolean };
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    setDiagnostics(null);
    apiJson<Diagnostics>('/api/pipeline-status')
      .then(setDiagnostics)
      .catch(() => setFailed(true));
  };

  useEffect(load, []);

  return (
    <section aria-labelledby="model-heading" className="ab-card p-6">
      <h2 id="model-heading" className="ab-title">
        {t(locale, 'settings.modelHeading')}
      </h2>
      <p className="ab-prose text-muted mt-2 text-sm">
        {disclosure.hosted
          ? t(locale, 'settings.modelHosted', { modelId: disclosure.modelId })
          : t(locale, 'settings.modelDefault', { modelId: disclosure.modelId })}
      </p>
      {diagnostics?.aiOffline ? (
        <div className="mt-3">
          <Badge tone="warning">{t(locale, 'settings.modelOffline')}</Badge>
        </div>
      ) : null}

      <h3 className="mt-6 font-semibold">{t(locale, 'settings.statusHeading')}</h3>
      <div aria-live="polite" aria-atomic="true">
        {failed ? <p className="text-sm mt-1" style={{ color: 'var(--ab-error)' }}>{t(locale, 'settings.statusDown')}</p> : null}
        {!failed && diagnostics ? (
          <p className="text-sm mt-1">
            {t(locale, 'settings.statusOk', {
              repositoryCount: diagnostics.repositoryCount,
              cachedExplanations: diagnostics.cachedExplanations,
            })}
          </p>
        ) : null}
        {!failed && !diagnostics ? (
          <p className="text-sm mt-1 text-muted ab-pulse">{t(locale, 'settings.statusPending')}</p>
        ) : null}
      </div>
      <div className="mt-3">
        <Button onClick={load}>{t(locale, 'settings.statusRetry')}</Button>
      </div>
    </section>
  );
}
