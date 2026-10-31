import { ContributionPreviewRequestSchema, ContributionPreviewResponseSchema } from '@atlas/contracts';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { handle, jsonOk, parseBody, readJsonBody } from '@/lib/api-utils';

// TRD §6.1: POST /api/contributions/preview — compute diff, scope and future
// PR payload. No write happens here (FR-10: submission is separate + OAuth).
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = parseBody(ContributionPreviewRequestSchema, await readJsonBody(request));
    const resolved = await getOverviewBySlug(body.repositoryId);
    const repositoryId = resolved?.repositoryId ?? body.repositoryId;
    const raw = await getPipeline().previewContribution({ ...body, repositoryId });
    const parsed = ContributionPreviewResponseSchema.safeParse(raw);
    return jsonOk(parsed.success ? parsed.data : raw);
  });
}
