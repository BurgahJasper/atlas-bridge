import type { ZodSchema } from 'zod';
import { ApiError } from './errors';

/** Shared helpers for App Router route handlers (TRD §6.1 error semantics). */

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data as unknown as Record<string, unknown>, {
    status: 200,
    ...init,
  });
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status });
}

const MAX_BODY_BYTES = 1_000_000; // 1 MB guard (TRD §7 abuse throttles)

export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    throw new ApiError(413, 'bad_request', 'request body too large');
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new ApiError(400, 'bad_request', 'unreadable request body');
  }
  if (raw.length > MAX_BODY_BYTES) {
    throw new ApiError(413, 'bad_request', 'request body too large');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, 'bad_request', 'request body is not valid JSON');
  }
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue ? `${issue.path.join('.')}: ${issue.message}` : result.error.message;
    throw new ApiError(400, 'bad_request', `validation failed — ${where}`);
  }
  return result.data;
}

export function parseQuery<T>(schema: ZodSchema<T>, url: URL): T {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    obj[key] = value;
  });
  const result = schema.safeParse(obj);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue ? `${issue.path.join('.')}: ${issue.message}` : result.error.message;
    throw new ApiError(400, 'bad_request', `invalid query — ${where}`);
  }
  return result.data;
}

/** Wrap a handler so ApiError/unknown errors map to stable JSON error shapes. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonError(error.status, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    // Rate limit surfacing (TRD §8 SLOs): any 429/rate signal persists as 429.
    if (/429|rate.?limit/i.test(message)) {
      return jsonError(429, 'rate_limited', 'rate limited');
    }
    if (/not (found|analyzed)/i.test(message)) {
      return jsonError(404, 'not_found', message);
    }
    if (/unsupport/i.test(message)) {
      return jsonError(422, 'unsupported', message);
    }
    if (/permission|forbidden|forbid/i.test(message)) {
      return jsonError(403, 'permission_denied', message);
    }
    console.error('[atlas/web api]', message);
    return jsonError(500, 'generic', 'internal error');
  }
}
