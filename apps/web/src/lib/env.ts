/**
 * Server-side environment access (TRD §7 secrets rule).
 * GEMINI_API_KEY and GITHUB_TOKEN must never reach client components; only
 * this module (imported exclusively from server code) can read them.
 */

export type AnalysisMode = 'embedded' | 'worker';

const MODES: AnalysisMode[] = ['embedded', 'worker'];

let warned = false;

function warnOnce(missing: string[]): void {
  if (warned || missing.length === 0) return;
  warned = true;
  // TRD §14: demo path works with no keys at all; missing keys are non-fatal.
  console.warn(
    `[atlas/web] missing optional env keys: ${missing.join(', ')} — falling back to defaults (offline mock AI, public unauthenticated GitHub).`,
  );
}

export interface AtlasEnv {
  mode: AnalysisMode;
  workerUrl: string | null;
  githubToken: string | null;
  geminiApiKey: string | null;
  gemmaModelId: string;
  gemmaLocalAdapterUrl: string | null;
  databaseUrl: string | null;
  siteUrl: string;
}

export function getEnv(): AtlasEnv {
  const modeRaw = process.env.ANALYSIS_MODE ?? 'embedded';
  const mode: AnalysisMode = MODES.includes(modeRaw as AnalysisMode) ? (modeRaw as AnalysisMode) : 'embedded';
  const workerUrl = process.env.WORKER_URL ?? null;
  const githubToken = process.env.GITHUB_TOKEN ?? null;
  const geminiApiKey = process.env.GEMINI_API_KEY ?? null;
  const gemmaModelId = process.env.GEMMA_MODEL_ID ?? 'gemma-4-26b-a4b-it';
  const gemmaLocalAdapterUrl = process.env.GEMMA_LOCAL_ADAPTER_URL ?? null;
  const databaseUrl = process.env.DATABASE_URL ?? null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const missing: string[] = [];
  if (!geminiApiKey && !gemmaLocalAdapterUrl) missing.push('GEMINI_API_KEY');
  if (mode === 'worker' && !workerUrl) missing.push('WORKER_URL');
  warnOnce(missing);

  return { mode, workerUrl, githubToken, geminiApiKey, gemmaModelId, gemmaLocalAdapterUrl, databaseUrl, siteUrl };
}

/** Public-surface env for status displays; never includes secrets. */
export function getPublicModelDisclosure(): { modelId: string; hosted: boolean } {
  const env = getEnv();
  return { modelId: env.gemmaModelId, hosted: Boolean(env.geminiApiKey) };
}
