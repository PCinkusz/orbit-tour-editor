import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';

test('view-only deployment serves the tour but refuses edits and uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vr-viewonly-'));
  const server = createApp(root, { viewOnly: true }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { viewOnly: true });
    assert.equal((await fetch(`${base}/api/project`)).status, 200);
    assert.equal((await fetch(`${base}/api/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/api/upload`, { method: 'POST' })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
