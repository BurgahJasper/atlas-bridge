# Demo script (3 minutes)

Source: TRD §11. Use the curated repository (`octokit/request.js`) for the live path. It is pinned to real commit SHAs and has a labeled offline fallback.

## Before you go on stage

1. `npm run build && npm run start`, then `npm run smoke`. Every check should pass.
2. Open http://localhost:3000 and confirm **Settings → Model source** says *hosted*. If it says offline, say so out loud and use the offline path.
3. Open `/explore/octokit__request.js/history` once so the analysis is loaded before the audience arrives.

## Run of show

| Time | Action | What to say |
|---|---|---|
| 0:00 | Home page. Choose **Español**. | "Atlas Bridge explains how an open-source project evolved, in your language, with every claim linked to a real commit." |
| 0:20 | Open the curated repo → **Time travel**. Scrub from the first milestone to the last. | "Each stop is a real commit SHA. The graph shows files and their real import edges, not a drawing." |
| 1:00 | Click a changed file in the insight panel. Show the commit link and the file link. | "This is the exact commit and file behind the sentence. Nothing here is invented: unresolvable citations are dropped before display." |
| 1:20 | Point at a claim's badge: *explicit* or *inferred*. | "Explicit means the commit message says it. Inferred means we derived it from the diff, and we never claim high confidence for an inference." |
| 1:40 | Switch the language to English. The selected milestone stays selected. | "Switching language keeps the same commit and lesson. Code, paths and SHAs are never translated." |
| 2:00 | Open **Contribute**. Do the read step, the comprehension answer and the quiz. | "The mission is built from a real change in this repo. Scoring is deterministic: the model never grades the learner." |
| 2:30 | Show the practice edit and the **PR preview**. Show the consent checkbox. | "Nothing is pushed without explicit approval. Without a GitHub authorization, it stays a preview. That is deliberate." |
| 2:50 | Close on **Settings** (model source) and the README. | "Open source under MIT. The setup is one command, and the test suite runs offline." |

## If something breaks

- **A live story is slow or unavailable:** the app falls back to a stored offline story. It is labeled offline in the UI. Say that it's the fallback, then keep going.
- **GitHub rate limits:** the analysis finishes with a visible *rate-limited* warning. Use the curated repo, which is pinned to fixed SHAs.
- **Never** present a recording or an offline story as live inference. The TRD forbids it, and judges can check the labels.

## What to claim (and not claim)

- **Claim:** bounded, evidence-linked history for public JS/TS/Python repositories, with a deterministic mission engine and bilingual explanations.
- **Do not claim:** that it understands any repository's architecture, that learners improve (no study has run yet), or that contributions are created automatically.
