import { z } from 'zod';
import type { Locale, MissionStep } from '@atlas/contracts';
import { getOverviewBySlug, getPipeline, ensureCuratedDemo } from '@/lib/pipeline';
import { t } from '@/lib/i18n';
import { ApiError } from '@/lib/errors';
import { handle, jsonOk, readJsonBody } from '@/lib/api-utils';

/**
 * POST /api/hints — hint ladder (FR-11, TRD §2.2 learn). Implemented
 * deterministically in the web layer from the mission step + validation spec,
 * so it works in any mode and cannot leak model secrets. Escalating levels
 * reveal progressively more concrete guidance; the evaluator still decides
 * pass/fail (TRD §5.1: hints, never auto-advance).
 */
const BodySchema = z.object({
  repositoryId: z.string().min(1),
  missionId: z.string().min(1),
  stepId: z.string().min(1),
  learnerText: z.string().max(20000).optional(),
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  locale: z.enum(['en', 'es']).default('en'),
});

function buildHint(
  level: 1 | 2 | 3,
  step: MissionStep,
  locale: Locale,
  missionTitle: string,
): string {
  const instructions = step.instructions[locale] ?? step.instructions.en ?? '';
  if (level === 1) {
    const firstSentence = instructions.split(/[.!?](\s|$)/)[0] ?? instructions;
    return `${t(locale, 'contribute.hintLevelLabel', { level })}: ${firstSentence}`.trim();
  }
  if (level === 2) {
    const target = step.targetPaths[0];
    return target
      ? `${t(locale, 'contribute.hintLevelLabel', { level })}: ${t(locale, 'step.targetLabel')} → ${target}`
      : `${t(locale, 'contribute.hintLevelLabel', { level })}: ${missionTitle}`;
  }
  // Level 3: most concrete hint derived from the deterministic validator.
  const v = step.validation;
  if (v.type === 'text-match' && v.mustInclude.length > 0) {
    return `${t(locale, 'contribute.hintLevelLabel', { level })}: "${v.mustInclude[0]}"`;
  }
  if (v.type === 'quiz') {
    return `${t(locale, 'contribute.hintLevelLabel', { level })}: ${v.oneOf[0] ?? ''}`;
  }
  if (v.type === 'pattern') {
    return `${t(locale, 'contribute.hintLevelLabel', { level })}: ${v.file} (${v.regex})`;
  }
  if (v.type === 'diff-touches') {
    return `${t(locale, 'contribute.hintLevelLabel', { level })}: ${v.path}`;
  }
  return `${t(locale, 'contribute.hintLevelLabel', { level })}: ${instructions.slice(-120)}`;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    await ensureCuratedDemo();
    const body = (await readJsonBody(request)) as unknown;
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(400, 'bad_request', `validation failed — ${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`);
    }
    const { repositoryId, missionId, stepId, hintLevel, locale } = parsed.data;
    const resolved = await getOverviewBySlug(repositoryId);
    const missions = await getPipeline().listMissions(resolved?.repositoryId ?? repositoryId);
    const mission = missions.find((m) => m.id === missionId);
    if (!mission) throw new ApiError(404, 'not_found', `mission ${missionId} not found`);
    const step: MissionStep | undefined = mission.steps.find((s) => s.id === stepId);
    if (!step) throw new ApiError(404, 'not_found', `step ${stepId} not found in mission ${missionId}`);
    return jsonOk({
      stepId,
      level: hintLevel,
      text: buildHint(hintLevel, step, locale, mission.title),
      locale,
    });
  });
}
