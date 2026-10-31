// Model providers — TRD §5 ("Gemma abstraction via Google GenAI SDK or
// self-hosted adapter") and §10.1.7 (never disguise fallback as live
// inference: the auto provider degrades to a clearly-labeled offline mock).
// Guardrails (schema validation, citation checks) stay with the CALLER (§5.1).

import { OfflineMockProvider } from './offline.js';
import { AiError } from './types.js';
import type { AiCallSpec, AiProvider, AiResult } from './types.js';
import { parseJsonText } from './validate.js';

export const DEFAULT_GEMMA_MODEL_ID = 'gemma-4-26b-a4b-it'; // TRD §5

/** Hard cap per model call (TRD §8: timeout + partial recovery). A stalled
 * provider must degrade to the labeled offline story, never wedge ai-story. */
export const AI_CALL_TIMEOUT_MS = 60_000;

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AiError('timeout', `AI call timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Hosted Gemma 4 via the Gemini API (TRD §5 primary path). */
export function createGemmaProvider(cfg: {
  apiKey: string;
  /** TRD §5: default gemma-4-26b-a4b-it; gemma-4-31b-it for heavier reasoning. */
  modelId?: string;
}): AiProvider {
  const modelId = cfg.modelId ?? DEFAULT_GEMMA_MODEL_ID;

  const callGemma = async (spec: AiCallSpec): Promise<AiResult> => {
    // Deferred import keeps @google/genai out of the offline/mock code path
    // (packages are consumed as plain TS source; demo fallback must not
    // require the hosted SDK to load).
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
    try {
      const res = await withTimeout(
        ai.models.generateContent({
          model: modelId,
          contents: spec.user,
          config: {
            systemInstruction: spec.system,
            responseMimeType: 'application/json',
            temperature: spec.temperature ?? 0.2,
            maxOutputTokens: spec.maxOutputTokens ?? 2048,
          },
        }),
        AI_CALL_TIMEOUT_MS,
      );
      const loose = res as {
        text?: string | null;
        candidates?: Array<{ content?: { parts?: Array<{ text?: string | null }> } }>;
      };
      const text =
        loose.text ??
        loose.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? '').join('') ??
        '';
      return { modelId, offline: false, text };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError('provider', `Gemma call failed: ${message}`);
    }
  };

  return {
    modelId,
    offline: false,
    generateText: callGemma,
    async generateJson<T>(spec: AiCallSpec): Promise<T> {
      // Parsed as JSON only; schema validation remains with the caller (§5.1).
      const result = await callGemma(spec);
      return parseJsonText<T>(result.text);
    },
  };
}

/**
 * Local adapter for a self-hosted Gemma runtime (TRD §5 local-first option).
 * POSTs {system,user,maxOutputTokens} to `<url>/generate` and reads {text}.
 */
export function createLocalAdapterProvider(cfg: {
  url: string;
  modelId?: string;
}): AiProvider {
  const base = cfg.url.replace(/\/+$/, '');
  const modelId = cfg.modelId ?? 'local-gemma-adapter';

  const callLocal = async (spec: AiCallSpec): Promise<AiResult> => {
    let res: Response;
    try {
      res = await fetch(`${base}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(AI_CALL_TIMEOUT_MS),
        body: JSON.stringify({
          system: spec.system,
          user: spec.user,
          maxOutputTokens: spec.maxOutputTokens ?? 2048,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError('provider', `local adapter request failed: ${message}`);
    }
    if (!res.ok) {
      throw new AiError('provider', `local adapter returned HTTP ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AiError('provider', 'local adapter returned a non-JSON body');
    }
    const text = (body as { text?: unknown }).text;
    if (typeof text !== 'string') {
      throw new AiError('provider', 'local adapter body is missing "text"');
    }
    return { modelId, offline: false, text };
  };

  return {
    modelId,
    offline: false,
    generateText: callLocal,
    async generateJson<T>(spec: AiCallSpec): Promise<T> {
      const result = await callLocal(spec);
      return parseJsonText<T>(result.text);
    },
  };
}

/**
 * Provider fallback chain (TRD §5.1 "provider fallback", §10.1.7 demo
 * reliability): hosted Gemma when an API key exists, else a local adapter,
 * else the deterministic offline mock — a demo crash is the worst outcome,
 * so the offline fallback is always available and clearly labeled offline.
 */
export function createAutoProvider(cfg: {
  apiKey?: string;
  localAdapterUrl?: string;
  modelId?: string;
}): AiProvider {
  if (cfg.apiKey) {
    return createGemmaProvider({ apiKey: cfg.apiKey, modelId: cfg.modelId });
  }
  if (cfg.localAdapterUrl) {
    return createLocalAdapterProvider({ url: cfg.localAdapterUrl, modelId: cfg.modelId });
  }
  return new OfflineMockProvider();
}
