'use client';

import { useEffect, useState } from 'react';
import type {
  GraphSnapshot,
  Locale,
  Milestone,
  NodeExplanation,
  TimelineStory,
} from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { apiJson, isApiIssue } from '@/lib/client-api';
import { errorMessage } from '@/lib/errors';
import { commitUrl, fileUrl, type RepoRef } from '@/lib/slug';
import { Badge } from '@/components/ui';
import { ClaimList } from '@/components/Provenance';

/**
 * Right insight panel (TRD §2.4): milestone change inspector + node inspector.
 * All citations come from evidenceRefs only (FR: no fabricated relationships);
 * offline/model provenance is always disclosed (FR-08).
 */

export function ChangeInspector({
  milestone,
  storyPart,
  story,
  repoRef,
  locale,
  addedCount,
  removedCount,
}: {
  milestone: Milestone;
  storyPart: TimelineStory['milestones'][number] | null;
  story: TimelineStory | null;
  repoRef: RepoRef;
  locale: Locale;
  addedCount: number;
  removedCount: number;
}) {
  return (
    <section aria-labelledby="change-inspector-heading" className="grid gap-4">
      <div>
        <h3 id="change-inspector-heading" className="ab-title">
          {t(locale, 'history.summaryHeading')}
        </h3>
        <p className="mt-1 text-sm">{milestone.changeSummary || milestone.title}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {addedCount > 0 ? (
            <Badge tone="success">{t(locale, 'history.deltaAdded', { count: addedCount })}</Badge>
          ) : null}
          {removedCount > 0 ? (
            <Badge tone="warning">{t(locale, 'history.deltaRemoved', { count: removedCount })}</Badge>
          ) : null}
          {addedCount === 0 && removedCount === 0 ? (
            <span className="text-xs text-muted">{t(locale, 'history.deltaNone')}</span>
          ) : null}
        </div>
        <a
          href={commitUrl(repoRef, milestone.sha)}
          target="_blank"
          rel="noopener noreferrer"
          className="ab-mono mt-2 inline-block text-xs underline"
          style={{ color: 'var(--ab-action-text)' }}
        >
          {t(locale, 'history.commitLink')} · {milestone.sha.slice(0, 10)}
        </a>
      </div>

      <div>
        <h4 className="text-sm font-bold">{t(locale, 'history.storyHeading')}</h4>
        {storyPart ? (
          <p className="ab-prose mt-1 text-sm">{storyPart.narrative}</p>
        ) : (
          <p className="mt-1 text-sm text-muted">{t(locale, 'history.storyNone')}</p>
        )}
        {storyPart && storyPart.claims.length > 0 ? (
          <div className="mt-3">
            <ClaimList claims={storyPart.claims} repoRef={repoRef} locale={locale} />
          </div>
        ) : null}
      </div>

      {story ? <ProvenanceNotice story={story} locale={locale} /> : null}
    </section>
  );
}

export function ProvenanceNotice({ story, locale }: { story: TimelineStory; locale: Locale }) {
  return (
    <p className="rounded-lg p-3 text-xs" style={{ background: 'var(--ab-raised)' }} role="note">
      <strong>{story.offline ? t(locale, 'provenance.offlineBadge') : t(locale, 'provenance.label')}:</strong>{' '}
      {story.offline ? t(locale, 'provenance.offlineNotice') : t(locale, 'provenance.liveNotice', { modelId: 'Gemma' })}
    </p>
  );
}

export function NodeInspector({
  repositoryId,
  snapshotSha,
  snapshot,
  nodeId,
  repoRef,
  locale,
}: {
  repositoryId: string;
  snapshotSha: string;
  snapshot: GraphSnapshot | null;
  nodeId: string;
  repoRef: RepoRef;
  locale: Locale;
}) {
  const [explanation, setExplanation] = useState<NodeExplanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const node = snapshot?.nodes.find((n) => n.id === nodeId) ?? null;
  const imports = snapshot?.edges.filter((e) => e.kind === 'import' && e.source === nodeId) ?? [];
  const importedBy = snapshot?.edges.filter((e) => e.kind === 'import' && e.target === nodeId) ?? [];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExplanation(null);
    apiJson<{ kind: string; explanation?: NodeExplanation }>('/api/explanations', {
      method: 'POST',
      body: JSON.stringify({
        repositoryId,
        snapshotSha,
        subject: nodeId,
        task: 'node',
        locale,
        level: 'beginner',
      }),
    })
      .then((response) => {
        if (!cancelled && response.kind === 'node' && response.explanation) {
          setExplanation(response.explanation);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(isApiIssue(err) ? errorMessage(err, locale) : t(locale, 'errors.generic'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryId, snapshotSha, nodeId, locale]);

  const pathOf = (id: string): string => snapshot?.nodes.find((n) => n.id === id)?.path ?? id;

  return (
    <section aria-labelledby="node-inspector-heading" className="grid gap-3">
      <h3 id="node-inspector-heading" className="ab-title">
        {node?.path ?? nodeId}
      </h3>
      {node ? (
        <a
          href={fileUrl(repoRef, snapshotSha, node.path)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline"
          style={{ color: 'var(--ab-action-text)' }}
        >
          {t(locale, 'inspector.openInGitHubCommit')}
        </a>
      ) : null}

      {loading ? <p className="text-sm text-muted">{t(locale, 'common.loading')}</p> : null}
      {error ? (
        <p className="text-sm" role="alert" style={{ color: 'var(--ab-error)' }}>
          {error}
        </p>
      ) : null}

      {explanation ? (
        <div className="grid gap-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
              {t(locale, 'inspector.nodePurposeLabel')}
            </h4>
            <p className="ab-prose mt-1 text-sm">{explanation.purpose}</p>
          </div>
          <p className="text-sm text-muted">{explanation.detail}</p>
          {explanation.offline ? (
            <Badge tone="history">{t(locale, 'provenance.offlineBadge')}</Badge>
          ) : null}
          <ClaimList claims={explanation.claims} repoRef={repoRef} locale={locale} />
        </div>
      ) : null}

      <div className="grid gap-2 text-sm">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{t(locale, 'inspector.importsLabel')}</h4>
          {imports.length > 0 ? (
            <ul className="ab-mono mt-1 grid gap-1 text-xs">
              {imports.map((edge) => (
                <li key={edge.id}>→ {pathOf(edge.target)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{t(locale, 'inspector.none')}</p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            {t(locale, 'inspector.importedByLabel')}
          </h4>
          {importedBy.length > 0 ? (
            <ul className="ab-mono mt-1 grid gap-1 text-xs">
              {importedBy.map((edge) => (
                <li key={edge.id}>← {pathOf(edge.source)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{t(locale, 'inspector.none')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
