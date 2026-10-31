import {
  historyNarrationPrompt,
  nodeExplanationPrompt,
  enforceBasis,
  capInferred,
  type AiProvider,
} from '@atlas/ai';
import {
  explanationCacheKey,
  newId,
  NodeExplanationSchema,
  TimelineStorySchema,
} from '@atlas/contracts';
import type {
  Claim,
  EvidenceRef,
  Explanation,
  ExplanationRequest,
  ExplanationResponse,
  ExplanationTask,
  LearningLevel,
  Locale,
  Milestone,
  NodeExplanation,
  Repository,
  Snapshot,
  Store,
  TimelineStory,
} from '@atlas/contracts';
import { extractImports } from '@atlas/graph';
import {
  comparePatch,
  comparePath,
  field,
  ghUrl,
} from './vendor-shape.js';
import {
  FILE_BYTES_LIMIT,
  MAX_PATCH_CHARS,
  MAX_PATCH_EXCERPTS,
  type PipelineContext,
} from './context.js';

// ── Story generation bundle (TRD §5.1 history narration) ─────────────────────

export interface HistoryMilestoneInput {
  milestoneId: string;
  sha: string;
  title: string;
  changeKind: string;
  changedFiles: string[];
  patchExcerpts: string[];
  commitMessageSubject: string;
}

export interface HistoryBundle {
  repositoryName: string;
  headSha: string;
  /** Ordered by rank (earliest first). */
  milestones: HistoryMilestoneInput[];
  readmeExcerpt: string;
  /** Every SHA a citation may point at (window commits at minimum). */
  knownShas: Set<string>;
  /** Every path a citation may point at (tree files + compare paths). */
  knownPaths: Set<string>;
}

export interface MilestoneEvidenceMaps {
  changedFiles: Map<string, string[]>;
  patchExcerpts: Map<string, string[]>;
  commitSubjects: Map<string, string>;
}

export function buildHistoryBundle(
  repository: Repository,
  milestones: Milestone[],
  evidence: MilestoneEvidenceMaps,
  knownShas: Iterable<string>,
  knownPaths: Iterable<string>,
  readmeExcerpt: string,
): HistoryBundle {
  const ordered = [...milestones].sort((a, b) => a.rank - b.rank);
  const headSha = ordered[ordered.length - 1]?.sha ?? '';
  return {
    repositoryName: `${repository.owner}/${repository.name}`,
    headSha,
    milestones: ordered.map((ms) => ({
      milestoneId: ms.id,
      sha: ms.sha,
      title: ms.title,
      changeKind: ms.changeKind,
      changedFiles: evidence.changedFiles.get(ms.sha) ?? [],
      patchExcerpts: evidence.patchExcerpts.get(ms.sha) ?? [],
      commitMessageSubject: evidence.commitSubjects.get(ms.sha) ?? ms.title,
    })),
    readmeExcerpt,
    knownShas: new Set(knownShas),
    knownPaths: new Set(knownPaths),
  };
}

// ── Prompt + generation for one locale (TRD §5.1, FR-05) ─────────────────────

export async function generateTimelineStory(
  ai: AiProvider,
  bundle: HistoryBundle,
  locale: Locale,
): Promise<TimelineStory> {
  const prompt = historyNarrationPrompt({ ...bundle, locale, level: 'beginner' });
  let raw: unknown = null;
  try {
    raw = await ai.generateJson<unknown>({ system: prompt.system, user: prompt.user, maxOutputTokens: 4096 });
  } catch {
    raw = null; // provider/host failure -> deterministic offline fallback
  }
  const candidate: unknown =
    raw && typeof raw === 'object'
      ? normalizeStoryOutput(raw as Record<string, unknown>, bundle, locale, ai.offline)
      : { snapshotSha: bundle.headSha, locale, offline: ai.offline };
  const parsed = TimelineStorySchema.safeParse(candidate);
  if (!parsed.success) {
    // TRD §11: never disguise a fallback as live inference — offline fallback
    // is openly labeled and cites only retrieved diff paths.
    return fallbackTimelineStory(bundle, locale);
  }
  // TRD §5.2/§5.3: cross-check every cited path/SHA against retrieved facts.
  // TRD §5.2: "explicit" must be backed by the cited commit's own message.
  const subjects = new Map(bundle.milestones.map((m) => [m.sha, m.commitMessageSubject]));
  const verified = filterUnverifiedStory(parsed.data, bundle.knownShas, bundle.knownPaths);
  return {
    ...verified,
    claims: enforceBasis(verified.claims, subjects),
    milestones: verified.milestones.map((part) => ({
      ...part,
      claims: enforceBasis(part.claims, subjects),
    })),
  };
}

