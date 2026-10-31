# Evaluation

This document separates what has been measured from what has not. It follows TRD §9.

## Measured so far (automated)

| Check | Result | How to reproduce |
|---|---|---|
| Unit and integration tests | 146 passing across 8 workspaces | `npm test` |
| Typecheck (web + worker) | clean | `npm run typecheck` |
| Production build | compiles | `npm run build` |
| Live end-to-end golden path | 32 of 32 checks, including live Gemma EN and ES | `npm run start`, then `npm run smoke` |
| Durability across restart | analysis, graph and mission survive a server restart | restart the server and open `/explore/octokit__request.js` |
| Basis policy | `explicit` requires overlap with the cited commit's own message; inferred claims are never high confidence | `packages/ai/src/basis.test.ts` and the smoke invariants |

Automated checks verify properties of the output (citations exist, labels follow the policy, mission answers are real). They do not verify that the explanations are accurate or useful to a learner.

## Not measured yet (required by TRD §9.2)

No human participants have been studied. The following claims are unproven until a study runs:

- Novices understand the project's purpose faster (TRD §2.5, 30-second test).
- Learners finish a validated mission.
- Learners answer "what changed and why do we think so?" correctly after using the app.
- Spanish-speaking learners complete the same tasks as English-speaking ones.

## Study protocol

**Participants:** at least 5 novice contributors, including at least 2 who prefer Spanish. Obtain consent. Do not collect personal data beyond an anonymous session id.

**Tasks** (on the curated repository, timed):

1. Explain in one sentence what the project does (30-second purpose test).
2. Find the milestone where a named file changed, using the timeline.
3. Complete the mission: read, comprehension, quiz, practice edit.
4. Open the cited evidence for one story claim and say whether it is explicit or inferred.

**Measures:** task completion; time to first validated mission; comprehension ("what changed, and why do we think so?") scored against the evidence; confidence before and after; count of unsuccessful attempts (record these; do not drop them).

**Reporting:** publish raw counts and the protocol, including failures. Do not report averages alone for groups of 5.

## Known limits

- Analysis covers a bounded window: at most 30 commits, 5 milestones, 80 file reads, and 2 minutes. Large repositories are partial by design, and the UI says so.
- Explanations are generated from commit subjects, truncated diffs and a few files. They are shallow compared with reading the code.
- The architecture view is a file and folder structure plus import edges for JS, TS and Python. Repositories without imports show a warning instead of an invented map.
- Gemma output varies between runs. The smoke test checks structure, not wording.
