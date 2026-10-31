# Atlas Bridge

**[Hackathon presentation](https://docs.google.com/presentation/d/1rFV2M2RUAAWfqWrYR41WCUKn0yRgAQDy60lxbMLdahk/edit)**
**[Live demo](https://atlas-bridge-sand.vercel.app)** · [GitHub source](https://github.com/BurgahJasper/atlas-bridge)

> Understand any open-source codebase in your own language: visual Git-history stories that teach how the software evolved — and guide you toward your first real contribution.

Atlas Bridge turns unfamiliar open-source repositories into **visual, multilingual time-travel stories**. A deterministic engine extracts commits, diffs, and dependency facts; an AI layer (Gemma 4 via the Gemini API, optional) narrates what changed **with citations that always resolve to real evidence**. A guided mission takes a novice from "what is this repo?" to a validated first contribution — in **English or Spanish**.

## Try the interactive demo

**[Launch Atlas Bridge](https://atlas-bridge-sand.vercel.app)** — no installation or local server needed.

1. On the homepage, click **Open curated repository** (the `octokit/request.js` example). This is the recommended path for trying the project.
2. Click **Start here** to explore the **Time travel** timeline. Select milestones and inspect the architecture graph, file changes, and linked GitHub commits.
3. Switch between **EN** and **ES** to try multilingual explanations.
4. Open **Learn** and **Contribute** to test guided missions, comprehension checks, hints, and practice edits.

**Please try the interactive controls!** Click an action **once**, then give it time to finish loading before clicking again. AI-generated explanations can take longer to appear while the model processes the request, especially on the first attempt. Wait for a response or an error message rather than repeatedly submitting the same action.

The curated example uses pinned repository evidence and can fall back to clearly labeled offline explanations. An optional live AI response is not guaranteed for every action. Analyzing arbitrary public GitHub repositories is experimental in the hosted hackathon demo; use the curated example for the most reliable experience.

## Features

- **Time travel** — scrub a keyboard-operable milestone timeline and watch the architecture graph change between real commits. Every milestone maps to an actual SHA.
- **Provenance-backed explanations** — every claim carries evidence references (commit SHA, file, lines), a basis (`explicit` / `inferred`), and a confidence level. Unverifiable citations are stripped, never rendered. A claim is only `explicit` when the cited commit's own message supports it; otherwise it is `inferred`, and inferred claims are never `high` confidence.
- **Real-change missions** — the beginner mission is built from the milestone with the most changed files. The comprehension answer, the quiz choices and the practice-note check all come from fetched data, not generic questions.
- **Durable by default** — analyses, graphs, missions and progress survive a restart (file log, or Postgres when `DATABASE_URL` is set).
- **Multilingual by design** — full EN/ES UI dictionaries, locale-aware lessons, and a domain glossary. Code identifiers, paths, and SHAs are never translated.
- **Guided first contribution** — source-grounded missions (read → comprehension → quiz → practice edit) with **deterministic** validation. No model self-grading.
- **Consent-gated contributions** — PR preview shows branch, destination, scope, and diff; nothing is pushed without explicit user approval. Without OAuth, previews stay previews.
- **Offline-reliable demo** — a curated fixture (`octokit/request.js`, real pinned SHAs) powers the full demo with zero keys and zero network. Offline/mock answers are always clearly labeled.
- **Accessible** — semantic landmarks, skip links, focus rings, `aria-live` progress, an always-available textual node list, reduced-motion support, 44px touch targets.

## Quickstart

Requires **Node.js ≥ 20**. No API keys needed for the demo.

```bash
npm install
npm run dev:web        # http://localhost:3000
```

Open the curated example (`octokit/request.js`) from the home page. The analysis runs against the committed offline fixture — real SHAs, real diffs, clearly labeled offline stories.

To analyze other public repositories, set optional keys (copy `.env.example` to `apps/web/.env.local`):

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Raises GitHub API rate limits for live ingestion |
| `GEMINI_API_KEY` | Enables real Gemma 4 inference (`gemma-4-26b-a4b-it` by default) |
| `GEMMA_MODEL_ID` | Override the hosted model id |
| `GEMMA_LOCAL_ADAPTER_URL` | Use a self-hosted Gemma runtime instead |
| `DATABASE_URL` | Required for reliable Vercel serverless job polling and durable analysis results; local development uses a durable file log |
| `ATLAS_DATA_DIR` | Where the file log lives (default: `.atlas-data/` at the repo root) |
| `ANALYSIS_MODE` | `embedded` (default) or `worker` |
| `WORKER_URL` | Worker base URL when `ANALYSIS_MODE=worker` |

Refresh the curated fixture (requires network):

```bash
npm run seed
```

### Worker + infrastructure (optional)

```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres + Redis
npm run dev:worker                                  # analysis service on :4600
# then set ANALYSIS_MODE=worker and WORKER_URL=http://localhost:4600
```

## Vercel deployment

The public application is available at **https://atlas-bridge-sand.vercel.app**. Configure `GEMINI_API_KEY` for hosted Gemma explanations and optional read-only `GITHUB_TOKEN` to raise GitHub API limits. For reliable arbitrary-repository analysis on Vercel, configure `DATABASE_URL` for shared PostgreSQL storage and run analysis on a durable worker. The local `/tmp` fallback is ephemeral and must not be presented as durable or reliable across serverless requests.

## Architecture

```
Browser ──► Next.js BFF (apps/web) ──► Pipeline (packages/pipeline)
                │                           ├─ GitHub adapter   (packages/github)   bounded, SSRF-guarded
                │                           ├─ Fact graph       (packages/graph)    milestones, imports, deltas
                │                           ├─ AI orchestrator  (packages/ai)       Gemma / offline mock, citations
                │                           ├─ Learning engine  (packages/learning) deterministic rubric scoring
                │                           └─ Store            (packages/store)    memory | Postgres (JSONB)
                └─ Worker mode: same pipeline over HTTP (apps/worker)
```

Monorepo layout (npm workspaces):

```
apps/web/            Next.js app: routes, React Flow graph, i18n, API BFF
apps/worker/         Optional HTTP analysis service (TRD §6.1 endpoints)
packages/contracts/  Shared entities + Zod schemas + Store interface
packages/github/     GitHub read adapter + curated-fixture client
packages/graph/      Milestone selection, import extraction, graph deltas
packages/ai/         Gemma provider, grounded prompts, citation validation
packages/learning/   Deterministic mission/rubric engine
packages/pipeline/   TRD §4.2 analysis algorithm + application services
packages/store/      In-memory + Postgres persistence
infra/               docker-compose, Postgres schema
scripts/             Curated-fixture generator (npm run seed)
docs/                architecture, privacy, deployment, contributing
```

## Security & privacy (summary)

- Public `github.com` repositories only; URL allowlist blocks SSRF-style hosts.
- Bounded ingestion: ≤30 commits, 3–5 milestones, ≤40 files/milestone, ≤48KB/file.
- **No untrusted code execution** — validation is static/deterministic.
- Repository text is treated as hostile input in prompts (data, never instructions).
- No secrets in prompts or logs; OAuth write path requires explicit consent.
- Anonymous progress uses a random UUID cookie — no accounts, no PII.

See [docs/privacy.md](docs/privacy.md) and [docs/architecture.md](docs/architecture.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Start the web app (embedded pipeline) |
| `npm run dev:worker` | Start the optional analysis worker |
| `npm run seed` | Regenerate the curated offline fixture from GitHub |
| `npm test` | Run package unit tests (Vitest) |
| `npm run smoke` | End-to-end checks against a running server (analysis, stories, missions, pages) |
| `npm run typecheck` | Typecheck web + worker |
| `npm run build` | Production build of the web app |

## Roadmap

- **P0 (demo):** curated fixture, graph/timeline, EN/ES explanations, guided mission — implemented.
- **P1 (v1):** arbitrary public-repo ingestion, provenance store, OAuth draft PRs, adaptive levels — implemented except live OAuth PR creation (preview-only unless `GITHUB_WRITE_TOKEN` is configured).
- **P2:** cohort dashboards, maintainer-authored tours, broader locales, offline caching.
- **P3:** private repos with consent, local-first inference, IDE extension.

## License

MIT — see [LICENSE](LICENSE). Generated explanations and translations never alter upstream repository licensing.