// ── Citation validation (story level; TRD §5.2, §5.3) ────────────────────────

/**
 * Normalizes raw model JSON before schema validation (TRD §5.1). Models
 * frequently return only per-milestone claims; the contract (§6.2) also wants
 * a top-level claims array — flatten it when absent, and default optional
 * collections instead of rejecting an otherwise valid story.
 */
function normalizeStoryOutput(
  raw: Record<string, unknown>,
  bundle: HistoryBundle,
  locale: Locale,
  offline: boolean,
): Record<string, unknown> {
  const parts = Array.isArray(raw.milestones) ? raw.milestones : [];
  const normalizedParts = parts.map((part) =>
    part && typeof part === 'object'
      ? { ...(part as Record<string, unknown>), claims: Array.isArray((part as { claims?: unknown }).claims) ? (part as { claims: unknown[] }).claims : [] }
      : part,
  );
  const flattened = normalizedParts.flatMap((part) =>
    part && typeof part === 'object' && Array.isArray((part as { claims?: unknown }).claims)
      ? (part as { claims: unknown[] }).claims
      : [],
  );
  return {
    ...raw,
    milestones: normalizedParts,
    claims: Array.isArray(raw.claims) ? raw.claims : flattened,
    untranslatedTerms: Array.isArray(raw.untranslatedTerms) ? raw.untranslatedTerms : [],
    snapshotSha: bundle.headSha,
    locale,
    offline,
  };
}

// Reimplemented locally as filterUnverifiedStory to keep story-filtering
// deterministic inside this package even if @atlas/ai's validateCitationsSync
// semantics drift; harmless duplication by design (same evidence rule).

function refResolves(ref: EvidenceRef, shas: Set<string>, paths: Set<string>): boolean {
  if (!shas.has(ref.sha)) return false;
  if (ref.path && !paths.has(ref.path)) return false;
  return true;
}

function filterClaim(claim: Claim, shas: Set<string>, paths: Set<string>): Claim | null {
  const refs = claim.evidenceRefs.filter((ref) => refResolves(ref, shas, paths));
  if (refs.length === 0) return null;
  return refs.length === claim.evidenceRefs.length ? claim : { ...claim, evidenceRefs: refs };
}

export function filterUnverifiedStory(
  story: TimelineStory,
  shas: Set<string>,
  paths: Set<string>,
): TimelineStory {
  const claims = story.claims
    .map((claim) => filterClaim(claim, shas, paths))
    .filter((c): c is Claim => c !== null);
  const milestones = story.milestones.map((part) => {
    const partClaims = part.claims
      .map((claim) => filterClaim(claim, shas, paths))
      .filter((c): c is Claim => c !== null);
    return partClaims.length === part.claims.length ? part : { ...part, claims: partClaims };
  });
  return { ...story, claims, milestones };
}

// ── Offline fallback story (TRD §11 demo reliability: openly labeled) ────────

