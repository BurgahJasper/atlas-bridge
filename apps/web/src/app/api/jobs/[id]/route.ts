import { JobStatusResponseSchema } from '@atlas/contracts';
import { getPipeline } from '@/lib/pipeline';
import { ApiError } from '@/lib/errors';
import { handle, jsonOk } from '@/lib/api-utils';

// TRD §6.1: GET /api/jobs/:id — progress, warnings, error details.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const job = await getPipeline().getJob(id);
    if (!job) throw new ApiError(404, 'not_found', `job ${id} not found`);
    const parsed = JobStatusResponseSchema.safeParse({
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      snapshotIds: job.snapshotIds,
      warnings: job.warnings,
      error: job.error,
    });
    return jsonOk(parsed.success ? parsed.data : { ...job, error: job.error });
  });
}
