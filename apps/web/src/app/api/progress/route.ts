import { z } from 'zod';
import { LocaleSchema } from '@atlas/contracts';
import { getStore } from '@/lib/pipeline';
import { ApiError } from '@/lib/errors';
import { handle, jsonOk, readJsonBody } from '@/lib/api-utils';

/**
 * Web-owned learner progress (FR-12): GET/POST by anonymous id + missionId.
 * The web app creates the shared Store in lib/pipeline.ts, so progress is
 * available in both embedded and worker modes. No PII: opaque ids only.
 */

const GetQuerySchema = z.object({
  userOrAnonymousId: z.string().min(1),
  missionId: z.string().min(1),
});

const PutBodySchema = z.object({
  userOrAnonymousId: z.string().min(1),
  missionId: z.string().min(1),
  locale: LocaleSchema.default('en'),
  completedSteps: z.array(z.string()).default([]),
  results: z
    .array(z.object({ stepId: z.string(), passed: z.boolean(), at: z.string() }))
    .default([]),
});

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const url = new URL(request.url);
    const parsed = GetQuerySchema.safeParse({
      userOrAnonymousId: url.searchParams.get('userOrAnonymousId') ?? undefined,
      missionId: url.searchParams.get('missionId') ?? undefined,
    });
    if (!parsed.success) throw new ApiError(400, 'bad_request', 'userOrAnonymousId and missionId are required');
    const { userOrAnonymousId, missionId } = parsed.data;
    const progress = await getStore().getProgress(userOrAnonymousId, missionId);
    return jsonOk({ progress });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = (await readJsonBody(request)) as unknown;
    const parsed = PutBodySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(400, 'bad_request', `validation failed — ${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`);
    }
    const data = parsed.data;
    const existing = await getStore().getProgress(data.userOrAnonymousId, data.missionId);
    const completed = new Set([...(existing?.completedSteps ?? []), ...data.completedSteps]);
    const progress = {
      id: existing?.id ?? `lp_${data.userOrAnonymousId}_${data.missionId}`,
      userOrAnonymousId: data.userOrAnonymousId,
      missionId: data.missionId,
      locale: data.locale,
      completedSteps: [...completed],
      results: [...(existing?.results ?? []), ...data.results],
      updatedAt: new Date().toISOString(),
    };
    await getStore().putProgress(progress);
    return jsonOk({ progress });
  });
}