export function fallbackTimelineStory(bundle: HistoryBundle, locale: Locale): TimelineStory {
  const es = locale === 'es';
  const claims: Claim[] = [];
  const milestones = bundle.milestones.map((ms) => {
    const evidencePaths =
      ms.changedFiles.length > 0 ? ms.changedFiles.slice(0, 3) : ['README.md'];
    const refs: EvidenceRef[] = evidencePaths
      .filter((p) => bundle.knownPaths.size === 0 || bundle.knownPaths.has(p))
      .map((path) => ({ sha: ms.sha, path }));
    const text = es
      ? `${ms.title} (${ms.changeKind}) — inferido a partir de la ventana acotada de diferencias` +
        (ms.changedFiles.length > 0
          ? ` que cubre ${ms.changedFiles.length} cambio(s) de archivo registrados.`
          : '.')
      : `${ms.title} (${ms.changeKind}) — inferred from the bounded diff window` +
        (ms.changedFiles.length > 0
          ? ` covering ${ms.changedFiles.length} tracked file change(s).`
          : '.');
    const claim: Claim = { text, basis: 'inferred', confidence: 'low', evidenceRefs: refs };
    claims.push(claim);
    return {
      milestoneId: ms.milestoneId,
      sha: ms.sha,
      title: ms.title,
      narrative: text,
      claims: [claim],
    };
  });
  const summary = es
    ? `Offline fallback — resumen provisional sin conexión para ${bundle.repositoryName}: el análisis acotado capturó ` +
      `${bundle.milestones.length} hito(s). La narración con un modelo conectado no está disponible, ` +
      `por lo que esta historia es una salida sin conexión claramente etiquetada (TRD §11).`
    : `Offline fallback summary for ${bundle.repositoryName}: bounded analysis captured ` +
      `${bundle.milestones.length} milestone(s). Narrative narration requires a connected ` +
      `model, so this story is a clearly labeled offline output (TRD §11).`;
  return {
    snapshotSha: bundle.headSha,
    milestones,
    locale,
    summary,
    claims,
    untranslatedTerms: [],
    offline: true,
  };
}

// ── Node explanations (TRD §5.1 architecture explanation) ────────────────────

export async function generateNodeExplanation(
  ai: AiProvider,
  input: {
    repository: Repository;
    snapshot: Snapshot;
    graphNodes: { id: string; path: string }[];
    graphEdges: { source: string; target: string; kind: string }[];
    node: { id: string; path: string };
    fetchFile: (path: string, sha: string, maxBytes: number) => Promise<string>;
    locale: Locale;
    level: LearningLevel;
  },
): Promise<NodeExplanation> {
  let content = '';
  try {
    content = await input.fetchFile(input.node.path, input.snapshot.sha, FILE_BYTES_LIMIT);
  } catch {
    content = ''; // file may exceed the bounded cap or be binary — stay graceful
  }
  const imports = importsOf(input.node.path, content);
  const importedBy = input.graphEdges
    .filter((e) => e.target === input.node.id && e.kind === 'import')
    .map((e) => pathOfNode(input.graphNodes, e.source))
    .filter((p): p is string => Boolean(p));
  const prompt = nodeExplanationPrompt({
    repositoryName: `${input.repository.owner}/${input.repository.name}`,
    nodeId: input.node.id,
    filePath: input.node.path,
    fileExcerpt: content.slice(0, 6000),
    imports,
    importedBy,
    locale: input.locale,
    level: input.level,
    // Pin citations to this exact snapshot (TRD §5.3: refs resolve at revision).
    snapshotSha: input.snapshot.sha,
  });
  let raw: unknown = null;
  try {
    raw = await ai.generateJson<unknown>({ system: prompt.system, user: prompt.user });
  } catch {
    raw = null;
  }
  const candidate: unknown =
    raw && typeof raw === 'object'
      ? {
          ...(raw as Record<string, unknown>),
          nodeId: input.node.id,
          locale: input.locale,
          offline: ai.offline,
        }
      : { locale: input.locale, offline: ai.offline };
  const parsed = NodeExplanationSchema.safeParse(candidate);
  if (parsed.success) {
    // Node claims describe code structure, not commit intent: always inferred.
    const explanation = {
      ...parsed.data,
      claims: parsed.data.claims.map((claim) => capInferred({ ...claim, basis: 'inferred' })),
    };
    return {
      ...explanation,
      claims: explanation.claims.filter((claim) =>
        claim.evidenceRefs.some(
          (ref) => ref.sha === input.snapshot.sha && (!ref.path || pathsAllow(input, ref.path)),
        ),
      ),
    };
  }
  return fallbackNodeExplanation(input, imports, importedBy);
}

