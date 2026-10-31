import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSubmission } from '../server/submission.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = async f => createHash('sha256').update(await readFile(f)).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let tmp, data, dist, ids, project, base;
const NAMES = ['Wydział mechaniczny', 'Library *Main* | hall', 'Lab'];

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'orbit-submission-'));
  data = join(tmp, 'data'); dist = join(tmp, 'dist');
  await mkdir(join(data, 'media'), { recursive: true });
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><head></head><body><script src="/assets/app.js"></script></body></html>');
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)');
  ids = NAMES.map(() => randomUUID());
  const img = `${randomUUID()}.png`;
  await writeFile(join(data, 'media', img), PNG);
  for (const id of ids) await writeFile(join(data, 'media', `${id}.mp4`), randomBytes(2048));
  // an unreferenced file must not be copied
  await writeFile(join(data, 'media', `${randomUUID()}.mp4`), randomBytes(64));
  const hs = (id, type, extra) => ({ id, type, label: id, yaw: 0, pitch: 0, style: type === 'link' ? 'arrow' : 'pill', ...extra });
  project = {
    version: 1, title: 'Campus tour',
    scenes: NAMES.map((name, i) => ({ id: `s${i}`, name, video: `/media/${ids[i]}.mp4`, startYaw: 0, hotspots: [] }))
  };
  project.scenes[0].hotspots.push(hs('h1', 'link', { label: 'Go to library', target: 's1' }), hs('h2', 'info', { label: 'Lathe', title: 'Old lathe', body: 'x', image: `/media/${img}`, startTime: 2, endTime: 9 }));
  project.scenes[1].hotspots.push(hs('h3', 'link', { label: 'Back', target: 's0' }), hs('h4', 'link', { label: 'To lab', target: 's2' }));
  await writeFile(join(data, 'project.json'), JSON.stringify(project, null, 2));
  base = await buildSubmission({ root: data, distDir: dist, repo, outDir: join(tmp, 'out1'), quality: 'original' });
});
after(() => rm(tmp, { recursive: true, force: true }));

test('layout matches the deliverable spec', async () => {
  assert.deepEqual((await readdir(base.outDir)).sort(), ['README.md', 'THIRD-PARTY-NOTICES.txt', 'html5-export', 'project-source']);
  const src = join(base.outDir, 'project-source');
  assert.deepEqual((await readdir(src)).sort(), ['HOW-TO-OPEN-THE-PROJECT.md', 'LOCATIONS.csv', 'editor', 'media', 'project.json']);
  assert.ok(existsSync(join(base.outDir, 'html5-export', 'tour.json')));
  assert.ok(existsSync(join(base.outDir, 'html5-export', 'index.html')));
  assert.equal(await readFile(join(src, 'project.json'), 'utf8'), await readFile(join(data, 'project.json'), 'utf8'));
  const how = await readFile(join(src, 'HOW-TO-OPEN-THE-PROJECT.md'), 'utf8');
  for (const s of ['Node.js 20', 'npm install', 'npm run build', 'npm start', 'http://127.0.0.1:4174', 'autosaves']) assert.ok(how.includes(s), s);
});

test('project-source media is byte-identical and only referenced files are copied', async () => {
  const names = (await readdir(join(base.outDir, 'project-source', 'media'))).sort();
  assert.equal(names.length, 4); // 3 videos + 1 image
  for (const n of names) assert.equal(await sha(join(base.outDir, 'project-source', 'media', n)), await sha(join(data, 'media', n)));
});

