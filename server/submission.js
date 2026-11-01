import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportTour, PRESETS, probeVideos, referencedMedia } from './export.js';
import { freshProject, validateProject } from '../src/project.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR_EXCLUDE = new Set(['node_modules', 'dist', 'data', 'exports', 'submissions', '.git']);

const ENCODING = {
  vr: 'Headset-friendly preset: videos a headset may not decode are re-encoded to H.264 (yuv420p), at most 4096 px wide and 30 fps (CRF 21, max 35 Mbit/s). Videos that already satisfy these limits are copied unchanged.',
  compact: 'Compact preset: videos a headset may not decode, or that exceed the limits, are re-encoded to H.264 (yuv420p), at most 2880 px wide and 30 fps (CRF 23, max 14 Mbit/s).',
  original: 'Original preset: video files are copied byte for byte, exactly as uploaded; no re-encoding was done.'
};

export const mdEscape = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/([\\`*_\[\]|<>~])/g, '\\$1').trim();
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const mermaidLabel = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[&"<>#]/g, c => `#${c.charCodeAt(0)};`);

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
const fmtNum = n => (Math.round(n * 10) / 10).toString();
const humanSize = b => b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

export function timestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function readIf(file) { try { return (await readFile(file, 'utf8')).trim(); } catch { return null; } }

export async function buildNotices(repo = REPO) {
  const nm = pkg => path.join(repo, 'node_modules', pkg);
  const licenseOf = async pkg => {
    try {
      const f = (await readdir(nm(pkg))).find(n => /^licen[cs]e/i.test(n));
      return f ? await readIf(path.join(nm(pkg), f)) : null;
    } catch { return null; }
  };
  const items = [
    { name: 'A-Frame', license: 'MIT', url: 'https://github.com/aframevr/aframe', pkg: 'aframe', note: 'A-Frame bundles three.js (MIT, https://github.com/mrdoob/three.js) and other components; see their repositories for details.' },
    { name: 'IBM Plex Sans (via @fontsource/ibm-plex-sans)', license: 'SIL Open Font License 1.1', url: 'https://github.com/fontsource/font-files and https://github.com/IBM/plex', pkg: '@fontsource/ibm-plex-sans' },
    { name: 'Express', license: 'MIT', url: 'https://github.com/expressjs/express', pkg: 'express' },
    { name: 'Multer', license: 'MIT', url: 'https://github.com/expressjs/multer', pkg: 'multer' }
  ];
  const parts = ['THIRD-PARTY NOTICES', '===================', '', 'This submission contains or uses the following third-party components.', ''];
  const marker = await readIf(path.join(repo, 'src/markers/LICENSE.txt'));
  const notice = await readIf(path.join(repo, 'src/markers/NOTICE.txt'));
  parts.push('Marzipano-derived marker icons and hover behaviour', '  License: Apache License 2.0', '  Project: https://github.com/google/marzipano', '  Files: src/markers/ (inside project-source/editor and compiled into html5-export)', '');
  if (notice) parts.push('--- NOTICE ---', notice, '');
  if (marker) parts.push('--- LICENSE (src/markers/LICENSE.txt) ---', marker, '');
  else parts.push('(License file src/markers/LICENSE.txt was not found when this file was generated; see https://www.apache.org/licenses/LICENSE-2.0)', '');
  for (const it of items) {
    parts.push('------------------------------------------------------------', `${it.name}`, `  License: ${it.license}`, `  Project: ${it.url}`);
    if (it.note) parts.push(`  Note: ${it.note}`);
    const text = await licenseOf(it.pkg);
    if (text) parts.push('', `--- LICENSE (node_modules/${it.pkg}) ---`, text);
    else parts.push('', '(License text not available locally when this file was generated; see the project URL above.)');
    parts.push('');
  }
  return parts.join('\n');
}

export function buildReadme({ project, title, url, headsetTested, quality, probes, sizes, date, warnings = [] }) {
  const scenes = project.scenes;
  const byId = new Map(scenes.map(s => [s.id, s]));
  const n = scenes.length;
  const heading = mdEscape(title || project.title || 'Interactive 360° video tour');
  const L = [];
  const links = scenes.flatMap(s => (s.hotspots || []).filter(h => h.type === 'link').map(h => ({ from: s, to: byId.get(h.target), h })));
  const infos = scenes.flatMap(s => (s.hotspots || []).filter(h => h.type === 'info').map(h => ({ scene: s, h })));
  L.push(`# ${heading}`, '', `This is an interactive 360° video tour with ${n} location${n === 1 ? '' : 's'}. The visitor looks around inside each 360° video and moves between locations through clickable markers; information markers show short explanatory cards. The tour runs in a web browser on a computer, and in a VR headset through WebXR.`, '');
  L.push('## Launching the experience', '', '### In a VR headset (Meta Quest)', '');
  L.push(url ? `Open this address in the Meta Quest Browser, then press the VR button at the bottom right of the window: ${url}` : '(Hosted link not set – see "Meta Quest from the exported folder without hosting" below)', '');
  L.push('### On a computer', '',
    '1. Unzip the submission and open the folder `html5-export`.',
    '2. On Windows double-click `start-windows.bat`. On macOS or Linux run `./start-mac-linux.sh` in a terminal. Node.js 18+ or Python 3 must be installed.',
    '3. Open the address printed in the window (for example `http://localhost:8080`) in a browser.', '',
    'Do not open `index.html` directly by double-clicking it. Browsers block the page from loading the tour data and videos from `file://` addresses, so it would stay empty. The start script runs a small local web server that serves the files properly.', '');
  L.push('### Meta Quest from the exported folder without hosting', '',
    'WebXR only works on secure origins, and the Quest Browser treats `http://localhost` as secure. To reach the computer\'s server as `localhost` on the headset:', '',
    '1. Enable developer mode on the headset and connect it to the computer with a USB cable; accept the USB debugging prompt in the headset.',
    '2. Start the local server from `html5-export` as described above and note its port (for example 8080).',
    '3. On the computer run `adb reverse tcp:8080 tcp:8080` (use the real port).',
    '4. In the Meta Quest Browser open `http://localhost:8080` and press the VR button.', '',
    'A LAN address such as `http://192.168.x.x:8080` will load the page, but the headset will not enter VR from it because it is not a secure origin.', '',
    headsetTested ? 'Headset note: the authors tested this tour on a physical Meta Quest headset.' : 'Headset note: the behaviour on a physical headset has not been verified by the authors. The tour was checked in a desktop browser only.', '');

  L.push('## Locations presented', '', '| # | Location | Video length | Info points | Links to |', '|---|---|---|---|---|');
  scenes.forEach((s, i) => {
    const p = probes.get(path.basename(s.video || ''));
    const hs = s.hotspots || [];
    const to = [...new Set(hs.filter(h => h.type === 'link').map(h => byId.get(h.target)?.name).filter(Boolean))].map(mdEscape).join(', ');
    L.push(`| ${i + 1} | ${mdEscape(s.name)} | ${formatDuration(p?.durationSec) || 'n/a'} | ${hs.filter(h => h.type === 'info').length} | ${to || '–'} |`);
  });
  L.push('');

  L.push('## Navigating between scenes', '',
    '- Look around: drag with the mouse or a finger. Scroll (or pinch) to zoom.',
    '- Click or tap a marker (hotspot) to use it.',
    '- Arrow-style markers lead to another location. Information markers show a card with text and, where provided, an image: click one on a computer, or point a controller at it in a headset.',
    '- The Locations menu button in the transport bar lists all locations and jumps directly to any of them.',
    '- The transport bar also has play/pause, a seek bar, mute, and fullscreen.',
    '- The Start tour button begins the tour at the first location.',
    '- In VR, aim with the controller or gaze at a marker and press the trigger.', '');
  L.push('### Connections', '');
  if (links.length) for (const { from, to, h } of links) L.push(`- ${mdEscape(from.name)} → ${to ? mdEscape(to.name) : '(missing target)'} (marker: "${mdEscape(h.label ?? '')}")`);
  else L.push('This tour has no links between locations.');
  L.push('', '### Information points', '');
  if (infos.length) for (const { scene, h } of infos) {
    const timed = Number.isFinite(h.startTime) || Number.isFinite(h.endTime);
    const t = timed ? ` (visible from ${fmtNum(h.startTime ?? 0)} s to ${Number.isFinite(h.endTime) ? fmtNum(h.endTime) + ' s' : 'the end of the video'})` : '';
    L.push(`- ${mdEscape(scene.name)}: ${mdEscape(h.title || h.label || 'Information')}${t}`);
  } else L.push('This tour has no information points.');
  L.push('', '```mermaid', 'flowchart LR');
  scenes.forEach((s, i) => L.push(`  n${i + 1}["${mermaidLabel(s.name)}"]`));
  const idx = new Map(scenes.map((s, i) => [s.id, i + 1]));
  const seen = new Set();
  for (const { from, to } of links) {
    if (!to) continue;
    const e = `n${idx.get(from.id)} --> n${idx.get(to.id)}`;
    if (!seen.has(e)) { seen.add(e); L.push(`  ${e}`); }
  }
  L.push('```', '');

  L.push('## About this submission', '',
    '- `html5-export/` is the equivalent of the Pano2VR HTML5/Web output: the playable tour with its start scripts.',
    '- `project-source/` is the equivalent of the Pano2VR project (.p2vr) plus the source assets: `project.json`, the original videos and images in `media/`, `LOCATIONS.csv`, and `editor/`, the source code of the editor that produced the tour (`HOW-TO-OPEN-THE-PROJECT.md` explains how to open it).',
    '- `THIRD-PARTY-NOTICES.txt` lists the third-party components and their licenses.', '',
    'Pano2VR\'s free edition limits a project to four videos/nodes, so this tour was produced with a purpose-built editor (Orbit) written for this course.', '',
    'Technologies: A-Frame (three.js) with WebXR for the viewer, plain JavaScript with Vite for the editor, and Node.js with Express for the editor server. No accounts or cloud services are needed to view or edit the tour.', '');

  L.push('## Technical notes', '', `- Video encoding of the export (quality "${quality}"): ${ENCODING[quality]}`,
    `- Size of html5-export: ${humanSize(sizes.export)}`, `- Size of project-source: ${humanSize(sizes.source)}`,
    `- Generated: ${date.toISOString()}`, '- Third-party components: see THIRD-PARTY-NOTICES.txt');
  for (const w of warnings) L.push(`- Generation warning: ${mdEscape(w)}`);
  L.push('');
  return L.join('\n');
}

const HOW_TO = `# How to open the project in the editor

The folder \`editor/\` contains the source of Orbit, the editor that produced this tour. \`project.json\` and \`media/\` next to it are the project data.

1. Install Node.js 20 or newer (https://nodejs.org).
2. Unzip the submission (if it came as a .zip) and open a terminal in \`project-source/editor\`:

       cd project-source/editor

3. Install the dependencies and build the app:

       npm install
       npm run build

4. Create the data folders and copy the project into them. The editor reads \`data/project.json\` and \`data/media/\`:

       mkdir -p data/media
       cp ../project.json data/project.json
       cp ../media/* data/media/

   On Windows (PowerShell):

       mkdir data\\media
       copy ..\\project.json data\\project.json
       copy ..\\media\\* data\\media\\

5. Start the editor:

       npm start

6. Open http://127.0.0.1:4174 in a browser.

The editor autosaves your changes into \`data/\` (\`data/project.json\` and \`data/media/\`). The original files in \`project-source/\` are not modified.

To create the playable HTML5 export again, run \`npm run export\` inside \`editor/\`.
`;

export async function buildSubmission({ root, outDir, distDir = path.join(REPO, 'dist'), repo = REPO, quality = 'vr', url, title, headsetTested = false, zip = false, onProgress = () => {}, signal } = {}) {
  if (!PRESETS.some(p => p.id === quality)) throw new Error(`Unknown quality "${quality}"`);
  if (!outDir) throw new Error('outDir is required');
  outDir = path.resolve(outDir);
  if (existsSync(outDir)) throw new Error(`Output folder already exists: ${outDir}`);
  if (!existsSync(path.join(distDir, 'index.html'))) throw new Error('The built app was not found (dist/index.html is missing). Run npm run build first.');
  const projectFile = path.join(root, 'project.json');
  const raw = existsSync(projectFile) ? await readFile(projectFile) : null;
  const project = validateProject(raw ? JSON.parse(raw.toString('utf8')) : freshProject());
  const warnings = [];
  const step = (percent, s) => onProgress({ step: s, percent });
  const exportDir = path.join(outDir, 'html5-export');
  const srcDir = path.join(outDir, 'project-source');
  try {
    step(0, 'Creating HTML5 export');
    await mkdir(outDir, { recursive: true });
    const res = await exportTour({ root, distDir, outDir: exportDir, quality, signal, onProgress: p => onProgress({ ...p, percent: Math.round(p.percent * 0.8), step: `Export: ${p.step}` }) });
    warnings.push(...res.warnings);

    step(82, 'Copying project source');
    await mkdir(path.join(srcDir, 'media'), { recursive: true });
    if (raw) await writeFile(path.join(srcDir, 'project.json'), raw);
    else await writeFile(path.join(srcDir, 'project.json'), JSON.stringify(project, null, 2));
    const { videos, images } = referencedMedia(project);
    for (const p of [...videos, ...images]) {
      const name = path.basename(p);
      const src = path.join(root, 'media', name);
      if (existsSync(src)) await copyFile(src, path.join(srcDir, 'media', name));
      else warnings.push(`Media file referenced by the project is missing: ${name}`);
    }
    const probes = new Map((await probeVideos(path.join(srcDir, 'media'), project)).map(v => [v.name, v]));
    const rows = ['number,location,video_file,duration_seconds,width,height,hotspots'];
    project.scenes.forEach((s, i) => {
      const p = probes.get(path.basename(s.video || ''));
      rows.push([i + 1, s.name, path.basename(s.video || ''), p?.durationSec != null ? p.durationSec.toFixed(1) : '', p?.width ?? '', p?.height ?? '', (s.hotspots || []).length].map(csvCell).join(','));
    });
    await writeFile(path.join(srcDir, 'LOCATIONS.csv'), '\ufeff' + rows.join('\r\n') + '\r\n');
    await writeFile(path.join(srcDir, 'HOW-TO-OPEN-THE-PROJECT.md'), HOW_TO);

    step(88, 'Copying editor source');
    const edDir = path.join(srcDir, 'editor');
    await mkdir(edDir, { recursive: true });
    for (const e of await readdir(repo, { withFileTypes: true })) {
      if (EDITOR_EXCLUDE.has(e.name)) continue;
      await cp(path.join(repo, e.name), path.join(edDir, e.name), { recursive: true });
    }

    step(94, 'Writing notices and README');
    await writeFile(path.join(outDir, 'THIRD-PARTY-NOTICES.txt'), await buildNotices(repo));
    const sizes = { export: await dirSize(exportDir), source: await dirSize(srcDir) };
    await writeFile(path.join(outDir, 'README.md'), buildReadme({ project, title, url, headsetTested, quality, probes, sizes, date: new Date(), warnings }));
  } catch (e) {
    await rm(outDir, { recursive: true, force: true });
    throw e;
  }

  let zipPath = null;
  if (zip) {
    step(97, 'Creating zip');
    zipPath = `${outDir}.zip`;
    const name = path.basename(outDir);
    let made = false;
    for (const py of ['python3', 'python']) {
      const r = spawnSync(py, ['-m', 'zipfile', '-c', zipPath, name], { cwd: path.dirname(outDir), stdio: 'ignore' });
      if (!r.error && r.status === 0) { made = true; break; }
    }
    if (!made) { zipPath = null; await rm(`${outDir}.zip`, { force: true }); warnings.push('Python was not found (or failed), so no .zip was created. Zip the folder manually.'); }
  }
  step(100, 'Done');
  return { outDir, zipPath, bytes: await dirSize(outDir), warnings };
}
