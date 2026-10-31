import type { Locale } from '@atlas/contracts';
import { t } from './i18n';

/**
 * Canonical pipeline/API error codes surfaced by the worker adapter and route
 * handlers. TRD §2.4: every state gets a visible next action, so each code has
 * a localized message + hint in both dictionaries.
 */
export type ErrorCode =
  | 'rate_limited'
  | 'not_found'
  | 'not_analyzed'
  | 'bad_request'
  | 'unsupported'
  | 'permission_denied'
  | 'failed'
  | 'offline'
  | 'generic';

export class ApiError extends Error {
  status: number;
  code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function classifyStatus(status: number): ErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'bad_request';
  if (status === 403) return 'permission_denied';
  if (status >= 500) return 'failed';
  return 'generic';
}

export function errorFromStatus(status: number, raw?: string): ApiError {
  const code = classifyStatus(status);
  const rawText = raw && raw.trim().length > 0 ? `: ${raw.trim().slice(0, 200)}` : '';
  return new ApiError(status, code, `${code}${rawText}`);
}

/** Localized user-facing message for an ApiError (code preferred over raw text). */
export function errorMessage(error: unknown, locale: Locale): string {
  const code: ErrorCode =
    error instanceof ApiError
      ? error.code
      : error instanceof Error && /429|rate/i.test(error.message)
        ? 'rate_limited'
        : 'generic';
  return t(locale, `errors.${code}` as never) as string;
}

/** Localized secondary hint (next action) for an error code. */
export function errorHint(error: unknown, locale: Locale): string {
  const code: ErrorCode = error instanceof ApiError ? error.code : 'generic';
  return t(locale, `errors.${code}_hint` as never) as string;
}
