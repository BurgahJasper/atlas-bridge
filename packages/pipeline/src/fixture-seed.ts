import { createPipeline, type Pipeline, type PipelineOptions } from './pipeline.js';
import { loadCuratedFixture } from './fixture-load.js';

/**
 * Fixture-aware pipeline factory (TRD §10.1.2, §11).
 *
 * Routing semantics (as used by apps/worker):
 * - When `fixtureName` resolves to a curated fixture, that fixture is handed
 *   to the pipeline and its client is consulted ONLY for analysis requests
 *   whose owner/name match fixture.repository (see pipeline.clientFor).
 * - Any other URL delegates to the live GitHub client (token optional).
 * - If the fixture file does not exist yet, this factory silently degrades to
 *   a standard live pipeline; the demo path simply requires the fixture
 *   (docs/deployment.md) and stays clearly labeled offline when used.
 */
export function createFixtureAwarePipeline(
  options: PipelineOptions & { fixtureName?: string },
): Pipeline {
  const fixture =
    options.fixture ?? (options.fixtureName ? loadCuratedFixture(options.fixtureName) : null);
  return createPipeline({ ...options, fixture: fixture ?? undefined });
}
