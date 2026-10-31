'use client';

import Link from 'next/link';
import type { Locale, Milestone } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Left repository rail (TRD §2.4 desktop): section links + milestone list.
 * Milestone buttons are announced; active milestone visibly highlighted.
 */
export function RepoNav({
  slug,
  locale,
  milestones,
  activeMilestoneIndex,
  onSelectMilestone,
  committedAt,
}: {
  slug: string;
  locale: Locale;
  milestones: Milestone[];
  activeMilestoneIndex?: number;
  onSelectMilestone?: (index: number) => void;
  committedAt?: (index: number) => string | undefined;
}) {
  const base = `/explore/${slug}`;
  const sections = [
    { href: base, key: 'nav.overview' },
    { href: `${base}/history`, key: 'nav.history' },
    { href: `${base}/learn`, key: 'nav.learn' },
    { href: `${base}/contribute`, key: 'nav.contribute' },
  ];

  return (
    <nav aria-label={t(locale, 'nav.repoLabel')} className="grid content-start gap-6">
      <ul className="grid gap-1 text-sm">
        {sections.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-lg px-3 py-2 font-semibold hover:bg-raised"
              style={{ color: 'var(--ab-action-text)' }}
            >
              {t(locale, section.key)}
            </Link>
          </li>
        ))}
      </ul>

      {milestones.length > 0 ? (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'history.cast')}</h2>
          <ol className="mt-2 grid gap-1">
            {milestones.map((milestone, index) => {
              const active = onSelectMilestone !== undefined && index === activeMilestoneIndex;
              const time = committedAt?.(index);
              return (
                <li key={milestone.id}>
                  {onSelectMilestone ? (
                    <button
                      type="button"
                      onClick={() => onSelectMilestone(index)}
                      aria-current={active ? 'true' : undefined}
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-raised"
                      style={{
                        background: active ? 'var(--ab-action-soft)' : undefined,
                        borderLeft: active ? '3px solid var(--ab-action)' : '3px solid transparent',
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <span className="block truncate">{milestone.title}</span>
                      {time ? <span className="ab-mono block text-xs text-muted">{time}</span> : null}
                    </button>
                  ) : (
                    <span className="block rounded-lg px-3 py-2 text-sm" style={{ color: 'var(--ab-muted)' }}>
                      {milestone.title}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </nav>
  );
}
