import type { Milestone, Mission, MissionStep, Repository } from '@atlas/contracts';

/**
 * Beginner mission seeded from a REAL change (TRD FR-06, §14: first missions
 * are comprehension + documentation edit, no unsafe code execution).
 *
 * The focus is the milestone with the most changed files. Every answer is
 * derived from fetched compare data or the tree, so a learner's success means
 * they actually read the history, not that they recalled a generic fact.
 * Deterministic: no model is involved in scoring (TRD §5.2).
 */

export interface FocusMilestone {
  milestone: Milestone;
  changedFiles: string[];
}

export interface FocusMissionInput {
  repository: Pick<Repository, 'id' | 'owner' | 'name'>;
  milestone: Milestone;
  /** Files changed in this milestone, from the compare API (non-empty). */
  changedFiles: string[];
  /** Files from the same tree that did NOT change here: quiz distractors. */
  distractorFiles: string[];
  /** Immutable revision the learner's starting files are read from. */
  scopeSha: string;
}

/** The milestone (after the first) that changed the most files. */
export function pickFocusMilestone(
  ordered: Milestone[],
  changedFilesBySha: Map<string, string[]>,
): FocusMilestone | null {
  let best: FocusMilestone | null = null;
  for (const milestone of ordered) {
    const changedFiles = [...new Set(changedFilesBySha.get(milestone.sha) ?? [])].filter(
      (path) => path.length > 0,
    );
    if (changedFiles.length === 0) continue;
    if (!best || changedFiles.length > best.changedFiles.length) {
      best = { milestone, changedFiles };
    }
  }
  return best;
}

/** Deterministic distractors: unchanged source files first, then by path. */
export function distractorsFor(treePaths: string[], changedFiles: string[], limit = 2): string[] {
  const changed = new Set(changedFiles);
  const candidates = treePaths
    .filter((path) => !changed.has(path) && !/(^|\/)readme\.md$/i.test(path))
    .sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
  return candidates.slice(0, limit);
}

function sourceRank(path: string): number {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i.test(path) ? 0 : 1;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function seedFocusMission(input: FocusMissionInput): Mission {
  const { repository, milestone, changedFiles, distractorFiles, scopeSha } = input;
  const shortSha = milestone.sha.slice(0, 7);
  const primary = changedFiles[0]!;
  const primaryName = primary.split('/').pop() ?? primary;
  const missionId = `mission_${repository.owner}_${repository.name}_beginner`;
  const stepId = (suffix: string): string => `${missionId}-${suffix}`;

  const steps: MissionStep[] = [
    {
      id: stepId('s1-read'),
      kind: 'read',
      instructions: {
        en: `Open the milestone "${milestone.title}" (commit ${shortSha}) and skim the list of files it changed.`,
        es: `Abre el hito «${milestone.title}» (commit ${shortSha}) y revisa la lista de archivos que cambió.`,
      },
      targetPaths: changedFiles.slice(0, 3),
      validation: { type: 'text-match', mustInclude: [] },
    },
    {
      id: stepId('s2-comprehension'),
      kind: 'comprehension',
      instructions: {
        en: 'In one short sentence, name one file that changed in this milestone.',
        es: 'En una frase corta, nombra un archivo que haya cambiado en este hito.',
      },
      targetPaths: [primary],
      validation: { type: 'text-match', mustInclude: [primaryName], caseSensitive: false, minLength: 3 },
    },
  ];

  if (distractorFiles.length >= 2) {
    steps.push({
      id: stepId('s3-quiz'),
      kind: 'quiz',
      instructions: {
        en: 'Which of these files changed in this milestone?',
        es: '¿Cuál de estos archivos cambió en este hito?',
      },
      targetPaths: [],
      options: [primary, ...distractorFiles.slice(0, 2)],
      validation: { type: 'quiz', oneOf: [primary] },
    });
  }

  steps.push({
    id: stepId('s4-edit'),
    kind: 'edit',
    instructions: {
      en: `Add one line to README.md that names commit ${shortSha} and what you learned from it.`,
      es: `Agrega una línea a README.md que mencione el commit ${shortSha} y lo que aprendiste de él.`,
    },
    targetPaths: ['README.md'],
    validation: { type: 'pattern', file: 'README.md', regex: escapeRegex(shortSha) },
  });

  return {
    id: missionId,
    repoId: repository.id,
    scopeSha,
    title: `First look: ${milestone.title}`,
    steps,
    rubric: [
      'Comprehension: name a file that changed in the focus milestone.',
      ...(distractorFiles.length >= 2 ? ['Quiz: identify a changed file from the set of options.'] : []),
      `Practice: cite commit ${shortSha} in a README note.`,
    ],
    maintainerApproved: false,
    estimatedMinutes: 15,
  };
}
