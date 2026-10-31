import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshProject, validateProject } from '../src/project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, 'export-templates');
const TEMPLATE_FILES = ['serve.mjs', 'serve.py', 'start-windows.bat', 'start-mac-linux.sh', 'HOW-TO-PLAY.txt'];

export const PRESETS = [
  { id: 'vr', label: 'Headset-friendly (recommended)', description: 'Re-encodes only videos that headsets may not decode: max 4096 px wide, 30 fps, H.264. Others are copied unchanged.' },
  { id: 'compact', label: 'Compact', description: 'Smaller files for hosts with size limits: max 2880 px wide, 30 fps, lower bitrate.' },
  { id: 'original', label: 'Original', description: 'Copies your files exactly as uploaded. Very large videos may not play on standalone headsets.' }
];

const LIMITS = {
  vr: { width: 4096, fps: 30, crf: 21, maxrate: '35M', bufsize: '70M' },
  compact: { width: 2880, fps: 30, crf: 23, maxrate: '14M', bufsize: '28M' }
};
const maxrateBits = s => parseFloat(s) * 1e6;
const FPS_LIMIT = 30.5;

let ffAvail;
export function hasFfmpeg() {
  if (ffAvail === undefined) {
    const ok = bin => { try { return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
    ffAvail = ok('ffmpeg') && ok('ffprobe');
  }
  return ffAvail;
}
function hasFfprobe() {
  try { return spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}

function parseFps(s) {
  if (!s) return 0;
  const [a, b] = String(s).split('/').map(Number);
  if (!b) return a || 0;
  return a / b;
}

function ffprobeFile(file) {
  return new Promise(resolve => {
    let out = '';
    let child;
    try { child = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return resolve(null); }
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

export function referencedMedia(project) {
  const videos = new Set();
  const images = new Set();
  for (const scene of project.scenes || []) {
    if (scene.video) videos.add(scene.video);
    for (const h of scene.hotspots || []) if (h.image) images.add(h.image);
  }
  return { videos: [...videos], images: [...images] };
}

export async function probeVideos(mediaDir, project) {
  const probe = hasFfprobe();
  const result = [];
  for (const p of referencedMedia(project).videos) {
    const name = path.basename(p);
    const file = path.join(mediaDir, name);
    let st;
    try { st = await stat(file); } catch { continue; }
    const info = { path: p, name, sizeBytes: st.size, width: null, height: null, fps: null, codec: null, pixFmt: null, durationSec: null, bitrate: null, headsetFriendly: false };
    const data = probe ? await ffprobeFile(file) : null;
    const v = data?.streams?.find(s => s.codec_type === 'video');
    if (v) {
      info.width = v.width ?? null;
      info.height = v.height ?? null;
      info.fps = Math.round(parseFps(v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate) * 100) / 100;
      info.codec = v.codec_name ?? null;
      info.pixFmt = v.pix_fmt ?? null;
      const dur = Number(data.format?.duration ?? v.duration);
      info.durationSec = Number.isFinite(dur) ? dur : null;
      const br = Number(data.format?.bit_rate);
      info.bitrate = Number.isFinite(br) ? br : null;
      info.headsetFriendly = info.codec === 'h264' && info.pixFmt === 'yuv420p' && info.width <= 4096 && info.fps <= FPS_LIMIT;
    }
    result.push(info);
  }
  return result;
}

function needsReencode(info, limit) {
  if (!info || !info.codec || !/\.mp4$/i.test(info.name)) return false; // unknown or non-mp4: copy through
  return info.width > limit.width || info.fps > FPS_LIMIT || !(info.codec === 'h264' && info.pixFmt === 'yuv420p');
}

export function estimateBytes(quality, videos, limits = LIMITS) {
  if (quality === 'original') return videos.reduce((a, v) => a + v.sizeBytes, 0);
  const lim = limits[quality];
  return videos.reduce((a, v) => {
    if (!needsReencode(v, lim) || !v.durationSec) return a + v.sizeBytes;
    return a + Math.min(v.sizeBytes, Math.round(maxrateBits(lim.maxrate) * v.durationSec / 8 * 0.6));
  }, 0);
}

function abortError() { const e = new Error('Export cancelled'); e.name = 'AbortError'; return e; }

function transcode({ src, dest, info, limit, signal, onFraction }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const args = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-vf', `scale='min(${limit.width},iw)':-2`,
      '-profile:v', 'high', '-level:v', '5.1', '-pix_fmt', 'yuv420p', '-crf', String(limit.crf),
      '-maxrate', limit.maxrate, '-bufsize', limit.bufsize, '-preset', 'medium', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', dest];
    // cap fps only when the source is above the limit (keeps normal rates untouched)
    if (!info.fps || info.fps > FPS_LIMIT) args.splice(args.indexOf('-vf'), 0, '-r', String(limit.fps));
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let buf = '';
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', d => { err = (err + d).slice(-2000); });
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && info.durationSec) onFraction(Math.min(1, Number(m[1]) / 1e6 / info.durationSec));
      }
    });
    child.on('error', e => { signal?.removeEventListener('abort', onAbort); reject(e); });
    child.on('close', code => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(abortError());
      if (code !== 0) return reject(new Error(`ffmpeg failed for ${path.basename(src)}: ${err.trim().split('\n').slice(-3).join(' ')}`));
      resolve();
    });
  });
}

