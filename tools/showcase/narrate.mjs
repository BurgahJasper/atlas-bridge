// Generates a narrated video from the existing showcase frames and video.
// Produces sequential (non-overlapping) voiceover clips with silence padding
// to match each frame's actual timestamp in the video.
//
// Usage: node tools/showcase/narrate.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const outDir = resolve('showcase');
const audioDir = join(outDir, 'audio');
rmSync(audioDir, { recursive: true, force: true });
mkdirSync(audioDir, { recursive: true });

// ── Narration segments ──────────────────────────────────────────────────────
// Each segment maps to one screenshot frame (01.png–20.png).
// The text is spoken ONCE per frame; there is NO overlap.
const segments = [
  { id: '01', text: 'Welcome to Atlas Bridge. It turns unfamiliar open-source repositories into visual stories that teach how the software evolved, and guide you toward your first real contribution.' },
  { id: '02', text: 'The interface starts in English. Every screen is fully localized, including Spanish, not just the headings.' },
  { id: '03', text: 'Overview page. The real owner, license, default branch, and the bounded analysis scope are stated up front.' },
  { id: '04', text: 'Time Travel. Each stop on the timeline is a real Git commit. The graph maps files and their actual import edges.' },
  { id: '05', text: 'Keyboard navigation scrubs between milestones. The before and after labels update with each step.' },
  { id: '06', text: 'Click any file. Its real imports and importers appear, with architecture explanation citing the source.' },
  { id: '07', text: 'Switching languages preserves the same milestone and selection. Code paths and commit hashes are never translated.' },
  { id: '08', text: 'Every claim shows provenance. Explicit means the commit message says it. Inferred means derived from the diff, and is never marked high confidence.' },
  { id: '09', text: 'Learning trail. One lesson per milestone with interactive checkpoints verified against the commit.' },
  { id: '10', text: 'Contribute. Missions come from real changes in this repository, not generic questions.' },
  { id: '11', text: 'Step one, read. Open the milestone and skim its changed files.' },
  { id: '12', text: 'Step two, comprehension. Name a file that changed. Validation is deterministic.' },
  { id: '13', text: 'Step three, quiz. Identify which file was modified in this milestone.' },
  { id: '14', text: 'Step four, practice edit. Add a note citing the commit into the real file content.' },
  { id: '15', text: 'Validated by code, not by a model. The mission is complete.' },
  { id: '16', text: 'PR Preview. See the exact branch, destination, scope, and diff before anything is submitted.' },
  { id: '17', text: 'Explicit consent is required. Without GitHub authorization, it stays a preview.' },
  { id: '18', text: 'The app states it plainly. No pull request was created. That is deliberate.' },
  { id: '19', text: 'Settings display the model source honestly. Hosted Gemma four, or labeled offline fallback.' },
  { id: '20', text: 'Atlas Bridge is open source under MIT. Run it locally with npm install and npm start.' },
];

// ── Calculate real frame timestamps from file mtimes ─────────────────────────
const framesDir = join(outDir, 'frames');
const frameFiles = readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
const frameTimes = frameFiles.map(f => statSync(join(framesDir, f)).mtimeMs);
const t0 = frameTimes[0];
const frameOffsets = frameTimes.map(t => (t - t0) / 1000); // seconds from start

console.log('Frame offsets (seconds):');
frameOffsets.forEach((t, i) => console.log(`  ${frameFiles[i]}: ${t.toFixed(2)}s`));

// ── Synthesize individual speech clips ───────────────────────────────────────
console.log('\nSynthesizing speech clips...');
const clipDurations = [];

for (const seg of segments) {
  const wavPath = join(audioDir, `seg_${seg.id}.wav`);
  const psScript = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft Zira Desktop')",
    '$s.Rate = 1',
    `$s.SetOutputToWaveFile('${wavPath.replace(/\\/g, '\\\\')}')`,
    `$s.Speak('${seg.text.replace(/'/g, "''")}')`,
    '$s.Dispose()',
  ].join('\n');
  const psFile = join(audioDir, `gen_${seg.id}.ps1`);
  writeFileSync(psFile, psScript, 'utf8');
  execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psFile], { stdio: 'ignore' });

  // Probe the clip duration with ffmpeg
  try {
    const probe = execFileSync(ffmpegPath, ['-i', wavPath, '-f', 'null', '-'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    // ffmpeg writes to stderr on probe; parse it
    const stderr = e.stderr || '';
    const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (m) {
      const dur = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      clipDurations.push(dur);
      console.log(`  ${seg.id}: ${dur.toFixed(2)}s  "${seg.text.slice(0, 50)}..."`);
    } else {
      clipDurations.push(4.0); // fallback
      console.log(`  ${seg.id}: ~4.00s (probe fallback)`);
    }
  }
}

// ── Build a sequential audio track with silence padding ──────────────────────
// Strategy: for each segment, prepend silence so the clip starts at the frame's
// timestamp, then concatenate ALL padded clips sequentially.
// This guarantees ZERO overlap.
console.log('\nBuilding sequential audio track...');

const paddedClips = [];
let cursor = 0; // current time position in seconds

for (let i = 0; i < segments.length; i++) {
  const targetStart = frameOffsets[i] || cursor;
  const silenceNeeded = Math.max(0, targetStart - cursor);
  const clipDur = clipDurations[i];
  const wavPath = join(audioDir, `seg_${segments[i].id}.wav`);
  const paddedPath = join(audioDir, `padded_${segments[i].id}.wav`);

  if (silenceNeeded > 0.05) {
    // Prepend silence then append the clip
    execFileSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', `anullsrc=r=22050:cl=mono`,
      '-i', wavPath,
      '-filter_complex', `[0:a]atrim=0:${silenceNeeded.toFixed(3)},asetpts=PTS-STARTPTS[s];[s][1:a]concat=n=2:v=0:a=1[out]`,
      '-map', '[out]',
      '-c:a', 'pcm_s16le',
      paddedPath,
    ], { stdio: 'ignore' });
  } else {
    // No silence needed; just copy
    execFileSync(ffmpegPath, ['-y', '-i', wavPath, '-c:a', 'pcm_s16le', paddedPath], { stdio: 'ignore' });
  }

  paddedClips.push(paddedPath);
  cursor = targetStart + clipDur;
  console.log(`  ${segments[i].id}: starts at ${targetStart.toFixed(2)}s, ends at ${cursor.toFixed(2)}s`);
}

// Concatenate all padded clips
const concatListPath = join(audioDir, 'concat.txt');
writeFileSync(concatListPath,
  paddedClips.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
  'utf8',
);

const fullAudio = join(audioDir, 'full_narration.wav');
execFileSync(ffmpegPath, [
  '-y',
  '-f', 'concat', '-safe', '0',
  '-i', concatListPath,
  '-c:a', 'pcm_s16le',
  fullAudio,
], { stdio: 'inherit' });

console.log('\nFull narration audio:', fullAudio);

// ── Mux video + narrated audio ──────────────────────────────────────────────
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
  outputVideo,
], { stdio: 'inherit' });

console.log('\n✅ Narrated video created:', outputVideo);

// Clean up intermediate audio files (keep the final .mp4)
rmSync(audioDir, { recursive: true, force: true });
console.log('Cleaned up audio intermediates.');
