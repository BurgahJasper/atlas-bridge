import { z } from 'zod';

// ── Locale / level schemas (TRD §1.2 G2: extensible locale system) ──────────

export const LocaleSchema = z.enum(['en', 'es']);
export type ZLocale = z.infer<typeof LocaleSchema>;

export const LevelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export type ZLevel = z.infer<typeof LevelSchema>;

// ── Evidence (TRD §5.3 sample contract) ─────────────────────────────────────

export const EvidenceRefSchema = z.object({
  sha: z.string().min(1),
  path: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

export const ClaimSchema = z.object({
  text: z.string(),
  basis: z.enum(['explicit', 'inferred']),
  confidence: z.enum(['low', 'medium', 'high']),
  evidenceRefs: z.array(EvidenceRefSchema),
});

export const MilestoneStoryPartSchema = z.object({
  milestoneId: z.string(),
  sha: z.string().min(7),
  title: z.string(),
  narrative: z.string(),
  claims: z.array(ClaimSchema),
});

/**
 * Representative structured response (TRD §6.2):
 * { snapshotSha, locale, summary, claims, untranslatedTerms }
 */
export const TimelineStorySchema = z.object({
  snapshotSha: z.string().min(7),
  milestones: z.array(MilestoneStoryPartSchema),
  locale: LocaleSchema,
  summary: z.string(),
  claims: z.array(ClaimSchema),
  untranslatedTerms: z.array(z.string()),
  offline: z.boolean().default(false),
});

export const NodeExplanationSchema = z.object({
  nodeId: z.string(),
  purpose: z.string(),
  detail: z.string(),
  claims: z.array(ClaimSchema),
  locale: LocaleSchema,
  offline: z.boolean().default(false),
});

// ── API request/response contracts (TRD §6.1) ───────────────────────────────

export const AnalyzeRequestSchema = z.object({
  /** Public GitHub URL; validated + SSRF-guarded in packages/github. */
  url: z.string().url().max(2048),
  locale: LocaleSchema.default('en'),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const JobStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'running', 'done', 'error', 'cancelled']),
  stage: z.string(),
  progress: z.number().min(0).max(100),
  snapshotIds: z.array(z.string()),
  warnings: z.array(z.string()),
  error: z.string().optional(),
});
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

export const ExplanationRequestSchema = z.object({
  repositoryId: z.string(),
  snapshotSha: z.string().min(7),
  /** Subject: "timeline" for history narration, or a graph node id. */
  subject: z.string(),
  task: z.enum(['history', 'node']),
  locale: LocaleSchema,
  level: LevelSchema,
});
export type ExplanationRequest = z.infer<typeof ExplanationRequestSchema>;

export const ExplanationResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('history'),
    story: TimelineStorySchema,
  }),
  z.object({
    kind: z.literal('node'),
    explanation: NodeExplanationSchema,
  }),
]);
export type ExplanationResponse = z.infer<typeof ExplanationResponseSchema>;

// ── Missions (TRD §6.1 /api/missions/:id/check) ─────────────────────────────

export const MissionSubmissionSchema = z.object({
  stepId: z.string(),
  answerText: z.string().max(20000).optional(),
  quizAnswer: z.string().optional(),
  editedFiles: z
    .array(z.object({ path: z.string().max(1024), content: z.string().max(1_000_000) }))
    .optional(),
});
export type MissionSubmission = z.infer<typeof MissionSubmissionSchema>;

export const MissionCheckRequestSchema = z.object({
  missionId: z.string(),
  submission: MissionSubmissionSchema,
});
export type MissionCheckRequest = z.infer<typeof MissionCheckRequestSchema>;

export const MissionCheckResponseSchema = z.object({
  passed: z.boolean(),
  completedStepId: z.string().nullable(),
  feedback: z.string(),
  /** Which deterministic rule failed, for actionable feedback (TRD §5.2). */
  failedRule: z.string().nullable(),
});
export type MissionCheckResponse = z.infer<typeof MissionCheckResponseSchema>;

// ── Contributions (TRD §6.1 preview/submit, FR-10) ──────────────────────────

export const ContributionPreviewRequestSchema = z.object({
  repositoryId: z.string(),
  missionId: z.string(),
  files: z.array(z.object({ path: z.string().max(1024), content: z.string().max(1_000_000) })),
});
export type ContributionPreviewRequest = z.infer<typeof ContributionPreviewRequestSchema>;

export const ContributionPreviewResponseSchema = z.object({
  diff: z.string(),
  branch: z.string(),
  destination: z.string(),
  scopeSummary: z.string(),
  requiresOAuth: z.boolean(),
});
export type ContributionPreviewResponse = z.infer<typeof ContributionPreviewResponseSchema>;

export const ContributionSubmitRequestSchema = z.object({
  missionId: z.string(),
  repositoryId: z.string(),
  files: z.array(z.object({ path: z.string().max(1024), content: z.string().max(1_000_000) })),
  /** Explicit confirmation flag; submit is a no-op without it (TRD §7). */
  confirmed: z.literal(true),
});
export type ContributionSubmitRequest = z.infer<typeof ContributionSubmitRequestSchema>;

// ── Mission shape over the wire ─────────────────────────────────────────────

export const ValidationSpecSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text-match'),
    mustInclude: z.array(z.string()),
    caseSensitive: z.boolean().optional(),
    minLength: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('pattern'),
    file: z.string(),
    regex: z.string(),
    flags: z.string().optional(),
  }),
  z.object({
    type: z.literal('diff-touches'),
    path: z.string(),
    mustNotInclude: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('quiz'),
    oneOf: z.array(z.string()),
  }),
]);

export const MissionStepSchema = z.object({
  id: z.string(),
  kind: z.enum(['read', 'comprehension', 'quiz', 'edit']),
  instructions: z.record(LocaleSchema, z.string()),
  targetPaths: z.array(z.string()),
  options: z.array(z.string()).optional(),
  validation: ValidationSpecSchema,
});

export const MissionSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  scopeSha: z.string(),
  title: z.string(),
  steps: z.array(MissionStepSchema),
  rubric: z.array(z.string()),
  maintainerApproved: z.boolean(),
  issueUrl: z.string().optional(),
  estimatedMinutes: z.number().int().positive(),
});
export type ZMission = z.infer<typeof MissionSchema>;
