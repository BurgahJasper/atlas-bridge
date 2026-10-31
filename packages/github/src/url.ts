// TRD §4.1 / FR-01: parse and validate GitHub repo URLs; reject unsafe hosts (SSRF guard).
// Hostile input: treat every URL as adversarial — parse, then allowlist.

export interface ParsedRepoUrl {
  owner: string;
  name: string;
}

/** Repo/owner path segments allow alphanumerics and `-._` but never path traversal. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Only accepts https://github.com/owner/re[.git][/tree|/blob/...].
 * Returns { owner, name } or null for anything else.
 */
export function parseGitHubRepoUrl(url: string): ParsedRepoUrl | null {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // https only (FR-01: reject http and unknown schemes such as javascript:).
  if (parsed.protocol !== 'https:') return null;

  // No userinfo / credentials (SSRF + credential-leak guard, TRD §7).
  if (parsed.username || parsed.password) return null;
  if (parsed.href.includes('@')) return null;

  // Allowlist the host; this rejects localhost, IP literals and look-alike hosts.
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;

  if (parsed.search || parsed.hash) return null;

  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return null;

  const owner = segments[0]!;
  const rawName = segments[1]!;
  const name = rawName.endsWith('.git') ? rawName.slice(0, -4) : rawName;

  // Optional trailing pen-ends are accepted only as tree/blob permalinks; strip them.
  if (segments.length > 2) {
    const follow = segments[2]!;
    if (follow !== 'tree' && follow !== 'blob') return null;
  }

  // Segment validation: no empty, no traversal ('.') tricks, no stray separators.
  for (const segment of [owner, name]) {
    if (!SEGMENT_RE.test(segment) || segment.includes('..') || segment.startsWith('.')) return null;
  }

  return { owner, name };
}
