import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getOverviewBySlug } from '@/lib/pipeline';
import { githubUrlFor } from '@/lib/slug';
import { CURATED_SLUG } from '@/lib/curated';
import { AnalysisGate } from '@/components/explore/AnalysisGate';
import { OnboardingMap } from '@/components/explore/OnboardingMap';
import { Badge } from '@/components/ui';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = slug.replace('__', ' / ');
  return { title, description: `Repository overview for ${title}` };
}

// TRD §2.2 /explore/[repo]: project overview — repo identity, confidence and
// coverage banner, structure summary, narrated "start here" map.
export default async function ExplorePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { job } = await searchParams;
  const locale = await getLocale();

  const overview = await getOverviewBySlug(slug);

  if (!overview) {
    const notCurated = slug !== CURATED_SLUG;
    return (
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="ab-display">{slug.replace('__', ' / ')}</h1>
        <div className="ab-card p-6">
          <h2 className="ab-title">{t(locale, 'overview.notAnalyzedTitle')}</h2>
          <p className="ab-prose text-muted mt-2 text-sm">{t(locale, 'overview.notAnalyzedBody')}</p>
          <p className="mt-2 text-sm text-muted">{notCurated ? t(locale, 'errors.not_analyzed_hint') : ''}</p>
        </div>
        <AnalysisGate slug={slug} jobId={job} locale={locale} autoStart={!job} />
        <Link href="/" className="ab-btn ab-btn-ghost w-fit">
          ← {t(locale, 'states.backHomeCta')}
        </Link>
      </div>
    );
  }

  const { repository, snapshots, milestones, coverage, warnings } = overview;
  const repoRef = { owner: repository.owner, name: repository.name };
  const currentSha = snapshots.length > 0 ? (snapshots[snapshots.length - 1]?.sha ?? '') : '';
  const isPartial = snapshots.some((s) => s.status === 'partial' || s.status === 'stale' || s.status === 'rate-limited' || s.status === 'failed');
  const isStale = snapshots.some((s) => s.status === 'stale');

  return (
    <div className="grid gap-8">
      <div>
        <p className="ab-mono text-muted">
          <a href={githubUrlFor(repoRef)} target="_blank" rel="noopener noreferrer" className="underline">
            {githubUrlFor(repoRef)}
          </a>
        </p>
        <h1 className="ab-display mt-1">
          {repository.owner} / {repository.name}
        </h1>
        <p className="ab-prose text-muted mt-2">{repository.description ?? t(locale, 'overview.descriptionNone')}</p>
      </div>

      {/* Repo identity card (FR-01: owner/repo/branch/LICENSE visible). */}
      <section aria-labelledby="identity-heading">
        <h2 id="identity-heading" className="sr-only">
          {t(locale, 'overview.heading')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <li className="ab-card p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'overview.branchLabel')}</p>
            <p className="ab-mono mt-1">{repository.defaultBranch}</p>
          </li>
          <li className="ab-card p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'overview.licenseLabel')}</p>
            <p className="mt-1 font-semibold">{repository.licenseSpdx ?? t(locale, 'overview.licenseNone')}</p>
          </li>
          <li className="ab-card p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'overview.starsLabel')}</p>
            <p className="mt-1 font-semibold">★ {repository.stars}</p>
          </li>
          <li className="ab-card p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'overview.lastIndexedLabel')}</p>
            <p className="ab-mono mt-1">{repository.lastIndexedAt ? new Date(repository.lastIndexedAt).toISOString().slice(0, 10) : '—'}</p>
          </li>
        </ul>
      </section>

      {/* Confidence & coverage banner (TRD §2.2; partial/stale states get next action). */}
      <section aria-labelledby="coverage-heading">
        <h2 id="coverage-heading" className="sr-only">
          {t(locale, 'overview.coverageLabel')}
        </h2>
        <div className="ab-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={warnings.length > 0 ? 'warning' : 'success'}>{t(locale, 'overview.coverageLabel')}</Badge>
            <span className="text-sm font-semibold">{coverage || '—'}</span>
            {isStale ? <Badge tone="warning">{t(locale, 'states.staleTitle')}</Badge> : null}
            {isPartial ? <Badge tone="warning">{t(locale, 'states.partialTitle')}</Badge> : null}
          </div>
          <p className="mt-2 text-xs text-muted">{t(locale, 'overview.confidenceNote')}</p>
          {warnings.length > 0 ? (
            <div className="mt-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'overview.warningsLabel')}</h3>
              <ul className="mt-1 grid gap-1">
                {warnings.map((warning, index) => (
                  <li key={index} className="text-sm" style={{ color: 'var(--ab-warning)' }}>
                    △ {warning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* Structure summary. */}
      <section aria-labelledby="structure-heading">
        <h2 id="structure-heading" className="ab-title">
          {t(locale, 'overview.structureHeading')}
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          <Badge tone="action" title={t(locale, 'nav.history')}>
            {milestones.length} {t(locale, 'overview.milestonesLabel')}
          </Badge>
          <Badge tone="neutral" title={t(locale, 'nav.overview')}>
            {snapshots.length} {t(locale, 'overview.snapshotsLabel')}
          </Badge>
        </div>
      </section>

      {/* Primary CTAs (TRD §2.2: start here narrated CTA + learn/contribute). */}
      <div className="flex flex-wrap gap-3">
        <Link href={`/explore/${slug}/history`} className="ab-btn ab-btn-primary" style={{ background: 'var(--ab-action)', color: '#fff' }}>
          {t(locale, 'overview.startHere')} →
        </Link>
        <Link href={`/explore/${slug}/learn`} className="ab-btn ab-btn-secondary">
          {t(locale, 'overview.learnCta')}
        </Link>
        <Link href={`/explore/${slug}/contribute`} className="ab-btn ab-btn-secondary">
          {t(locale, 'overview.contributeCta')}
        </Link>
      </div>

      <OnboardingMap slug={slug} locale={locale} />
    </div>
  );
}
