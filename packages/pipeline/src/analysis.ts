import { parseGitHubRepoUrl } from '@atlas/github';
import { newId } from '@atlas/contracts';
import type { CuratedFixture, GitHubClient, TreeEntry, CommitInfo } from '@atlas/github';
import type {
  AnalysisJob,
  Locale,
  Milestone,
  Repository,
  Snapshot,
  SnapshotStatus,
} from '@atlas/contracts';
import { buildGraph, deltaSummary, diffGraphs, selectMilestones } from '@atlas/graph';
import type { GraphSnapshot } from '@atlas/contracts';
import {
  comparePath,
  comparePatch,
  commitSubject,
  metaDefaultBranch,
  orNull,
  asNumber,
  asString,
  field,
  shaOf,
  timeOf,
  treeEntryIsFile,
  treeEntryPath,
  treeEntrySize,
} from './vendor-shape.js';
import {
  COMMIT_WINDOW,
  FILE_BYTES_LIMIT,
  FILE_COUNT_LIMIT,
  TREE_ENTRY_LIMIT,
  type PipelineContext,
} from './context.js';
import {
  buildHistoryBundle,
  compareMilestoneEvidence,
  generateTimelineStory,
  persistExplanation,
} from './explanations.js';
import { distractorsFor, pickFocusMilestone, seedFocusMission } from './mission-seed.js';

/**
 * Bounded analysis pipeline (TRD §4.2 algorithm, FR-01..FR-06).
 *
 * Stages surfaced on the AnalysisJob (TRD §6.1 /api/jobs/:id):
 *   validate-url(5) fetch-meta(10) fetch-commits(20) milestones(30)
 *   ingest-graphs(70) ai-story(85) seed-missions(95) persist(100)
 */

export interface AnalyzeTargetInput {
  url: string;
  locale: Locale;
}

export interface JobProgressState {
  warnings: string[];
  rateLimited: boolean;
  failedMilestones: number;
  /** Global file-content request budget + wall-clock deadline (TRD §8 SLOs). */
  fileRequests: number;
  budgetExhausted: boolean;
  deadline: number;
}

/**
 * Massive-monorepo guards (TRD §1.3: bounded slices, not universal ingestion;
 * §8: timeout + partial recovery instead of an indefinite spinner).
 * Whichever trips first — rate limit, request budget, or deadline — the job
 * still completes with partial, honestly-labeled data.
 */
const FILE_FETCH_BUDGET = 80;
const ANALYSIS_TIME_BUDGET_MS = 120_000;

function budgetsExhausted(state: JobProgressState): boolean {
  return state.rateLimited || state.budgetExhausted || Date.now() > state.deadline;
}

/** Hard stop for cheap structural calls (trees/compares/README): only rate
 * limiting or the wall-clock deadline blocks these — the file-content budget
 * must never leave a milestone with an empty graph (TRD FR-04). */
function hardStopped(state: JobProgressState): boolean {
  return state.rateLimited || Date.now() > state.deadline;
}

// ── Public entry: enqueue & kick off the bounded run ─────────────────────────

