'use client';

import type { GraphSnapshot, Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';

/**
 * Accessible node list fallback (TRD §2.3 Graph row, §2.4 a11y): the textual
 * equivalent of the canvas. Always available; activating an item focuses the
 * node on the graph and opens its inspector. Keyboard traversal is native
 * button focus + Enter/Space.
 */
export function NodeList({
  snapshot,
  selectedNodeId,
  onSelectNode,
  locale,
}: {
  snapshot: GraphSnapshot | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  locale: Locale;
}) {
  if (!snapshot || snapshot.nodes.length === 0) {
    return <p className="p-4 text-sm text-muted">{t(locale, 'nodeList.empty')}</p>;
  }
  return (
    <div>
      <p className="px-1 pb-2 text-xs text-muted">{t(locale, 'graph.selectFromList')}</p>
      <ul className="grid max-h-80 gap-1 overflow-auto" aria-label={t(locale, 'nodeList.ariaLabel')}>
        {snapshot.nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelectNode(node.id)}
              aria-pressed={node.id === selectedNodeId}
              className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-raised"
              style={{
                background: node.id === selectedNodeId ? 'var(--ab-action-soft)' : undefined,
                fontWeight: node.id === selectedNodeId ? 700 : 400,
              }}
            >
              <span className="ab-mono block truncate">{node.path}</span>
              <span className="text-xs text-muted">
                {t(locale, `graph.${node.type}`)}
                {node.language ? ` · ${node.language}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
