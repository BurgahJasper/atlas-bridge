import { z } from 'zod';
import { LocaleSchema } from '@atlas/contracts';
import { checkAndRecord, ensureCuratedDemo } from '@/lib/pipeline';
import { ApiError } from '@/lib/errors';
import { handle, jsonOk, readJsonBody } from '@/lib/api-utils';

// TRD §6.1: POST /api/missions/:id/check — validate learner changes against
// the deterministic evaluator. Body may include anonymous id + locale so the
// route records LearnerProgress locally (FR-12); without them it behaves as a
// plain validation call.
const BodySchema = z.object({
  submission: z.object({
    stepId: z.string().min(1),
    answerText: z.string().max(20000).optional(),
    quizAnswer: z.string().optional(),
    editedFiles: z.array(z.object({ path: z.string().max(1024), content: z.string().max(1_000_000) })).optional(),
  }),
  userOrAnonymousId: z.string().min(1).optional(),
  locale: LocaleSchema.default('en'),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    await ensureCuratedDemo();
    const { id } = await params;
    const body = (await readJsonBody(request)) as unknown;
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(400, 'bad_request', `validation failed — ${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`);
    }
    const { submission, userOrAnonymousId, locale } = parsed.data;
    const result = await checkAndRecord({
      missionId: id,
      submission,
      userOrAnonymousId: userOrAnonymousId ?? 'anonymous',
      locale,
    });
    return jsonOk({
      passed: result.passed,
      completedStepId: result.completedStepId,
      feedback: result.feedback,
      failedRule: result.failedRule,
      progress: result.progress,
    });
  });
}
