/**
 * Worker environment (TRD §7 secrets discipline: read server-side only, never
 * echoed in responses or logs). Mirrors the root .env.example names.
 */

export interface WorkerEnv {
  port: number;
  githubToken?: string;
  geminiApiKey?: string;
  gemmaModelId?: string;
  gemmaLocalAdapterUrl?: string;
  databaseUrl?: string;
  githubWriteToken?: string;
  /** Force the curated fixture pipeline; live client remains the fallback. */
  fixtureFirst: boolean;
  workspaceUrl: string;
}

export function readEnv(env: Record<string, string | undefined> = process.env): WorkerEnv {
  const port = Number.parseInt(env.PORT ?? '4600', 10);
  return {
    port: Number.isFinite(port) ? port : 4600,
    githubToken: env.GITHUB_TOKEN || undefined,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    gemmaModelId: env.GEMMA_MODEL_ID || undefined,
    gemmaLocalAdapterUrl: env.GEMMA_LOCAL_ADAPTER_URL || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
    githubWriteToken: env.GITHUB_WRITE_TOKEN || undefined,
    fixtureFirst: (env.FIXTURE_FIRST ?? 'true').toLowerCase() !== 'false',
    workspaceUrl: env.WORKER_URL || 'http://localhost:4600',
  };
}
