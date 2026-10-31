// Records a narrated-by-caption walkthrough of the running app (docs/demo-script.md).
// Usage: npm run showcase   (needs the app running; ATLAS_URL overrides the address)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(root, 'showcase');
const framesDir = join(outDir, 'frames');
const BASE = process.env.ATLAS_URL ?? 'http://localhost:3000';
const SLUG = 'octokit__request.js';
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(join(outDir, 'raw'), { recursive: true });

// Real data for the walkthrough: the same mission the learner will see.
async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}
const overview = await getJson(`/api/repos/${SLUG}/overview`);
const repoId = overview.repository.id;
const { missions } = await getJson(`/api/missions?repositoryId=${encodeURIComponent(repoId)}`);
const mission = missions[0];
if (!mission) throw new Error('no mission available: run an analysis of the curated repo first');
const comp = mission.steps.find((s) => s.kind === 'comprehension');
const quiz = mission.steps.find((s) => s.kind === 'quiz');
const edit = mission.steps.find((s) => s.kind === 'edit');
const needle = comp.validation.mustInclude[0];
const shortSha = edit.validation.regex;

const CURSOR_SCRIPT = `(() => {
  const add = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: '22px', height: '22px',
      marginLeft: '-11px', marginTop: '-11px', borderRadius: '50%', border: '3px solid #0E7490',
      background: 'rgba(14,116,144,0.25)', pointerEvents: 'none', zIndex: '2147483646',
      transition: 'transform 90ms linear' });
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { c.style.transform = 'scale(0.7)'; }, true);
    document.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: join(outDir, 'raw'), size: { width: 1280, height: 720 } },
  locale: 'en-US',
});
await context.addCookies([{ name: 'ab-locale', value: 'es', url: BASE }]);
await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
let frame = 0;

async function caption(text, ms = 3800) {
  await page.evaluate((message) => {
    let el = document.getElementById('__showcase_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__showcase_caption';
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
        maxWidth: '940px', width: 'calc(100% - 64px)', padding: '14px 22px', borderRadius: '14px',
        background: 'rgba(15,20,32,0.9)', color: '#fff', font: '600 20px/1.4 system-ui, sans-serif',
        textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.35)', pointerEvents: 'none',
        zIndex: '2147483647',
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = message;
  }, text);
  await page.waitForTimeout(ms);
  frame += 1;
  await page.screenshot({ path: join(framesDir, `${String(frame).padStart(2, '0')}.png`) });
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
    await page.screenshot({ path: join(framesDir, `error-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
  }
}

const pause = (ms) => page.waitForTimeout(ms);

await step('intro', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await caption('Atlas Bridge: understand how an open-source project evolved, in your own language, with every claim linked to real evidence.', 5000);
  await caption('The interface starts in Spanish. Every screen is localized, not just the headings.');
});

await step('overview', async () => {
  await page.goto(`${BASE}/explore/${SLUG}`, { waitUntil: 'networkidle' });
  await caption('Overview: the real owner, license, default branch, and the analysis scope. Limits are stated up front.');
});

await step('history-scrub', async () => {
  await page.goto(`${BASE}/explore/${SLUG}/history`, { waitUntil: 'networkidle' });
  await page.locator('#milestone-range').waitFor({ timeout: 60000 });
  await caption('Time travel: each stop on the timeline is a real commit. The graph shows the files and import edges at that commit.');
  await page.locator('#milestone-range').focus();
  await page.keyboard.press('ArrowRight');
  await pause(1500);
  await page.keyboard.press('ArrowRight');
  await caption('Keyboard-operable: arrow keys move through the milestones. The before and after labels update with each stop.', 4200);
});

await step('node-inspector', async () => {
  await page.getByRole('button', { name: /lista de nodos|node list/i }).first().click();
  await pause(800);
  await page.locator('ul[aria-label] button').nth(2).click();
  await pause(1200);
  await caption('Select a file: its real imports and importers appear, and the architecture explanation cites the file itself.');
});

await step('language-switch', async () => {
  await page.locator('[role="group"] button').filter({ hasText: 'EN' }).first().click();
  await pause(1200);
  await caption('Switching to English keeps the same milestone and the same selection. Code, paths and SHAs are never translated.', 4500);
});