export async function analyzeJob(
  ctx: PipelineContext,
  input: AnalyzeTargetInput,
): Promise<{ jobId: string }> {
  const now = new Date().toISOString();
  // TRD FR-01: parse+validate allowlisted github.com URLs (SSRF-guarded in
  // packages/github). Invalid input still creates an inspectable error job.
  const parsed = parseGitHubRepoUrl(input.url);
  const job: AnalysisJob = {
    id: newId('job'),
    kind: 'analyze',
    repoUrl: input.url,
    owner: parsed?.owner ?? 'unknown',
    name: parsed?.name ?? 'unknown',
    locale: input.locale,
    status: 'queued',
    stage: 'validate-url',
    progress: 0,
    snapshotIds: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
  if (!parsed) {
    job.status = 'error';
    job.error = 'unsupported-url';
    await ctx.store.putJob(job);
    return { jobId: job.id };
  }
  await ctx.store.putJob(job);
  // Vercel can suspend an invocation after its HTTP response. For the pinned
  // hackathon fixture, finish ingestion before responding, so the demo never
  // depends on a detached background promise surviving in a serverless worker.
  const work = runAnalysis(ctx, job, parsed.owner, parsed.name).catch(async (err) => {
    job.status = 'error';
    job.error = errorMessage(err);
    job.updatedAt = new Date().toISOString();
    await ctx.store.putJob(job);
  });
  if (process.env.VERCEL && ctx.fixture?.repository.owner === parsed.owner &&
      ctx.fixture.repository.name === parsed.name) {
    await work;
  } else {
    void work;
  }
  return { jobId: job.id };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** GitHubError-kind probe that never depends on instanceof across builds. */
export function errKind(err: unknown): string {
  return asString(field(err, 'kind')) || 'network';
}

async function advance(
  ctx: PipelineContext,
  job: AnalysisJob,
  stage: string,
  progress: number,
): Promise<void> {
  job.stage = stage;
  job.progress = progress;
  job.updatedAt = new Date().toISOString();
  await ctx.store.putJob(job);
}

/** GitHubError-aware guard: rate-limited degrades to partial data (§8 SLOs). */
async function guarded<T>(
  state: JobProgressState,
  run: () => Promise<T>,
  fallback: T,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (err) {
    const kind = (field(err, 'kind') as string | undefined) ?? '';
    if (kind === 'rate-limited') {
      state.rateLimited = true;
      state.warnings.push('rate-limited: some repository data may be missing');
      return fallback;
    }
    throw err; // not-found / network / forbidden -> job-level error
  }
}

function asGitHubError(err: unknown, what: string): Error {
  const kind = (field(err, 'kind') as string | undefined) ?? 'network';
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`not-found: ${what} (${kind}: ${message})`);
}

// ── The bounded pipeline ──────────────────────────────────────────────────────

async function runAnalysis(
  ctx: PipelineContext,
  job: AnalysisJob,
  owner: string,
  name: string,
): Promise<void> {
  const state: JobProgressState = {
    warnings: [],
    rateLimited: false,
    failedMilestones: 0,
    fileRequests: 0,
    budgetExhausted: false,
    deadline: Date.now() + ANALYSIS_TIME_BUDGET_MS,
  };
  const client = ctx.clientFor(owner, name);
  const fixture = matchingFixture(ctx, owner, name);

  await advance(ctx, job, 'fetch-meta', 10);

  // 1) Repository entity (FR-01): prefer an existing stable id so that
  //    repeated analyses of the same repo do not duplicate entities.
  const existing = await ctx.store.getRepositoryBySlug(owner, name);
  const repositoryId = existing?.id ?? `repo_${owner}_${name}`;
  let meta: unknown = null;
  try {
    meta = await client.fetchRepoMeta(owner, name);
  } catch (err) {
    if (!existing) throw asGitHubError(err, `${owner}/${name}`);
    state.warnings.push('repo-meta fetch failed; using persisted repository facts');
  }
  const repository: Repository = existing ?? {
    id: repositoryId,
    provider: 'github',
    owner,
    name,
    visibility: 'public', // public-only until explicit consent (TRD §14)
    defaultBranch: 'main',
    licenseSpdx: null,
    description: null,
    stars: 0,
    lastIndexedAt: null,
  };
  if (meta !== null && meta !== undefined) {
    repository.defaultBranch = metaDefaultBranch(meta);
    repository.licenseSpdx = orNull(field(meta, 'licenseSpdx'), field(meta, 'license'));
    repository.description = orNull(field(meta, 'description'));
    repository.stars = asNumber(field(meta, 'stars'));
  }
  ctx.counters.repositoryIds.add(repository.id);

  // 2) Bounded commit window ascending (FR-02).
  await advance(ctx, job, 'fetch-commits', 20);
  const commitsRaw = (await guarded(
    state,
    () => client.fetchCommits(owner, name, COMMIT_WINDOW),
    [],
  )) as CommitInfo[] | undefined;
  if (!commitsRaw || commitsRaw.length === 0) {
    throw new Error(`not-found: no commits available for ${owner}/${name}`);
  }
  const commits = commitsRaw;
  const knownShas = new Set<string>(commits.map((c) => shaOf(c)));
  const commitBySha = new Map(commits.map((c) => [shaOf(c), c]));
  const tags = fixture?.tags ?? [];

  // 3) Milestone selection (FR-03, §4.2 step 2): curated fixtures win.
  await advance(ctx, job, 'milestones', 30);
  const selected = chooseMilestones(commits, knownShas, fixture, tags);
  if (selected.length === 0) {
    throw new Error('not-found: no analysis milestones could be selected');
  }
  const milestones: Milestone[] = selected.map((sel, i) => {
    const commit = commitBySha.get(sel.sha);
    return {
      id: newId('ms'),
      repositoryId: repository.id,
      snapshotId: newId('snap'),
      sha: sel.sha,
      title: firstNonEmpty(sel.title, commitSubject(commit), sel.sha),
      rank: i,
      changeKind: sel.changeKind,
      changeSummary: '',
      time: timeOf(commit),
      evidenceRefs: [{ sha: sel.sha }],
    };
  });
  job.snapshotIds = milestones.map((ms) => ms.snapshotId);

  // 4) Per-milestone bounded tree + file ingestion + deterministic graph
  //    (FR-02, FR-04; §4.2 steps 3–4). Failures degrade per-milestone.
  await advance(ctx, job, 'ingest-graphs', 35);
  const graphs: GraphSnapshot[] = [];
  const snapshots: Snapshot[] = [];
  const treesBySha = new Map<string, TreeEntry[]>();
  const readmes = new Map<string, string>();
  const sourceScope = {
    commitLimit: COMMIT_WINDOW,
    maxMilestoneFiles: FILE_COUNT_LIMIT,
    maxFileBytes: FILE_BYTES_LIMIT,
  };
  for (const ms of milestones) {
    const entries: TreeEntry[] = await (async () => {
      // Circuit breaker: rate limits/deadline stop new tree requests; the
      // file-content budget does NOT apply here (cheap structural calls).
      if (hardStopped(state)) return [];
      try {
        return (await client.fetchTree(owner, name, ms.sha, TREE_ENTRY_LIMIT)) ?? [];
      } catch (err) {
        const kind = errKind(err);
        if (kind === 'rate-limited') {
          state.rateLimited = true;
          state.warnings.push('rate-limited: some repository data may be missing');
        } else {
          // Per-milestone degradation (§8: partial recovery beats a spinner).
          state.failedMilestones += 1;
          state.warnings.push(`milestone ${ms.sha.slice(0, 7)}: tree fetch failed (${kind})`);
        }
        return [];
      }
    })();
    treesBySha.set(ms.sha, entries);
    if (entries.length >= TREE_ENTRY_LIMIT) {
      state.warnings.push(`large repository: tree truncated to ${TREE_ENTRY_LIMIT} entries (bounded slice, TRD §1.3)`);
    }
    const picks = budgetsExhausted(state) ? [] : pickBoundedFiles(entries);
    const files = await fetchFiles(client, owner, name, ms.sha, picks, state);
    // FR-04: graph STRUCTURE comes from the tree (always available), file
    // contents only enrich import extraction. A content-budget stop therefore
    // degrades edge detail, never the whole graph.
    const contentByPath = new Map(files.map((f) => [f.path, f.content]));
    const graphInputs = entries
      .filter((entry) => treeEntryIsFile(entry) && isSelectablePath(treeEntryPath(entry)))
      .map((entry) => ({
        path: treeEntryPath(entry),
        size: treeEntrySize(entry),
        content: contentByPath.get(treeEntryPath(entry)),
      }));
    const graph = buildGraph(ms.snapshotId, ms.sha, graphInputs);
    ctx.graphCache.set(`${repository.id}:${ms.sha}`, graph);
    await ctx.store.putGraph(`${repository.id}:${ms.sha}`, graph);
    graphs.push(graph);
    readmes.set(ms.sha, hardStopped(state) ? '' : await readReadme(client, owner, name, fixture, ms.sha, files));
    snapshots.push({
      id: ms.snapshotId,
      repositoryId: repository.id,
      sha: ms.sha,
      rootSha: [...knownShas][0] ?? ms.sha,
      time: ms.time,
      sourceScope,
      manifestKey: `${repository.id}:${ms.sha}`,
      status: 'analyzing',
    });
    job.warnings = [...new Set(state.warnings)];
    // Per-milestone progress (TRD §2.4: visible stage progress, never a
    // spinner that sits still while many files are fetched).
    await advance(ctx, job, 'ingest-graphs', 35 + Math.round((graphs.length / milestones.length) * 35));
  }

  // 5) Compare windows + graph deltas (FR-03; §4.2 step 4).
  const allPaths = new Set<string>();
  for (const graph of graphs) for (const node of graph.nodes) allPaths.add(node.path);
  const changedFilesBySha = new Map<string, string[]>();
  const patchExcerptsBySha = new Map<string, string[]>();
  for (let i = 0; i < milestones.length; i++) {
    if (i === 0) {
      changedFilesBySha.set(milestones[i]!.sha, []);
      patchExcerptsBySha.set(milestones[i]!.sha, []);
      continue;
    }
    const base = milestones[i - 1]!;
    const head = milestones[i]!;
    const compareKey = `compare:${repository.id}:${base.sha}...${head.sha}`;
    const list: unknown[] = await (async () => {
      if (hardStopped(state)) return []; // circuit breaker (§8: partial recovery)
      try {
        return ((await client.fetchCompare(owner, name, base.sha, head.sha))?.files ?? []) as unknown[];
      } catch (err) {
        const kind = errKind(err);
        if (kind === 'rate-limited') {
          state.rateLimited = true;
          state.warnings.push('rate-limited: some repository data may be missing');
        } else {
          state.failedMilestones += 1;
          state.warnings.push(`milestone ${head.sha.slice(0, 7)}: compare fetch failed (${kind})`);
        }
        return [];
      }
    })();
    ctx.compareCache.set(compareKey, list);
    const paths = list.map((f) => comparePath(f)).filter((p) => p.length > 0);
    changedFilesBySha.set(head.sha, paths);
    for (const p of paths) allPaths.add(p);
    patchExcerptsBySha.set(
      head.sha,
      list
        .map((f) => comparePatch(f))
        .filter((p) => p.length > 0)
        .slice(0, 5)
        .map((p) => truncate(p, 400)),
    );
    const delta = diffGraphs(graphs[i - 1]!, graphs[i]!);
    head.changeSummary = deltaSummary(delta) || `${delta.addedNodes.length} added node(s), ${delta.removedNodeIds.length} removed`;
  }
  if (milestones[0]) milestones[0]!.changeSummary = 'Initial bounded snapshot of the analysis window.';

  // 6) Snapshot statuses: rate-limited propagates top-level (§2.4 states);
  // budget/deadline exhaustion marks partial, never silent "ready".
  if (Date.now() > state.deadline) {
    state.warnings.push('analysis time budget reached; partial results (TRD §8)');
  }
  const statuses: SnapshotStatus[] = snapshots.map(() =>
    state.rateLimited ? 'rate-limited' : 'ready',
  );
  if (state.failedMilestones > 0 || state.budgetExhausted || Date.now() > state.deadline) {
    for (let i = 0; i < statuses.length; i++) {
      if (statuses[i] === 'ready') statuses[i] = 'partial';
    }
  }
  snapshots.forEach((s, i) => {
    s.status = statuses[i]!;
  });

  // 7) AI history narration in the requested locale AND the other one (FR-05).
  await advance(ctx, job, 'ai-story', 85);
  const ordered = [...milestones].sort((a, b) => a.rank - b.rank);
  const evidence = compareMilestoneEvidence(
    ordered,
    ctx.compareCache,
    repository.id,
    new Map(milestones.map((ms) => [ms.sha, ms.title])),
  );
  for (const ms of ordered) {
    evidence.commitSubjects.set(
      ms.sha,
      commitSubject(commitBySha.get(ms.sha)) || ms.title,
    );
    if (!evidence.changedFiles.get(ms.sha)) {
      evidence.changedFiles.set(ms.sha, changedFilesBySha.get(ms.sha) ?? []);
    }
    if (!evidence.patchExcerpts.get(ms.sha)) {
      evidence.patchExcerpts.set(ms.sha, patchExcerptsBySha.get(ms.sha) ?? []);
    }
  }
  const head = ordered[ordered.length - 1]!;
  const readmeExcerpt = (readmes.get(head.sha) ?? '').slice(0, 4000);
  const bundle = buildHistoryBundle(
    repository,
    ordered,
    evidence,
    knownShas,
    allPaths,
    readmeExcerpt,
  );
  for (const locale of localePair(job.locale)) {
    const story = await generateTimelineStory(ctx.ai, bundle, locale);
    if (story.offline && !ctx.ai.offline) {
      // A LIVE provider failed and fell back: warn. An intentionally offline
      // provider (fixture/mock) is a disclosed mode, not a warning (TRD §11).
      state.warnings.push('story-unavailable: offline fallback story in use');
    }
    await persistExplanation(ctx, {
      content: story,
      task: 'history',
      repository,
      snapshot: snapshots[snapshots.length - 1]!,
      locale,
      level: 'beginner',
      modelId: ctx.ai.modelId,
    });
  }

  // 8) Beginner mission grounded in the earliest milestone (FR-06, §14).
  await advance(ctx, job, 'seed-missions', 95);
  const earliest = ordered[0]!;
  const focus = pickFocusMilestone(ordered, changedFilesBySha);
  if (focus) {
    const focusTree = (treesBySha.get(focus.milestone.sha) ?? []).filter((e) => treeEntryIsFile(e));
    const mission = seedFocusMission({
      repository,
      milestone: focus.milestone,
      changedFiles: focus.changedFiles,
      distractorFiles: distractorsFor(
        focusTree.map((e) => treeEntryPath(e)),
        focus.changedFiles,
      ),
      scopeSha: earliest.sha,
    });
    await ctx.store.putMissions([mission]);
  } else {
    state.warnings.push('no changed files between milestones: no beginner mission generated');
  }

  // 9) Persist everything (FR-02: immutable snapshots + source URLs).
  await advance(ctx, job, 'persist', 98);
  repository.lastIndexedAt = new Date().toISOString();
  await ctx.store.putRepository(repository);
  // Architecture honesty: a graph with no import relations is a file listing,
  // not an architecture map. Say so on the snapshot, so it survives restarts.
  const headGraph = graphs[graphs.length - 1];
  if (headGraph && !headGraph.edges.some((edge) => edge.kind === 'import')) {
    state.warnings.push('no import relationships detected: the architecture view shows files and folders only');
  }
  const analysisNotes = [...new Set(state.warnings)];
  for (const snapshot of snapshots) snapshot.notes = analysisNotes;
  await ctx.store.putSnapshots(snapshots);
  await ctx.store.putMilestones(ordered);

  job.warnings = [...new Set(state.warnings)];
  job.snapshotIds = snapshots.map((s) => s.id);
  await advance(ctx, job, 'done', 100);
  job.status = 'done';
  job.updatedAt = new Date().toISOString();
  await ctx.store.putJob(job);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function matchingFixture(ctx: PipelineContext, owner: string, name: string): CuratedFixture | null {
  const fixture = ctx.fixture;
  if (!fixture) return null;
  const repo = fixture.repository;
  return repo.owner === owner && repo.name === name ? fixture : null;
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) if (value && value.length > 0) return value;
  return '';
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function localePair(requested: Locale): Locale[] {
  // FR-05: generate for the requested locale AND the other one.
  return requested === 'en' ? ['en', 'es'] : ['es', 'en'];
}

const SKIP_SEGMENT = /(node_modules|\.git|dist|test|spec|__snapshots__)/i;
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;

export function isSelectablePath(path: string): boolean {
  if (path.length === 0) return false;
  if (SKIP_SEGMENT.test(path)) return false;
  return true;
}

export function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.test(path);
}

export interface PickedFile {
  path: string;
  size?: number;
}

/** Bounded picks (§4.2 step 3): sources first, then README, capped at 40. */
export function pickBoundedFiles(entries: TreeEntry[]): PickedFile[] {
  const files = entries
    .filter((entry) => treeEntryIsFile(entry))
    .map((entry) => ({ path: treeEntryPath(entry), size: treeEntrySize(entry) }))
    .filter((f) => f.path.length > 0 && isSelectablePath(f.path) && (f.size ?? 0) <= FILE_BYTES_LIMIT);
  const ranked = files.map((f) => ({
    ...f,
    score: isSourcePath(f.path) ? 0 : /readme/i.test(f.path) ? 1 : 2,
  }));
  ranked.sort((a, b) => (a.score - b.score) || a.path.localeCompare(b.path));
  return ranked.slice(0, FILE_COUNT_LIMIT).map(({ path, size }) => ({ path, size }));
}

/** Concurrency-bounded file fetch (§4.2 step 3: Promise.all concurrency 6). */
async function fetchFiles(
  client: GitHubClient,
  owner: string,
  name: string,
  sha: string,
  picks: PickedFile[],
  state: JobProgressState,
): Promise<{ path: string; size?: number; content: string }[]> {
  const results: { path: string; size?: number; content: string }[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(6, Math.max(picks.length, 1)) }, () =>
    (async () => {
      // Shared circuit breaker: the first 403/429 stops ALL outstanding file
      // fetches; a global request budget + deadline stops monorepo grinding
      // (TRD §8: partial recovery instead of an indefinite spinner).
      while (index < picks.length && !budgetsExhausted(state)) {
        if (state.fileRequests >= FILE_FETCH_BUDGET) {
          state.budgetExhausted = true;
          state.warnings.push(`bounded: file-content budget of ${FILE_FETCH_BUDGET} requests reached; partial graphs`);
          break;
        }
        const pick = picks[index]!;
        index++;
        state.fileRequests += 1;
        try {
          const content = await client.fetchFile(owner, name, pick.path, sha, FILE_BYTES_LIMIT);
          if (content) results.push({ path: pick.path, size: pick.size, content });
        } catch (err) {
          if (errKind(err) === 'rate-limited') {
            state.rateLimited = true;
            state.warnings.push('rate-limited: some repository data may be missing');
            break;
          }
          // Missing/binary files are skipped silently (bounded retrieval FR-02).
        }
      }
    })(),
  );
  await Promise.all(workers);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function readReadme(
  client: GitHubClient,
  owner: string,
  name: string,
  fixture: CuratedFixture | null,
  sha: string,
  files: { path: string; content: string }[],
): Promise<string> {
  const fromFixture = fixture?.readme[sha];
  if (fromFixture && fromFixture.length > 0) return fromFixture;
  const fromFetched = files.find((f) => /(^|\/)readme\.md$/i.test(f.path));
  if (fromFetched) return fromFetched.content;
  try {
    return await client.fetchFile(owner, name, 'README.md', sha, FILE_BYTES_LIMIT);
  } catch {
    return ''; // graceful: README is optional evidence (§5.1 inputs)
  }
}

type SelectedMilestone = { sha: string; title: string; changeKind: Milestone['changeKind']; reason: string };

/** Curated fixture milestones win (TRD §10.1.2); else derive deterministically. */
function chooseMilestones(
  commits: CommitInfo[],
  knownShas: Set<string>,
  fixture: CuratedFixture | null,
  tags: { tag: string; sha: string }[],
): SelectedMilestone[] {
  if (fixture) {
    const curated = fixture.milestones.filter((m) => knownShas.has(m.sha));
    if (curated.length > 0) {
      return curated.map((m) => ({
        sha: m.sha,
        title: m.title,
        changeKind: m.changeKind,
        reason: m.reason,
      }));
    }
  }
  const derived = selectMilestones(commits, { min: 3, max: 5, tags });
  return derived.map((m) => ({
    sha: m.sha,
    title: m.title,
    changeKind: m.changeKind as Milestone['changeKind'],
    reason: m.reason,
  }));
}
