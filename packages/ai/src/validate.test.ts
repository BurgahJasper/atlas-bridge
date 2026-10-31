// Validate/post-check tests — TRD §5.2 deterministic checks, §5.3 citations,
// FR-03 inferences marking.
import { describe, expect, it } from 'vitest';
import type { Claim, NodeExplanation, TimelineStory } from '@atlas/contracts';

import {
  chunkBounded,
  extractJsonCandidate,
  parseJsonText,
  protectTokens,
  restoreTokens,
  stripClaims,
  validateCitationsSync,
} from './validate.js';
import { AiError } from './types.js';

const SHA_A = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const SHA_B = '0f9e8d7c6b5a09876543210fedcba9876543210f';
const KNOWN = { shas: new Set([SHA_A]), paths: new Set(['src/index.ts']) };

const claim = (evidenceRefs: Claim['evidenceRefs'], text = 'a change happened'): Claim => ({
  text,
  basis: 'inferred',
  confidence: 'low',
  evidenceRefs,
});

describe('validateCitationsSync', () => {
  it('accepts claims whose refs resolve to known SHAs and paths', () => {
    const ok = claim([{ sha: SHA_A, path: 'src/index.ts', startLine: 3 }], 'imports were added');
    const review = validateCitationsSync([ok], KNOWN);
    expect(review.valid).toEqual([ok]);
    expect(review.invalid).toEqual([]);
  });

  it('rejects a claim with no evidenceRefs (uncited source-specific claim, §5.1)', () => {
    const review = validateCitationsSync([claim([])], KNOWN);
    expect(review.valid).toEqual([]);
    expect(review.invalid).toHaveLength(1);
  });

  it('rejects claims citing a SHA outside the fetched facts (fake cited SHA, §9.1)', () => {
    const review = validateCitationsSync([claim([{ sha: SHA_B }])], KNOWN);
    expect(review.valid).toEqual([]);
  });

  it('rejects claims citing a path not in the known tree', () => {
    const review = validateCitationsSync([claim([{ sha: SHA_A, path: 'evil/new.ts' }])], KNOWN);
    expect(review.valid).toEqual([]);
  });

  it('rejects refs whose path is set but unknown even when the sha is known', () => {
    const mixed = [
      claim([{ sha: SHA_A, path: 'src/index.ts' }]),
      claim([{ sha: SHA_A, path: 'src/ghost.ts', url: 'https://github.com/acme/widget/blob/main/src/ghost.ts' }]),
    ];
    const review = validateCitationsSync(mixed, KNOWN);
    expect(review.valid).toHaveLength(1);
    expect(review.invalid).toHaveLength(1);
  });
});

describe('stripClaims', () => {
  const story: TimelineStory = {
    snapshotSha: SHA_A,
    locale: 'en',
    summary: 'How the widget grew.',
    claims: [claim([{ sha: SHA_A, path: 'src/index.ts' }]), claim([{ sha: SHA_B }])],
    milestones: [
      {
        milestoneId: 'm1',
        sha: SHA_A,
        title: 'Good',
        narrative: 'Verified milestone.',
        claims: [claim([{ sha: SHA_A, path: 'src/index.ts' }])],
      },
      {
        milestoneId: 'm2',
        sha: SHA_A,
        title: 'Invented',
        narrative: 'Cites a sha we never fetched.',
        claims: [claim([{ sha: SHA_B }]), claim([])],
      },
    ],
    untranslatedTerms: ['useEffect'],
    offline: false,
  };

  it('drops invalid claims, keeps verified parts, marks empty parts [unverified]', () => {
    const result = stripClaims(story, KNOWN);
    expect(result.dropped).toBe(3);
    const cleaned = result.story!;
    expect(cleaned.claims).toHaveLength(1);
    expect(cleaned.milestones[0]?.claims).toHaveLength(1);
    expect(cleaned.milestones[0]?.narrative).toBe('Verified milestone.');
    expect(cleaned.milestones[1]?.claims).toHaveLength(0);
    // FR-03: visibly mark inferences, never silently delete the part.
    expect(cleaned.milestones[1]?.narrative.startsWith('[unverified] ')).toBe(true);
    expect(cleaned.untranslatedTerms).toEqual(['useEffect']);
  });

  it('never mutates the input story', () => {
    const snapshot = JSON.stringify(story);
    stripClaims(story, KNOWN);
    expect(JSON.stringify(story)).toBe(snapshot);
  });

  it('marks node explanations when every claim is unresolvable', () => {
    const node: NodeExplanation = {
      nodeId: 'src/index.ts',
      purpose: 'Entry point.',
      detail: 'Detail.',
      claims: [claim([{ sha: SHA_B }])],
      locale: 'es',
      offline: false,
    };
    const result = stripClaims(node, KNOWN);
    expect(result.dropped).toBe(1);
    expect(result.story).toBeUndefined();
    expect(result.explanation?.claims).toHaveLength(0);
    expect(result.explanation?.purpose.startsWith('[unverified] ')).toBe(true);
  });
});

