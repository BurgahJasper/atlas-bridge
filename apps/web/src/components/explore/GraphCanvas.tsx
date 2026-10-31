'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  useReactFlow,
  BackgroundVariant,
  Edge,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EdgeKind, GraphNode, GraphSnapshot, Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { GraphNodeCard } from './GraphNodes';

/**
 * Graph canvas (TRD §2.3 Graph row): React Flow with typed node shapes, edges
 * colored by kind with redundant text labels for import edges (never
 * color-only; inferred edges also dashed), fit-to-view per snapshot, pan/zoom,
 * 44px controls, minimap on large screens, role="img" aria-label. Keyboard
 * navigation lives in the NodeList (accessible focusList), which drives
 * focusSignal → here (fitView + selection).
 */

const EDGE_TONE: Record<EdgeKind, string> = {
  import: '#0E7490',
  folder: '#8B8378',
  association: '#B45309',
};

export interface GraphCanvasProps {
  snapshot: GraphSnapshot | null;
  addedNodeIds: string[];
  locale: Locale;
  milestoneTitle: string;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  /** Increment to focus a node imperatively (from NodeList activation). */
  focusSignal: { nodeId: string; nonce: number } | null;
}

function AtlasNodeComponent(props: { data: unknown }) {
  const data = props.data as { node: GraphNode };
  return <GraphNodeCard node={data.node} kind={`graph.${data.node.type}`} />;
}

const nodeTypes = { atlas: AtlasNodeComponent };

function Flow({
  snapshot,
  addedNodeIds,
  locale,
  milestoneTitle,
  selectedNodeId,
  onSelectNode,
  focusSignal,
}: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const didInitialFit = useRef(false);

  // Deterministic layout: one column per top-level folder keeps placement
  // stable between milestones so scrubbing does not reflow the whole canvas.
  const layoutNodes = useCallback(
    (snap: GraphSnapshot): Node[] => {
      const xByFolder = new Map<string, number>();
      const yCounters = new Map<string, number>();
      let folderIndex = 0;
      return snap.nodes.map((node) => {
        const folder = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '(root)';
        if (!xByFolder.has(folder)) {
          xByFolder.set(folder, 40 + folderIndex * 230);
          folderIndex += 1;
        }
        const x = xByFolder.get(folder)!;
        const y = 24 + (yCounters.get(folder) ?? 0) * 80;
        yCounters.set(folder, (yCounters.get(folder) ?? 0) + 1);
        return {
          id: node.id,
          position: { x, y },
          data: { node },
          type: 'atlas',
          className: addedNodeIds.includes(node.id) ? 'ab-node-enter' : undefined,
          selected: node.id === selectedNodeId,
          draggable: false,
        } satisfies Node;
      });
    },
    [addedNodeIds, selectedNodeId],
  );

  const buildEdges = useCallback(
    (snap: GraphSnapshot): Edge[] =>
      snap.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        style: {
          stroke: EDGE_TONE[edge.kind],
          strokeWidth: edge.kind === 'import' ? 2 : 1,
          strokeDasharray: edge.inferred ? '6 4' : undefined,
        },
        ...(edge.kind === 'import'
          ? {
              label: `${t(locale, 'graph.edgeImport')}${edge.inferred ? ` · ${t(locale, 'graph.edgeInferred')}` : ''}`,
              labelShowBg: true,
            }
          : {}),
      })),
    [locale],
  );

  useEffect(() => {
    if (!snapshot) {
      setNodes([]);
      setEdges([]);
      return;
    }
    // Added-node CSS animation only when motion is allowed (CSS media +
    // settings gate the animation itself; class is harmless otherwise).
    const nextNodes = layoutNodes(snapshot);
    setNodes(nextNodes);
    setEdges(buildEdges(snapshot));
    didInitialFit.current = false;
  }, [snapshot, layoutNodes, buildEdges, setNodes, setEdges]);

  // Fit after layout render completes (jump-cut under reduced motion is fine).
  useEffect(() => {
    if (nodes.length > 0 && !didInitialFit.current) {
      didInitialFit.current = true;
      const timeout = setTimeout(() => fitView({ padding: 0.15, duration: 0 }), 60);
      return () => clearTimeout(timeout);
    }
  }, [nodes, fitView]);

  // NodeList → canvas focus bridge.
  useEffect(() => {
    if (!focusSignal) return;
    fitView({ nodes: [{ id: focusSignal.nodeId }], padding: 0.6, duration: 300, maxZoom: 1.4 });
  }, [focusSignal, fitView]);

  return (
    <div
      className="ab-card relative overflow-hidden"
      style={{ height: 'min(62vh, 640px)', minHeight: 320 }}
      role="img"
      aria-label={t(locale, 'graph.label', { milestone: milestoneTitle })}
    >
      {snapshot ? (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelectNode(String(node.id))}
          onPaneClick={() => onSelectNode(null)}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          nodesConnectable={false}
          elementsSelectable
          className="text-[13px]"
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls position="bottom-left" showInteractive={false} aria-label={t(locale, 'graph.controlsLabel')} />
          <MiniMap pannable zoomable className="!hidden lg:!block" ariaLabel={t(locale, 'graph.miniMapLabel')} />
        </ReactFlow>
      ) : (
        <p className="p-6 text-muted">{t(locale, 'nodeList.empty')}</p>
      )}

      <span className="sr-only">{t(locale, 'graph.keyboardHint')}</span>
      <span className="sr-only">{t(locale, 'graph.canvasHint')}</span>
      {selectedNodeId ? <span className="sr-only">{t(locale, 'history.selectedSummary', { title: selectedNodeId })}</span> : null}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