function pathsAllow(
  input: { graphNodes: { id: string; path: string }[] },
  path: string,
): boolean {
  return input.graphNodes.some((n) => n.path === path);
}

function importsOf(path: string, content: string): string[] {
  try {
    return extractImports(path, content).slice(0, 24);
  } catch {
    return []; // unsupported language -> no import claims (TRD §4.2 step 3)
  }
}

function pathOfNode(nodes: { id: string; path: string }[], id: string): string | undefined {
  return nodes.find((n) => n.id === id)?.path;
}

function fallbackNodeExplanation(
  input: {
    repository: Repository;
    snapshot: Snapshot;
    node: { id: string; path: string };
    locale: Locale;
  },
  imports: string[],
  importedBy: string[],
): NodeExplanation {
  const purpose =
    `Module ${input.node.path} (offline analysis; responsibility inferred ` +
    `from imports and file structure, TRD §11).`;
  const detail =
    (imports.length > 0 ? `Imports ${imports.length} module(s). ` : '') +
    (importedBy.length > 0 ? `Imported by ${importedBy.length} file(s). ` : '') +
    `Connect a model for a grounded explanation.`;
  return {
    nodeId: input.node.id,
    purpose,
    detail,
    claims: [
      {
        text: `${input.node.path} exists at ${input.snapshot.sha.slice(0, 7)}.`,
        basis: 'inferred',
        confidence: 'low',
        evidenceRefs: [{ sha: input.snapshot.sha, path: input.node.path }],
      },
    ],
    locale: input.locale as Locale,
    offline: true,
  };
}

// ── Explanation persistence (TRD §6 data model) ──────────────────────────────

export function sortForHistory(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.rank - b.rank);
}

export function compareMilestoneEvidence(
  milestones: Milestone[],
  compareCache: Map<string, unknown[]>,
  repositoryId: string,
  commitSubjects: Map<string, string>,
): MilestoneEvidenceMaps {
  const changedFiles = new Map<string, string[]>();
  const patchExcerpts = new Map<string, string[]>();
  for (let i = 0; i < milestones.length; i++) {
    const head = milestones[i]!;
    if (i === 0) {
      changedFiles.set(head.sha, []);
      patchExcerpts.set(head.sha, []);
      continue;
    }
    const base = milestones[i - 1]!;
    const files = compareCache.get(`compare:${repositoryId}:${base.sha}...${head.sha}`) ?? [];
    const paths = files.map((f) => comparePath(f)).filter((p) => p.length > 0);
    const patches = files
      .map((f) => comparePatch(f))
      .filter((p) => p.length > 0)
      .slice(0, MAX_PATCH_EXCERPTS)
      .map((p) => (p.length > MAX_PATCH_CHARS ? `${p.slice(0, MAX_PATCH_CHARS)}…` : p));
    changedFiles.set(head.sha, paths);
    patchExcerpts.set(head.sha, patches);
  }
  return { changedFiles, patchExcerpts, commitSubjects };
}

export async function persistExplanation(
  ctx: { store: Store; counters: PipelineContext['counters'] },
  input: {
    content: TimelineStory | NodeExplanation;
    task: ExplanationTask;
    repository: Repository;
    snapshot: Snapshot;
    locale: Locale;
    level: LearningLevel;
    modelId: string;
    subjectId?: string;
  },
): Promise<Explanation> {
  const citations = collectCitations(input.content);
  const explanation: Explanation = {
    id: newId('exp'),
    snapshotId: input.snapshot.id,
    subjectId: input.subjectId ?? subjectIdFor(input.task, input.content),
    task: input.task,
    locale: input.locale,
    level: input.level,
    modelId: input.modelId,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    citations,
    confidence: lowestConfidence(citations, input.content),
    content: input.content,
  };
  const snapshotSha = snapshotShaOf(input.content) ?? input.snapshot.sha;
  const key = explanationCacheKey({
    snapshotSha,
    subject: explanation.subjectId,
    task: explanation.task,
    locale: explanation.locale,
    level: explanation.level,
  });
  await ctx.store.putExplanation(key, explanation);
  ctx.counters.explanationKeys.add(key);
  return explanation;
}

