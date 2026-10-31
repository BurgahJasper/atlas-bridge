import { Buffer } from 'node:buffer';
import {
  newId,
  ContributionPreviewResponseSchema,
  type ContributionFile,
  type ContributionPreviewRequest,
  type ContributionPreviewResponse,
  type ContributionSubmitRequest,
  type Contribution,
  type Mission,
  type Repository,
} from '@atlas/contracts';
import type { PipelineContext } from './context.js';
import { diffLines } from './diff.js';

/**
 * Contribution gateway (TRD §4.1, FR-10, §7).
 *
 * v1 posture: preview is always available; the actual GitHub write path is
 * gated behind an explicit `githubWriteToken` that the shipped apps NEVER set
 * by default. Every submit stores a Contribution record with `consentAt`
 * before any write is attempted. abuse throttling lives in apps/worker
 * (per-IP limits on preview/submit, TRD §7 public-contribution throttle).
 */

export interface ContributionService {
  previewContribution(input: ContributionPreviewRequest): Promise<ContributionPreviewResponse>;
  submitContribution(input: ContributionSubmitRequest): Promise<{
    prUrl?: string;
    status: 'submitted' | 'reviewed' | 'failed';
    note?: string;
  }>;
}

const GITHUB_API = 'https://api.github.com';

export function createContributionService(ctx: PipelineContext): ContributionService {
  async function loadMissionRepository(input: { missionId: string; repositoryId: string }): Promise<{
    repository: Repository;
    mission: Mission;
  }> {
    const [repository, mission] = await Promise.all([
      ctx.store.getRepository(input.repositoryId),
      ctx.store.getMission(input.missionId),
    ]);
    if (!repository) throw new Error(`not-found: repository ${input.repositoryId}`);
    if (!mission) throw new Error(`not-found: mission ${input.missionId}`);
    return { repository, mission };
  }

  return {
    async previewContribution(input): Promise<ContributionPreviewResponse> {
      const { repository, mission } = await loadMissionRepository(input);
      const client = ctx.clientFor(repository.owner, repository.name);
      const files: ContributionFile[] = input.files.map((f) => ({ path: f.path, content: f.content }));
      const sections: string[] = [];
      for (const file of files) {
        let base = '';
        try {
          // Base text pinned at the mission scope SHA (immutable per TRD FR-02).
          base = await client.fetchFile(repository.owner, repository.name, file.path, mission.scopeSha, 48_000);
        } catch {
          base = ''; // new file or omitted from the bounded snapshot
        }
        sections.push(`diff --git a/${file.path} b/${file.path}\n${diffLines(base, file.content)}`);
      }
      const response: ContributionPreviewResponse = {
        diff: sections.join('\n\n'),
        branch: branchFor(mission),
        destination: repository.defaultBranch,
        scopeSummary: `Touches ${files.length} file(s): ${files.map((f) => f.path).join(', ')}`,
        // OAuth is always required in v1 (TRD §6.1 contributions/submit).
        requiresOAuth: true,
      };
      return ContributionPreviewResponseSchema.parse(response);
    },

    async submitContribution(input) {
      if (input.confirmed !== true) {
        return { status: 'failed', note: 'Submission requires explicit confirmation (TRD §7).' };
      }
      const { repository, mission } = await loadMissionRepository(input);
      const files: ContributionFile[] = input.files.map((f) => ({ path: f.path, content: f.content }));
      const contribution: Contribution = {
        id: newId('contrib'),
        // No PII in v1 (FR-12): opaque anonymous actor per mission.
        userId: 'anonymous',
        repositoryId: repository.id,
        branch: branchFor(mission),
        status: 'reviewed',
        files,
        consentAt: new Date().toISOString(),
      };
      await ctx.store.putContribution(contribution);

      if (!ctx.githubWriteToken) {
        const note = 'PR creation requires OAuth. Preview only.';
        await ctx.store.putContribution(contribution);
        return { status: 'reviewed', note };
      }
      try {
        const plan = computeGitOpsPlan({
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          branch: contribution.branch,
          title: `Atlas Bridge: ${mission.title}`,
          body: `Previewed, user-confirmed contribution from mission ${mission.id}.`,
          files,
        });
        const result = await executeGitOpsPlan(plan, {
          owner: repository.owner,
          name: repository.name,
          token: ctx.githubWriteToken,
        });
        contribution.status = 'submitted';
        contribution.headSha = result.headSha;
        contribution.prUrl = result.prUrl;
        await ctx.store.putContribution(contribution);
        return { prUrl: result.prUrl, status: 'submitted' };
      } catch (err) {
        contribution.status = 'failed';
        await ctx.store.putContribution(contribution);
        const message = err instanceof Error ? err.message : String(err);
        return { status: 'failed', note: `GitHub write failed: ${message}` };
      }
    },
  };
}