describe('protectTokens / restoreTokens', () => {
  const text =
    'See https://example.com/docs#anchor and `src/api.ts`; bare path src/core/parser.js plus `useEffect` (v1.0).';

  it('replaces URLs, backticked identifiers and file paths with stable sentinels', () => {
    const { protected: prot, tokens } = protectTokens(text);
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    expect(prot).toMatch(/⟦T0⟧/);
    // The raw path must not survive unprotected.
    expect(prot).not.toContain('src/core/parser.js');
    expect(prot).not.toContain('https://example.com');
  });

  it('restore round-trips the original text exactly', () => {
    const { protected: prot, tokens } = protectTokens(text);
    expect(restoreTokens(prot, tokens)).toBe(text);
  });

  it('reuses a sentinel for repeated candidates and is deterministic', () => {
    const a = protectTokens('x `useEffect` y `useEffect` z');
    expect(a.tokens.filter((t) => t === 'useEffect')).toHaveLength(1);
    expect(protectTokens(text)).toEqual(protectTokens(text));
  });

  it('restores sentinels copied back from a hostile model output', () => {
    const { protected: prot, tokens } = protectTokens('identify `handler.js` now');
    const sentinel = prot.match(/⟦T\d+⟧/)?.[0] ?? '';
    expect(sentinel).toBe('⟦T0⟧');
    // The model cannot be trusted: restore only recomputes known indices.
    expect(restoreTokens(`⟦T0⟧ ⟦T7⟧ ⟦T0⟧`, tokens)).toBe('handler.js ⟦T7⟧ handler.js');
  });

  it('leaves unknown sentinels untouched (out-of-range indices)', () => {
    expect(restoreTokens('keep ⟦T9⟧', [])).toBe('keep ⟦T9⟧');
  });

  it('neutralizes fake sentinels planted in the original text (identity restore)', () => {
    const hostile = 'model saw ⟦T0⟧ already';
    const { protected: prot, tokens } = protectTokens(hostile);
    expect(restoreTokens(prot, tokens)).toBe(hostile);
  });

  it('does not nest-wrap URLs that live inside backticks', () => {
    const text = 'see `https://x.test/a` doc';
    const { protected: prot, tokens } = protectTokens(text);
    expect(prot).not.toMatch(/⟦.*⟦/);
    expect(restoreTokens(prot, tokens)).toBe(text);
  });
});

describe('chunkBounded + provider JSON parsing', () => {
  it('passes short text through and marks long text within the limit', () => {
    expect(chunkBounded('short', 10)).toBe('short');
    const long = 'x'.repeat(500);
    const out = chunkBounded(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…[truncated]')).toBe(true);
    expect(chunkBounded('abc', 0)).toBe('');
  });

  it('parses fenced/prose-wrapped JSON and throws AiError(invalid-json) with a raw excerpt', () => {
    expect(parseJsonText('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('noise before {"a": [1, 2]} trailing')).toEqual({ a: [1, 2] });
    try {
      parseJsonText('{"truncated": ');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiError);
      const aiErr = err as AiError;
      expect(aiErr.kind).toBe('invalid-json');
      expect(aiErr.message.startsWith('invalid JSON:')).toBe(true);
      expect(aiErr.rawExcerpt).toBe('{"truncated": ');
    }
    expect(extractJsonCandidate('plain text only')).toBe('plain text only');
  });
});
