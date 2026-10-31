import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@atlas/contracts';
import { buildGraph } from './graph.js';
import { deltaSummary, diffGraphs } from './delta.js';

const PREV_SHA = '1111111111111111111111111111111111111111';
const NEXT_SHA = '2222222222222222222222222222222222222222';

const prevFiles = [
  { path: 'src/a.ts', content: "import x from './b.ts';" },
  { path: 'src/b.ts', content: 'export const x = 1;' },
];

const nextFiles = [
  { path: 'src/a.ts', content: "import x from './c.ts';" }, // dependency changed; node id unchanged
  { path: 'src/c.ts', content: 'export const x = 2;' },
];

const prev: GraphSnapshot = buildGraph('snap1', PREV_SHA, prevFiles);
const next: GraphSnapshot = buildGraph('snap1', NEXT_SHA, nextFiles);

describe('diffGraphs', () => {
  it('reports structural additions and removals by node/edge id', () => {
    const delta = diffGraphs(prev, next);
    expect(delta.addedNodes.map((node) => node.id)).toEqual(['file:src/c.ts']);
    expect(delta.removedNodeIds).toEqual(['file:src/b.ts']);
    expect(delta.addedEdges.map((edge) => edge.id).sort()).toEqual([
      'edge:folder:folder:src/->file:src/c.ts:',
      'edge:import:file:src/a.ts->file:src/c.ts:src/a.ts',
    ]);
    expect(delta.removedEdgeIds.sort()).toEqual([
      'edge:folder:folder:src/->file:src/b.ts:',
      'edge:import:file:src/a.ts->file:src/b.ts:src/a.ts',
    ]);
  });

  it('excludes content-only edits from the delta (no node churn)', () => {
    const delta = diffGraphs(prev, next);
    expect(delta.addedNodes.find((node) => node.id === 'file:src/a.ts')).toBeUndefined();
    expect(delta.removedNodeIds).not.toContain('file:src/a.ts');
  });

  it('summarizes deltas as a one-liner', () => {
    expect(deltaSummary(diffGraphs(prev, next))).toBe('+1 file, −1 file, +1 dependency, −1 dependency');
  });

  it('reports a pure addition as files only', () => {
    const grown = buildGraph('snap1', NEXT_SHA, [
      ...prevFiles,
      { path: 'src/c.ts', content: 'export const y = 2;' },
      { path: 'docs/guide.md', content: '# guide' },
    ]);
    expect(deltaSummary(diffGraphs(prev, grown))).toBe('+2 files');
  });

  it('returns a zero-delta sentence when structure is unchanged', () => {
    const again = buildGraph('snap1', NEXT_SHA, [...prevFiles]);
    const delta = diffGraphs(prev, again);
    expect(delta.addedNodes).toEqual([]);
    expect(delta.removedNodeIds).toEqual([]);
    expect(delta.addedEdges).toEqual([]);
    expect(delta.removedEdgeIds).toEqual([]);
    expect(deltaSummary(delta)).toBe('No structural changes');
  });
});
