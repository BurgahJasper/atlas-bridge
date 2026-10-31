# Contributing to Atlas Bridge

Thanks for helping make open-source onramping kinder. This guide covers local setup, the package map, and the rules that keep the platform trustworthy.

## Setup

```bash
git clone <your-fork>
cd atlas-bridge
npm install
npm run dev:web
```

Optional: `npm run dev:worker` for the split worker mode, and `docker compose -f infra/docker-compose.yml up -d` for Postgres/Redis.

## Package ownership map

| Area | Path | Owns |
| --- | --- | --- |
| Shared types & schemas | `packages/contracts` | Entities, Zod API schemas, Store interface. **Change first; everything depends on it.** |
| GitHub ingestion | `packages/github` | URL allowlist, bounded REST client, fixture client |
| Fact graph | `packages/graph` | Milestones, import edges, graph deltas |
| AI layer | `packages/ai` | Gemma provider, prompts, offline mock, glossary |
| Missions | `packages/learning` | Deterministic validators, progress, mission builders |
| Orchestration | `packages/pipeline` | TRD §4.2 analysis algorithm, explanation cache, contributions |
| Persistence | `packages/store` | Memory + Postgres backends behind one interface |
| Web app | `apps/web` | Routes, components, i18n dictionaries, API BFF |
| Worker | `apps/worker` | HTTP wrapper around the pipeline |

## Invariants (do not break these)

1. **No fabricated relationships.** Graph edges and story citations must resolve to fetched evidence. Uncited or unresolvable claims are dropped, not displayed.
2. **Deterministic scoring.** Mission pass/fail never depends on model output.
3. **No untrusted code execution.** Validation is static; do not add repo builds to the web/API process.
4. **Consent before writes.** No GitHub mutation without explicit user confirmation; preview-first always.
5. **Offline honesty.** Fixture/mock responses are labeled `offline: true` and disclosed in the UI. Never disguise fallbacks as live inference.
6. **Locales are data.** Add languages by extending dictionaries + `Locale` in contracts; never hardcode bilingual strings in components.
7. **Identifiers stay original.** Paths, SHAs, code terms are never translated.

## Code style

- TypeScript strict, pure ESM; relative imports use `.js` suffixes.
- Packages are consumed as TS source (`main: ./src/index.ts`) — no build steps.
- Comments reference TRD sections where behavior implements a requirement (`// TRD §5.2`).
- Deterministic core logic: no `Math.random()`/`Date.now()` in pure paths.

## Tests & checks

```bash
npm test              # Vitest unit tests per workspace
npm run typecheck     # web + worker
npm run build         # production build of apps/web
```

Add tests next to source (`src/*.test.ts`) for any pure logic you touch: URL parsing, milestone selection, graph deltas, citation filtering, rubric rules, i18n invariants.

## Pull requests

- Keep changes scoped to one package/concern where possible.
- Update docs when changing architecture, privacy behavior, env vars, or setup.
- UI changes: verify keyboard-only operation, 320px width, reduced motion, and EN/ES parity.
- Run `npm test`, `npm run typecheck`, and `npm run build` before submitting.
