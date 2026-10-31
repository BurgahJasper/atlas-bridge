// TRD §10.1 item 7: curated fixtures power the demo fallback when live GitHub
// inference is unavailable. Same GitHubClient contract — UI code cannot tell
// the difference, but demo output must stay clearly labeled offline elsewhere.

import type { CommitInfo, CompareFile, RepoMeta, TreeEntry } from './types.js';
import type { GitHubClient } from './client.js';
import { GitHubError } from './errors.js';

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;

export interface CuratedFixture {
  generatedAt: string;
  notes?: string;
  repository: {
    owner: string;
    name: string;
    defaultBranch: string;
    description: string | null;
    licenseSpdx: string | null;
    stars: number;
  };
  /** Ascending committerDate — exactly the demo analysis window. */
  commits: CommitInfo[];
  tags: { tag: string; sha: string }[];
  milestones: {
    sha: string;
    title: string;
    changeKind: 'release' | 'merge' | 'structural' | 'other';
    reason: string;
  }[];
  trees: Record<string, TreeEntry[]>;
  files: Record<string, string>;
  readme: Record<string, string>;
  compares: Record<string, CompareFile[]>;
}

export function createFixtureClient(fixture: CuratedFixture): GitHubClient {
  const repo = fixture.repository;

  function notFound(what: string): GitHubError {
    return new GitHubError('not-found', `Fixture does not contain ${what}`);
  }

  function treeFor(sha: string): TreeEntry[] {
    const entries = fixture.trees[sha];
    if (!entries) throw notFound(`tree at sha ${sha}`);
    return entries.map((entry) => ({ ...entry })); // defensive copy: fixtures are immutable facts
  }

  const client: GitHubClient = {
    async fetchRepoMeta(owner, name) {
      if (owner !== repo.owner || name !== repo.name) {
        throw notFound(`repository ${owner}/${name}`);
      }
      const meta: RepoMeta = {
        owner: repo.owner,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        description: repo.description,
        licenseSpdx: repo.licenseSpdx,
        stars: repo.stars,
        visibility: 'public', // TRD §14: public repos only until consent review
      };
      return meta;
    },

    async fetchCommits(owner, name, limit) {
      void owner;
      void name;
      if (!Number.isFinite(limit) || limit <= 0) return [];
      const ascending = [...fixture.commits].sort(compareCommitInfo);
      // Parity with the live client: the newest `limit` commits of the window.
      const count = Math.min(Math.floor(limit), ascending.length);
      const start = Math.max(0, ascending.length - count);
      return ascending.slice(start).map((c) => ({ ...c, parents: [...c.parents] }));
    },

    async fetchCompare(owner, name, baseSha, headSha) {
      void owner;
      void name;
      const files = fixture.compares[`${baseSha}...${headSha}`];
      if (!files) throw notFound(`compare ${baseSha}...${headSha}`);
      return {
        files: files.map((f) => {
          const copy: CompareFile = { ...f };
          if (typeof f.previousPath !== 'string') delete copy.previousPath; // no dangling undefined keys
          return copy;
        }),
      };
    },

    async fetchTree(_owner, _name, sha, maxEntries) {
      const entries = treeFor(sha);
      return maxEntries === undefined ? entries : entries.slice(0, Math.max(0, maxEntries));
    },

    async fetchFile(_owner, _name, path, sha, maxBytes = DEFAULT_MAX_FILE_BYTES) {
      const key = `${sha}:${path}`;
      const content = fixture.files[key];
      if (typeof content !== 'string') throw notFound(`file ${key}`);
      // Same byte cap as the live client so fixture and live paths behave alike.
      const byteLength = new TextEncoder().encode(content).byteLength;
      if (byteLength > maxBytes) {
        throw new GitHubError('unsupported', `File '${path}' exceeds the ${maxBytes}-byte cap`);
      }
      return content;
    },
  };

  return client;
}

function compareCommitInfo(a: CommitInfo, b: CommitInfo): number {
  if (a.committerDate !== b.committerDate) return a.committerDate < b.committerDate ? -1 : 1;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  return 0;
}
