import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrip } from '../public/lib/model.js';
import { encodeShare } from '../public/lib/share.js';
import { LIMITS } from '../public/lib/limits.js';

test('S-6: short share API validates, bounds, rate-limits and expires links', async () => {
  const shareDir = await mkdtemp(join(tmpdir(), 'xenotravel-share-test-'));
  const port = 18000 + Math.floor(Math.random() * 20000);
  const old = new Date(Date.now() - 180 * 24 * 60 * 60_000 - 60_000).toISOString();
  const expired = (id) => join(shareDir, id + '.json');
  let server;
  try {
    await writeFile(expired('OldStart'), JSON.stringify({ createdAt: old }));
    server = spawn(process.execPath, ['server.js'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, PORT: String(port), SHARE_DIR: shareDir, TRUST_PROXY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server start timeout')), 5000);
      server.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
      server.once('error', (error) => { clearTimeout(timeout); reject(error); });
      server.once('exit', (code) => { clearTimeout(timeout); reject(new Error('server exited with ' + code)); });
    });
    const url = (path) => 'http://localhost:' + port + path;
    const api = (path, init) => fetch(url('/api' + path), init);
    const post = (body, ip = '192.0.2.1', extra) => api('/share', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body, ...extra,
    });
    const response = (res, status) => {
      assert.equal(res.status, status);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex');
      return res;
    };
    response(await api('/share'), 200);
    response(await api('/missing'), 404);
    response(await api('/bad%zz'), 400);
    response(await fetch(url('/s/invalid')), 404);
    assert.equal((await fetch(url('/'))).headers.has('x-robots-tag'), false);

    for (const code of ['2.invalid', '1.a+b', '1.invalid\n', '1.unparseable', null]) {
      response(await post(JSON.stringify({ code })), 400);
    }
    response(await post('x'.repeat(LIMITS.shareCode + 1)), 413);
    const chunked = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(LIMITS.shareCode));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    response(await post(chunked, '192.0.2.1', { duplex: 'half' }), 413);

    const code = await encodeShare(createTrip({ title: 'Short link', startDate: '2020-01-01', endDate: '2020-01-02' }));
    const body = JSON.stringify({ code });
    const created = response(await post(body.padEnd(LIMITS.shareCode)), 201);
    const { id, path } = await created.json();
    const filename = expired(id);
    const record = JSON.parse(await readFile(filename, 'utf8'));
    assert.ok(Date.now() - Date.parse(record.createdAt) < 60_000);
    assert.deepEqual(await response(await api('/share/' + id), 200).json(), { code });
    assert.match(await response(await fetch(url(path)), 200).text(), /Short link/);

    response(await post(body), 201);
    response(await post(body), 201);
    const limited = response(await post(body), 429);
    const retry = Number(limited.headers.get('retry-after'));
    assert.ok(retry >= 1 && retry <= 60);
    response(await post(body, '192.0.2.2'), 201);

    await assert.rejects(access(expired('OldStart')), { code: 'ENOENT' });
    await writeFile(filename, JSON.stringify({ ...record, createdAt: old }));
    response(await api('/share/' + id), 404);
    await assert.rejects(access(filename), { code: 'ENOENT' });
    await writeFile(filename, JSON.stringify({ ...record, createdAt: old }));
    response(await fetch(url(path)), 404);
    await assert.rejects(access(filename), { code: 'ENOENT' });
  } finally {
    if (server?.pid && server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
    await rm(shareDir, { recursive: true, force: true });
  }
});
