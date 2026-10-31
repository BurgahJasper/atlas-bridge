import { getOverviewBySlug } from '@/lib/pipeline';
import { ApiError } from '@/lib/errors';
import { decodeSlug } from '@/lib/slug';
import { handle, jsonOk } from '@/lib/api-utils';

// TRD §6.1: GET /api/repos/:id/overview. The path parameter may be an opaque
// repositoryId OR an owner__name slug; resolution order is store slug index →
// overview() over plausible ids (lib/pipeline.ts). 404 carries code
// 'not_analyzed' so clients can drive the analyze-then-poll flow.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return handle(async () => {
    const { slug } = await params;
    if (!decodeSlug(slug)) throw new ApiError(400, 'bad_request', `invalid slug: ${slug}`);
    const overview = await getOverviewBySlug(slug);
    if (!overview) {
      throw new ApiError(404, 'not_analyzed', `no analysis found for ${slug}`);
    }
    return jsonOk(overview);
  });
}
