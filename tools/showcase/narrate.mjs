import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const outDir = resolve('showcase');
const audioDir = join(outDir, 'audio');
mkdirSync(audioDir, { recursive: true });

const segments = [
  { id: '01', delayMs: 500, text: 'Welcome to Atlas Bridge. Understand how an open-source project evolved, in your own language, with every claim linked to real evidence.' },
  { id: '02', delayMs: 4000, text: 'The interface starts in Spanish. Every single screen is fully localized, not just the headers.' },
  { id: '03', delayMs: 8500, text: 'Overview: verified repository owner, license, default branch, and bounded analysis scope.' },
  { id: '04', delayMs: 13000, text: 'Time Travel: each stop on the timeline is a real commit. The graph maps files and real import edges.' },
  { id: '05', delayMs: 18800, text: 'Accessible keyboard navigation scrubs milestones, updating before and after change diffs in real time.' },
  { id: '06', delayMs: 24800, text: 'Select any file: inspect its imports, and read an architecture explanation citing the exact file.' },
  { id: '07', delayMs: 30500, text: 'Switching to English preserves the active milestone and context. Code, paths, and SHAs are never translated.' },
  { id: '08', delayMs: 35500, text: 'Every claim shows provenance: explicit claims match commit messages, while inferred claims are never high confidence.' },
  { id: '09', delayMs: 41000, text: 'Learning trail: milestone lessons with interactive checkpoints, verified directly against the commit.' },
  { id: '10', delayMs: 45500, text: 'Contribute: missions come from real changes in this repository, not generic questions.' },
  { id: '11', delayMs: 48500, text: 'Step one, read: inspect the milestone and skim its changed files.' },
  { id: '12', delayMs: 52000, text: 'Step two, comprehension: name a file that changed. The check deterministically validates it.' },
  { id: '13', delayMs: 56000, text: 'Step three, quiz: identify which file in the tree was modified in this milestone.' },
  { id: '14', delayMs: 60500, text: 'Step four, practice edit: add a note citing the commit into the real file content at this revision.' },
  { id: '15', delayMs: 65500, text: 'Deterministic validation by code, not by an AI model. The mission is complete.' },
  { id: '16', delayMs: 70000, text: 'Preview: see the exact branch, destination, scope, and diff before anything is submitted.' },
  { id: '17', delayMs: 74200, text: 'Explicit consent is required. Without GitHub authorization, it is recorded as a preview only.' },
  { id: '18', delayMs: 78500, text: 'The application states the outcome plainly: no pull request was created. That is deliberate.' },
  { id: '19', delayMs: 83800, text: 'Settings honestly display the model source: hosted Gemma 4, or labeled offline fallback.' },
  { id: '20', delayMs: 89300, text: 'Atlas Bridge is open source under MIT. Run it locally with npm install and npm start.' },
];

console.log('Synthesizing speech clips...');
for (const seg of segments) {
  const wavPath = join(audioDir, `seg_${seg.id}.wav`);
  const psScript = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop')
$s.Rate = 1
$s.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}')
$s.Speak('${seg.text.replace(/'/g, "''")}')
$s.Dispose()
`;
  const psFile = join(audioDir, `gen_${seg.id}.ps1`);
  writeFileSync(psFile, psScript, 'utf8');
  execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psFile], { stdio: 'ignore' });
  console.log(`Generated clip ${seg.id} -> ${wavPath}`);
}

console.log('Building mixed audio track with ffmpeg...');
const inputArgs = [];
const filterParts = [];
segments.forEach((seg, idx) => {
  const wavPath = join(audioDir, `seg_${seg.id}.wav`);
  inputArgs.push('-i', wavPath);
  filterParts.push(`[${idx}:a]adelay=${seg.delayMs}|${seg.delayMs}[a${idx}]`);
});

const amixInputs = segments.map((_, idx) => `[a${idx}]`).join('');
const fullFilter = `${filterParts.join(';')};${amixInputs}amix=inputs=${segments.length}:dropout_transition=0:normalize=0[aout]`;

const fullAudio = join(audioDir, 'full_narration.wav');
execFileSync(ffmpegPath, [
  '-y',
  ...inputArgs,
  '-filter_complex', fullFilter,
  '-map', '[aout]',
  '-c:a', 'pcm_s16le',
  fullAudio
], { stdio: 'inherit' });
console.log('Full narration audio generated:', fullAudio);

console.log('Muxing video with narrated audio...');
const inputVideo = join(outDir, 'atlas-bridge-showcase.mp4');
const outputVideo = join(outDir, 'atlas-bridge-showcase-narrated.mp4');

execFileSync(ffmpegPath, [
  '-y',
  '-i', inputVideo,
  '-i', fullAudio,
  '-c:v', 'copy',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-shortest',
  outputVideo
], { stdio: 'inherit' });

console.log('Narrated video created successfully:');
console.log(outputVideo);
