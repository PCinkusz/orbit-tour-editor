import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshProject, validateProject } from '../src/project.js';
import { PRESETS, estimateBytes, exportTour, hasFfmpeg, probeVideos } from './export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Map([
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']
]);

export function createApp(root = path.join(__dirname, '..', 'data'), { viewOnly = false, exportsDir = path.join(root, '..', 'exports'), distDir = path.join(__dirname, '..', 'dist') } = {}) {
  mkdirSync(path.join(root, 'media'), { recursive: true });
  const app = express();
  const projectFile = path.join(root, 'project.json');
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/config', (req, res) => res.json({ viewOnly }));
  app.use(['/api/project', '/api/upload', '/api/export'], (req, res, next) => {
    if (viewOnly && req.method !== 'GET') return res.status(403).json({ error: 'This tour is view-only.' });
    next();
  });
  app.get('/api/project', async (req, res, next) => {
    try { res.json(existsSync(projectFile) ? validateProject(JSON.parse(await readFile(projectFile, 'utf8'))) : freshProject()); }
    catch (error) { next(error); }
  });
  app.put('/api/project', async (req, res) => {
    try {
      const project = validateProject(req.body);
      const pending = `${projectFile}.${randomUUID()}.tmp`;
      await writeFile(pending, JSON.stringify(project, null, 2));
      await rename(pending, projectFile);
      res.json(project);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  const loadProject = async () => validateProject(existsSync(projectFile) ? JSON.parse(await readFile(projectFile, 'utf8')) : freshProject());
  const idleJob = () => ({ state: 'idle', quality: null, step: '', done: 0, total: 0, percent: 0, outDir: null, outName: null, warnings: [], error: null, bytes: null, startedAt: null, finishedAt: null });
  let job = idleJob();
  let controller = null;
  app.get('/api/export/info', async (req, res) => {
    try {
      const project = await loadProject();
      const videos = await probeVideos(path.join(root, 'media'), project);
      res.json({
        ffmpeg: hasFfmpeg(), exportsDir: path.resolve(exportsDir), videos,
        totalBytes: videos.reduce((a, v) => a + v.sizeBytes, 0),
        presets: PRESETS.map(p => ({ ...p, estimateBytes: estimateBytes(p.id, videos) }))
      });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/export', async (req, res) => {
    const quality = req.body?.quality;
    if (!PRESETS.some(p => p.id === quality)) return res.status(400).json({ error: 'Choose a quality: ' + PRESETS.map(p => p.id).join(', ') + '.' });
    if (job.state === 'running') return res.status(409).json({ error: 'An export is already running.' });
    try { await loadProject(); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!existsSync(path.join(distDir, 'index.html'))) return res.status(400).json({ error: 'The built app was not found. Run npm run build first.' });
    if (job.state === 'running') return res.status(409).json({ error: 'An export is already running.' });
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const outName = `orbit-tour-${stamp}-${quality}`;
    const outDir = path.resolve(exportsDir, outName);
    const mine = controller = new AbortController();
    const current = job = { ...idleJob(), state: 'running', quality, step: 'Preparing', outDir, outName, startedAt: Date.now() };
    mkdirSync(path.resolve(exportsDir), { recursive: true });
    exportTour({
      root, distDir, outDir, quality, signal: mine.signal,
      onProgress: p => { if (job === current) Object.assign(current, { step: p.step, done: p.done, total: p.total, percent: p.percent }); }
    }).then(result => {
      Object.assign(current, { state: 'done', step: 'Finished', percent: 100, done: current.total, warnings: result.warnings, bytes: result.bytes, finishedAt: Date.now() });
    }).catch(error => {
      const cancelled = mine.signal.aborted;
      Object.assign(current, { state: cancelled ? 'cancelled' : 'error', error: cancelled ? null : error.message, step: cancelled ? 'Cancelled' : 'Failed', finishedAt: Date.now() });
    });
    res.status(202).json({ started: true });
  });
  app.get('/api/export/status', (req, res) => res.json(job));
  app.post('/api/export/cancel', (req, res) => {
    if (job.state === 'running') controller?.abort();
    res.json({ cancelling: job.state === 'running' });
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(root, 'media'),
      filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.get(ext) === file.mimetype);
    }
  }).single('file');
  app.post('/api/upload', (req, res, next) => upload(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Select an MP4/WebM video or JPG/PNG/WebP image.' });
    res.status(201).json({ path: `/media/${req.file.filename}`, kind: req.file.mimetype.startsWith('video/') ? 'video' : 'image' });
  }));
  app.use('/media', express.static(path.join(root, 'media'), { fallthrough: false }));
  const dist = distDir;
  if (existsSync(dist)) {
    app.use(express.static(dist, { dotfiles: 'allow' }));
    app.get('/{*route}', (req, res) => res.sendFile(path.join(dist, 'index.html'), { dotfiles: 'allow' }));
  }
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}
