# Deployment

Node 20+ (worker and pipeline). The web app deploys like any Next.js app;
the analysis worker deploys as a long-running Node process with Postgres.

## Environment variables

Names match `.env.example` (root) and `apps/worker/src/env.ts` exactly:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4600` | Worker HTTP port |
| `GEMINI_API_KEY` | — | Hosted Gemma via Gemini API; if unset → labeled offline fallback provider |
| `GEMMA_MODEL_ID` | `gemma-4-26b-a4b-it` | Hosted Gemma id (`gemma-4-31b-it` optional for heavier reasoning) |
| `GEMMA_LOCAL_ADAPTER_URL` | — | Self-hosted adapter; set to prefer local inference |
| `GITHUB_TOKEN` | — | Optional; public repos work unauthenticated (rate limits apply, TRD §8) |
| `DATABASE_URL` | — | Postgres connection (init via `infra/docker-compose.yml`); unset → in-memory store |
| `REDIS_URL` | — | Reserved for v1.5 distributed queue (not read yet) |
| `ANALYSIS_MODE` | `embedded` | `embedded` = web runs analysis in-process; `worker` = delegate to `WORKER_URL` (read by apps/web) |
| `WORKER_URL` | `http://localhost:4600` | Worker base URL for `ANALYSIS_MODE=worker` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public web origin (also the worker CORS allowlist origin) |
| `FIXTURE_FIRST` | `true` | Worker resolves the curated fixture before live GitHub (fixture wins **only** for URLs matching the fixture repo) |
| `GITHUB_WRITE_TOKEN` | — | **Unset by default.** Enables the PR-creation write path (TRD §7 consent gating) |

Secrets never appear in logs or responses (see `docs/privacy.md`).

## Local development

```bash
npm install            # workspaces install (root)
npm run dev:worker     # worker API  → http://localhost:4600
npm run dev:web       # web app     → http://localhost:3000
npm run seed           # regenerates the curated fixture at
                       # packages/pipeline/src/fixtures/octokit-request-js.json
```

Typecheck and tests:

```bash
npm run typecheck
npm test               # vitest, all workspaces with a test script
```

## Verification at deploy (TRD §5)

1. **Model availability**: confirm the hosted Gemma id exists and is enabled
   at your quota — check the Gemini API model list for `gemma-4-26b-a4b-it`
   (and `gemma-4-31b-it` if used). Setting `GEMMA_MODEL_ID` to a
   non-provisioned id silently flips the pipeline into offline fallback —
   make sure that shows up in a smoke test, not in a demo.
2. **Rehearse live inference at least once** (TRD §11): run an analysis with
   a key present; the story must come back with `offline: false`.
3. **Database**: `psql` schema applied (or container auto-init), then
   `DATABASE_URL=... npm run dev:worker` and confirm `GET /healthz` →
   `{"ok": true}`.
4. **Fixture path**: with no `GEMINI_API_KEY` and `FIXTURE_FIRST=true`, analyze
   the curated repo URL; the story must be explicitly labeled offline
   fallback.

## Hosting

- **apps/web**: deploy as a standard Next.js app (Vercel, Netlify, or
  `next start` on any Node host). No `NEXT_PUBLIC_*` secrets beyond the
  site URL; all AI/GitHub calls run against the worker.
- **apps/worker**: dockless Node process (`npm ci && npm run start`) with
  `DATABASE_URL` pointing at managed Postgres; needs only HTTPS egress to
  `api.github.com` and the model endpoint. Ports: 4600.
- **Queue**: in-process for v1 (each analyze job is per-request in the worker);
  Redis slots in at v1.5 without changing the endpoint surface.

## Demo reliability (TRD §11)

- Pinned SHAs: curated fixture keeps immutable commit SHAs and trees.
- Cached fallback: offline story path is labeled; never shown as live.
- The public sample repo stays ready for live inference re-runs (fixture
  URL == live URL, so demo mode and live mode never diverge).
