'use client';

import Link from 'next/link';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Narrated "start here" map (TRD §2.2): four sequential steps with aria labels
 * and links. Static composition; keyboard order follows DOM order.
 */
export function OnboardingMap({ slug, locale }: { slug: string; locale: Locale }) {
  const base = `/explore/${slug}`;
  const steps = [
    { href: base, key: 'map.ingest', descKey: 'map.ingestDesc', icon: '▤' },
    { href: `${base}/history`, key: 'map.timeTravel', descKey: 'map.timeTravelDesc', icon: '⇄' },
    { href: `${base}/learn`, key: 'map.learnStep', descKey: 'map.learnStepDesc', icon: '✎' },
    { href: `${base}/contribute`, key: 'map.contribute', descKey: 'map.contributeDesc', icon: '✔' },
  ];

  return (
    <section aria-labelledby="map-heading">
      <h2 id="map-heading" className="ab-title">
        {t(locale, 'map.heading')}
      </h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.key} className="ab-card relative p-4">
            <p className="ab-mono text-muted" aria-hidden="true">
              {index + 1}
            </p>
            <h3 className="mt-1 font-semibold text-action-text" style={{ color: 'var(--ab-action-text)' }}>
              <span aria-hidden="true" className="mr-2">
                {step.icon}
              </span>
              {t(locale, step.key)}
            </h3>
            <p className="ab-prose text-muted mt-1 text-sm">{t(locale, step.descKey)}</p>
            <Link
              href={step.href}
              className="absolute inset-0 rounded-[14px]"
              aria-label={t(locale, 'map.stepLabel', { index: index + 1, label: t(locale, step.key) })}
            >
              <span className="sr-only">{t(locale, 'map.stepLabel')}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
