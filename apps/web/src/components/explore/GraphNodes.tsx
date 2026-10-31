'use client';

import type { GraphNode } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Node shape by type is mandatory: files are square-ish with an extension
 * badge, folders rounded, modules hexagonal (TRD §2.3 Graph row: "distinguish
 * node types by shape + label"). Labels are always text, never color-only.
 */

const NODE_WIDTH = 180;

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.includes('.') ? base.split('.').pop()!.toUpperCase() : '';
}

function baseLabel(node: GraphNode): string {
  if (node.label) return node.label;
  const base = node.path.split('/').pop() ?? node.path;
  return node.type === 'folder' ? `${base}/` : base;
}

const SHAPE_STYLE: Record<GraphNode['type'], React.CSSProperties> = {
  file: { borderRadius: 4 },
  folder: { borderRadius: 999 },
  module: {
    borderRadius: 12,
    borderStyle: 'double',
    borderWidth: 3,
  },
};

export function GraphNodeCard({ node, kind }: { node: GraphNode; kind: string }) {
  const label = baseLabel(node);
  const ext = node.type === 'file' ? extensionOf(node.path) : '';
  const typeKey = kind ?? 'graph.file';
  return (
    <div
      tabIndex={-1}
      role="group"
      aria-label={`Graph node ${node.id}`}
      className="min-w-0 select-none border bg-surface px-3 py-2"
      style={{
        ...SHAPE_STYLE[node.type],
        borderColor: 'var(--ab-action)',
        boxShadow: '0 1px 3px rgb(0 0 0 / 0.15)',
      }}
    >
      <p className="truncate text-xs font-bold" title={node.path}>
        {label}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted">
        <span className="rounded px-1" style={{ background: 'var(--ab-raised)' }}>
          {t('en', typeKey)}
        </span>
        {ext ? (
          <span className="rounded px-1" style={{ background: 'var(--ab-raised)', border: '1px solid var(--ab-line)' }}>
            {ext}
          </span>
        ) : null}
        {node.language ? <span className="ab-mono">{node.language}</span> : null}
      </p>
    </div>
  );
}

export { NODE_WIDTH };
