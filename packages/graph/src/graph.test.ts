import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph.js';

const SHA = '1111111111111111111111111111111111111111';

const files = [
  { path: 'README.md', content: '# atlas bridge' },
  {
    path: 'src/app.ts',
    content: [
      "import { helper } from './util.js';",
      "import init from '../lib/tool.ts';",
      "import react from 'react';",
      "import tool from 'shared';",
    ].join('\n'),
  },
  { path: 'src/util.ts', content: 'export function helper() { return 1; }' },
  { path: 'shared/index.ts', content: 'export const tools = 1;' },
  { path: 'pkg/app.py', content: ['from pkg.util import run', 'from .util import run2', 'import os'].join('\n') },
  { path: 'pkg/util.py', content: ['def run():', '    pass'].join('\n') },
];

const snapshot = buildGraph('snap1', SHA, files);

/* Deterministic: sorted output regardless of input order. */
const shuffled = [files[3]!, files[0]!, files[5]!, files[2]!, files[1]!, files[4]!];

describe('buildGraph', () => {
  it('creates file and top-two-level folder nodes only', () => {
    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      'file:README.md',
      'file:pkg/app.py',
      'file:pkg/util.py',
      'file:shared/index.ts',
      'file:src/app.ts',
      'file:src/util.ts',
      'folder:pkg/',
      'folder:shared/',
      'folder:src/',
      'module:shared',
    ]);
  });

  it('derives language and parent-folder edges', () => {
    const app = snapshot.nodes.find((node) => node.id === 'file:src/app.ts');
    expect(app).toMatchObject({ type: 'file', label: 'app.ts', language: 'typescript' });
    const python = snapshot.nodes.find((node) => node.id === 'file:pkg/util.py');
    expect(python).toMatchObject({ language: 'python' });

    const edgeIds = snapshot.edges.map((edge) => edge.id);
    expect(edgeIds).toContain('edge:folder:folder:src/->file:src/app.ts:');
    expect(edgeIds).toContain('edge:folder:folder:pkg/->file:pkg/util.py:');
    // Root-level files have no parent folder node → no fabricated containment edge.
    expect(edgeIds.filter((id) => id.includes('->file:README.md:'))).toEqual([]);
  });

  it('resolves relative imports with extension swaps and records evidence lines', () => {
    const edge = snapshot.edges.find((edge) => edge.id === 'edge:import:file:src/app.ts->file:src/util.ts:src/app.ts');
    expect(edge).toMatchObject({
      kind: 'import',
      source: 'file:src/app.ts',
      target: 'file:src/util.ts',
      evidenceRef: { sha: SHA, path: 'src/app.ts', startLine: 1 }, // './util.js' finds 'src/util.ts'
    });
  });

  it('creates module nodes only for real top-level folders and marks the edge inferred', () => {
    expect(snapshot.nodes.find((node) => node.id === 'module:shared')).toMatchObject({
      type: 'module',
      label: 'shared',
      snapshotId: 'snap1',
    });
    const edge = snapshot.edges.find((edge) => edge.id === 'edge:import:file:src/app.ts->module:shared:src/app.ts');
    expect(edge).toMatchObject({
      kind: 'import',
      inferred: true,
      evidenceRef: { sha: SHA, path: 'src/app.ts', startLine: 4 },
    });

    // FR-04: no fabricated relationships — 'react' and 'os' are not workspace folders.
    expect(snapshot.nodes.find((node) => node.id === 'module:react')).toBeUndefined();
    expect(snapshot.nodes.find((node) => node.id === 'module:os')).toBeUndefined();
    expect(snapshot.edges.find((edge) => edge.id.includes('react'))).toBeUndefined();
    expect(snapshot.edges.find((edge) => edge.id.includes('->module:os'))).toBeUndefined();
    // Unresolvable relative import ('../lib/tool.ts') never becomes an edge.
    expect(snapshot.edges.find((edge) => edge.id.includes('lib/tool'))).toBeUndefined();
  });

  it('maps python imports against known .py paths (deduped)', () => {
    const edgeIds = snapshot.edges.map((edge) => edge.id);
    // 'pkg.util' (line 1) and '.util' resolve to the same target: single deduped edge.
    expect(edgeIds.filter((id) => id.includes('file:pkg/util.py'))).toEqual([
      'edge:folder:folder:pkg/->file:pkg/util.py:',
      'edge:import:file:pkg/app.py->file:pkg/util.py:pkg/app.py',
    ]);
    const edge = snapshot.edges.find((edge) => edge.kind === 'import' && edge.target === 'file:pkg/util.py');
    expect(edge).toMatchObject({
      source: 'file:pkg/app.py',
      evidenceRef: { sha: SHA, path: 'pkg/app.py', startLine: 1 },
    });
  });

  it('produces identical output for any input order (twice-run determinism)', () => {
    const fromShuffled = buildGraph('snap1', SHA, shuffled);
    const rerun = buildGraph('snap1', SHA, files);
    expect(JSON.stringify(fromShuffled)).toBe(JSON.stringify(snapshot));
    expect(JSON.stringify(rerun)).toBe(JSON.stringify(snapshot));
  });
});
