// TRD §4.1 repo-ingestion facts: bounded, deterministic GitHub retrieval shapes.
// These describe what the ingestion service extracts; contracts entities build on them.

export interface RepoMeta {
  owner: string;
  name: string;
  defaultBranch: string;
  description: string | null;
  /** SPDX identifier, or null when the license is absent or unmappable. */
  licenseSpdx: string | null;
  stars: number;
  visibility: 'public' | 'private';
}

export interface CommitInfo {
  sha: string;
  message: string;
  /** ISO 8601 committer date. */
  committerDate: string;
  parents: string[];
  /** Present only when requested through the compare API; not fetched per commit. */
  filesChanged?: string[];
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
  sha: string;
}

export interface CompareFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}
