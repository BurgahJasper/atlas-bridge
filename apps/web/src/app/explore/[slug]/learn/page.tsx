import type { Metadata } from 'next';
import Link from 'next/link';
import type { TimelineStory } from '@atlas/contracts';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { decodeSlug } from '@/lib/slug';
import { AnalysisGate } from '@/components/explore/AnalysisGate';
import { LessonRunner } from '@/components/learn/LessonRunner';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string; level?: string; step?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug.replace('__', ' / ')} — learn` };
}

// TRD §2.2 /explore/[repo]/learn: adaptive lesson cards, glossary, checkpoint.
// Level + step live in the URL so locale switches preserve lesson state
// (TRD §2.5 UX acceptance tests).
export default async function LearnPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const locale = await getLocale();
  const level = query.level === 'intermediate' || query.level === 'advanced' ? query.level : 'beginner';

  const overview = await getOverviewBySlug(slug);
  const repoRef = decodeSlug(slug);

  if (!overview || !repoRef) {
    return (
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="ab-display">{t(locale, 'learn.heading')}</h1>
        <AnalysisGate slug={slug} jobId={query.job} locale={locale} autoStart={!query.job} />
      </div>
    );
  }

  const repositoryId = overview.repositoryId;
  const milestones = overview.milestones;
  const headSha = milestones[milestones.length - 1]?.sha ?? '';

  let story: TimelineStory | null = null;
  if (headSha) {
    try {
      const response = await getPipeline().explain({
        repositoryId,
        snapshotSha: headSha,
        subject: 'timeline',
        task: 'history',
        locale,
        level,
      });
      if (response.kind === 'history') story = response.story;
    } catch {
      story = null;
    }
  }

  if (!story) {
    return (
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="ab-display">{t(locale, 'learn.noStoryTitle')}</h1>
        <p className="ab-prose text-muted">{t(locale, 'learn.noStoryBody')}</p>
        <Link href={`/explore/${slug}/history`} className="ab-btn ab-btn-primary w-fit">
          {t(locale, 'nav.history')} →
        </Link>
      </div>
    );
  }

  return (
    <LessonRunner
      slug={slug}
      locale={locale}
      level={level}
      story={story}
      milestones={milestones}
      repoRef={repoRef}
      initialStep={Number(query.step ?? '0') || 0}
    />
  );
}
