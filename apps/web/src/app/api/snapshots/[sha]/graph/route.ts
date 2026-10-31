import { z } from 'zod';
import { getPipeline } from '@/lib/pipeline';
import { ApiError } from '@/lib/errors';
import { getOverviewBySlug } from '@/lib/pipeline';
import { handle, jsonOk, parseQuery } from '@/lib/api-utils';

// TRD §6.1: GET /api/snapshots/:sha/graph?repositoryId= — provenance-backed
// nodes and edges. repositoryId may be a slug; resolved the same way as
// overview. 404 when the snapshot is not loaded in-process (TRD: re-run
// analysis) — surfaced with a stable code.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sha: string }> },
): Promise<Response> {
  return handle(async () => {
    const { sha } = await params;
    const query = parseQuery(z.object({ repositoryId: z.string().min(1) }), new URL(request.url));
    const resolved = await getOverviewBySlug(query.repositoryId);
    const repositoryId = resolved?.repositoryId ?? query.repositoryId;
    try {
      const graph = await getPipeline().graph(repositoryId, sha);
      return jsonOk(graph);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not (found|loaded)/i.test(message) || /404/.test(message)) {
        throw new ApiError(404, 'not_analyzed', `snapshot ${sha} not loaded for ${repositoryId}`);
      }
      throw error;
    }
  });
}
