// TRD §4.2 step 3 / FR-04: build a provenance-backed graph snapshot.
// Invariant: no fabricated relationships — an edge exists only when BOTH
// endpoints are real nodes derived from the fetched tree, and import edges
// carry evidence pointing at the exact importing file revision (sha, path, line).

import type { EvidenceRef, GraphEdge, GraphNode, GraphSnapshot } from '@atlas/contracts';
import { extractImports } from './imports.js';

export interface FileFacts {
  path: string;
  size?: number;
  content?: string;
}

/** Top two folder levels only: bounded graphs (TRD §8: ~150-node graphs). */
const FOLDER_LEVELS = 2;
/** Global cap so hostile sources cannot blow up edge extraction. */
const MAX_IMPORTS_PROCESSED = 5000;

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
};

export function buildGraph(snapshotId: string, sha: string, files: FileFacts[]): GraphSnapshot {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  // Sorted pass: output is independent of input order (deterministic requirement).
  const ordered = [...files].sort((a, b) => compareStrings(a.path, b.path));

  const fileIds = new Set<string>();
  for (const file of ordered) {
    if (typeof file.path !== 'string' || file.path.length === 0 || fileIds.has(file.path)) continue;
    fileIds.add(file.path);

    const extension = extensionOf(file.path);
    const node: GraphNode = {
      id: `file:${file.path}`,
      snapshotId,
      path: file.path,
      label: baseName(file.path),
      type: 'file',
    };
    const language = LANGUAGE_BY_EXTENSION[extension.replace(/^\./, '')];
    if (language) node.language = language;
    if (typeof file.size === 'number') node.size = file.size;
    nodes.set(node.id, node);

    const segments = file.path.split('/');
    const folderDepth = Math.min(FOLDER_LEVELS, segments.length - 1);
    // Folder nodes (`folder:` ids keep the trailing slash per the contracts doc).
    for (let level = 1; level <= folderDepth; level++) {
      const folderPath = `${segments.slice(0, level).join('/')}/`;
      const id = `folder:${folderPath}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          snapshotId,
          path: folderPath,
          label: segments[level - 1]!,
          type: 'folder',
        });
      }
    }
    // Structural containment edge — only when the parent folder node exists
    // (depth-3+ trees collapse onto the top-two-levels view, so deeper files get no folder edge).
    if (folderDepth >= 1) {
      const parentPath = `${segments.slice(0, segments.length - 1).join('/')}/`;
      const parentNodeId = `folder:${parentPath}`;
      if (nodes.has(parentNodeId)) {
        putEdge(edges, {
          id: edgeId('folder', parentNodeId, node.id, ''),
          snapshotId,
          source: parentNodeId,
          target: node.id,
          kind: 'folder',
        });
      }
    }
  }

  // Second pass: import edges. Evidence line is the specifier's first line in
  // the importing file at this exact sha (TRD §5.3: citations resolve exactly).
  const topLevelFolders = new Set<string>();
  for (const node of nodes.values()) {
    if (node.type === 'folder') topLevelFolders.add(node.path.split('/')[0]!);
  }

  let processed = 0;
  for (const file of ordered) {
    if (processed >= MAX_IMPORTS_PROCESSED) continue;
    if (typeof file.content !== 'string' || !fileIds.has(file.path)) continue;

    for (const specifier of extractImports(file.path, file.content)) {
      if (processed >= MAX_IMPORTS_PROCESSED) break;
      processed++;
      const extension = extensionOf(file.path);

      // Python: dotted (`pkg.mod`) and package-relative (`.` / `..`) specifiers
      // both resolve against known .py paths.
      if (extension === '.py') {
        const resolved = resolvePythonImport(specifier, file.path, fileIds);
        if (resolved) {
          addImportEdge(edges, snapshotId, sha, file, specifier, `file:${resolved}`);
          continue;
        }
      } else if (CODE_EXTENSIONS.includes(extension) && specifier.startsWith('.')) {
        // Relative JS/TS specifiers resolve extension-agnostically against real files only.
        const resolved = resolveRelativeImport(specifier, file.path, fileIds);
        if (resolved) {
          addImportEdge(edges, snapshotId, sha, file, specifier, `file:${resolved}`);
          continue;
        }
      }

      // Bare specifier: allowed only as a top-level workspace/folder match.
      // Anything else (npm packages, stdlib names) is ignored — never fabricated.
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && topLevelFolders.has(specifier)) {
        const moduleId = `module:${specifier}`;
        if (!nodes.has(moduleId)) {
          nodes.set(moduleId, {
            id: moduleId,
            snapshotId,
            path: specifier,
            label: specifier,
            type: 'module',
          });
        }
        addImportEdge(edges, snapshotId, sha, file, specifier, moduleId, true);
      }
    }
  }

  return {
    snapshotId,
    sha,
    nodes: [...nodes.values()].sort((a, b) => compareStrings(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => compareStrings(a.id, b.id)),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map-backed: duplicate edges collapse on the deterministic edge id. */
function putEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
  if (!edges.has(edge.id)) edges.set(edge.id, edge);
}

function addImportEdge(
  edges: Map<string, GraphEdge>,
  snapshotId: string,
  sha: string,
  file: FileFacts,
  specifier: string,
  targetId: string,
  inferred: boolean = false,
): void {
  const sourceId = `file:${file.path}`;
  const id = edgeId('import', sourceId, targetId, file.path);
  if (edges.has(id)) return; // same source→target pair already evidenced from this file

  const evidenceRef: EvidenceRef = { sha, path: file.path };
  const startLine = findLine(file.content, specifier);
  if (startLine !== undefined) evidenceRef.startLine = startLine;

  putEdge(edges, {
    id,
    snapshotId,
    source: sourceId,
    target: targetId,
    kind: 'import',
    evidenceRef,
    ...(inferred ? { inferred: true } : {}),
  });
}

/** Resolve `./x`, `../x` including extension and /index variants; null when unknown. */
function resolveRelativeImport(specifier: string, importerPath: string, fileIds: Set<string>): string | null {
  const importerDir = parentDir(importerPath);
  const segments: string[] = [];
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(decodeSegment(part));
  }
  const basePath = segments.length > 0
    ? [importerDir, ...segments].filter((s) => s.length > 0).join('/')
    : importerDir;
  if (basePath.length === 0) return null;

  // './util.js' written in TS source must still find './util.ts' — try the
  // literal path first, then extension swaps (TS convention), then /index.
  const stem = hasCodeExtension(basePath) ? basePath.slice(0, basePath.lastIndexOf('.')) : basePath;
  const candidates: string[] = [basePath];
  for (const extension of CODE_EXTENSIONS) candidates.push(stem + extension);
  for (const extension of CODE_EXTENSIONS) candidates.push(`${stem}/index${extension}`);

  for (const candidate of candidates) {
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

/** Resolve python dotted/package-relative specifiers against observed .py paths. */
function resolvePythonImport(specifier: string, importerPath: string, fileIds: Set<string>): string | null {
  let leadingDots = 0;
  let rest = specifier;
  while (rest.startsWith('.') && leadingDots < 3) {
    rest = rest.slice(1);
    leadingDots++;
  }
  const dottedPath = rest.split('.').filter((part) => part.length > 0);

  let base: string[];
  if (leadingDots === 0) {
    base = dottedPath; // absolute dotted: pkg.mod → pkg/mod
  } else {
    let dir = parentDir(importerPath);
    for (let up = 2; up <= leadingDots; up++) dir = parentDir(dir);
    base = [...dir.split('/').filter((p) => p.length > 0), ...dottedPath];
  }
  if (base.length === 0) return null; // bare `from . import …` without a package file

  for (const candidate of [`${base.join('/')}.py`, `${base.join('/')}/__init__.py`]) {
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

function decodeSegment(part: string): string {
  try {
    return decodeURIComponent(part); // hostile paths were percent-encoded inbound
  } catch {
    return part;
  }
}

function hasCodeExtension(path: string): boolean {
  return CODE_EXTENSIONS.includes(extensionOf(path));
}

/** 1-based first line containing the specifier; omitted from evidence when unseen. */
function findLine(content: string | undefined, needle: string): number | undefined {
  if (content === undefined) return undefined;
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.includes(needle)) return index + 1;
  }
  return undefined;
}

function extensionOf(path: string): string {
  const slashed = path.includes('/') ? path.slice(Math.max(0, path.lastIndexOf('/')) + 1) : path;
  const dot = slashed.lastIndexOf('.');
  return dot === -1 ? '' : slashed.slice(dot).toLowerCase();
}

function baseName(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash === -1 ? '' : path.slice(0, lastSlash);
}

function edgeId(kind: GraphEdge['kind'], source: string, target: string, path: string): string {
  return `edge:${kind}:${source}->${target}:${path}`;
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
