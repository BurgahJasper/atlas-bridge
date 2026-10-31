'use client';

import { ApiError, type ErrorCode } from './errors';

/**
 * Client-side fetch helper for the web app's own /api routes. Errors come back
 * as structured {error, code}; rate limits (429) surface identically across
 * embedded and worker modes (TRD §2.4 states).
 */

export interface ApiIssue extends Error {
  status: number;
  code: ErrorCode;
}

export function isApiIssue(error: unknown): error is ApiIssue {
  return error instanceof ApiError;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const obj = (payload ?? {}) as { error?: string; code?: ErrorCode };
    throw new ApiError(
      res.status,
      obj.code ?? (res.status === 429 ? 'rate_limited' : mapStatus(res.status)),
      obj.error ?? `request failed (${res.status})`,
    );
  }
  return payload as T;
}

function mapStatus(status: number): ErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 413 || status === 422) return 'bad_request';
  if (status === 403) return 'permission_denied';
  return 'generic';
}

/** Anonymous id (FR-12): random UUID cookie, set on first visit, no PII. */
export function getOrCreateAnonymousId(): string {
  if (typeof document === 'undefined') return 'server';
  const match = document.cookie.match(/(?:^|;\s*)ab-uid=([^;]+)/);
  if (match) return decodeURIComponent(match[1]!);
  const id = crypto.randomUUID();
  document.cookie = `ab-uid=${id}; path=/; max-age=31536000; samesite=lax`;
  return id;
}

export function setClientCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
