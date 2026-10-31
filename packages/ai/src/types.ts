// AI provider abstraction — TRD §5, §5.1.
// Guardrails (JSON-schema validation, citation checks, locale policy) live with
// the CALLER, not inside the provider: the provider only transports text/JSON.

export interface AiCallSpec {
  /** System instruction for the model (TRD §5.1 task prompt). */
  system: string;
  /** User turn; repository facts are embedded as DATA (never as instructions, TRD §5.2). */
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AiResult {
  modelId: string;
  /** True for the offline mock / cached fallback — the UI labels it visibly (TRD §10.1.7). */
  offline: boolean;
  text: string;
}

export interface AiProvider {
  readonly modelId: string;
  readonly offline: boolean;
  generateText(spec: AiCallSpec): Promise<AiResult>;
  /**
   * Parses provider.text as JSON (throws `invalid JSON: ...` with a trimmed
   * prefix of the raw text). Schema validation stays with the CALLER
   * (TRD §5.1 guardrails live outside the provider).
   */
  generateJson<T>(spec: AiCallSpec): Promise<T>;
}

export type AiErrorKind = 'invalid-json' | 'provider' | 'timeout';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly rawExcerpt?: string;

  constructor(kind: AiErrorKind, message: string, rawExcerpt?: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.rawExcerpt = rawExcerpt;
  }
}
