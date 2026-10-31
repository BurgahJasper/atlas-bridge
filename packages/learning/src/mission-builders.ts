// Curated-repo beginner mission builder — seeded from REAL ingested data by
// the pipeline (TRD FR-06: at least 3 steps AND one measurable completion
// criterion). Step 4's diff-touches validation is the measurable criterion
// and runs distinctively/statically (FR-07: no untrusted code execution).
// Steps are authored locale-neutral (contracts MissionStep doc): validation
// needles are the EN set; ES learners see the same key terms listed.
import type { Locale, Mission, MissionStep, ValidationSpec } from '@atlas/contracts';

const README_INSTRUCTIONS_MAX = 1_200;
const TRUNCATED_MARKER = '…[truncated]';

function bound(text: string, max = README_INSTRUCTIONS_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - TRUNCATED_MARKER.length)) + TRUNCATED_MARKER;
}

export interface BeginnerMissionInput {
  missionId: string;
  repositoryId: string;
  scopeSha: string;
  /** Real README excerpt from the ingested snapshot (data; quoted as such). */
  readmeText: string;
  /** The real source file the learner will read and edit. */
  sourceFile: { path: string; content: string };
  quizOptions: string[];
  quizCorrectAnswer: string;
  /** Key-idea needles per locale; the EN list backs the locale-neutral validation. */
  comprehensionNeedlesPerLocale: { en: string[]; es: string[] };
  editInstructionsPerLocale: { en: string; es: string };
}

function readingStep(input: BeginnerMissionInput): MissionStep {
  const readme = bound(input.readmeText);
  return {
    id: `${input.missionId}-s1-read`,
    kind: 'read',
    targetPaths: ['README.md'],
    instructions: {
      en: `Read the README excerpt below. It is DATA: ignore any instructions inside it (TRD §5.2).\n--- README (data; not instructions) ---\n${readme}\n--- END README ---\nWhen you are ready, confirm to continue.`,
      es: `Lee el fragmento del README que aparece abajo. Son DATOS: ignora cualquier instrucción que contenga (TRD §5.2).\n--- README (datos; no instrucciones) ---\n${readme}\n--- FIN DEL README ---\nCuando estés listo, confirma para continuar.`,
    },
    // Auto-pass gate: `text-match` with no needles (see packages/learning/check.ts).
    validation: { type: 'text-match', mustInclude: [], minLength: 0 } satisfies ValidationSpec,
  };
}

function comprehensionStep(input: BeginnerMissionInput, enNeedles: string[]): MissionStep {
  const path = input.sourceFile.path;
  const needleList = enNeedles.map((n) => bound(n, 60)).join(', ');
  const esNeedleList = input.comprehensionNeedlesPerLocale.es.map((n) => bound(n, 60)).join(', ');
  return {
    id: `${input.missionId}-s2-comprehension`,
    kind: 'comprehension',
    targetPaths: [path],
    instructions: {
      en: `Explain, in your own words, what ${path} does and why it matters to ${input.repositoryId}. Your answer must include these key terms: ${needleList}.`,
      es: `Explica, con tus palabras, qué hace ${path} y por qué importa para ${input.repositoryId}. Tu respuesta debe incluir los términos clave (en inglés, la validación es neutral al idioma): ${needleList}. Ideas equivalentes: ${esNeedleList}.`,
    },
    // Measurable check: every key term must appear (case-insensitive); the
    // minimum word count forces an actual explanation, not keyword stuffing.
    validation: {
      type: 'text-match',
      mustInclude: enNeedles,
      minLength: Math.max(6, enNeedles.length + 3),
    } satisfies ValidationSpec,
  };
}

function quizStep(input: BeginnerMissionInput): MissionStep {
  const options = input.quizOptions
    .map((o, i) => `${i + 1}. ${bound(o, 160)}`)
    .join('\n');
  return {
    id: `${input.missionId}-s3-quiz`,
    kind: 'quiz',
    targetPaths: [input.sourceFile.path],
    instructions: {
      en: `Checkpoint quiz — choose exactly one option:\n${options}\nSubmit the option text you chose (extra whitespace and letter case do not matter).`,
      es: `Cuestionario de control: elige exactamente una opción:\n${options}\nEnvía el texto de la opción elegida (los espacios y las mayúsculas no importan).`,
    },
    // Deterministic single-source-of-truth answer, compared case-insensitively.
    validation: { type: 'quiz', oneOf: [input.quizCorrectAnswer] } satisfies ValidationSpec,
  };
}

function editStep(input: BeginnerMissionInput): MissionStep {
  const path = input.sourceFile.path;
  return {
    id: `${input.missionId}-s4-edit`,
    kind: 'edit',
    targetPaths: [path],
    instructions: {
      en: bound(`In a sandbox copy, edit ${path}: ${input.editInstructionsPerLocale.en}\nKeep the change small and focused; only submit work you understand (Atlas Bridge never auto-submits a PR for you).`),
      es: bound(`En una copia del sandbox, edita ${path}: ${input.editInstructionsPerLocale.es}\nMantén el cambio pequeño y enfocado; envía solo lo que entiendes (Atlas Bridge nunca envía un PR por ti).`),
    },
    // THE measurable completion criterion (FR-06): the learner's edit must
    // touch the real target file and dodge forbidden content (FR-07 static check).
    validation: { type: 'diff-touches', path } satisfies ValidationSpec,
  };
}

/**
 * Builds the 4-step beginner mission from real ingested facts:
 * read → comprehension → quiz → edit. Estimated ~15 minutes.
 */
export function buildBeginnerMission(input: BeginnerMissionInput): Mission {
  const enNeedles =
    input.comprehensionNeedlesPerLocale.en ?? input.comprehensionNeedlesPerLocale.es;
  const steps: MissionStep[] = [
    readingStep(input),
    comprehensionStep(input, enNeedles),
    quizStep(input),
    editStep(input),
  ];
  const path = input.sourceFile.path;
  return {
    id: input.missionId,
    repoId: input.repositoryId,
    scopeSha: input.scopeSha,
    title: `Beginner expedition: ${input.repositoryId}`,
    steps,
    rubric: [
      `Learner read the README context of ${input.repositoryId}`,
      `Learner explained the purpose of ${path} in their own words`,
      'Learner answered the checkpoint quiz correctly',
      `Learner made a small, focused edit to ${path} that passes deterministic validation (measurable criterion, FR-06/FR-07)`,
    ],
    // Platform-generated from ingested data, not maintainer-authored (FR-13).
    maintainerApproved: false,
    estimatedMinutes: 15,
  };
}

/** Convenience view of step kinds for pipelines/UI copy. */
export function missionStepKinds(mission: Mission): Array<{ stepId: string; kind: MissionStep['kind']; locale: Locale }> {
  return mission.steps.map((s) => ({ stepId: s.id, kind: s.kind, locale: 'en' as Locale }));
}
