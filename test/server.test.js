import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';

async function withServer(fn) {
  const root = await mkdtemp(join(tmpdir(), 'vr-tour-test-'));
  const app = createApp(root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`, root); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
}

test('project persists after API write, rejects broken links,', async () => withServer(async base => {
  const start = await (await fetch(`${base}/api/project`)).json();
  assert.equal(start.scenes.length, 0);
  const project = { version: 1, title: 'Museum', scenes: [{ id: 'a', name: 'Entry', video: '', startYaw: 0, hotspots: [] }] };
  const saved = await fetch(`${base}/api/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
  assert.equal(saved.status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/project`)).json(), project);
  project.scenes[0].hotspots.push({ id: 'h', type: 'link', label: 'Go', yaw: 0, pitch: 0, target: 'missing' });
  const invalid = await fetch(`${base}/api/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project) });
  assert.equal(invalid.status, 400);
  assert.equal((await (await fetch(`${base}/api/project`)).json()).scenes[0].hotspots.length, 0);
}));

test('uploads video to disk and serves it with byte ranges; rejects unsupported files', async () => withServer(async (base, root) => {
  const body = new FormData();
  body.append('file', new Blob(['abcdef'], { type: 'video/mp4' }), 'room.mp4');
  const res = await fetch(`${base}/api/upload`, { method: 'POST', body });
  assert.equal(res.status, 201);
  const { path } = await res.json();
  assert.match(path, /^\/media\/[a-f0-9-]+\.mp4$/);
  assert.equal((await readFile(join(root, path.slice(1)))).toString(), 'abcdef');
  const partial = await fetch(`${base}${path}`, { headers: { range: 'bytes=1-3' } });
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), 'bcd');
  const invalid = new FormData();
  invalid.append('file', new Blob(['bad'], { type: 'text/plain' }), 'bad.txt');
  assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', body: invalid })).status, 400);
}));
