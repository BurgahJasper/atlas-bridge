import { ExplanationRequestSchema, ExplanationResponseSchema } from '@atlas/contracts';
import { getOverviewBySlug, getPipeline } from '@/lib/pipeline';
import { handle, jsonOk, parseBody, readJsonBody } from '@/lib/api-utils';

// TRD §6.1: POST /api/explanations — generate/fetch locale+level explanation.
// Never trusts arbitrary client evidence: request carries only ids, sha,
// subject, locale and level (TRD §5.2). Response is schema-validated.
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = parseBody(ExplanationRequestSchema, await readJsonBody(request));
    const resolved = await getOverviewBySlug(body.repositoryId);
    const repositoryId = resolved?.repositoryId ?? body.repositoryId;
    const raw = await getPipeline().explain({
      repositoryId,
      snapshotSha: body.snapshotSha,
      subject: body.subject,
      task: body.task,
      locale: body.locale,
      level: body.level,
    });
    const parsed = ExplanationResponseSchema.safeParse(raw);
    return jsonOk(parsed.success ? parsed.data : raw);
  });
}
