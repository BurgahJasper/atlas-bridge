import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphSnapshot, Repository } from '@atlas/contracts';
import { createFileStore } from './file.js';

const repo: Repository = {
  id: 'repo_o_r',
  provider: 'github',
  owner: 'o',
  name: 'r',
  visibility: 'public',
  defaultBranch: 'main',
  licenseSpdx: 'MIT',
  description: null,
  stars: 3,
  lastIndexedAt: null,
};

const graph: GraphSnapshot = {
  snapshotId: 'snap_1',
  sha: 'a'.repeat(40),
  nodes: [{ id: 'file:src/a.ts', snapshotId: 'snap_1', path: 'src/a.ts', label: 'a.ts', type: 'file' }],
  edges: [],
};

describe('createFileStore (durable across restarts)', () => {
  it('replays repositories and graphs written by a previous process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-store-'));
    const logPath = join(dir, 'store.jsonl');
    try {
      const first = createFileStore(logPath);
      await first.putRepository(repo);
      await first.putGraph(`${repo.id}:${graph.sha}`, graph);

      const restarted = createFileStore(logPath);
      expect((await restarted.getRepositoryBySlug('O', 'R'))?.id).toBe('repo_o_r');
      expect((await restarted.getGraph(`${repo.id}:${graph.sha}`))?.nodes.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a torn final line instead of failing startup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-store-'));
    const logPath = join(dir, 'store.jsonl');
    try {
      const first = createFileStore(logPath);
      await first.putRepository(repo);
      const { appendFileSync } = await import('node:fs');
      appendFileSync(logPath, '{"op":"putRepository","args":[');
      const restarted = createFileStore(logPath);
      expect((await restarted.getRepository('repo_o_r'))?.name).toBe('r');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
