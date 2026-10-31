import { ContributionSubmitRequestSchema } from '@atlas/contracts';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { handle, jsonOk, parseBody, readJsonBody } from '@/lib/api-utils';

// TRD §6.1 / FR-10: POST /api/contributions/submit — requires explicit
// confirmation (zod literal `confirmed: true`); without real OAuth
// authorization the pipeline returns status 'reviewed' with an honest note.
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = parseBody(ContributionSubmitRequestSchema, await readJsonBody(request));
    const resolved = await getOverviewBySlug(body.repositoryId);
    const repositoryId = resolved?.repositoryId ?? body.repositoryId;
    const result = await getPipeline().submitContribution({ ...body, repositoryId });
    return jsonOk(result);
  });
}
