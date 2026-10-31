/**
 * Slug helpers (TRD §2.2): routes address a repository as `${owner}__${name}`
 * while pipeline APIs address it by opaque repositoryId. Resolution lives in
 * lib/pipeline.ts (getOverviewBySlug) — do not assume id === slug.
 */

export interface RepoRef {
  owner: string;
  name: string;
}

export function encodeSlug(ref: RepoRef): string {
  return `${ref.owner}__${ref.name}`;
}

export function decodeSlug(slug: string): RepoRef | null {
  const idx = slug.indexOf('__');
  if (idx <= 0 || idx === slug.length - 2) return null;
  const owner = slug.slice(0, idx);
  const name = slug.slice(idx + 2);
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { owner, name };
}

/**
 * Validate and parse a public GitHub URL (FR-01). Host allowlist: only
 * github.com; blocks SSRF-style hosts by construction.
 */
export function parseGitHubUrl(input: string): (RepoRef & { url: string }) | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;
  const parts = parsed.pathname.split('/').filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const name = parts[1]!.replace(/\.git$/, '');
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { owner, name, url: `https://github.com/${owner}/${name}` };
}

export function githubUrlFor(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.name}`;
}

export function commitUrl(ref: RepoRef, sha: string): string {
  return `https://github.com/${ref.owner}/${ref.name}/commit/${sha}`;
}

/** File permalink at an exact revision with optional line anchor (evidence-derived only). */
export function fileUrl(ref: RepoRef, sha: string, path: string, line?: number, endLine?: number): string {
  const anchor = line ? `#L${line}${endLine && endLine > line ? `-L${endLine}` : ''}` : '';
  return `https://github.com/${ref.owner}/${ref.name}/blob/${sha}/${path}${anchor}`;
}

export function fileUrlAtBranch(ref: RepoRef, branch: string, path: string): string {
  return `https://github.com/${ref.owner}/${ref.name}/blob/${branch}/${path}`;
}
