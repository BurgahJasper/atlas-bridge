// TRD §4.2 step 3 / FR-04: deterministic import extraction for supported files.
// Regex heuristics only — no AST, no code execution (repo text is hostile input).

/** Extensions whose contents feed the JS/TS import extractor. */
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXTENSIONS = new Set(['.py']);

/** Hard cap per file so hostile/obfuscated sources cannot stall analysis. */
const MAX_RESULTS = 200;

/** Specifier text is captured by group 2 in every pattern. */
const JS_PATTERNS: RegExp[] = [
  // `import {...} from 'x'` / `export {...} from 'x'` — multi-line safe; the
  // semicolon guard keeps the lazy span from leaking across statements.
  /\b(?:import|export)\b[^;]{0,400}?\bfrom\s*(['"])([^'"]+)\1/g,
  // Side-effect import: `import 'x'`
  /\bimport\s*(['"])([^'"]+)\1/g,
  // Dynamic import: `import('x')`
  /\bimport\s*\(\s*(['"])([^'"]+)\1/g,
  // CommonJS: `require('x')`
  /\brequire\s*\(\s*(['"])([^'"]+)\1/g,
];

/**
 * Extract a specifier list for the given path and content.
 * Unknowable extensions → []. Results are unique, first-occurrence order, ≤ 200.
 */
export function extractImports(path: string, content: string): string[] {
  const extension = extensionOf(path);
  if (JS_EXTENSIONS.has(extension)) return extractJsImports(content);
  if (PY_EXTENSIONS.has(extension)) return extractPyImports(content);
  return [];
}

function extensionOf(path: string): string {
  const slashed = path.includes('/') ? path.slice(Math.max(0, path.lastIndexOf('/')) + 1) : path;
  const dot = slashed.lastIndexOf('.');
  return dot === -1 ? '' : slashed.slice(dot).toLowerCase();
}

function extractJsImports(content: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const pattern of JS_PATTERNS) {
    pattern.lastIndex = 0; // stateful /g: reset defensively per call
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[2];
      if (typeof specifier !== 'string' || specifier.length === 0) continue;
      const key = specifier.trim();
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      order.push(key);
      if (order.length >= MAX_RESULTS) return order;
    }
    if (order.length >= MAX_RESULTS) break;
  }
  return order;
}

const PY_FROM_RE = /^\s*from\s+((?:\.{0,2})[A-Za-z_][\w.]*)\s+import\b/gm;
const PY_IMPORT_RE = /^\s*import\s+([^\n#]+)$/gm;

function extractPyImports(content: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const push = (specifier: string): boolean => {
    if (specifier.length === 0 || seen.has(specifier)) return false;
    seen.add(specifier);
    order.push(specifier);
    return order.length >= MAX_RESULTS;
  };

  PY_FROM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PY_FROM_RE.exec(content)) !== null) {
    const module = (match[1] ?? '').trim();
    // `from . import x` imports the current package: keep the bare-dot module form.
    if (module.length > 0 && push(module)) return order;
  }

  PY_IMPORT_RE.lastIndex = 0;
  while ((match = PY_IMPORT_RE.exec(content)) !== null) {
    // First identifier only: `import numpy as np`, `import a, b.c` → numpy / a / b.c.
    for (const piece of (match[1] ?? '').split(',')) {
      const moduleName = /^([A-Za-z_][\w.]*)/.exec(piece.trim())?.[1];
      if (moduleName && push(moduleName)) return order;
    }
  }
  return order;
}
