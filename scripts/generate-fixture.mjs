#!/usr/bin/env node
// Generates the curated offline fixture for the Atlas Bridge demo repo.
// TRD §10.1 item 7 (demo reliability): the demo is pinned to immutable commit
// SHAs; `npm run seed` refreshes this fixture from the live GitHub API.
// Output: packages/pipeline/src/fixtures/octokit-request-js.json
//
// Boundary rules honoured here (TRD FR-02, §7): bounded retrieval only —
// 30 commits, ≤5 milestones, ≤300 tree entries, ≤8 files per milestone,
// ≤48KB per file, no binaries.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, dirname as pd } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'octokit';
const NAME = 'request.js';
const REPO = `${OWNER}/${NAME}`;

const COMMIT_LIMIT = 30;
const MILESTONE_MIN = 3;
const MILESTONE_MAX = 5;
const TREE_MAX_ENTRIES = 300;
const FILES_PER_MILESTONE = 8;
const MAX_FILE_BYTES = 48_000;

const HEADERS = {
  'User-Agent': 'atlas-bridge-fixture-generator',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

class ApiError extends Error {
  constructor(status, message) {
    super(`GitHub API ${status}: ${message}`);
    this.status = status;
  }
}

async function api(path, { raw = false } = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      ...(raw ? { Accept: 'application/vnd.github.raw' } : {}),
    },
  });
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    throw new ApiError(res.status, `${res.url} (retry-after: ${retryAfter ?? '-'})`);
  }
  if (raw) return res.text();
  return res.json();
}

const isSourceText = (path) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|md|json)$/i.test(path) &&
  !/(node_modules|__tests__|\.test\.|\.spec\.|\/test\/|\/tests\/|\/dist\/)/i.test(path);

function pickMilestones(commits, tags) {
  // Same spirit as @atlas/graph selectMilestones: earliest + latest + tag,
  // padded with merge commits (TRD §4.2 step 2).
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const chosen = new Map();

  const add = (sha, title, changeKind, reason) => {
    if (bySha.has(sha) && !chosen.has(sha)) chosen.set(sha, { sha, title, changeKind, reason });
  };

  const first = commits[0];
  const last = commits[commits.length - 1];
  if (!first || !last) throw new Error('window too small');
  add(first.sha, first.message.split('\n')[0], 'other', 'earliest commit in analysis window');
  add(last.sha, last.message.split('\n')[0], 'other', 'latest commit in analysis window');

  for (const t of tags) add(t.sha, t.tag, 'release', `release tag ${t.tag}`);

  if (chosen.size < MILESTONE_MIN) {
    for (const c of commits) {
      if (c.parents.length === 2) add(c.sha, c.message.split('\n')[0], 'merge', 'merge commit');
      if (chosen.size >= MILESTONE_MAX) break;
    }
  }
  // Deterministic: order ascending by window index; trim to max.
  const ordered = commits.filter((c) => chosen.has(c.sha)).map((c) => chosen.get(c.sha));
  return ordered.slice(0, MILESTONE_MAX);
}

const statusMap = { added: 'added', removed: 'removed', changed: 'modified', renamed: 'renamed' };