test('editor/ has sources but no node_modules, dist, data, exports, submissions', async () => {
  const ed = join(base.outDir, 'project-source', 'editor');
  for (const f of ['package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'src', 'server', 'scripts', 'test', 'README.md']) assert.ok(existsSync(join(ed, f)), f);
  for (const f of ['node_modules', 'dist', 'data', 'exports', 'submissions', '.git']) assert.ok(!existsSync(join(ed, f)), f);
  assert.ok(existsSync(join(ed, 'server', 'submission.js')));
});

test('README content without url', async () => {
  const md = await readFile(join(base.outDir, 'README.md'), 'utf8');
  assert.match(md, /^# Campus tour/);
  assert.ok(md.includes('3 locations'));
  assert.ok(md.includes('Wydział mechaniczny'));
  assert.ok(md.includes('Library \\*Main\\* \\| hall'));
  assert.ok(md.includes('(Hosted link not set'));
  assert.ok(md.includes('has not been verified'));
  assert.ok(md.includes('Wydział mechaniczny → Library \\*Main\\* \\| hall (marker: "Go to library")'));
  assert.ok(md.includes('Library \\*Main\\* \\| hall → Wydział mechaniczny (marker: "Back")'));
  assert.ok(md.includes('Library \\*Main\\* \\| hall → Lab (marker: "To lab")'));
  assert.ok(md.includes('Wydział mechaniczny: Old lathe (visible from 2 s to 9 s)'));
  assert.ok(md.includes('```mermaid\nflowchart LR'));
  assert.ok(md.includes('n1 --> n2') && md.includes('n2 --> n3'));
  assert.ok(md.includes("Pano2VR's free edition limits a project to four videos/nodes, so this tour was produced with a purpose-built editor (Orbit) written for this course."));
  assert.ok(md.includes('adb reverse'));
  assert.ok(md.includes('THIRD-PARTY-NOTICES.txt'));
  assert.ok(md.indexOf('## Launching the experience') < md.indexOf('## Locations presented'));
  assert.ok(md.indexOf('## Locations presented') < md.indexOf('## Navigating between scenes'));
  assert.ok(md.indexOf('## Navigating between scenes') < md.indexOf('## About this submission'));
  assert.ok(md.indexOf('## About this submission') < md.indexOf('## Technical notes'));
  assert.ok(md.includes('Original preset'));
});

test('LOCATIONS.csv has one row per location', async () => {
  const csv = (await readFile(join(base.outDir, 'project-source', 'LOCATIONS.csv'), 'utf8')).replace(/^\ufeff/, '');
  const lines = csv.trim().split(/\r\n/);
  assert.equal(lines[0], 'number,location,video_file,duration_seconds,width,height,hotspots');
  assert.equal(lines.length, 1 + NAMES.length);
  assert.ok(lines[1].startsWith('1,Wydział mechaniczny,'));
  assert.ok(lines[1].endsWith(',2'));
});

test('THIRD-PARTY-NOTICES.txt names the components', async () => {
  const t = await readFile(join(base.outDir, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
  for (const s of ['A-Frame', 'Apache', 'IBM Plex', 'Express', 'Multer', 'Marzipano']) assert.ok(t.includes(s), s);
});

test('url and headset-tested flags appear in the README; refuses to overwrite', async () => {
  const url = 'https://example.org/tour/';
  const r = await buildSubmission({ root: data, distDir: dist, repo, outDir: join(tmp, 'out2'), quality: 'original', url, title: 'My *title*', headsetTested: true });
  const md = await readFile(join(r.outDir, 'README.md'), 'utf8');
  assert.ok(md.includes(`press the VR button at the bottom right of the window: ${url}`));
  assert.ok(!md.includes('(Hosted link not set'));
  assert.ok(md.startsWith('# My \\*title\\*'));
  assert.ok(md.includes('tested this tour on a physical Meta Quest'));
  await assert.rejects(buildSubmission({ root: data, distDir: dist, repo, outDir: r.outDir, quality: 'original' }), /already exists/);
  assert.ok(existsSync(join(r.outDir, 'README.md'))); // untouched
});

test('missing dist gives a clear error and leaves no output', async () => {
  const out = join(tmp, 'out-nodist');
  await assert.rejects(buildSubmission({ root: data, distDir: join(tmp, 'nope'), repo, outDir: out, quality: 'original' }), /npm run build/);
  assert.ok(!existsSync(out));
});

test('CLI: bad args exit 2; --zip makes a single-top-level-folder archive', async () => {
  const cli = join(repo, 'scripts', 'submit.js');
  assert.equal(spawnSync('node', [cli, '--quality', 'bogus'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync('node', [cli, '--nope'], { encoding: 'utf8' }).status, 2);
  const py = spawnSync('python3', ['--version']).status === 0;
  const out = join(tmp, 'cli-out');
  // the CLI always uses the repo's dist; skip the full CLI run if it is not built
  if (!existsSync(join(repo, 'dist', 'index.html'))) return;
  const r = spawnSync('node', [cli, '--data', data, '--out', out, '--quality', 'original', '--zip'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(r.stdout.includes(out));
  assert.ok(existsSync(join(out, 'README.md')));
  const again = spawnSync('node', [cli, '--data', data, '--out', out, '--quality', 'original'], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  if (!py) return;
  assert.ok(existsSync(`${out}.zip`));
  const list = spawnSync('python3', ['-m', 'zipfile', '-l', `${out}.zip`], { encoding: 'utf8' }).stdout;
  const entries = list.split('\n').slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  assert.ok(entries[0].startsWith('cli-out'), entries[0]);
  assert.ok(entries.every(e => e.startsWith('cli-out')));
});

test('zip via API (no dependency on repo dist)', async () => {
  if (spawnSync('python3', ['--version']).status !== 0) return;
  const r = await buildSubmission({ root: data, distDir: dist, repo, outDir: join(tmp, 'zipme'), quality: 'original', zip: true });
  assert.equal(r.zipPath, join(tmp, 'zipme.zip'));
  const list = spawnSync('python3', ['-m', 'zipfile', '-l', r.zipPath], { encoding: 'utf8' }).stdout;
  const first = list.split('\n')[1].split(/\s+/)[0];
  assert.ok(first.startsWith('zipme'), first);
  assert.ok(list.includes('zipme/README.md'));
});