export async function exportTour({ root, distDir, outDir, quality = 'vr', onProgress = () => {}, signal, limits } = {}) {
  if (!PRESETS.some(p => p.id === quality)) throw new Error(`Unknown quality "${quality}"`);
  const lims = { vr: { ...LIMITS.vr, ...limits?.vr }, compact: { ...LIMITS.compact, ...limits?.compact } };
  const distIndex = path.join(distDir, 'index.html');
  if (!existsSync(distIndex)) throw new Error('The built app was not found (dist/index.html is missing). Run npm run build first.');
  const projectFile = path.join(root, 'project.json');
  const project = validateProject(existsSync(projectFile) ? JSON.parse(await readFile(projectFile, 'utf8')) : freshProject());
  const mediaDir = path.join(root, 'media');
  const warnings = [];
  const check = () => { if (signal?.aborted) throw abortError(); };
  const report = (step, done, total, frac = 0, extra = {}) => {
    const pct = total ? Math.min(99, Math.floor(((done + frac) / total) * 100)) : 0;
    onProgress({ step, done, total, percent: pct, ...extra });
  };

  const { videos: videoPaths, images: imagePaths } = referencedMedia(project);
  const total = videoPaths.length;
  report('Preparing', 0, total);

  let useFfmpeg = quality !== 'original';
  if (useFfmpeg && !hasFfmpeg()) {
    useFfmpeg = false;
    warnings.push('ffmpeg was not found, so videos were copied unchanged (not optimised for headsets).');
  }
  const probes = useFfmpeg ? new Map((await probeVideos(mediaDir, project)).map(v => [v.name, v])) : new Map();

  if (existsSync(outDir)) throw new Error(`Output folder already exists: ${outDir}`);
  await mkdir(path.join(outDir, 'media'), { recursive: true });
  try {
    check();
    // app files
    let html = await readFile(distIndex, 'utf8');
    html = html.replace(/(["'])\/assets\//g, '$1./assets/');
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, m => `${m}\n  <meta name="orbit-static" content="1">`)
      : `<meta name="orbit-static" content="1">\n${html}`;
    await writeFile(path.join(outDir, 'index.html'), html);
    if (existsSync(path.join(distDir, 'assets'))) await cp(path.join(distDir, 'assets'), path.join(outDir, 'assets'), { recursive: true });
    else await mkdir(path.join(outDir, 'assets'), { recursive: true });
    await writeFile(path.join(outDir, 'tour.json'), JSON.stringify(project, null, 2));
    for (const f of TEMPLATE_FILES) {
      const dest = path.join(outDir, f);
      await copyFile(path.join(TEMPLATES, f), dest);
      if (f === 'start-mac-linux.sh' || f === 'serve.py') await chmod(dest, 0o755);
    }

    // videos
    for (let i = 0; i < videoPaths.length; i++) {
      check();
      const name = path.basename(videoPaths[i]);
      const src = path.join(mediaDir, name);
      const dest = path.join(outDir, 'media', name);
      if (!existsSync(src)) { warnings.push(`Missing media file skipped: ${name}`); continue; }
      const info = probes.get(name);
      const lim = lims[quality];
      if (useFfmpeg && needsReencode(info, lim)) {
        report(`Converting video ${i + 1} of ${total}`, i, total);
        await transcode({
          src, dest: `${dest}.part`, info, limit: lim, signal,
          onFraction: f => report(`Converting video ${i + 1} of ${total}`, i, total, f)
        });
        await rename(`${dest}.part`, dest);
      } else {
        report(useFfmpeg ? `Copying video ${i + 1} of ${total}` : 'Copying files', i, total);
        await copyFile(src, `${dest}.part`);
        await rename(`${dest}.part`, dest);
        if (useFfmpeg && info && !info.codec) warnings.push(`${name}: could not be analysed, copied unchanged.`);
      }
      report(useFfmpeg && needsReencode(info, lim) ? `Converting video ${i + 1} of ${total}` : 'Copying files', i + 1, total);
    }
    // images
    report('Copying files', total, total);
    for (const p of imagePaths) {
      check();
      const name = path.basename(p);
      const src = path.join(mediaDir, name);
      if (!existsSync(src)) { warnings.push(`Missing media file skipped: ${name}`); continue; }
      await copyFile(src, path.join(outDir, 'media', `${name}.part`));
      await rename(path.join(outDir, 'media', `${name}.part`), path.join(outDir, 'media', name));
    }
  } catch (error) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  const bytes = await dirSize(outDir);
  onProgress({ step: 'Finished', done: total, total, percent: 100, bytes });
  return { outDir, bytes, warnings };
}

async function dirSize(dir) {
  let sum = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return sum;
}
