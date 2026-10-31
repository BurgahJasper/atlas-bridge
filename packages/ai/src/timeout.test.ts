import { describe, expect, it } from 'vitest';
import { withTimeout, AI_CALL_TIMEOUT_MS } from './provider.js';
import { AiError } from './types.js';

describe('withTimeout (TRD §8: ai-story can never hang forever)', () => {
  it('resolves when the call finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('rejects with AiError(timeout) when the provider stalls', async () => {
    const stalled = new Promise(() => undefined); // never resolves
    const err = await withTimeout(stalled, 25).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).kind).toBe('timeout');
  });

  it('default budget is a finite 60s', () => {
    expect(AI_CALL_TIMEOUT_MS).toBe(60_000);
  });
});
