#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../server/export.js';
import { buildSubmission, timestamp } from '../server/submission.js';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/submit.js [--quality vr|compact|original] [--url https://...] [--title "..."] [--out DIR] [--data DIR] [--zip] [--headset-tested]';
const bad = msg => { console.error(`${msg}\n${usage}`); process.exit(2); };
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
const opts = {};
const VALUE = ['--quality', '--url', '--title', '--out', '--data'];
const FLAG = ['--zip', '--headset-tested'];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUE.includes(a)) {
    if (i + 1 >= args.length || (args[i + 1].startsWith('--') && a !== '--title')) bad(`Missing value for ${a}`);
    opts[a.slice(2)] = args[++i];
  } else if (FLAG.includes(a)) opts[a.slice(2)] = true;
  else bad(`Unknown argument: ${a}`);
}
const quality = opts.quality || 'vr';
if (!PRESETS.some(p => p.id === quality)) bad(`Unknown quality "${quality}". Use: ${PRESETS.map(p => p.id).join(', ')}`);
if (opts.url && !/^https?:\/\/\S+$/i.test(opts.url)) bad('--url must start with http:// or https://');

const ac = new AbortController();
process.on('SIGINT', () => { console.error('\nCancelling...'); ac.abort(); });
let last = '';
try {
  const result = await buildSubmission({
    root: path.resolve(opts.data || path.join(repo, 'data')),
    distDir: path.join(repo, 'dist'), repo, quality, url: opts.url, title: opts.title,
    headsetTested: !!opts['headset-tested'], zip: !!opts.zip, signal: ac.signal,
    outDir: path.resolve(opts.out || path.join(repo, 'submissions', `orbit-submission-${timestamp()}`)),
    onProgress: p => { const line = `[${String(p.percent).padStart(3)}%] ${p.step}`; if (line !== last) { last = line; console.log(line); } }
  });
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  console.log(`Done: ${(result.bytes / 1048576).toFixed(1)} MB`);
  console.log(result.outDir);
  if (result.zipPath) console.log(result.zipPath);
  else if (opts.zip) console.warn('No zip was created (see warning above).');
} catch (error) {
  console.error(`Submission failed: ${error.message}`);
  process.exit(1);
}
