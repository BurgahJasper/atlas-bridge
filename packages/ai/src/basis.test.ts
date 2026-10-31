import { describe, expect, it } from 'vitest';
import type { Claim } from '@atlas/contracts';
import { capInferred, enforceBasis } from './validate.js';

const SHA = 'b'.repeat(40);
const messages = new Map([[SHA, 'Remove broken link from contributing guide']]);

function claim(overrides: Partial<Claim>): Claim {
  return {
    text: 'The commit removed a broken link',
    basis: 'explicit',
    confidence: 'high',
    evidenceRefs: [{ sha: SHA, path: 'contributing.md' }],
    ...overrides,
  };
}

describe('enforceBasis (TRD §5.2 basis policy)', () => {
  it('keeps explicit when the commit message states the same fact', () => {
    const [kept] = enforceBasis([claim({})], messages);
    expect(kept!.basis).toBe('explicit');
    expect(kept!.confidence).toBe('high');
  });

  it('downgrades explicit when the commit message does not support it', () => {
    const [down] = enforceBasis([claim({ text: 'The maintainers rewrote the build pipeline' })], messages);
    expect(down!.basis).toBe('inferred');
    expect(down!.confidence).toBe('medium');
  });

  it('downgrades explicit when the cited sha has no known message', () => {
    const [down] = enforceBasis([claim({ evidenceRefs: [{ sha: 'c'.repeat(40) }] })], messages);
    expect(down!.basis).toBe('inferred');
  });

  it('never leaves an inferred claim at high confidence', () => {
    const [capped] = enforceBasis([claim({ basis: 'inferred', confidence: 'high' })], messages);
    expect(capped!.confidence).toBe('medium');
    expect(capInferred(claim({ basis: 'inferred', confidence: 'low' })).confidence).toBe('low');
  });

  it('does not treat generic release vocabulary as evidence', () => {
    const generic = new Map([[SHA, 'Release version update']]);
    const [down] = enforceBasis(
      [claim({ text: 'The release updated the version', evidenceRefs: [{ sha: SHA }] })],
      generic,
    );
    expect(down!.basis).toBe('inferred');
  });

  it('matches inflected words (removed ~ remove)', () => {
    const [kept] = enforceBasis([claim({ text: 'It removed the broken links' })], messages);
    expect(kept!.basis).toBe('explicit');
  });
});
