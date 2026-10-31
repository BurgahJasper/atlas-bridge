import type {
  AnalysisJob,
  Contribution,
  Explanation,
  GraphSnapshot,
  LearnerProgress,
  Milestone,
  Mission,
  Repository,
  Snapshot,
} from './entities.js';

/**
 * Persistence boundary (TRD §6). Default implementation is the in-memory
 * store (demo / local mode). Postgres implementation lives behind the same
 * interface and is wired through infra/postgres/schema.sql (TRD §14).
 */
export interface Store {
  // Repositories
  getRepository(id: string): Promise<Repository | null>;
  getRepositoryBySlug(owner: string, name: string): Promise<Repository | null>;
  putRepository(repo: Repository): Promise<void>;

  // Snapshots
  getSnapshot(id: string): Promise<Snapshot | null>;
  getSnapshotsForRepository(repositoryId: string): Promise<Snapshot[]>;
  getSnapshotBySha(repositoryId: string, sha: string): Promise<Snapshot | null>;
  putSnapshot(snapshot: Snapshot): Promise<void>;
  putSnapshots(snapshots: Snapshot[]): Promise<void>;

  // Milestones
  getMilestones(repositoryId: string): Promise<Milestone[]>;
  putMilestones(milestones: Milestone[]): Promise<void>;

  // Missions
  getMissions(repoId: string): Promise<Mission[]>;
  getMission(id: string): Promise<Mission | null>;
  putMissions(missions: Mission[]): Promise<void>;

  // Explanations (cache keyed by sha+locale+level+promptVersion, TRD §12)
  getExplanation(cacheKey: string): Promise<Explanation | null>;
  putExplanation(cacheKey: string, explanation: Explanation): Promise<void>;

  // Job registry
  getJob(id: string): Promise<AnalysisJob | null>;
  putJob(job: AnalysisJob): Promise<void>;

  // Learner progress (FR-12: minimal, no PII beyond opaque ids)
  getProgress(userOrAnonymousId: string, missionId: string): Promise<LearnerProgress | null>;
  putProgress(progress: LearnerProgress): Promise<void>;

  // Graphs (per milestone SHA; survives restarts so graph routes keep working)
  getGraph(key: string): Promise<GraphSnapshot | null>;
  putGraph(key: string, graph: GraphSnapshot): Promise<void>;

  // Contributions
  getContribution(id: string): Promise<Contribution | null>;
  putContribution(contribution: Contribution): Promise<void>;
}

export function explanationCacheKey(input: {
  snapshotSha: string;
  subject: string;
  task: string;
  locale: string;
  level: string;
}): string {
  return `${input.task}:${input.snapshotSha}:${input.subject}:${input.locale}:${input.level}`;
}

export function newId(prefix: string): string {
  const rand =
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12) ??
    Math.random().toString(36).slice(2, 14);
  return `${prefix}_${rand}`;
}
