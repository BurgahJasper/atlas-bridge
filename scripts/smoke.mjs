#!/usr/bin/env node
// End-to-end smoke test for a RUNNING Atlas Bridge server (TRD §9.1 E2E).
// Usage: npm run smoke            (ATLAS_URL overrides http://localhost:3000)
// Checks output properties, not just HTTP status: basis policy invariants,
// real mission answers, evidence on every claim, and the golden path pages.

const BASE = process.env.ATLAS_URL ?? 'http://localhost:3000';
const REPO_URL = process.env.ATLAS_SMOKE_REPO ?? 'https://github.com/octokit/request.js';
const SLUG = REPO_URL.replace('https://github.com/', '').replace('/', '__');

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function page(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return res.status;
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });

async function main() {
  // 1) Analysis completes (no stuck stages, TRD §8).
  const started = await post('/api/repos/analyze', { url: REPO_URL, locale: 'en' });
  // Web BFF answers 200, worker answers 202: both mean the job was queued.
  const accepted = started.status === 200 || started.status === 202;
  record('analyze accepted', accepted && !!started.body?.jobId, `HTTP ${started.status}`);
  if (!accepted) return finish();

  let job = null;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    job = (await api(`/api/jobs/${started.body.jobId}`)).body;
    if (job?.status === 'done' || job?.status === 'error') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  record('analysis reaches done', job?.status === 'done', job?.error ?? `stage=${job?.stage}`);
  if (job?.status !== 'done') return finish();

  // 2) Overview: real milestones, explicit scope.
  const overview = (await api(`/api/repos/${SLUG}/overview`)).body;
  const repoId = overview?.repository?.id;
  record('overview has ≥3 milestones', (overview?.milestones?.length ?? 0) >= 3, `${overview?.milestones?.length}`);
  record('overview states analysis scope', /bounded/.test(overview?.coverage ?? ''));
  const head = overview.milestones.at(-1).sha;

  // 3) Graph: structure present and linked to real imports.
  const graph = (await api(`/api/snapshots/${head}/graph?repositoryId=${encodeURIComponent(repoId)}`)).body;
  const imports = (graph?.edges ?? []).filter((e) => e.kind === 'import');
  record('head graph has file nodes', (graph?.nodes ?? []).length > 0, `${graph?.nodes?.length} nodes`);
  record('import edges carry evidence', imports.every((e) => e.evidenceRef?.sha), `${imports.length} imports`);

  // 4) Stories: EN + ES, with the basis policy invariants (TRD §5.2–5.3).
  for (const locale of ['en', 'es']) {
    const res = await post('/api/explanations', {
      repositoryId: repoId,
      snapshotSha: head,
      subject: 'timeline',
      task: 'history',
      locale,
      level: 'beginner',
    });
    const story = res.body?.story;
    record(`${locale} story generated`, res.status === 200 && !!story?.summary, story?.offline ? 'offline' : 'live');
    const claims = [...(story?.claims ?? []), ...(story?.milestones ?? []).flatMap((m) => m.claims)];
    record(`${locale} every claim cites evidence`, claims.every((c) => c.evidenceRefs?.length > 0), `${claims.length} claims`);
    const explicitOk = claims.filter((c) => c.basis === 'explicit').every((c) => c.evidenceRefs.some((r) => r.sha));
    record(`${locale} explicit claims cite a commit`, explicitOk);
    const inferredHigh = claims.filter((c) => c.basis === 'inferred' && c.confidence === 'high');
    record(`${locale} no inferred claim at high confidence`, inferredHigh.length === 0, `${inferredHigh.length} violations`);
  }

  // 5) Mission grounded in a real change, checked deterministically.
  const missions = (await api(`/api/missions?repositoryId=${encodeURIComponent(repoId)}`)).body?.missions ?? [];
  record('mission generated from a real change', missions.length >= 1, `${missions.length} mission(s)`);
  if (missions.length === 0) return finish();
  const mission = missions[0];
  const kinds = mission.steps.map((s) => s.kind);
  record('mission has ≥3 steps ending in an edit', mission.steps.length >= 3 && kinds.at(-1) === 'edit', kinds.join('→'));

  const submit = (stepId, submission) =>
    post(`/api/missions/${mission.id}/check`, { submission: { stepId, ...submission }, userOrAnonymousId: 'smoke', locale: 'en' });

  const readStep = mission.steps.find((s) => s.kind === 'read');
  record('read step passes', (await submit(readStep.id, {})).body?.passed === true);

  const comp = mission.steps.find((s) => s.kind === 'comprehension');
  const needle = comp.validation.mustInclude[0];
  record('comprehension accepts the real file name', (await submit(comp.id, { answerText: `It changed ${needle} here` })).body?.passed === true);
  record('comprehension rejects an unrelated answer', (await submit(comp.id, { answerText: 'something entirely unrelated' })).body?.passed === false);

  const quiz = mission.steps.find((s) => s.kind === 'quiz');
  if (quiz) {
    record('quiz offers multiple real choices', (quiz.options ?? []).length >= 3, `${quiz.options?.length} options`);
    record('quiz accepts the correct file', (await submit(quiz.id, { quizAnswer: quiz.validation.oneOf[0] })).body?.passed === true);
    record('quiz rejects a wrong file', (await submit(quiz.id, { quizAnswer: 'not-a-real-file.txt' })).body?.passed === false);
  }

  // 6) Practice edit + consent-gated preview (FR-07, FR-10).
  const edit = mission.steps.find((s) => s.kind === 'edit');
  const shortSha = edit.validation.regex;
  const preview = await post('/api/contributions/preview', {
    missionId: mission.id,
    repositoryId: repoId,
    files: [{ path: 'README.md', content: `# notes\n\nLearned from commit ${shortSha}.\n` }],
  });
  record('contribution preview computes a diff', preview.status === 200 && preview.body?.diff?.length > 0);
  record('contribution requires OAuth to create a PR', preview.body?.requiresOAuth === true);
  const submitted = await post('/api/contributions/submit', {
    missionId: mission.id,
    repositoryId: repoId,
    files: [{ path: 'README.md', content: 'x' }],
    confirmed: true,
  });
  record('submit without OAuth stays preview-only', submitted.body?.status === 'reviewed', submitted.body?.status);

  // 7) Hints never auto-submit and always return text (FR-11).
  const hint = await post('/api/hints', { repositoryId: repoId, missionId: mission.id, stepId: readStep.id, hintLevel: 1, locale: 'es' });
  record('hint returned in Spanish', hint.status === 200 && (hint.body?.text ?? '').length > 0);

  // 8) Golden-path pages render (TRD §2.2 IA).
  for (const path of ['/', `/explore/${SLUG}`, `/explore/${SLUG}/history`, `/explore/${SLUG}/learn`, `/explore/${SLUG}/contribute`, '/settings']) {
    record(`page ${path}`, (await page(path)) === 200);
  }

  return finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed against ${BASE}`);
  process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}

main().catch((error) => {
  record('smoke run completed', false, error instanceof Error ? error.message : String(error));
  finish();
});
