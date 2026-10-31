# Privacy & data handling

TRD §7 governs this file. Processors, exact payloads, retention, and consent
are listed below — no aspirational prose.

## What we collect and process

| Data | Where it lives | Retention |
| --- | --- | --- |
| Public GitHub repository facts (commits ≤30, trees ≤300 entries/milestone, files ≤40 × ≤48 kB, diffs) | Store (memory or Postgres JSONB) | Derived metadata kept until re-analysis; raw source excerpts are bounded inputs only |
| Bounded source excerpts sent to models | Memory of the provider call; provider-side logging subject to the provider's policy | TTL-able (TRD §7); prompts are cache-keyed by SHA+locale+level so repeats don't re-send |
| Analysis jobs, snapshots, milestones | Store | Indefinite (derived, public data, no PII) |
| Learner progress | Store (`learner_progress`) | Opaque `userOrAnonymousId` only — no accounts, emails, or IPs in this record (FR-12) |
| Contributions | Store (`contributions`) | Edited files + consent timestamp; kept as audit evidence of consent |
| Analytics | Consent-aware aggregates (planned, TRD §4.1) | **Never source contents**; no code text, no diffs in logs |

## Model prompts: exactly what leaves the process

`packages/ai` prompts receive (TRD §5.1):

1. `historyNarrationPrompt`: repository name, 3–5 milestone payloads
   (SHA, title, changeKind, changed file paths, up to 5 patch excerpts
   truncated at 400 chars each), README excerpt (≤4 kB), target locale.
2. `nodeExplanationPrompt`: node id, one file path, file excerpt (≤6 kB),
   import specifiers, importer paths, locale/level.

Hard rules, enforced in code:

- Bounded excerpts only — no full-file dumps, no unlisted files, no commit
  bodies beyond subjects.
- **Never** in prompts: GitHub tokens, OAuth scopes, `DATABASE_URL`,
  cookies, environment variables, or anything from the local disk outside
  the fetched repository facts (TRD §5.2).
- Repository text, issues, and READMEs are treated as **hostile input** —
  wrapped as data, never instructions, with JSON-schema validation and
  allowlisted citations on output (TRD §5.2).
- Code is never modified by models; node explanations are descriptive only
  (TRD §5.1 guardrail).

## Processors

| Processor | Purpose | When active |
| --- | --- | --- |
| GitHub REST API | Read public repo facts | Always (unless curated fixture used) |
| Google Gemini API (hosted Gemma) | History narration, node explanations, hints | Only when `GEMINI_API_KEY` is configured |
| Local Gemma adapter | Same, self-hosted | Only when `GEMMA_LOCAL_ADAPTER_URL` is configured |
| Offline mock provider | Clearly labeled fallback stories/explanations | Always available; no network |

No other outbound processors exist in v1. GitHub **write** calls happen only
in the contribution flow, only when `GITHUB_WRITE_TOKEN` is explicitly set —
the shipped apps do not set it by default.

## Secrets handling

- All tokens are read server-side (`apps/worker/src/env.ts`) and are never
  sent to the browser, never logged, never echoed in error responses
  (worker error mapper returns sanitized messages).
- Model results that fail zod validation or citation cross-checks are
  dropped; they silently degrade to the labeled offline fallback.

## Deletion workflow & consent

- Because only public GitHub data + opaque progress ids are stored, a user
  can exercise deletion of *their* pace records by deleting the
  `learner_progress`/`contributions` rows tied to their opaque id (a CLI
  endpoint ships with v1.5 cohort dashboards, TRD §14).
- Data of record is reproducible: re-running analysis rebuilds everything
  from GitHub; wiping the store (`docker compose down -v`) erases all state.
- Public-repo analysis requires no consent in v1 (public data, public
  repos only — TRD §14). Private-repo access is a P3 decision requiring a
  privacy review before any code ships.
- Contribution submission stores `consentAt` **before** any GitHub write is
  attempted; the frontend must show branch, files, destination, diff, and
  destination confirmation first (TRD §6.1, FR-10).
