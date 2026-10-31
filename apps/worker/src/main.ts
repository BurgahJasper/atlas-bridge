import { createAutoProvider } from '@atlas/ai';
import { createFileStore, createPgStore } from '@atlas/store';
import path from 'node:path';
import type { Store } from '@atlas/contracts';
import { createFixtureAwarePipeline } from '@atlas/pipeline';
import { createServer } from './server.js';
import { readEnv } from './env.js';

/**
 * Worker entry point (TRD §4, §10.3): GitHub ingestion, milestone builder,
 * AI jobs + the whole §6.1 REST surface. Demo-first: resolve the curated
 * fixture when present; otherwise (or for any other repo) hit the live
 * GitHub client. Persistence: Postgres when DATABASE_URL is set, else
 * in-memory (demo/local mode).
 */
// TRD §10.3 apps/worker

const CURATED_FIXTURE_NAME = 'octokit-request-js';

export function createWorkerDependencies(env: ReturnType<typeof readEnv> = readEnv()): {
  store: Store;
  listen: () => void;
} {
  const dataDir = process.env.ATLAS_DATA_DIR ?? path.resolve(process.cwd(), '..', '..', '.atlas-data');
  const store: Store = env.databaseUrl
    ? createPgStore(env.databaseUrl)
    : createFileStore(path.join(dataDir, 'store.jsonl'));
  const pipeline = createFixtureAwarePipeline({
    store,
    // TRD §5: hosted Gemma via Gemini API, optional local adapter; the
    // no-key case stays functional with a clearly labeled offline provider.
    ai: createAutoProvider({
      apiKey: env.geminiApiKey,
      localAdapterUrl: env.gemmaLocalAdapterUrl,
      modelId: env.gemmaModelId,
    }),
    githubToken: env.githubToken,
    githubWriteToken: env.githubWriteToken,
    fixtureName: env.fixtureFirst ? CURATED_FIXTURE_NAME : undefined,
  });
  const app = createServer({ store, pipeline });

  return {
    store,
    listen: () => {
      app.listen(env.port, () => {
        // No secrets in logs (TRD §7): ports and modes only.
        process.stdout.write(
          `atlas-bridge worker listening on ${env.port} ` +
            `(store=${env.databaseUrl ? 'postgres' : 'memory'}, fixture=${env.fixtureFirst})\n`,
        );
      });
    },
  };
}

// Only run the actual server when executed directly; tests import the factory.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').includes('/worker/src/main');
if (invokedDirectly) {
  const worker = createWorkerDependencies();
  worker.listen();

  const shutdown = (): void => {
    // In-memory store needs no flush; PgStore connections are pooled by the
    // driver (TRD §6). Queue is in-process for v1 (TRD §10.2).
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
