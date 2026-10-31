// OfflineMockProvider — deterministic templating fallback, NOT an LLM (TRD
// §10.1.7: "use clearly labeled cached outputs as fallback, never disguise
// recordings as live inference"). The user prompt carries a sentinel line
// `OFFLINE_MOCK_PAYLOAD: <base64url JSON>` with everything needed to fill the
// templates; evidence refs are copied verbatim from that payload so offline
// output never invents SHAs (TRD FR-03, §6.2).

import type { Claim, EvidenceRef, Locale, LearningLevel } from '@atlas/contracts';

import { AiError } from './types.js';
import type { AiCallSpec, AiProvider, AiResult } from './types.js';
import { parseJsonText } from './validate.js';

export const OFFLINE_MOCK_PAYLOAD_PREFIX = 'OFFLINE_MOCK_PAYLOAD: ';
const OFFLINE_MOCK_MODEL_ID = 'offline-mock';
const B64URL_RE = /^[A-Za-z0-9_-]{8,}={0,2}$/;

// ── Payload shapes (embedded by prompts.ts as the last line of `user`) ──────

export interface OfflineMilestoneFacts {
  milestoneId: string;
  sha: string;
  title: string;
  /** Commit-message subject / recorded notes. */
  summaries: string[];
  /** Changed file paths (diff headers). */
  diffHeaders: string[];
  /** Evidence refs copied VERBATIM into output claims (FR-03, §6.2). */
  evidenceRefs: EvidenceRef[];
}

export interface OfflineNodeFacts {
  nodeId: string;
  /** Purpose hints derived from recorded metadata (path, language, edges). */
  purposeHints: string[];
  evidenceRefs: EvidenceRef[];
}

export interface OfflineHintFacts {
  missionTitle: string;
  stepId: string;
  hintLevel: 1 | 2 | 3;
}

export type OfflinePayload =
  | {
      shape: 'timeline-story';
      repositoryName: string;
      shardOfFacts: OfflineMilestoneFacts[];
      locale: Locale;
      level: LearningLevel;
    }
  | {
      shape: 'node-explanation';
      repositoryName: string;
      shardOfFacts: OfflineNodeFacts;
      locale: Locale;
      level: LearningLevel;
    }
  | {
      shape: 'hint';
      repositoryName: string;
      shardOfFacts: OfflineHintFacts;
      locale: Locale;
      level: LearningLevel;
    };

