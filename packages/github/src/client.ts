// TRD §4.1 repo ingestion: bounded, deterministic GitHub REST retrieval (FR-02).
// Dependency-free: uses the global fetch. Commit lists stay newest-first on the
// wire and are returned ascending (newest-last) per §4.2 step 1.

import type { CommitInfo, CompareFile, RepoMeta, TreeEntry } from './types.js';
import { GitHubError } from './errors.js';

export interface GitHubClient {
  fetchRepoMeta(owner: string, name: string): Promise<RepoMeta>;
  /** Ascending by committerDate (newest last). */
  fetchCommits(owner: string, name: string, limit: number): Promise<CommitInfo[]>;
  fetchCompare(
    owner: string,
    name: string,
    baseSha: string,
    headSha: string,
  ): Promise<{ files: CompareFile[] }>;
  /** Recursive tree; silently truncated to maxEntries (no error). */
  fetchTree(owner: string, name: string, sha: string, maxEntries?: number): Promise<TreeEntry[]>;
  /** Text files only; GitHubError 'unsupported' for binaries or oversized content. */
  fetchFile(owner: string, name: string, path: string, sha: string, maxBytes?: number): Promise<string>;
}

export interface GitHubClientOptions {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_PAGE_SIZE = 100;
const MAX_COMMIT_LIMIT = 60;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
/** Hard per-request cap so a stalled network can never wedge a job (FR-02). */
const REQUEST_TIMEOUT_MS = 15_000;
/** Binary heuristic threshold: >30% of bytes above 0x7F → not text. */
const BINARY_RATIO = 0.3;

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'atlas-bridge',
      'X-GitHub-Api-Version': API_VERSION,
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    return headers;
  }

  async function requestJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: buildHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // Fetch rejection (offline, DNS, TLS, timeout…) → 'network', never a crash.
      const timedOut = cause instanceof Error && /abort|timeout/i.test(cause.name + cause.message);
      throw new GitHubError(
        'network',
        timedOut
          ? `GitHub request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`
          : `GitHub request failed: ${describeCause(cause)}`,
      );
    }

    if (response.status === 404) {
      throw new GitHubError('not-found', `GitHub resource not found: ${url}`, 404);
    }
    if (response.status === 403 || response.status === 429) {
      throw new GitHubError(
        'rate-limited',
        `GitHub rate limited (HTTP ${response.status})`,
        response.status,
        readRetryAfterMs(response),
      );
    }
    if (response.status >= 500) {
      throw new GitHubError('network', `GitHub server error (HTTP ${response.status})`, response.status);
    }
    if (!response.ok) {
      throw new GitHubError('forbidden', `GitHub refused the request (HTTP ${response.status})`, response.status);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw new GitHubError('network', `GitHub response body unreadable: ${describeCause(cause)}`, response.status);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // Non-JSON body (e.g. HTML error page) → 'network' (TRD §9.1 partial responses).
      throw new GitHubError('network', `GitHub returned non-JSON content (HTTP ${response.status})`, response.status);
    }
    return parsed as T;
  }

  const client: GitHubClient = {
    async fetchRepoMeta(owner, name) {
      interface ApiRepo {
        default_branch?: string;
        description?: string | null;
        license?: { spdx_id?: string | null } | null;
        stargazers_count?: number;
        private?: boolean;
      }
      const repo = await requestJson<ApiRepo>(
        `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      );
      // Be permissive: license/counts may be absent (§4.1: deterministic bounded retrieval).
      const spdx = repo.license?.spdx_id ?? null;
      return {
        owner,
        name,
        defaultBranch: typeof repo.default_branch === 'string' && repo.default_branch.length > 0 ? repo.default_branch : 'main',
        description: typeof repo.description === 'string' ? repo.description : null,
        licenseSpdx: spdx && spdx !== 'NOASSERTION' && spdx !== 'NONE' ? spdx : null,
        stars: typeof repo.stargazers_count === 'number' ? repo.stargazers_count : 0,
        visibility: repo.private === true ? 'private' : 'public',
      };
    },

    async fetchCommits(owner, name, limit) {
      if (!Number.isFinite(limit) || limit <= 0) return [];
      // Bounded: clamp the window (demo N=30, cap 60) and page with per_page ≤ 100.
      const wanted = Math.min(Math.floor(limit), MAX_COMMIT_LIMIT);
      const pages = Math.ceil(wanted / MAX_PAGE_SIZE);

      interface ApiCommit {
        sha?: string;
        commit?: { message?: string; committer?: { date?: string } };
        parents?: { sha?: string }[];
      }
      const raw: ApiCommit[] = [];
      for (let page = 1; page <= pages; page++) {
        const perPage = Math.min(MAX_PAGE_SIZE, wanted - raw.length);
        const batch = await requestJson<ApiCommit[]>(
          `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?per_page=${perPage}&page=${page}`,
        );
        if (!Array.isArray(batch)) {
          throw new GitHubError('network', 'GitHub commits response was not a list');
        }
        raw.push(...batch);
        if (batch.length < perPage) break; // short page: no newer history to fetch
      }

      return raw
        .filter((c): c is ApiCommit & { sha: string; commit: { committer: { date: string } } } =>
          typeof c.sha === 'string' &&
          typeof c.commit?.committer?.date === 'string' &&
          typeof c.commit.message === 'string')
        .map((c) => ({
          sha: c.sha,
          // Treat repo text as data only; a missing message stays empty, never undefined.
          message: c.commit.message ?? '',
          // TRD §4.2: commit list dates come from commit.committer.date.
          committerDate: c.commit.committer.date,
          parents: (c.parents ?? [])
            .map((p) => p.sha)
            .filter((sha): sha is string => typeof sha === 'string'),
          // filesChanged intentionally omitted: file lists come from the compare API only.
        }))
        .slice(0, wanted) // wire order is newest-first → the newest `wanted` commits
        .sort(compareCommitInfo); // ascending committerDate → newest-last
    },

    async fetchCompare(owner, name, baseSha, headSha) {
      interface ApiCompareFile {
        filename?: string;
        previous_filename?: string;
        status?: string;
        additions?: number;
        deletions?: number;
        patch?: string;
      }
      const data = await requestJson<{ files?: ApiCompareFile[] }>(
        `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
      );
      const files = (data.files ?? []).map((f) => {
        const status = normalizeStatus(f.status);
        const mapped: CompareFile = {
          path: typeof f.filename === 'string' ? f.filename : '',
          status,
          additions: typeof f.additions === 'number' ? f.additions : 0,
          deletions: typeof f.deletions === 'number' ? f.deletions : 0,
        };
        if (status === 'renamed' && typeof f.previous_filename === 'string') {
          mapped.previousPath = f.previous_filename; // TRD §4.2 step 4: rename tracking
        }
        if (typeof f.patch === 'string') mapped.patch = f.patch;
        return mapped;
      });
      return { files };
    },

    async fetchTree(owner, name, sha, maxEntries) {
      interface ApiTreeEntry {
        path?: string;
        type?: string;
        size?: number;
        sha?: string;
      }
      const data = await requestJson<{ tree?: ApiTreeEntry[] }>(
        `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
      );
      const entries: TreeEntry[] = (data.tree ?? [])
        .filter((t): t is ApiTreeEntry & { path: string; sha: string } =>
          typeof t.path === 'string' && typeof t.sha === 'string' && (t.type === 'blob' || t.type === 'tree'))
        .map((t) => ({
          path: t.path,
          type: t.type === 'tree' ? 'tree' : 'blob',
          size: typeof t.size === 'number' ? t.size : 0,
          sha: t.sha,
        }));
      return maxEntries === undefined ? entries : entries.slice(0, Math.max(0, maxEntries));
    },

    async fetchFile(owner, name, path, sha, maxBytes = DEFAULT_MAX_FILE_BYTES) {
      interface ApiContent { content?: string | null }
      const data = await requestJson<ApiContent>(
        `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(sha)}`,
      );
      const encoded = data.content;
      if (typeof encoded !== 'string') {
        throw new GitHubError('unsupported', `File '${path}' could not be inlined by GitHub (too large or empty)`);
      }
      const bytes = base64ToBytes(encoded);
      if (bytes.byteLength > maxBytes) {
        throw new GitHubError('unsupported', `File '${path}' exceeds the ${maxBytes}-byte cap`);
      }
      if (isProbablyBinary(bytes)) {
        throw new GitHubError('unsupported', `File '${path}' looks binary`);
      }
      return new TextDecoder('utf-8').decode(bytes);
    },
  };

  return client;
}

/** Ascending committerDate, deterministic lexicographic sha tie-break. */
function compareCommitInfo(a: CommitInfo, b: CommitInfo): number {
  if (a.committerDate !== b.committerDate) return a.committerDate < b.committerDate ? -1 : 1;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  return 0;
}

function normalizeStatus(status: string | undefined): CompareFile['status'] {
  if (status === 'added' || status === 'removed' || status === 'modified' || status === 'renamed') return status;
  return 'modified'; // GitHub also emits 'changed' for combined compare states
}

/**
 * Convert GitHub's rate-limit headers to a delay.
 * x-ratelimit-reset is an epoch second; Retry-After is a relative second.
 * Map only — the caller decides whether to wait (never auto-block).
 */
function readRetryAfterMs(response: Response): number | undefined {
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset) {
    const epochMs = Number(reset) * 1000;
    if (Number.isFinite(epochMs)) {
      return Math.max(0, epochMs - Date.now());
    }
  }
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return undefined;
}

function base64ToBytes(encoded: string): Uint8Array {
  const compact = encoded.replace(/\s+/g, '');
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** >30% of bytes above 0x7F → hostile/unsupported binary, refuse to decode as text. */
function isProbablyBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let high = 0;
  for (const byte of bytes) if (byte > 0x7f) high++;
  return high / bytes.length > BINARY_RATIO;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
