import type { AiProvider } from '@atlas/ai';
import type { CuratedFixture, GitHubClient } from '@atlas/github';
import type { GraphSnapshot, Store } from '@atlas/contracts';

/**
 * Shared wiring for the analysis / explanation / contribution services
 * (TRD §4.1). Owned by createPipeline() in pipeline.ts.
 */
export interface PipelineContext {
  store: Store;
  ai: AiProvider;
  /** Live GitHub adapter (token-optional); used for any non-fixture repo. */
  liveClient: GitHubClient;
  /** Curated fixture, when the pipeline is fixture-aware (TRD §10.1.2). */
  fixture: CuratedFixture | null;
  fixtureClient: GitHubClient | null;
  /** Gated by explicit opt-in; no app sets this by default (TRD §7). */
  githubWriteToken?: string;
  /** Fixture routing: fixture data only when the URL matches the fixture repo (TRD §10.1.2). */
  clientFor(owner: string, name: string): GitHubClient;
  /**
   * v1 tradeoff: GraphSnapshots and compare payloads are cached per-process
   * instead of persisted (the Store contract does not expose graph APIs).
   * The worker process retains them for hot paths; a restart costs a
   * re-analysis (pipeline.graph() throws a clear error until then).
   */
  graphCache: Map<string, GraphSnapshot>;
  compareCache: Map<string, unknown[]>;
  /** Cheap demo-health counters (GET /healthz, TRD §6.1). */
  counters: {
    repositoryIds: Set<string>;
    explanationKeys: Set<string>;
  };
}

export interface PipelineOptionsInput {
  store: Store;
  ai?: AiProvider;
  githubToken?: string;
  github?: GitHubClient;
  fixture?: CuratedFixture;
  githubWriteToken?: string;
  mode?: 'embedded';
}

/** File/tree bounds shared by analysis and explanations (TRD FR-02). */
export const COMMIT_WINDOW = 30;
export const TREE_ENTRY_LIMIT = 300;
export const FILE_COUNT_LIMIT = 40;
export const FILE_BYTES_LIMIT = 48_000;
export const MAX_PATCH_EXCERPTS = 5;
export const MAX_PATCH_CHARS = 400;
