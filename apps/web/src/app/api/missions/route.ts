import { z } from 'zod';
import { getOverviewBySlug, getPipeline, ensureCuratedDemo } from '@/lib/pipeline';
import { handle, jsonOk, parseQuery } from '@/lib/api-utils';

// TRD §6.1: GET /api/missions?repositoryId= — curated/approved missions.
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    await ensureCuratedDemo();
    const query = parseQuery(z.object({ repositoryId: z.string().min(1) }), new URL(request.url));
    const resolved = await getOverviewBySlug(query.repositoryId);
    const repositoryId = resolved?.repositoryId ?? query.repositoryId;
    const missions = await getPipeline().listMissions(repositoryId);
    return jsonOk({ missions });
  });
}
