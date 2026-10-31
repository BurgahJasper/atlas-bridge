// TRD §4.1: deterministic error mapping for the GitHub adapter.
// Callers branch on `kind`; raw HTTP status is retained for diagnostics only.

export type GitHubErrorKind =
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'unsupported'
  | 'forbidden';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  /** Duration suggested by GitHub (x-ratelimit-reset or Retry-After); never auto-waited. */
  readonly retryAfterMs?: number;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
