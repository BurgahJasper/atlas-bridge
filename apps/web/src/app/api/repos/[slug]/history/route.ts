import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { handle, jsonOk } from '@/lib/api-utils';

// TRD §6.1: GET /api/repos/:id/history — milestones with delta metadata.
// Accepts an opaque repositoryId OR an owner__name slug; slug → repositoryId
// resolution lives in lib/pipeline.ts (store slug index first, then
// overview() attempts). No aliasing: 'milestones' wrapper + items verbatim.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return handle(async () => {
    const { slug } = await params;
    const resolved = await getOverviewBySlug(slug);
    const repositoryId = resolved?.repositoryId ?? slug;
    const milestones = await getPipeline().history(repositoryId);
    return jsonOk({ milestones });
  });
}
