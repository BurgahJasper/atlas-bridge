// Deterministic pre/post-checks around model output — TRD §5.2 ("deterministic
// pre- and post-checks; scoring cannot rely only on model self-evaluation"),
// §5.3 (citation allowlist) and FR-03 (visibly mark inferences).

import type { Claim, NodeExplanation, TimelineStory } from '@atlas/contracts';

import { AiError } from './types.js';

// ── Protected tokens (translation invariant, TRD §5.2: never translate
//    SHAs/paths/URLs/identifiers) ────────────────────────────────────────────

const URL_RE = /(?:https?:\/\/|www\.)[^\s"'`<>()]+/g;
const TICKED_ID_RE = /`([^`\n]{1,120})`/g;
/** File-like paths, e.g. `src/api.ts`; tolerant of sentence punctuation. */
const PATH_RE = /[\w-]+(?:[./\\][\w-]+)*\.\w{1,5}\b/g;
/** Fake/hostile sentinels already present in the source text. */
const SENTINEL_LIKE_RE = /⟦\s*T\s*\d+\s*⟧/g;

const DONE_MARKER = '…[truncated]';

/**
 * Replaces URLs, ticked identifiers and file-like paths with stable
 * sentinels ⟦T0⟧ ⟦T1⟧ … Mapping is deterministic for the same input, so
 * callers can recompute the token list to restore translated text later.
 */
export function protectTokens(text: string): { protected: string; tokens: string[] } {
  const tokens: string[] = [];
  const put = (candidate: string): string => {
    let i = tokens.indexOf(candidate);
    if (i === -1) {
      tokens.push(candidate);
      i = tokens.length - 1;
    }
    return `⟦T${i}⟧`;
  };

  // Order matters: hostile fake sentinels are tokenized first (identity
  // mapping — they restore to exactly what they were), then URLs (so the path
  // pass cannot bite inside a URL), then backticked identifiers — skipping
  // inner content that is already a sentinels to avoid nested wrapping — and
  // finally bare file-like paths. Real sentinels ⟦T…⟧ match none of the
  // regexes afterwards.
  let out = text.replace(SENTINEL_LIKE_RE, (m) => put(m));
  out = out.replace(URL_RE, (m) => put(m));
  out = out.replace(TICKED_ID_RE, (m, inner: string) =>
    inner.includes('⟦') ? m : '`' + put(inner) + '`',
  );
  out = out.replace(PATH_RE, (m) => (m.length >= 4 ? put(m) : m));

  return { protected: out, tokens };
}

/** Replaces ⟦Tn⟧ sentinels with their original tokens; unknown sentinels stay. */
export function restoreTokens(text: string, tokens: string[]): string {
  return text.replace(/⟦T\s*(\d+)⟧/g, (m, digits: string) => {
    const i = Number(digits);
    return i >= 0 && i < tokens.length ? tokens[i] : m;
  });
}

// ── Citation validation (TRD §5.3, §6.2: 100% of citations must resolve) ────

export interface CitationReview {
  valid: Claim[];
  invalid: Claim[];
}

/**
 * Claims are invalid when they carry no evidenceRefs, cite a SHA outside the
 * fetched facts, or cite a path outside the fetched tree (allowlisted
 * citations only, TRD §5.2/§5.3).
 */
export function validateCitationsSync(
  claims: Claim[],
  known: { shas: Set<string>; paths: Set<string> },
): CitationReview {
  const valid: Claim[] = [];
  const invalid: Claim[] = [];
  for (const claim of claims) {
    if (isClaimVerifiable(claim, known)) valid.push(claim);
    else invalid.push(claim);
  }
  return { valid, invalid };
}

function isClaimVerifiable(
  claim: Claim,
  known: { shas: Set<string>; paths: Set<string> },
): boolean {
  if (claim.evidenceRefs.length === 0) return false;
  return claim.evidenceRefs.every(
    (ref) =>
      known.shas.has(ref.sha) &&
      (ref.path === undefined || known.paths.has(ref.path)),
  );
}

export interface StripCitationsResult {
  story?: TimelineStory;
  explanation?: NodeExplanation;
  /** Number of claims dropped for unverifiable citations. */
  dropped: number;
}

/**
 * Removes unverifiable claims from a story or node explanation.
 * Milestone parts (or node explanations) that lose ALL claims keep their text
 * but get the narrative prefixed with `[unverified] ` — inferences are visibly
 * marked, never silently deleted (TRD FR-03). `untranslatedTerms` is untouched.
 */
export function stripClaims(
  input: TimelineStory,
  known: { shas: Set<string>; paths: Set<string> },
): StripCitationsResult;
export function stripClaims(
  input: NodeExplanation,
  known: { shas: Set<string>; paths: Set<string> },
): StripCitationsResult;
export function stripClaims(
  input: TimelineStory | NodeExplanation,
  known: { shas: Set<string>; paths: Set<string> },
): StripCitationsResult {
  if ('milestones' in input) {
    const story = input as TimelineStory;
    let dropped = 0;
    const milestones = story.milestones.map((part) => {
      const review = validateCitationsSync(part.claims, known);
      dropped += review.invalid.length;
      const narrative =
        review.valid.length === 0 && review.invalid.length > 0
          ? `[unverified] ${part.narrative}`
          : part.narrative;
      return { ...part, narrative, claims: review.valid };
    });
    const top = validateCitationsSync(story.claims, known);
    dropped += top.invalid.length;
    return {
      story: {
        ...story,
        milestones,
        claims: top.valid,
        untranslatedTerms: story.untranslatedTerms,
      },
      dropped,
    };
  }

  const explanation = input as NodeExplanation;
  const review = validateCitationsSync(explanation.claims, known);
  return {
    explanation: {
      ...explanation,
      purpose:
        review.valid.length === 0 && review.invalid.length > 0
          ? `[unverified] ${explanation.purpose}`
          : explanation.purpose,
      claims: review.valid,
    },
    dropped: review.invalid.length,
  };
}

// ── Basis enforcement (TRD §5.2: "explicit" only when commit/PR text says it) ─

const BASIS_STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'into', 'were', 'have', 'been', 'their', 'there',
  'which', 'would', 'should', 'could', 'about', 'after', 'before', 'also', 'more',
  'some', 'only', 'them', 'they', 'then', 'than', 'when', 'what', 'while', 'where',
  'file', 'files', 'commit', 'change', 'changed', 'changes', 'milestone', 'repository',
  // Generic release/maintenance vocabulary: overlap on these alone proves nothing.
  'update', 'updated', 'updates', 'version', 'versions', 'release', 'releases',
  'bump', 'bumped', 'upgrade', 'upgraded', 'merge', 'merged', 'pull', 'request',
]);

/**
 * Content tokens for overlap checks. Prefix-5 normalization makes inflections
 * match ("removed" ~ "remove", "adds" ~ "add" is too short, so it is skipped).
 */
export function claimTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || BASIS_STOPWORDS.has(raw)) continue;
    tokens.add(raw.slice(0, 5));
  }
  return tokens;
}

/**
 * Deterministic basis policy. A claim may stay `explicit` only when a cited
 * commit's own message shares at least two content tokens with it (or all of
 * them when the claim is very short). Anything else becomes `inferred` and
 * cannot claim `high` confidence. Model self-labels are never trusted alone.
 */
export function enforceBasis(claims: Claim[], commitMessages: Map<string, string>): Claim[] {
  return claims.map((claim) => {
    if (claim.basis !== 'explicit') return capInferred(claim);
    const wanted = claimTokens(claim.text);
    const supported = claim.evidenceRefs.some((ref) => {
      const message = commitMessages.get(ref.sha);
      if (!message || wanted.size === 0) return false;
      const have = claimTokens(message);
      let overlap = 0;
      for (const token of wanted) if (have.has(token)) overlap += 1;
      return overlap >= Math.min(2, wanted.size);
    });
    if (supported) return claim;
    return capInferred({ ...claim, basis: 'inferred' });
  });
}

/** Inferred claims are never high-confidence (TRD §5.3). */
export function capInferred(claim: Claim): Claim {
  if (claim.basis === 'inferred' && claim.confidence === 'high') {
    return { ...claim, confidence: 'medium' };
  }
  return claim;
}

// ── Bounded text helper (TRD §5.1 bounded prompt inputs) ────────────────────

/** Truncates `text` to at most `max` chars with a visible truncation marker. */
export function chunkBounded(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - DONE_MARKER.length)) + DONE_MARKER;
}

// ── Provider-output JSON parsing (TRD §5.1 contract) ────────────────────────

/** Strips markdown fences / leading+trailing prose before JSON.parse. */
export function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence && fence[1] && fence[1].trim().length > 0) return fence[1].trim();

  const startObj = trimmed.indexOf('{');
  const startArr = trimmed.indexOf('[');
  let start = -1;
  if (startObj !== -1 && startArr !== -1) start = Math.min(startObj, startArr);
  else if (startObj !== -1) start = startObj;
  else start = startArr;
  if (start === -1) return trimmed;

  // String-aware scan for the matching close brace so trailing prose
  // ("…} trailing") never reaches JSON.parse (TRD §5.1 output contract).
  const open = trimmed[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start).trim();
}

/** Parses provider text as JSON; throws AiError('invalid-json') on failure. */
export function parseJsonText<T = unknown>(raw: string): T {
  try {
    return JSON.parse(extractJsonCandidate(raw)) as T;
  } catch {
    const excerpt = raw.slice(0, 120);
    throw new AiError('invalid-json', `invalid JSON: ${excerpt}`, excerpt);
  }
}
