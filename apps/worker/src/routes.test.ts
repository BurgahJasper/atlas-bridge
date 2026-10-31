import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createMemoryStore } from '@atlas/store';
import { createFixtureAwarePipeline } from '@atlas/pipeline';
import { buildTinyFixture, TINY_FIXTURE_URL } from '@atlas/pipeline';
import { createServer } from './server.js';

/**
 * Integration test exercising the TRD §6.1 surface end-to-end with the tiny
 * pipeline fixture: analyze → job progress → rate limiting. Deterministic:
 * the offline AI provider and fixture client require no network.
 */
// TRD §6.1, §9.1 (fixture ingestion + API contract integration)

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    const app = createServer({
      store: createMemoryStore(),
      pipeline: createFixtureAwarePipeline({
        store: createMemoryStore(),
        fixture: buildTinyFixture(),
      }),
      // Low caps: the analyze throttle becomes observable in-test (5/hour → 2).
      limits: { globalMax: 100, analyzeMax: 2, globalWindowMs: 60_000, analyzeWindowMs: 60_000 },
    });
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

describe('worker REST surface (TRD §6.1)', () => {
  it('returns 400 for invalid analyze payloads', async () => {
    const res = await post('/api/repos/analyze', { url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('queues analysis, reaches done, and enforces the analyze cap', async () => {
    const first = await post('/api/repos/analyze', { url: TINY_FIXTURE_URL, locale: 'en' });
    expect(first.status).toBe(202);
    const { jobId } = (await first.json()) as { jobId: string };

    let job: { status: string; progress: number; warnings: string[] } | null = null;
    for (let i = 0; i < 120 && !job; i++) {
      const polls = await get(`/api/jobs/${jobId}`);
      if (polls.status === 200) {
        const body = (await polls.json()) as {
          status: string;
          progress: number;
          warnings: string[];
        };
        if (body.status === 'done' || body.status === 'error') job = body;
      }
      if (!job) await new Promise((r) => setTimeout(r, 25));
    }
    expect(job?.status).toBe('done');
    expect(job?.progress).toBe(100);
    expect(job?.warnings.some((w) => /rate-limited|partial/.test(w))).toBe(false);

    // Second analyze fits under the test cap of 2.
    const second = await post('/api/repos/analyze', { url: TINY_FIXTURE_URL, locale: 'es' });
    expect(second.status).toBe(202);

    // Third is throttled by the per-IP analyze limiter (TRD §8).
    const third = await post('/api/repos/analyze', { url: TINY_FIXTURE_URL, locale: 'es' });
    expect(third.status).toBe(429);

    // /healthz is exempt from throttling and reflects pipeline counters.
    const health = await get('/healthz');
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; repositoryCount: number };
    expect(body.ok).toBe(true);
    expect(body.repositoryCount).toBeGreaterThan(0);
  });

  it('404s unknown jobs and routes', async () => {
    expect((await get('/api/jobs/nope')).status).toBe(404);
    expect((await get('/api/repos/nope/overview')).status).toBe(404);
  });
});
