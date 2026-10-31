import type { Metadata } from 'next';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { decodeSlug } from '@/lib/slug';
import { AnalysisGate } from '@/components/explore/AnalysisGate';
import { MissionBoard } from '@/components/contribute/MissionRunner';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ job?: string; mission?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${slug.replace('__', ' / ')} — contribute` };
}

// TRD §2.2 /explore/[repo]/contribute: mission board, file editor/diff,
// deterministic checks, PR preview with explicit consent (FR-06, FR-07, FR-10).
export default async function ContributePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const locale = await getLocale();

  const overview = await getOverviewBySlug(slug);
  const repoRef = decodeSlug(slug);

  if (!overview || !repoRef) {
    return (
      <div className="mx-auto grid max-w-2xl gap-6">
        <h1 className="ab-display">{t(locale, 'contribute.heading')}</h1>
        <AnalysisGate slug={slug} jobId={query.job} locale={locale} autoStart={!query.job} />
      </div>
    );
  }

  const repositoryId = overview.repositoryId;
  const missions = await getPipeline().listMissions(repositoryId);

  return (
    <MissionBoard
      slug={slug}
      locale={locale}
      repositoryId={repositoryId}
      repoRef={repoRef}
      missions={missions}
      initialMissionId={query.mission ?? null}
    />
  );
}
