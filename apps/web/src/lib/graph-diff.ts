import type { GraphDelta, GraphEdge, GraphNode, GraphSnapshot } from '@atlas/contracts';

/**
 * Local, deterministic GraphSnapshot diff matching contracts' GraphDelta
 * (TRD §4.2 step 11). Kept in the web package (pure, client-safe) so the
 * history workbench never depends on external diff signatures.
 */
export function diffGraphs(prev: GraphSnapshot | null, next: GraphSnapshot): GraphDelta {
  const addedNodes: GraphNode[] = [];
  const removedNodeIds: string[] = [];
  const addedEdges: GraphEdge[] = [];
  const removedEdgeIds: string[] = [];

  const prevNodes = prev ? new Set(prev.nodes.map((n) => n.id)) : new Set<string>();
  const nextNodes = new Set(next.nodes.map((n) => n.id));

  for (const node of next.nodes) {
    if (!prevNodes.has(node.id)) addedNodes.push(node);
  }
  if (prev) {
    for (const node of prev.nodes) {
      if (!nextNodes.has(node.id)) removedNodeIds.push(node.id);
    }
  }

  const prevEdges = prev ? new Set(prev.edges.map((e) => e.id)) : new Set<string>();
  const nextEdges = new Set(next.edges.map((e) => e.id));

  for (const edge of next.edges) {
    if (!prevEdges.has(edge.id)) addedEdges.push(edge);
  }
  if (prev) {
    for (const edge of prev.edges) {
      if (!nextEdges.has(edge.id)) removedEdgeIds.push(edge.id);
    }
  }

  return { addedNodes, removedNodeIds, addedEdges, removedEdgeIds };
}

/**
 * Deterministic positive-hash for stable shuffles (mission quiz option
 * ordering, TRD §6): same missionId+stepId always yields the same order.
 */
export function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shuffledDeterministic<T>(items: T[], seed: string): T[] {
  const copy = [...items];
  let state = stableHash(seed) || 1;
  for (let i = copy.length - 1; i > 0; i--) {
    state = Math.imul(state, 48271) % 2147483647;
    const j = state % (i + 1);
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}
