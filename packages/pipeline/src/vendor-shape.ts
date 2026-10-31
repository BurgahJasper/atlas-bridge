/**
 * Tolerant accessors for sibling-package payloads (TRD §10.3 parallel build).
 *
 * @atlas/github / @atlas/ai are developed concurrently by other agents; to keep
 * @atlas/pipeline compilable against their *published contracts* only, payloads
 * like CommitInfo / TreeEntry / CompareFile / RepoMeta are read through narrow
 * structural probes instead of direct property access. This trades a little
 * verbosity for resilience against parallel API drift.
 */
// TRD §10.3 (parallel package ownership)

export function field(payload: unknown, key: string): unknown {
  if (payload === null || typeof payload !== 'object') return undefined;
  return (payload as Record<string, unknown>)[key];
}

/** First non-empty string among candidates; missing => ''. */
export function asString(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '';
}

export function asNumber(...candidates: unknown[]): number {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return 0;
}

export function orNull(...candidates: unknown[]): string | null {
  const value = asString(...candidates);
  return value.length > 0 ? value : null;
}

// ── CommitInfo probes (ascending order guaranteed by @atlas/github) ─────────

export function shaOf(commit: unknown): string {
  return asString(field(commit, 'sha'), field(commit, 'id'));

}

export function msgOf(commit: unknown): string {
  return asString(field(commit, 'message'), field(commit, 'msg'));
}

export function commitSubject(commit: unknown): string {
  return msgOf(commit).split('\n')[0] ?? '';
}

export function timeOf(commit: unknown): string {
  const direct = field(commit, 'date') ?? field(commit, 'time') ?? field(commit, 'committedAt');
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const author = field(commit, 'author');
  const nested = field(author, 'date') ?? field(field(author, 'committer'), 'date');
  if (typeof nested === 'string' && nested.length > 0) return nested;
  return new Date().toISOString();
}

// ── TreeEntry probes ─────────────────────────────────────────────────────────

export function treeEntryPath(entry: unknown): string {
  return asString(field(entry, 'path'), field(entry, 'name'));
}

export function treeEntrySize(entry: unknown): number | undefined {
  const size = field(entry, 'size');
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
}

export function treeEntryIsFile(entry: unknown): boolean {
  const type = field(entry, 'type');
  if (type == null) return true; // tolerant: absence implies blob in GitHub trees API
  const t = String(type);
  return t === 'blob' || t === 'file';
}

// ── CompareFile probes ───────────────────────────────────────────────────────

export function comparePath(file: unknown): string {
  return asString(field(file, 'path'), field(file, 'filename'));
}

/** Patch bodies are optional (binary/oversized files carry none). */
export function comparePatch(file: unknown): string {
  const patch = field(file, 'patch') ?? field(file, 'patchText');
  return typeof patch === 'string' ? patch : '';
}

// ── RepoMeta probes ──────────────────────────────────────────────────────────

export function metaDefaultBranch(meta: unknown): string {
  return asString(field(meta, 'defaultBranch'), field(meta, 'default_branch')) || 'main';
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function firstLine(text: string): string {
  return text.split('\n')[0] ?? '';
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function ghUrl(owner: string, name: string, sha: string, path?: string): string {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  return path ? `${base}/blob/${sha}/${path}` : `${base}/commit/${sha}`;
}