export function branchFor(mission: Mission): string {
  return `atlas-bridge/${mission.id}`;
}

// ── GitOps plan (pure; network execution is separate and token-gated) ────────

export type GitOpsStep =
  | { kind: 'get-base-ref'; branch: string }
  | { kind: 'create-ref'; branch: string; baseShaPlaceholder: '{baseSha}' }
  | { kind: 'put-content'; branch: string; path: string; contentB64: string }
  | { kind: 'open-pr'; title: string; head: string; base: string; body: string };

export function computeGitOpsPlan(input: {
  owner: string;
  name: string;
  defaultBranch: string;
  branch: string;
  title: string;
  body: string;
  files: ContributionFile[];
}): GitOpsStep[] {
  // Least-privilege flow (FR-10): branch -> per-file contents PUT on that ref
  // -> draft-style PR open. Never writes the default branch directly.
  return [
    { kind: 'get-base-ref', branch: input.defaultBranch },
    { kind: 'create-ref', branch: input.branch, baseShaPlaceholder: '{baseSha}' },
    ...input.files.map((f) => ({
      kind: 'put-content' as const,
      branch: input.branch,
      path: f.path,
      contentB64: Buffer.from(f.content, 'utf8').toString('base64'),
    })),
    { kind: 'open-pr', title: input.title, head: input.branch, base: input.defaultBranch, body: input.body },
  ];
}

export interface GitOpsResult {
  headSha?: string;
  prUrl?: string;
}

async function call(
  endpoint: string,
  init: { method: string; token: string; body?: string },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(endpoint, {
    method: init.method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${init.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'atlas-bridge-v1',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function assertOk(status: number, json: unknown, what: string): void {
  if (status < 200 || status >= 300) {
    const message = (json as { message?: string } | null)?.message ?? `HTTP ${status}`;
    throw new Error(`${what}: ${message}`);
  }
}

export async function executeGitOpsPlan(
  plan: GitOpsStep[],
  input: { owner: string; name: string; token: string },
): Promise<GitOpsResult> {
  const base = `${GITHUB_API}/repos/${input.owner}/${input.name}`;
  const out: GitOpsResult = {};
  let baseSha = '';
  for (const step of plan) {
    if (step.kind === 'get-base-ref') {
      const { status, json } = await call(`${base}/git/ref/heads/${step.branch}`, {
        method: 'GET',
        token: input.token,
      });
      assertOk(status, json, 'resolve base ref');
      const object = (json as { object?: { sha?: string } } | null)?.object?.sha ?? '';
      if (!object) throw new Error('resolve base ref: missing SHA');
      baseSha = object;
    } else if (step.kind === 'create-ref') {
      const { status, json } = await call(`${base}/git/refs`, {
        method: 'POST',
        token: input.token,
        body: JSON.stringify({ ref: `refs/heads/${step.branch}`, sha: baseSha }),
      });
      assertOk(status, json, 'create branch');
    } else if (step.kind === 'put-content') {
      const { status, json } = await call(`${base}/contents/${step.path}`, {
        method: 'PUT',
        token: input.token,
        body: JSON.stringify({
          message: `Atlas Bridge edit: ${step.path}`,
          content: step.contentB64,
          branch: step.branch,
        }),
      });
      assertOk(status, json, `write ${step.path}`);
      const commitSha = (json as { commit?: { sha?: string } } | null)?.commit?.sha;
      if (commitSha) out.headSha = commitSha;
    } else {
      const { status, json } = await call(`${base}/pulls`, {
        method: 'POST',
        token: input.token,
        body: JSON.stringify({ title: step.title, head: step.head, base: step.base, body: step.body, draft: true }),
      });
      assertOk(status, json, 'open PR');
      out.prUrl = (json as { html_url?: string } | null)?.html_url;
    }
  }
  return out;
}
