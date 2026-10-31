import { AnalyzeRequestSchema } from '@atlas/contracts';
import { getPipeline } from '@/lib/pipeline';
import { encodeSlug, parseGitHubUrl } from '@/lib/slug';
import { handle, jsonOk, parseBody, readJsonBody } from '@/lib/api-utils';

// TRD §6.1: POST /api/repos/analyze — validate URL, queue bounded analysis,
// return jobId (+slug so the client can route to /explore/owner__name).
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = parseBody(AnalyzeRequestSchema, await readJsonBody(request));
    const { jobId } = await getPipeline().analyze({ url: body.url, locale: body.locale ?? 'en' });
    const ref = parseGitHubUrl(body.url);
    return jsonOk({ jobId, slug: ref ? encodeSlug(ref) : null });
  });
}
