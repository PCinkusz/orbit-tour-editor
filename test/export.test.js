import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createApp } from '../server/app.js';
import { exportTour, hasFfmpeg, probeVideos } from '../server/export.js';

const ffmpeg = hasFfmpeg();
const python = spawnSync('python3', ['--version']).status === 0;
const tmp = [];
after(async () => { for (const d of tmp) await rm(d, { recursive: true, force: true }); });
const mk = async name => { const d = await mkdtemp(join(tmpdir(), `vr-export-${name}-`)); tmp.push(d); return d; };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function makeVideo(file, { pixFmt = 'yuv420p', size = '1280x640' } = {}) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30`, '-t', '1', '-pix_fmt', pixFmt, '-c:v', 'libx264', file]);
  assert.equal(r.status, 0, String(r.stderr));
}
const probeWidth = file => Number(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file]).stdout.toString().trim());

async function fixture({ pixFmt } = {}) {
  const root = await mk('data');
  const dist = await mk('dist');
  await mkdir(join(root, 'media'), { recursive: true });
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8" />\n<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href=\'/assets/app.css\'></head><body>tour</body></html>');
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(dist, 'assets', 'app.css'), 'body{}');
  if (ffmpeg) makeVideo(join(root, 'media', 'a.mp4'), { pixFmt });
  else await writeFile(join(root, 'media', 'a.mp4'), Buffer.alloc(5000, 7));
  await writeFile(join(root, 'media', 'pic.png'), PNG);
  await writeFile(join(root, 'media', 'unused.mp4'), Buffer.alloc(100, 1));
  await writeFile(join(root, 'media', 'unused.png'), PNG);
  const project = {
    version: 1, title: 'T',
    scenes: [
      { id: 's1', name: 'One', video: '/media/a.mp4', startYaw: 0, hotspots: [
        { id: 'h1', type: 'info', label: 'i', yaw: 0, pitch: 0, title: 't', body: 'b', image: '/media/pic.png' },
        { id: 'h2', type: 'link', label: 'go', yaw: 1, pitch: 0, target: 's2' }] },
      { id: 's2', name: 'Two', video: '', startYaw: 0, hotspots: [] }
    ]
  };
  await writeFile(join(root, 'project.json'), JSON.stringify(project));
  return { root, dist, project };
}

test('original export has the exact package layout', async () => {
  const { root, dist, project } = await fixture();
  const out = join(await mk('out'), 'tour');
  const seen = [];
  const result = await exportTour({ root, distDir: dist, outDir: out, quality: 'original', onProgress: p => seen.push(p) });
  assert.equal(result.outDir, out);
  assert.ok(result.bytes > 0);
  assert.equal(seen.at(-1).percent, 100);
  const top = (await readdir(out)).sort();
  assert.deepEqual(top, ['HOW-TO-PLAY.txt', 'assets', 'index.html', 'media', 'serve.mjs', 'serve.py', 'start-mac-linux.sh', 'start-windows.bat', 'tour.json']);
  assert.deepEqual((await readdir(join(out, 'media'))).sort(), ['a.mp4', 'pic.png']);
  assert.deepEqual((await readdir(join(out, 'assets'))).sort(), ['app.css', 'app.js']);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'tour.json'), 'utf8')), project);
  assert.deepEqual(await readFile(join(out, 'media', 'a.mp4')), await readFile(join(root, 'media', 'a.mp4')));
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /<head>\s*<meta name="orbit-static" content="1">\s*<meta charset/);
  assert.ok(html.includes('"./assets/app.js"') && html.includes("'./assets/app.css'"));
  assert.ok(!html.includes('"/assets/') && !html.includes("'/assets/"));
});

test('missing dist gives a clear error and leaves no output', async () => {
  const { root } = await fixture();
  const out = join(await mk('out'), 'tour');
  await assert.rejects(exportTour({ root, distDir: join(root, 'nope'), outDir: out, quality: 'original' }), /npm run build/);
  assert.equal(existsSync(out), false);
});

test('invalid project is refused', async () => {
  const { root, dist, project } = await fixture();
  project.scenes[0].hotspots[1].target = 'ghost';
  await writeFile(join(root, 'project.json'), JSON.stringify(project));
  await assert.rejects(exportTour({ root, distDir: dist, outDir: join(await mk('out'), 't'), quality: 'original' }), /Invalid link target/);
});

async function withServer(opts, fn) {
  const { root, dist } = opts;
  const exportsDir = await mk('exports');
  const server = createApp(root, { exportsDir, distDir: dist, viewOnly: !!opts.viewOnly }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, exportsDir); } finally { await new Promise(r => { server.close(r); server.closeAllConnections?.(); }); }
}
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
async function waitDone(base) {
  for (let i = 0; i < 300; i++) {
    const s = await (await fetch(`${base}/api/export/status`)).json();
    if (s.state !== 'running') return s;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('export did not finish');
}

test('API flow: info, export, status, errors', async () => {
  const f = await fixture();
  await withServer(f, async (base, exportsDir) => {
    const info = await (await fetch(`${base}/api/export/info`)).json();
    assert.equal(typeof info.ffmpeg, 'boolean');
    assert.equal(info.videos.length, 1);
    assert.equal(info.videos[0].name, 'a.mp4');
    assert.deepEqual(info.presets.map(p => p.id).sort(), ['compact', 'original', 'vr']);
    assert.equal(info.presets.find(p => p.id === 'original').estimateBytes, info.totalBytes);
    assert.ok(!(await fetch(`${base}/api/export`)).headers.get('content-disposition'), 'old JSON download route is gone');
    assert.equal((await post(`${base}/api/export`, { quality: 'bogus' })).status, 400);
    assert.equal((await (await fetch(`${base}/api/export/status`)).json()).state, 'idle');
    const res = await post(`${base}/api/export`, { quality: 'original' });
    assert.equal(res.status, 202);
    const st = await waitDone(base);
    assert.equal(st.state, 'done', JSON.stringify(st));
    assert.equal(st.percent, 100);
    assert.equal(st.step, 'Finished');
    assert.match(st.outName, /^orbit-tour-\d{8}-\d{6}-original$/);
    assert.equal(st.outDir, join(exportsDir, st.outName));
    for (const p of ['index.html', 'tour.json', 'media/a.mp4', 'media/pic.png', 'serve.mjs']) assert.ok(existsSync(join(st.outDir, p)), p);
  });
});

test('API: concurrent job gets 409, cancel works', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const f = await fixture({ pixFmt: 'yuv444p' }); // forces a re-encode so the job lasts a moment
  await withServer(f, async (base, exportsDir) => {
    assert.equal((await post(`${base}/api/export`, { quality: 'vr' })).status, 202);
    assert.equal((await post(`${base}/api/export`, { quality: 'vr' })).status, 409);
    await post(`${base}/api/export/cancel`);
    const st = await waitDone(base);
    assert.ok(['cancelled', 'done'].includes(st.state), st.state);
    if (st.state === 'cancelled') assert.equal(existsSync(st.outDir), false);
    // a new job can start afterwards and finishes with a playable same-named file
    assert.equal((await post(`${base}/api/export`, { quality: 'vr' })).status, 202);
    const st2 = await waitDone(base);
    assert.equal(st2.state, 'done', JSON.stringify(st2));
    const spec = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', join(st2.outDir, 'media', 'a.mp4')]).stdout.toString().trim();
    assert.equal(spec, 'yuv420p');
    assert.deepEqual((await readdir(join(st2.outDir, 'media'))).filter(n => n.endsWith('.part')), []);
  });
});

test('API: view-only refuses export actions', async () => {
  const f = await fixture();
  await withServer({ ...f, viewOnly: true }, async base => {
    assert.equal((await post(`${base}/api/export`, { quality: 'original' })).status, 403);
    assert.equal((await post(`${base}/api/export/cancel`)).status, 403);
  });
});

test('compact preset re-encodes oversized video, keeps the file name', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const { root, dist } = await fixture();
  const out = join(await mk('out'), 'tour');
  const progress = [];
  await exportTour({ root, distDir: dist, outDir: out, quality: 'compact', limits: { compact: { width: 640 } }, onProgress: p => progress.push(p) });
  assert.equal(probeWidth(join(out, 'media', 'a.mp4')), 640);
  assert.equal(probeWidth(join(root, 'media', 'a.mp4')), 1280); // source untouched
  assert.ok(progress.some(p => /^Converting video 1 of 1$/.test(p.step)));
  const info = (await probeVideos(join(out, 'media'), JSON.parse(await readFile(join(out, 'tour.json'), 'utf8'))))[0];
  assert.equal(info.codec, 'h264');
  assert.equal(info.pixFmt, 'yuv420p');
  assert.equal(info.headsetFriendly, true);
});

test('vr preset copies an already friendly video byte-for-byte', { skip: !ffmpeg && 'ffmpeg missing' }, async () => {
  const { root, dist } = await fixture();
  const out = join(await mk('out'), 'tour');
  await exportTour({ root, distDir: dist, outDir: out, quality: 'vr' });
  assert.deepEqual(await readFile(join(out, 'media', 'a.mp4')), await readFile(join(root, 'media', 'a.mp4')));
});

// ---- bundled serve scripts ----
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const children = [];
after(() => { for (const c of children) c.kill('SIGKILL'); });

async function startScript(cmd, args, port) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  for (let i = 0; i < 100; i++) {
    if (/running at/.test(out)) return { child, base: `http://127.0.0.1:${port}`, out };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start: ' + out);
}

