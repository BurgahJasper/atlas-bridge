import { describe, expect, it } from 'vitest';
import { extractImports } from './imports.js';

describe('extractImports', () => {
  it('extracts JS/TS specifiers including multi-line and dynamic forms', () => {
    const source = [
      'import {',
      '  alpha,',
      '  beta,',
      "} from './alpha.ts';",
      'import gamma from "./gamma.mjs";',
      "const fs = require('node:fs');",
      "const lazy = () => import('./lazy.tsx');",
      "export { helper } from './helper.js';",
      "import './side-effect.css';",
    ].join('\n');
    expect(extractImports('src/app.tsx', source)).toEqual([
      './alpha.ts',
      './gamma.mjs',
      './helper.js',
      './side-effect.css',
      './lazy.tsx',
      'node:fs',
    ]);
  });

  it('extracts python modules: plain, aliased, dotted and package-relative', () => {
    const source = [
      'from pkg.mod import thing',
      'from .local import helper',
      'from ..sibling import other',
      'import os',
      'import numpy as np',
      'import a, b.c',
      'from rel import alpha as beta',
    ].join('\n');
    expect(extractImports('services/app.py', source)).toEqual([
      'pkg.mod',
      '.local',
      '..sibling',
      'rel',
      'os',
      'numpy',
      'a',
      'b.c',
    ]);
  });

  it('returns [] for unsupported extensions', () => {
    expect(extractImports('notes.txt', "import x from 'y';")).toEqual([]);
    expect(extractImports('Makefile', 'include $(x)')).toEqual([]);
  });

  it('caps results at 200 per file', () => {
    const many = Array.from({ length: 300 }, (_, index) => `import x${index} from './m${index}.js';`).join('\n');
    expect(extractImports('src/a.ts', many)).toHaveLength(200);
  });

  it('handles odd quoting without emitting duplicates', () => {
    const source = [
      `const label = "he said 'import ghost'";`,
      `import a from './a.ts'; // don't match 'this'`,
      `import b from "b.ts";`,
      `import a from './a.ts';`,
    ].join('\n');
    expect(extractImports('src/odd.ts', source)).toEqual(['./a.ts', 'b.ts']);
  });
});
