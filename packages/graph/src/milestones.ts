// TRD §4.2 step 2 / §4.1 Timeline: pick 3–5 milestone commits via tags, merges
// and change significance. Invariant: every selectable milestone maps to an
// actual SHA from the fetched window — never represent gaps as full history.

import type { MilestoneChangeKind } from '@atlas/contracts';
import type { CommitInfo } from '@atlas/github';

export interface MilestoneChoice {
  sha: string;
  title: string;
  changeKind: MilestoneChangeKind;
  reason: string;
}

export interface SelectMilestonesOptions {
  min?: number;
  max?: number;
  tags?: { tag: string; sha: string }[];
}

/** Dropping priority: highest survives the `max` trim. */
const PRIORITY = { boundary: 4, release: 3, merge: 2, significance: 1, filler: 0 } as const;

const DEFAULT_MIN = 3;
const DEFAULT_MAX = 5;

interface Candidate {
  commit: CommitInfo;
  changeKind: MilestoneChangeKind;
  title: string;
  reason: string;
  priority: number;
  score: number;
}

/**
 * Select milestone commits from an analysis window (ascending committerDate).
 * Deterministic: same input → same output, no Date.now / Math.random.
 */
export function selectMilestones(
  commits: CommitInfo[],
  options: SelectMilestonesOptions = {},
): MilestoneChoice[] {
  const min = Math.max(1, options.min ?? DEFAULT_MIN);
  const max = Math.max(min, options.max ?? DEFAULT_MAX);
  if (commits.length === 0) return [];

  const window = [...commits].sort(compareCommitInfo);
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const bySha = new Map(window.map((commit) => [commit.sha, commit]));

  const chosen = new Map<string, Candidate>();
  const add = (candidate: Candidate): void => {
    if (!chosen.has(candidate.commit.sha)) chosen.set(candidate.commit.sha, candidate);
  };

  // TRD §4.2 step 3: always include the earliest and latest commit of the window.
  add({
    commit: first,
    changeKind: 'other',
    title: subjectOf(first.message),
    reason: 'earliest commit in window',
    priority: PRIORITY.boundary,
    score: 0,
  });
  if (last.sha !== first.sha) {
    add({
      commit: last,
      changeKind: 'other',
      title: subjectOf(last.message),
      reason: 'latest commit in window',
      priority: PRIORITY.boundary,
      score: 0,
    });
  }

  // Release tags inside the window map to real SHAs (TRD §4.1: tags → milestones).
  for (const tag of options.tags ?? []) {
    const commit = bySha.get(tag.sha);
    if (!commit) continue; // tag outside the fetched window is not a selectable milestone
    add({
      commit,
      changeKind: 'release',
      title: tag.tag,
      reason: `release tag ${tag.tag}`,
      priority: PRIORITY.release,
      score: 0,
    });
  }

  // Merge commits are notable structure events (two parents).
  for (const commit of window) {
    if ((commit.parents?.length ?? 0) >= 2) {
      add({
        commit,
        changeKind: 'merge',
        title: subjectOf(commit.message),
        reason: 'merge commit',
        priority: PRIORITY.merge,
        score: 0,
      });
    }
  }

  // Change-significance picks: when file counts are known use them; otherwise a
  // message-length hint is the only deterministic proxy (§4.2: "change significance").
  const hasFileCounts = window.some((commit) => Array.isArray(commit.filesChanged));
  const scoreOf = (commit: CommitInfo): number =>
    hasFileCounts ? (commit.filesChanged?.length ?? -1) : commit.message.length;
  const scored: { commit: CommitInfo; score: number }[] = window
    .map((commit) => ({ commit, score: scoreOf(commit) }))
    .filter((entry) => entry.score >= 0);

  // Fill toward `max` with the most significant remaining commits.
  if (chosen.size < max) {
    const ordered = [...scored].sort((a, b) => b.score - a.score || compareSha(a.commit.sha, b.commit.sha));
    for (const entry of ordered) {
      if (chosen.size >= max) break;
      if (chosen.has(entry.commit.sha)) continue;
      add({
        commit: entry.commit,
        changeKind: 'structural',
        title: subjectOf(entry.commit.message),
        reason: hasFileCounts
          ? `clears ${entry.score} files across the window`
          : 'widest change message hint in window',
        priority: PRIORITY.significance,
        score: entry.score,
      });
    }
  }

  // Trim to `max`: lowest priority drops first; window boundaries are untouchable.
  while (chosen.size > max) {
    const droppable = [...chosen.values()].filter(
      (c) => c.commit.sha !== first.sha && c.commit.sha !== last.sha,
    );
    if (droppable.length === 0) break;
    droppable.sort(
      (a, b) => a.priority - b.priority || a.score - b.score || -compareSha(a.commit.sha, b.commit.sha),
    );
    chosen.delete(droppable[0]!.commit.sha);
  }

  // Ensure `min` when the window allows it (TRD §4.2: 3–5 milestones).
  const floor = Math.min(min, window.length);
  while (chosen.size < floor) {
    const remaining = [...scored]
      .filter((entry) => !chosen.has(entry.commit.sha))
      .sort((a, b) => b.score - a.score || compareSha(a.commit.sha, b.commit.sha));
    const next = remaining[0];
    if (!next) break;
    add({
      commit: next.commit,
      changeKind: 'other',
      title: subjectOf(next.commit.message),
      reason: hasFileCounts ? `touches ${next.score} files` : 'notable commit in window',
      priority: PRIORITY.filler,
      score: next.score,
    });
  }

  return [...chosen.values()]
    .sort((a, b) => compareCommitInfo(a.commit, b.commit))
    .map((candidate) => ({
      sha: candidate.commit.sha,
      title: candidate.title,
      changeKind: candidate.changeKind,
      reason: candidate.reason,
    }));
}

/** Ascending committerDate; lexicographic sha as the deterministic tie-break. */
function compareCommitInfo(a: CommitInfo, b: CommitInfo): number {
  if (a.committerDate !== b.committerDate) return a.committerDate < b.committerDate ? -1 : 1;
  return compareSha(a.sha, b.sha);
}

function compareSha(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function subjectOf(message: string): string {
  const line = (message.split('\n', 1)[0] ?? '').trim();
  return line.length > 0 ? line : 'untitled commit';
}