async function checkServer(base, mediaSize) {
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.equal(html.headers.get('cache-control'), 'no-cache');
  assert.ok((await html.text()).includes('orbit-static'));
  const tj = await fetch(`${base}/tour.json`);
  assert.match(tj.headers.get('content-type'), /application\/json/);
  assert.equal(tj.headers.get('cache-control'), 'no-cache');
  assert.match((await fetch(`${base}/assets/app.js`)).headers.get('content-type'), /javascript/);
  const full = await fetch(`${base}/media/a.mp4`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal((await full.arrayBuffer()).byteLength, mediaSize);
  const part = await fetch(`${base}/media/a.mp4`, { headers: { range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-99/${mediaSize}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await fetch(`${base}/media/a.mp4`, { headers: { range: 'bytes=-10' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${mediaSize - 10}-${mediaSize - 1}/${mediaSize}`);
  const open = await fetch(`${base}/media/a.mp4`, { headers: { range: `bytes=${mediaSize - 5}-` } });
  assert.equal((await open.arrayBuffer()).byteLength, 5);
  assert.equal((await fetch(`${base}/media/a.mp4`, { headers: { range: `bytes=${mediaSize + 10}-` } })).status, 416);
  assert.equal((await fetch(`${base}/media/a.mp4`, { headers: { range: 'bytes=abc' } })).status, 416);
  assert.equal((await fetch(`${base}/nothing.png`)).status, 404);
  // path traversal, raw (fetch would normalise ../)
  for (const target of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/media/..%2f..%2f..%2fetc/passwd']) {
    const status = await rawStatus(base, target);
    assert.notEqual(status, 200, target);
    assert.ok([400, 403, 404].includes(status), `${target} -> ${status}`);
  }
}
function rawStatus(base, target) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write(`GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let data = '';
    s.on('data', d => { data += d; });
    s.on('close', () => resolve(Number(/^HTTP\/1\.\d (\d+)/.exec(data)?.[1])));
    s.on('error', reject);
  });
}

async function exported() {
  const { root, dist } = await fixture();
  const out = join(await mk('out'), 'tour');
  await exportTour({ root, distDir: dist, outDir: out, quality: 'original' });
  const size = (await readFile(join(out, 'media', 'a.mp4'))).length;
  return { out, size };
}

test('exported serve.mjs serves with Range support and blocks traversal', async () => {
  const { out, size } = await exported();
  const port = await freePort();
  const { child } = await startScript('node', [join(out, 'serve.mjs'), '--port', String(port), '--no-open'], port);
  try { await checkServer(`http://127.0.0.1:${port}`, size); } finally { child.kill('SIGKILL'); }
});

test('serve.mjs moves to the next port when busy', async () => {
  const { out } = await exported();
  const port = await freePort();
  const blocker = net.createServer().listen(port, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  let child;
  try {
    const r = await startScript('node', [join(out, 'serve.mjs'), '--port', String(port), '--no-open'], port + 1);
    child = r.child;
    assert.match(r.out, new RegExp(`localhost:${port + 1}`));
  } finally { child?.kill('SIGKILL'); blocker.close(); }
});

test('exported serve.py serves with Range support and blocks traversal', { skip: !python && 'python3 missing' }, async () => {
  const { out, size } = await exported();
  const port = await freePort();
  const { child } = await startScript('python3', [join(out, 'serve.py'), '--port', String(port), '--no-open'], port);
  try { await checkServer(`http://127.0.0.1:${port}`, size); } finally { child.kill('SIGKILL'); }
});