function subjectIdFor(
  task: ExplanationTask,
  content: TimelineStory | NodeExplanation,
): string {
  return task === 'history' || isStory(content) ? 'timeline' : content.nodeId;
}

function snapshotShaOf(content: TimelineStory | NodeExplanation): string | null {
  return isStory(content) ? content.snapshotSha : null;
}

export function wrapResponse(
  task: ExplanationTask,
  content: TimelineStory | NodeExplanation,
): ExplanationResponse {
  const shape = isStory(content)
    ? { kind: 'history' as const, story: content as TimelineStory }
    : { kind: 'node' as const, explanation: content as NodeExplanation };
  void task;
  return shape as ExplanationResponse;
}

export function isStory(content: TimelineStory | NodeExplanation): content is TimelineStory {
  return Array.isArray((content as { milestones?: unknown }).milestones);
}

function collectCitations(content: TimelineStory | NodeExplanation): EvidenceRef[] {
  if (isStory(content)) {
    return dedupeRefs([
      ...content.claims.flatMap((c) => c.evidenceRefs),
      ...content.milestones.flatMap((part) => part.claims.flatMap((c) => c.evidenceRefs)),
    ]);
  }
  return dedupeRefs(content.claims.flatMap((c) => c.evidenceRefs));
}

function dedupeRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.sha}:${ref.path ?? ''}:${ref.startLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function lowestConfidence(
  _citations: EvidenceRef[],
  content: TimelineStory | NodeExplanation,
): 'low' | 'medium' | 'high' {
  const claims = isStory(content)
    ? [...content.claims, ...content.milestones.flatMap((p) => p.claims)]
    : content.claims;
  if (claims.length === 0) return 'low';
  if (claims.some((c) => c.confidence === 'low')) return 'low';
  if (claims.some((c) => c.confidence === 'medium')) return 'medium';
  return 'high';
}

// ── Service (used by createPipeline and the /api/explanations route) ─────────

export function createExplanationService(ctx: {
  store: Store;
  ai: AiProvider;
  fixture: PipelineContext['fixture'];
  graphCache: PipelineContext['graphCache'];
  compareCache: PipelineContext['compareCache'];
  counters: PipelineContext['counters'];
  clientFor: PipelineContext['clientFor'];
}) {
  return {
    async explain(input: ExplanationRequest): Promise<ExplanationResponse> {
      // TRD §6.1: never trust arbitrary client evidence — everything is
      // re-derived from persisted facts / the process-local graph cache.
      const repository = await ctx.store.getRepository(input.repositoryId);
      if (!repository) throw new Error(`not-found: repository ${input.repositoryId}`);
      const snapshot = await ctx.store.getSnapshotBySha(input.repositoryId, input.snapshotSha);
      if (!snapshot) throw new Error(`not-found: snapshot ${input.snapshotSha}`);

      const key = explanationCacheKey({
        snapshotSha: snapshot.sha,
        subject: input.subject,
        task: input.task,
        locale: input.locale,
        level: input.level,
      });
      const cached = await ctx.store.getExplanation(key);
      if (cached) return wrapResponse(input.task, cached.content as TimelineStory | NodeExplanation);

      const content =
        input.task === 'history'
          ? await runHistory(ctx, repository, snapshot, input)
          : await runNode(ctx, repository, snapshot, input);
      await persistExplanation(ctx, {
        content,
        task: input.task,
        repository,
        snapshot,
        locale: input.locale,
        level: input.level,
        modelId: ctx.ai.modelId,
      });
      return wrapResponse(input.task, content);
    },
  };
}

async function runHistory(
  ctx: {
    store: Store;
    ai: AiProvider;
    fixture: PipelineContext['fixture'];
    compareCache: PipelineContext['compareCache'];
    clientFor: PipelineContext['clientFor'];
  },
  repository: Repository,
  snapshot: Snapshot,
  input: ExplanationRequest,
): Promise<TimelineStory> {
  const milestones = sortForHistory(await ctx.store.getMilestones(repository.id));
  if (milestones.length === 0) {
    throw new Error('not-found: no milestones analyzed yet; run analysis first');
  }
  // Subject must be "timeline" for history — ignore/normalize other values.
  void input.subject;
  const evidence = compareMilestoneEvidence(
    milestones,
    ctx.compareCache,
    repository.id,
    new Map(milestones.map((ms) => [ms.sha, ms.title])),
  );
  const client = ctx.clientFor(repository.owner, repository.name);
  const head = milestones[milestones.length - 1]!;
  let readmeExcerpt = '';
  try {
    readmeExcerpt = await client.fetchFile(repository.owner, repository.name, 'README.md', head.sha, FILE_BYTES_LIMIT);
  } catch {
    readmeExcerpt = fixtureReadme(ctx.fixture, repository, head.sha);
  }
  const knownPaths = collectKnownPaths(ctx.fixture, repository, milestones);
  const knownShas = milestones.map((ms) => ms.sha);
  const bundle = buildHistoryBundle(
    repository,
    milestones,
    evidence,
    knownShas,
    knownPaths,
    readmeExcerpt.slice(0, 4000),
  );
  return generateTimelineStory(ctx.ai, bundle, input.locale);
}

function fixtureReadme(
  fixture: PipelineContext['fixture'],
  repository: Repository,
  sha: string,
): string {
  if (!fixture || fixture.repository.owner !== repository.owner || fixture.repository.name !== repository.name) {
    return '';
  }
  return fixture.readme[sha] ?? '';
}

function collectKnownPaths(
  fixture: PipelineContext['fixture'],
  repository: Repository,
  milestones: Milestone[],
): Set<string> {
  const paths = new Set<string>();
  if (fixture && fixture.repository.owner === repository.owner && fixture.repository.name === repository.name) {
    for (const sha of milestones.map((m) => m.sha)) {
      for (const entry of fixture.trees[sha] ?? []) {
        const p = field(entry, 'path');
        if (typeof p === 'string') paths.add(p);
      }
      for (const [key] of Object.entries(fixture.compares)) {
        const [base, head] = key.split('...');
        if (base === milestones[0]?.sha || head === sha) {
          for (const f of fixture.compares[key] ?? []) {
            const p = comparePath(f);
            if (p) paths.add(p);
          }
        }
      }
    }
  }
  return paths;
}

async function runNode(
  ctx: {
    store: Store;
    ai: AiProvider;
    fixture: PipelineContext['fixture'];
    graphCache: PipelineContext['graphCache'];
    compareCache: PipelineContext['compareCache'];
    clientFor: PipelineContext['clientFor'];
  },
  repository: Repository,
  snapshot: Snapshot,
  input: ExplanationRequest,
): Promise<NodeExplanation> {
  const graph =
    ctx.graphCache.get(`${repository.id}:${snapshot.sha}`) ??
    (await ctx.store.getGraph(`${repository.id}:${snapshot.sha}`));
  if (!graph) {
    // TRD §4.2: process-local graph cache; a worker restart loses it.
    throw new Error('graph not loaded for this snapshot in this process; re-run analysis');
  }
  const node = graph.nodes.find((n) => n.id === input.subject);
  if (!node) throw new Error(`not-found: node ${input.subject} in snapshot ${snapshot.sha}`);
  const client = ctx.clientFor(repository.owner, repository.name);
  return generateNodeExplanation(ctx.ai, {
    repository,
    snapshot,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    node: { id: node.id, path: node.path },
    fetchFile: (path, sha, maxBytes) => client.fetchFile(repository.owner, repository.name, path, sha, maxBytes),
    locale: input.locale,
    level: input.level,
  });
}

export { ghUrl as evidenceUrl };
