#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS, exportTour } from '../server/export.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const args = process.argv.slice(2);
const get = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/export.js --quality vr|compact|original [--out DIR] [--data DIR]');
  process.exit(0);
}
const quality = get('--quality') || 'vr';
if (!PRESETS.some(p => p.id === quality)) { console.error(`Unknown quality "${quality}". Use: ${PRESETS.map(p => p.id).join(', ')}`); process.exit(2); }
const data = path.resolve(get('--data') || path.join(repo, 'data'));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const outDir = path.resolve(get('--out') || path.join(repo, 'exports', `orbit-tour-${stamp}-${quality}`));

const ac = new AbortController();
process.on('SIGINT', () => { console.error('\nCancelling...'); ac.abort(); });
let last = '';
try {
  const result = await exportTour({
    root: data, distDir: path.join(repo, 'dist'), outDir, quality, signal: ac.signal,
    onProgress: p => { const line = `[${String(p.percent).padStart(3)}%] ${p.step}`; if (line !== last) { last = line; console.log(line); } }
  });
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  console.log(`Done: ${(result.bytes / 1048576).toFixed(1)} MB`);
  console.log(result.outDir);
} catch (error) {
  console.error(`Export failed: ${error.message}`);
  process.exit(1);
}
