import type { Metadata } from 'next';
import type { TimelineStory } from '@atlas/contracts';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { decodeSlug } from '@/lib/slug';
import { AnalysisGate } from '@/components/explore/AnalysisGate';
import { HistoryWorkbench } from '@/components/explore/HistoryWorkbench';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug.replace('__', ' / ')} — time travel` };
}

// TRD §2.2 /explore/[repo]/history: timeline scrubber + graph canvas + change
// inspector + provenance panel. Data is fetched server-side; all interactivity
// lives in the client HistoryWorkbench.
export default async function HistoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { job } = await searchParams;
  const locale = await getLocale();

  const overview = await getOverviewBySlug(slug);
  const repoRef = decodeSlug(slug);

  if (!overview || !repoRef) {
    return (
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="ab-display">{t(locale, 'history.heading')}</h1>
        <AnalysisGate slug={slug} jobId={job} locale={locale} autoStart={!job} />
      </div>
    );
  }

  const repositoryId = overview.repositoryId;
  const milestones = overview.milestones;
  const headSha = milestones[milestones.length - 1]?.sha ?? overview.snapshots[overview.snapshots.length - 1]?.sha ?? '';

  let story: TimelineStory | null = null;
  if (headSha) {
    try {
      const response = await getPipeline().explain({
        repositoryId,
        snapshotSha: headSha,
        subject: 'timeline',
        task: 'history',
        locale,
        level: 'beginner',
      });
      if (response.kind === 'history') story = response.story;
    } catch {
      story = null; // UI shows history.storyNone with a next action (TRD §2.4)
    }
  }

  return (
    <HistoryWorkbench
      slug={slug}
      locale={locale}
      repositoryId={repositoryId}
      repoRef={repoRef}
      milestones={milestones}
      story={story}
      coverage={overview.coverage}
    />
  );
}