/** Encodes a payload as base64url (deterministic). */
export function encodeOfflinePayload(payload: OfflinePayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decodes the sentinel payload; throws AiError('provider') when unusable. */
export function decodeOfflinePayload(encoded: string): OfflinePayload {
  const throwBad = (): never => {
    throw new AiError('provider', 'OFFLINE_MOCK_PAYLOAD missing or undecodable');
  };
  const trimmed = encoded.trim();
  if (!B64URL_RE.test(trimmed)) throwBad();
  let b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  let json: string | null = null;
  try {
    json = Buffer.from(b64, 'base64').toString('utf8');
    // Round-trip guard so silent coercion cannot slip through.
    const rebuilt = Buffer.from(json, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    if (rebuilt !== trimmed) throwBad();
  } catch (err) {
    if (err instanceof AiError) throw err;
    json = null;
  }
  if (json === null) throwBad();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(json as string);
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('shape' in parsed) ||
    !('shardOfFacts' in parsed)
  ) {
    throwBad();
  }
  return parsed as OfflinePayload;
}

// ── Bilingual deterministic templates (es/en, FR-08 labeled fallback) ───────

const OFFLINE_TAIL = {
  en: '(generated offline, clearly labeled fallback)',
  es: '(generado sin conexión, recurso provisional etiquetado)',
} as const;

function pluralOnes(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function offlineStory(payload: Extract<OfflinePayload, { shape: 'timeline-story' }>) {
  const es = payload.locale === 'es';
  const summary = es
    ? `Narrativa sin conexión para ${payload.repositoryName} (recurso provisional etiquetado claramente).`
    : `Offline narrative for ${payload.repositoryName} (clearly labeled fallback).`;

  const milestones = payload.shardOfFacts.map((m) => {
    const narrative = es
      ? `Resumen sin conexión: "${m.title}" agrupa ${pluralOnes(m.diffHeaders.length, 'cambio de archivo registrado', 'cambios de archivo registrados')} y ${pluralOnes(m.summaries.length, 'nota registrada', 'notas registradas')} del repositorio. ${OFFLINE_TAIL.es}`
      : `Offline summary: "${m.title}" groups ${pluralOnes(m.diffHeaders.length, 'tracked file change', 'tracked file changes')} and ${pluralOnes(m.summaries.length, 'recorded summary note', 'recorded summary notes')} from the repository. ${OFFLINE_TAIL.en}`;

    const firstSummary = m.summaries[0] ? m.summaries[0].slice(0, 160) : '';
    const claim: Claim = {
      text: es
        ? `Cambio registrado en ${m.sha}${firstSummary ? `: ${firstSummary}` : '.'}`
        : `Recorded change at ${m.sha}${firstSummary ? `: ${firstSummary}` : '.'}`,
      // Every mock claim is an inference with low confidence; refs are the
      // payload's own refs (guaranteed to resolve to fetched evidence, §6.2).
      basis: 'inferred',
      confidence: 'low',
      evidenceRefs: m.evidenceRefs,
    };

    return { milestoneId: m.milestoneId, sha: m.sha, title: m.title, narrative, claims: [claim] };
  });

  return { summary, milestones, untranslatedTerms: [] };
}

function offlineNode(payload: Extract<OfflinePayload, { shape: 'node-explanation' }>) {
  const es = payload.locale === 'es';
  const facts = payload.shardOfFacts;
  const purpose = es
    ? `Responsabilidad técnica de ${facts.nodeId}.`
    : `Technical responsibility of ${facts.nodeId}.`;
  const hints = facts.purposeHints.slice(0, 8).join('; ');
  const detail = es
    ? `Metadatos registrados: ${hints || '(sin metadatos)'}. ${OFFLINE_TAIL.es}`
    : `Recorded metadata: ${hints || '(no metadata)'}. ${OFFLINE_TAIL.en}`;
  const claim: Claim = {
    text: es
      ? 'Responsabilidades inferidas a partir de los metadatos registrados del repositorio.'
      : 'Responsibilities inferred from recorded repository metadata.',
    basis: 'inferred',
    confidence: 'low',
    evidenceRefs: facts.evidenceRefs,
  };
  return { nodeId: facts.nodeId, purpose, detail, claims: [claim], locale: payload.locale };
}

function offlineHint(payload: Extract<OfflinePayload, { shape: 'hint' }>) {
  const es = payload.locale === 'es';
  const { missionTitle, stepId, hintLevel } = payload.shardOfFacts;
  const base: Record<1 | 2 | 3, { en: string; es: string }> = {
    1: {
      en: `Hint: re-read the step instructions for "${missionTitle}" and inspect the highlighted file before trying again.`,
      es: `Pista: vuelve a leer las instrucciones del paso de «${missionTitle}» y revisa el archivo destacado antes de reintentarlo.`,
    },
    2: {
      en: 'Hint: focus on the exact wording the step asks for — a small, precise change is enough.',
      es: 'Pista: concéntrate en la redacción exacta que pide el paso; un cambio pequeño y preciso es suficiente.',
    },
    3: {
      en: 'Hint: compare your attempt with the step instructions line by line; Atlas Bridge never auto-submits pull requests for you.',
      es: 'Pista: compara tu intento con las instrucciones del paso línea por línea; Atlas Bridge nunca envía pull requests por ti.',
    },
  };
  const text = base[hintLevel][es ? 'es' : 'en'];
  return { text: `${text} ${es ? OFFLINE_TAIL.es : OFFLINE_TAIL.en}`, stepId, hintLevel, locale: payload.locale };
}

export function buildOfflineJson(payload: OfflinePayload): unknown {
  switch (payload.shape) {
    case 'timeline-story':
      return offlineStory(payload);
    case 'node-explanation':
      return offlineNode(payload);
    case 'hint':
      return offlineHint(payload);
    default: {
      throw new AiError('provider', 'OFFLINE_MOCK_PAYLOAD unknown shape');
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * Deterministic mock provider. The `user` prompt must end with the sentinel
 * payload line (prompts.ts guarantees this); mistakes within the offline
 * path surface as errors instead of silently fabricating content.
 */
export class OfflineMockProvider implements AiProvider {
  readonly modelId = OFFLINE_MOCK_MODEL_ID;
  readonly offline = true;

  async generateText(spec: AiCallSpec): Promise<AiResult> {
    // Async so sentinel mistakes surface as rejections, not sync throws.
    return this.render(spec);
  }

  async generateJson<T>(spec: AiCallSpec): Promise<T> {
    // Parses its own deterministic text as JSON; schema validation is the
    // caller's job (TRD §5.1 guardrails outside the provider).
    const render = this.render(spec);
    return parseJsonText<T>(render.text);
  }

  private render(spec: AiCallSpec): AiResult {
    const idx = spec.user.lastIndexOf(OFFLINE_MOCK_PAYLOAD_PREFIX);
    if (idx === -1) {
      throw new AiError('provider', 'OFFLINE_MOCK_PAYLOAD missing');
    }
    const line =
      spec.user
        .slice(idx + OFFLINE_MOCK_PAYLOAD_PREFIX.length)
        .split(/[\r\n]/)[0]
        ?.trim() ?? '';
    const payload = decodeOfflinePayload(line);
    return {
      modelId: OFFLINE_MOCK_MODEL_ID,
      offline: true,
      text: JSON.stringify(buildOfflineJson(payload)),
    };
  }
}
