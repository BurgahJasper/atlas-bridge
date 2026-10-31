import type {
  AnalysisJob,
  ContributionPreviewRequest,
  ContributionPreviewResponse,
  ContributionSubmitRequest,
  ExplanationRequest,
  ExplanationResponse,
  GraphSnapshot,
  LearnerProgress,
  Milestone,
  Mission,
  MissionCheckRequest,
  MissionCheckResponse,
  Repository,
  Snapshot,
  Store,
} from '@atlas/contracts';

/**
 * Structural interface for the Pipeline surface provided by @atlas/pipeline
 * (TRD §4, §6.1). The web app depends only on this shape; if the pipeline
 * package refines a signature, reconcile inside lib/pipeline.ts's factory —
 * not across the app.
 */
export interface AtlasPipeline {
  analyze(input: { url: string; locale: string }): Promise<{ jobId: string }>;
  getJob(id: string): Promise<AnalysisJob | null>;
  overview(
    repositoryId: string,
  ): Promise<{ repository: Repository; snapshots: Snapshot[]; milestones: Milestone[]; coverage: string; warnings: string[] }>;
  history(repositoryId: string): Promise<Milestone[]>;
  graph(repositoryId: string, snapshotSha: string): Promise<GraphSnapshot>;
  explain(req: ExplanationRequest): Promise<ExplanationResponse>;
  listMissions(repositoryId: string): Promise<Mission[]>;
  checkMissionStep(request: MissionCheckRequest): Promise<MissionCheckResponse>;
  submitMissionStep(input: {
    userOrAnonymousId: string;
    missionId: string;
    submission: MissionCheckRequest['submission'];
    locale: string;
  }): Promise<{ passed: boolean; completedStepId: string | null; progress: LearnerProgress }>;
  previewContribution(req: ContributionPreviewRequest): Promise<ContributionPreviewResponse>;
  submitContribution(req: ContributionSubmitRequest): Promise<{ prUrl?: string; status: 'submitted' | 'reviewed' | 'failed'; note?: string }>;
  healthz(): Promise<{ ok: boolean; repositoryCount: number; cachedExplanations: number }>;
}

export type { Store };