async function main() {
  console.log(`Generating curated fixture for ${REPO}…`);
  const meta = await api(`/repos/${REPO}`);
  const repository = {
    owner: OWNER,
    name: NAME,
    defaultBranch: meta.default_branch,
    description: meta.description,
    licenseSpdx: meta.license?.spdx_id === 'NOASSERTION' ? null : (meta.license?.spdx_id ?? null),
    stars: meta.stargazers_count,
  };
  console.log(`  repo: ${meta.full_name}, branch ${meta.default_branch}, stars ${repository.stars}`);

  // Latest-N window, returned ascending.
  const rawCommits = await api(`/repos/${REPO}/commits?per_page=${COMMIT_LIMIT}&page=1`);
  const windowCommits = rawCommits
    .slice(0, COMMIT_LIMIT)
    .map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      committerDate: c.commit.committer.date,
      parents: (c.parents ?? []).map((p) => p.sha),
    }))
    .reverse();
  console.log(`  commits: ${windowCommits.length} in window (${windowCommits[0].sha.slice(0, 7)}…${windowCommits.at(-1).sha.slice(0, 7)})`);
  const windowShas = new Set(windowCommits.map((c) => c.sha));

  const rawTags = await api(`/repos/${REPO}/tags?per_page=100&page=1`);
  const tags = rawTags.filter((t) => windowShas.has(t.commit.sha)).map((t) => ({ tag: t.name, sha: t.commit.sha }));
  console.log(`  tags in window: ${tags.map((t) => t.tag).join(', ') || '(none)'}`);

  const milestones = pickMilestones(windowCommits, tags);
  console.log(`  milestones: ${milestones.map((m) => `${m.sha.slice(0, 7)} (${m.changeKind})`).join(' → ')}`);

  const fixture = {
    generatedAt: new Date().toISOString(),
    notes: 'Offline demo fixture for octokit/request.js. Real pinned SHAs; bounded slice per TRD FR-02. Regenerate with `npm run seed`.',
    repository,
    commits: windowCommits,
    tags,
    milestones,
    trees: {},
    files: {},
    readme: {},
    compares: {},
  };

  for (const m of milestones) {
    // Full tree at each milestone SHA.
    const tree = await api(`/repos/${REPO}/git/trees/${m.sha}?recursive=1`);
    const entries = (tree.tree ?? [])
      .filter((e) => e.type === 'blob' && e.path.split('/').length <= 6)
      .slice(0, TREE_MAX_ENTRIES)
      .map((e) => ({ path: e.path, type: 'blob', size: e.size ?? 0, sha: e.sha }));
    fixture.trees[m.sha] = entries;
    console.log(`  tree @${m.sha.slice(0, 7)}: ${entries.length} blobs`);

    // README at this milestone.
    try {
      const readme = await api(`/repos/${REPO}/contents/README.md?ref=${m.sha}`, { raw: true });
      fixture.readme[m.sha] = readme.slice(0, MAX_FILE_BYTES);
    } catch (e) {
      if (e.status === 404) console.log(`  no README @${m.sha.slice(0, 7)}`);
      else throw e;
    }

    // Bounded set of source files.
    const candidates = entries
      .filter((e) => isSourceText(e.path) && e.size > 0 && e.size <= MAX_FILE_BYTES)
      .sort((a, b) => {
        const rank = (p) => (p.startsWith('src/') ? 0 : p.includes('/') ? 2 : 1);
        return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path);
      })
      .slice(0, FILES_PER_MILESTONE);
    for (const e of candidates) {
      try {
        fixture.files[`${m.sha}:${e.path}`] = await api(
          `/repos/${REPO}/contents/${encodeURIComponent(e.path).replace(/%2F/g, '/')}?ref=${m.sha}`,
          { raw: true },
        );
      } catch (e) {
        if (e.status === 404 || e.status === 403) console.log(`  skip file @${m.sha.slice(0, 7)} ${e.path}`);
        else throw e;
      }
    }
    console.log(`  files @${m.sha.slice(0, 7)}: ${candidates.length}`);
  }

  // Comparisons between consecutive milestones (bounded per_page).
  for (let i = 1; i < milestones.length; i++) {
    const base = milestones[i - 1].sha;
    const head = milestones[i].sha;
    const cmp = await api(`/repos/${REPO}/compare/${base}...${head}?per_page=300`);
    fixture.compares[`${base}...${head}`] = (cmp.files ?? [])
      .slice(0, 300)
      .map((f) => ({
        path: f.filename,
        previousPath: f.previous_filename ?? undefined,
        status: statusMap[f.status],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? f.patch.slice(0, 4000) : undefined,
      }));
    console.log(`  compare ${base.slice(0, 7)}…${head.slice(0, 7)}: ${cmp.files?.length ?? 0} files`);
  }

  const out = resolve(fileURLToPath(import.meta.url), '..', '..', 'packages', 'pipeline', 'src', 'fixtures', 'octokit-request-js.json');
  mkdirSync(pd(out), { recursive: true });
  writeFileSync(out, JSON.stringify(fixture, null, 2), 'utf8');
  console.log(`Fixture written: ${out}`);
}

main().catch((err) => {
  console.error('Fixture generation FAILED:', err.message);
  process.exit(1);
});
