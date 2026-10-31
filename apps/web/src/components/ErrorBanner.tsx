import type { ReactNode } from 'react';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Error/state banner (TRD §2.4): every failure state shows a message AND a
 * next action. Codded variants map to dictionary keys (errors.*).
 */
export function ErrorBanner({
  locale,
  titleKey,
  bodyKey,
  action,
  tone = 'error',
  children,
}: {
  locale: Locale;
  titleKey?: string;
  bodyKey?: string;
  action?: ReactNode;
  tone?: 'error' | 'warning' | 'info';
  children?: ReactNode;
}) {
  const boundary =
    tone === 'warning' ? 'var(--ab-history)' : tone === 'info' ? 'var(--ab-action)' : 'var(--ab-error)';
  return (
    <div
      role="alert"
      className="rounded-xl border p-4"
      style={{ background: 'var(--ab-surface)', borderColor: `color-mix(in srgb, ${boundary} 45%, var(--ab-line))` }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" style={{ color: boundary, fontWeight: 700 }}>
          {tone === 'error' ? '!' : tone === 'warning' ? '△' : 'ℹ'}
        </span>
        <div className="min-w-0">
          {titleKey ? <p className="font-semibold">{t(locale, titleKey)}</p> : null}
          {bodyKey ? <p className="text-sm text-muted mt-1 ab-prose">{t(locale, bodyKey)}</p> : null}
          {children}
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