await step('evidence', async () => {
  await page.locator('aside[aria-label]').first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
  await caption('Each claim shows its basis and confidence. Explicit means the commit message says it. Inferred means derived from the diff, never high confidence.', 5000);
});

await step('learn', async () => {
  await page.goto(`${BASE}/explore/${SLUG}/learn`, { waitUntil: 'networkidle' });
  await caption('Learning trail: one lesson per milestone. The checkpoint asks which statement is explicitly documented, and the answer is checked against the commit.', 5000);
});

await step('contribute-mission', async () => {
  await page.goto(`${BASE}/explore/${SLUG}/contribute`, { waitUntil: 'networkidle' });
  await caption('Contribute: missions come from a real change in this repository, not generic questions.');
  await page.getByRole('button', { name: /Start mission|Comenzar misi/ }).first().click();
  await page.getByRole('heading', { name: mission.title }).waitFor({ timeout: 30000 });
  await caption('Step 1, read: open the milestone and skim its changed files.', 3000);
  await page.getByRole('button', { name: /I read this step/ }).click();
  await page.getByText('Validated ✓').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Go to next step/ }).click();
});

await step('contribute-comprehension', async () => {
  await caption('Step 2, comprehension: name a file that really changed. The check looks for that file, not for a phrase.', 3500);
  await page.fill('#answer-text', `I think ${needle} changed in this milestone.`);
  await page.getByRole('button', { name: /Submit answer|Enviar/ }).click();
  await page.getByText('Validated ✓').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Go to next step/ }).click();
});

await step('contribute-quiz', async () => {
  await caption('Step 3, quiz: the choices are real files from the same tree. Only one of them changed in this milestone.', 3800);
  await page.getByLabel(quiz.validation.oneOf[0], { exact: true }).check();
  await page.getByRole('button', { name: /Submit answer|Enviar/ }).click();
  await page.getByText('Validated ✓').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Go to next step/ }).click();
});

await step('contribute-edit', async () => {
  await page.waitForFunction(() => (document.getElementById('file-editor')?.value ?? '').length > 0, null, { timeout: 30000 });
  await caption('Step 4, practice edit: add a note to README.md that cites the commit. The file is the real content at that revision.', 4200);
  await page.click('#file-editor');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n\nLearned from commit ${shortSha} in this milestone.`, { delay: 25 });
  await page.getByRole('button', { name: /Submit answer|Enviar/ }).click();
  await page.getByText(/Mission validated/).waitFor({ timeout: 20000 });
  await caption('Validated by code, not by a model. The mission is complete.', 3500);
});

await step('preview-consent', async () => {
  await page.getByRole('button', { name: /Prepare PR preview|Preparar vista previa/ }).click();
  await page.getByText(/Contribution preview|Vista previa/).first().waitFor({ timeout: 20000 });
  await caption('Preview: the exact branch, destination, scope and diff. Nothing is sent until you approve.', 4500);
  await page.getByLabel(/I reviewed and approve this contribution|Revisé y apruebo/).check();
  await caption('Explicit consent is required. Without GitHub authorization, the result is recorded as a preview only.', 4000);
  await page.getByRole('button', { name: /Submit contribution|Enviar contribuci/ }).click();
  await page.getByText(/No pull request was created/).waitFor({ timeout: 20000 });
  await caption('The app states the outcome plainly: no pull request was created. That is deliberate.', 4000);
});

await step('settings', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await caption('Settings show the model source honestly: hosted Gemma, or the labeled offline fallback. Reduced motion is respected.', 5000);
});

await step('end-card', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await caption('Open source under MIT. Run it locally with npm install, npm run start, and npm run smoke.', 5000);
});

const video = page.video();
await context.close();
await browser.close();
const rawPath = await video.path();
const webm = join(outDir, 'atlas-bridge-showcase.webm');
if (existsSync(webm)) rmSync(webm);
renameSync(rawPath, webm);
rmSync(join(outDir, 'raw'), { recursive: true, force: true });

if (ffmpegPath && existsSync(ffmpegPath)) {
  const mp4 = join(outDir, 'atlas-bridge-showcase.mp4');
  execFileSync(ffmpegPath, ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
  console.log(`MP4: ${mp4}`);
}
console.log(`WebM: ${webm}`);
console.log(`Frames: ${framesDir} (${frame} captions)`);
