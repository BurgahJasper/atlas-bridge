'use client';

import type { Locale, Milestone } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Keyboard-operable discrete timeline (TRD §2.3 Timeline row): native range
 * input gives arrows/Home/End for free, milestone stops are also real buttons
 * (44px targets), explicit before/after labels, aria-valuetext announces the
 * selected milestone. Reduced motion only affects the graph, not control.
 */
export function TimelineScrubber({
  milestones,
  activeIndex,
  onSelect,
  locale,
}: {
  milestones: Milestone[];
  activeIndex: number;
  onSelect: (index: number) => void;
  locale: Locale;
}) {
  const active = milestones[activeIndex];
  if (!active) return null;
  const before = milestones[activeIndex - 1];

  return (
    <section aria-labelledby="timeline-heading" className="ab-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="timeline-heading" className="ab-title">
          {t(locale, 'history.heading')}
        </h2>
        <p className="text-sm text-muted" aria-live="polite">
          {t(locale, 'history.milestoneOf', { index: activeIndex + 1, total: milestones.length })}
        </p>
      </div>

      <label htmlFor="milestone-range" className="sr-only">
        {t(locale, 'a11y.timelineAria', { index: activeIndex + 1, total: milestones.length, title: active.title })}
      </label>
      <input
        id="milestone-range"
        type="range"
        min={0}
        max={Math.max(milestones.length - 1, 0)}
        step={1}
        value={activeIndex}
        onChange={(event) => onSelect(Number(event.target.value))}
        aria-valuetext={t(locale, 'a11y.timelineAria', {
          index: activeIndex + 1,
          total: milestones.length,
          title: active.title,
        })}
        className="mt-3 w-full accent-[var(--ab-action)]"
        style={{ minHeight: 44 }}
      />
      <p className="sr-only">{t(locale, 'history.keyboardHint')}</p>

      {/* Discrete stops: releases are marked, never color-only (text label). */}
      <ol className="mt-1 flex flex-wrap gap-2" aria-label={t(locale, 'history.cast')}>
        {milestones.map((milestone, index) => (
          <li key={milestone.id}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === activeIndex ? 'step' : undefined}
              className="ab-btn ab-btn-secondary text-xs"
              style={
                index === activeIndex
                  ? { background: 'var(--ab-action)', color: '#fff', borderColor: 'var(--ab-action)' }
                  : undefined
              }
            >
              {milestone.changeKind === 'release' ? '◆ ' : ''}
              {milestone.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-1 text-sm">
        <p className="text-muted">
          {before ? t(locale, 'history.before', { title: before.title }) : t(locale, 'history.before', { title: '—' })}
        </p>
        <p className="font-semibold">{t(locale, 'history.after', { title: active.title })}</p>
      </div>
    </section>
  );
}
