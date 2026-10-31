'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GraphSnapshot,
  Locale,
  Milestone,
  TimelineStory,
} from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { apiJson, isApiIssue } from '@/lib/client-api';
import { errorMessage } from '@/lib/errors';
import { diffGraphs } from '@/lib/graph-diff';
import type { RepoRef } from '@/lib/slug';
import { RepoNav } from '@/components/RepoNav';
import { GraphCanvas } from './GraphCanvas';
import { TimelineScrubber } from './TimelineScrubber';
import { NodeList } from './NodeList';
import { ChangeInspector, NodeInspector } from './InsightPanel';
import { Badge, Button, Skeleton } from '@/components/ui';

/**
 * Time-travel workbench (TRD §2.2 history route, §2.4 responsive states):
 * left rail = repo navigation, center = timeline + graph, right = insight
 * panel (overlay on smaller screens). Graph snapshots are fetched per
 * milestone SHA and cached client-side; deltas are computed locally.
 */
export function HistoryWorkbench({
  slug,
  locale,
  repositoryId,
  repoRef,
  milestones,
  story,
  coverage,
}: {
  slug: string;
  locale: Locale;
  repositoryId: string;
  repoRef: RepoRef;
  milestones: Milestone[];
  story: TimelineStory | null;
  coverage: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [graphs, setGraphs] = useState<Record<string, GraphSnapshot | null>>({});
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loadingSha, setLoadingSha] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [showNodeList, setShowNodeList] = useState(false);
  const [showInspector, setShowInspector] = useState(true);

  const active = milestones[activeIndex] ?? null;
  const activeSha = active?.sha ?? '';

  const fetchGraph = useCallback(
    async (sha: string) => {
      if (!sha) return;
      setLoadingSha(sha);
      setGraphError(null);
      try {
        const graph = await apiJson<GraphSnapshot>(
          `/api/snapshots/${encodeURIComponent(sha)}/graph?repositoryId=${encodeURIComponent(repositoryId)}`,
        );
        setGraphs((prev) => ({ ...prev, [sha]: graph }));
      } catch (error) {
        setGraphError(isApiIssue(error) ? errorMessage(error, locale) : t(locale, 'errors.generic'));
      } finally {
        setLoadingSha((current) => (current === sha ? null : current));
      }
    },
    [repositoryId, locale],
  );

  // Load active + previous snapshot so the delta is real, not assumed.
  useEffect(() => {
    if (!activeSha) return;
    setSelectedNodeId(null);
    const previousSha = milestones[activeIndex - 1]?.sha;
    for (const sha of [activeSha, previousSha]) {
      if (sha && graphs[sha] === undefined) void fetchGraph(sha);
    }
  }, [activeSha, activeIndex, milestones, graphs, fetchGraph]);

  const activeGraph = activeSha ? (graphs[activeSha] ?? null) : null;
  const previousGraph = milestones[activeIndex - 1]?.sha
    ? (graphs[milestones[activeIndex - 1]!.sha] ?? null)
    : null;

  const delta = useMemo(
    () => (activeGraph ? diffGraphs(previousGraph, activeGraph) : null),
    [previousGraph, activeGraph],
  );

  const storyPart = active && story ? (story.milestones.find((part) => part.milestoneId === active.id) ?? null) : null;

  const selectFromList = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFocusSignal({ nodeId, nonce: Date.now() });
    setShowInspector(true);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_360px]">
      {/* Left rail (hidden on small screens; sections remain in header nav). */}
      <div className="hidden lg:block">
        <RepoNav
          slug={slug}
          locale={locale}
          milestones={milestones}
          activeMilestoneIndex={activeIndex}
          onSelectMilestone={setActiveIndex}
          committedAt={(index) => milestones[index]?.time.slice(0, 10)}
        />
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="ab-display">{t(locale, 'history.headingAria')}</h1>
          <Badge tone="neutral" title={coverage}>
            {t(locale, 'overview.coverageLabel')}
          </Badge>
        </div>

        <TimelineScrubber milestones={milestones} activeIndex={activeIndex} onSelect={setActiveIndex} locale={locale} />

        {graphError ? (
          <div className="ab-card p-4" role="alert">
            <p className="text-sm" style={{ color: 'var(--ab-error)' }}>
              {graphError}
            </p>
            <Button className="mt-2" onClick={() => void fetchGraph(activeSha)}>
              {t(locale, 'common.retry')}
            </Button>
          </div>
        ) : null}

        {loadingSha === activeSha && !activeGraph ? <Skeleton height={320} /> : null}

        <GraphCanvas
          snapshot={activeGraph}
          addedNodeIds={delta?.addedNodes.map((node) => node.id) ?? []}
          locale={locale}
          milestoneTitle={active?.title ?? ''}
          selectedNodeId={selectedNodeId}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            if (nodeId) setShowInspector(true);
          }}
          focusSignal={focusSignal}
        />

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowNodeList((v) => !v)} aria-expanded={showNodeList}>
            {showNodeList ? t(locale, 'nodeList.hide') : t(locale, 'nodeList.show')}
          </Button>
          <Button className="xl:hidden" onClick={() => setShowInspector((v) => !v)} aria-expanded={showInspector}>
            {showInspector ? t(locale, 'inspector.hide') : t(locale, 'inspector.show')}
          </Button>
        </div>

        {showNodeList ? (
          <div className="ab-card p-4">
            <NodeList snapshot={activeGraph} selectedNodeId={selectedNodeId} onSelectNode={selectFromList} locale={locale} />
          </div>
        ) : null}

        {/* Mobile: milestone cards replace the free-roaming default (TRD §2.4). */}
        <section className="ab-card p-4 lg:hidden" aria-labelledby="milestone-cards-heading">
          <h2 id="milestone-cards-heading" className="ab-title">
            {t(locale, 'history.cardsTitle')}
          </h2>
          <ol className="mt-2 grid gap-2">
            {milestones.map((milestone, index) => (
              <li key={milestone.id}>
                <button
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className="w-full rounded-lg border p-3 text-left"
                  style={{
                    borderColor: index === activeIndex ? 'var(--ab-action)' : 'var(--ab-line)',
                    background: index === activeIndex ? 'var(--ab-action-soft)' : undefined,
                  }}
                >
                  <span className="block text-sm font-semibold">{milestone.title}</span>
                  <span className="ab-mono block text-xs text-muted">{milestone.sha.slice(0, 10)}</span>
                  <span className="block text-xs text-muted">{milestone.changeSummary}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        {/* Insight panel below the graph on small screens. */}
        {showInspector && active ? (
          <div className="ab-card p-4 xl:hidden">
            <InspectorBody
              selectedNodeId={selectedNodeId}
              repositoryId={repositoryId}
              activeSha={activeSha}
              activeGraph={activeGraph}
              active={active}
              storyPart={storyPart}
              story={story}
              repoRef={repoRef}
              locale={locale}
              deltaAdded={delta?.addedNodes.length ?? 0}
              deltaRemoved={delta?.removedNodeIds.length ?? 0}
            />
          </div>
        ) : null}
      </div>

      {/* Right insight panel on wide screens. */}
      {active ? (
        <aside className="ab-card hidden h-fit content-start gap-4 p-4 xl:grid" aria-label={t(locale, 'inspector.changeTab')}>
          <InspectorBody
            selectedNodeId={selectedNodeId}
            repositoryId={repositoryId}
            activeSha={activeSha}
            activeGraph={activeGraph}
            active={active}
            storyPart={storyPart}
            story={story}
            repoRef={repoRef}
            locale={locale}
            deltaAdded={delta?.addedNodes.length ?? 0}
            deltaRemoved={delta?.removedNodeIds.length ?? 0}
          />
        </aside>
      ) : null}
    </div>
  );
}

function InspectorBody(props: {
  selectedNodeId: string | null;
  repositoryId: string;
  activeSha: string;
  activeGraph: GraphSnapshot | null;
  active: Milestone;
  storyPart: TimelineStory['milestones'][number] | null;
  story: TimelineStory | null;
  repoRef: RepoRef;
  locale: Locale;
  deltaAdded: number;
  deltaRemoved: number;
}) {
  const {
    selectedNodeId,
    repositoryId,
    activeSha,
    activeGraph,
    active,
    storyPart,
    story,
    repoRef,
    locale,
    deltaAdded,
    deltaRemoved,
  } = props;
  return (
    <div className="grid content-start gap-6">
      {selectedNodeId ? (
        <NodeInspector
          repositoryId={repositoryId}
          snapshotSha={activeSha}
          snapshot={activeGraph}
          nodeId={selectedNodeId}
          repoRef={repoRef}
          locale={locale}
        />
      ) : (
        <p className="text-xs text-muted">{t(locale, 'inspector.noNodeSelected')}</p>
      )}
      <ChangeInspector
        milestone={active}
        storyPart={storyPart}
        story={story}
        repoRef={repoRef}
        locale={locale}
        addedCount={deltaAdded}
        removedCount={deltaRemoved}
      />
    </div>
  );
}
