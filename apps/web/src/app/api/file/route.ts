import { z } from 'zod';
import { readCuratedFile } from '@/lib/curated';
import { githubUrlFor, type RepoRef } from '@/lib/slug';
import { getEnv } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { handle, jsonOk, parseQuery } from '@/lib/api-utils';

/**
 * GET /api/file — original file content for mission edit steps (TRD §2.2
 * contribute). Fallback order:
 * 1. curated fixture (offline-first, demo path — TRD §11 reliability);
 * 2. live GitHub fetch via @atlas/github when a token/network is available;
 * 3. 404 with an 'Open on GitHub' next action (FR-08: visible next action).
 */
const QuerySchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1).max(1024),
  sha: z.string().optional(),
});

interface FilePayload {
  path: string;
  content: string;
  sha: string | null;
  source: 'fixture' | 'github' | 'github-raw';
  githubUrl: string;
}

async function fetchFromGitHub(ref: RepoRef, path: string, sha?: string): Promise<string | null> {
  // Live fetch needs an immutable revision (TRD FR-02); HEAD guesses would
  // break the evidence contract, so only exact-SHA requests hit the network.
  if (!sha) return null;
  const env = getEnv();
  try {
    const { createGitHubClient } = await import('@atlas/github');
    const client = createGitHubClient({ token: env.githubToken ?? undefined });
    return await client.fetchFile(ref.owner, ref.name, path, sha, 200_000);
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const query = parseQuery(QuerySchema, new URL(request.url));
    const ref: RepoRef = { owner: query.owner, name: query.name };
    const githubUrl = `${githubUrlFor(ref)}/blob/${query.sha ?? 'HEAD'}/${query.path}`;

    // 1) Fixture (works fully offline for the curated repo).
    const fixture = await readCuratedFile(query.path, query.sha ?? null);
    if (fixture) {
      const payload: FilePayload = {
        path: fixture.path,
        content: fixture.content,
        sha: fixture.sha,
        source: 'fixture',
        githubUrl,
      };
      return jsonOk(payload);
    }

    // 2) Live GitHub (network optional).
    const content = await fetchFromGitHub(ref, query.path, query.sha);
    if (content !== null) {
      const payload: FilePayload = {
        path: query.path,
        content,
        sha: query.sha ?? null,
        source: 'github',
        githubUrl,
      };
      return jsonOk(payload);
    }

    // 3) Not available — honest 404 with the GitHub permalink in payload.
    throw new ApiError(404, 'not_found', `file ${query.path} unavailable (no fixture, no live fetch)`);
  });
}
