import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Offline file-content access for the curated fixture repository (TRD §10.1:
 * stable fixtures; the demo must work fully offline). The fixture JSON is
 * owned by packages/pipeline; we read it read-only. Fixture shape risk is
 * contained here: any record with a matching `path` (or `file`) and a string
 * content-like field (content | contents | text) qualifies.
 */

export const CURATED_FIXTURE_NAME = 'octokit-request-js';
export const CURATED_SLUG = 'octokit__request.js';
// TRD §1.4 P0: the demo path pins the curated repository.
export const CURATED_URL = 'https://github.com/octokit/request.js';

export interface CuratedFileResult {
  path: string;
  content: string;
  sha: string | null;
  source: 'fixture';
}

function fixtureCandidates(fixtureName: string): string[] {
  const dir = path.resolve(process.cwd(), '..', '..', 'packages', 'pipeline', 'src', 'fixtures');
  return [path.join(dir, `${fixtureName}.json`), path.join(dir, fixtureName, 'index.json'), path.join(dir, fixtureName, 'fixture.json')];
}

const fixtureCache = new Map<string, unknown | null>();

async function loadFixtureJson(fixtureName: string): Promise<unknown | null> {
  if (fixtureCache.has(fixtureName)) return fixtureCache.get(fixtureName) ?? null;
  for (const file of fixtureCandidates(fixtureName)) {
    try {
      const text = await fs.readFile(file, 'utf8');
      const parsed: unknown = JSON.parse(text);
      fixtureCache.set(fixtureName, parsed);
      return parsed;
    } catch {
      // try next candidate
    }
  }
  fixtureCache.set(fixtureName, null);
  return null;
}

/** Read a file's content from the committed fixture. Returns null when absent. */
export async function readCuratedFile(repoPath: string, sha?: string | null): Promise<CuratedFileResult | null> {
  const json = await loadFixtureJson(CURATED_FIXTURE_NAME);
  if (!json) return null;

  // README files are pinned in the fixture's `readme` map (keyed by SHA),
  // source files in `files` (keyed `${sha}:${path}`). Exact matches only.
  if (sha && /(^|\/)readme\.md$/i.test(repoPath)) {
    const readme = (json as { readme?: Record<string, unknown> }).readme;
    const content = readme?.[sha];
    if (typeof content === 'string') {
      return { path: repoPath, content, sha, source: 'fixture' };
    }
  }

  // Fixture map shape: keys are `${sha}:${path}` (TRD FR-02 immutable pin).
  // Exact-key matching only — never return a different file's content, which
  // would fabricate evidence (TRD §5.3).
  const filesMap = (json as { files?: unknown }).files;
  if (filesMap && typeof filesMap === 'object' && !Array.isArray(filesMap)) {
    const map = filesMap as Record<string, unknown>;
    const candidates = sha ? [`${sha}:${repoPath}`] : [];
    for (const key of Object.keys(map)) {
      if (key.endsWith(`:${repoPath}`) && !candidates.includes(key)) candidates.push(key);
    }
    for (const key of candidates) {
      const entry = map[key];
      if (typeof entry === 'string') {
        return { path: repoPath, content: entry, sha: sha ?? key.split(':')[0] ?? null, source: 'fixture' };
      }
    }
    return null;
  }
  return null;
}
