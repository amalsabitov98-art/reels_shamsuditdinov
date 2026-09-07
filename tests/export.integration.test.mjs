import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { FFMPEG, probe, digest } from '../scripts/media.mjs';
import { assembleApproved } from '../scripts/assemble-approved.mjs';

test('HTTP import → assignment → real 1080x1920 MP4; failures preserve final', { timeout: 120000, skip: process.env.REELS_TEST_HTTP !== '1' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'reels-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Exercises the actual former Windows quoting failure, including Unicode.
  const workspace = join(root, "reels shams' тест");
  const project = join(workspace, 'fixture');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'project.json'), JSON.stringify({ slug: 'fixture', duration: 1.2, parts: [{ n: 1, duration: 0.6, text: 'one' }, { n: 2, duration: 0.6, text: 'two' }] }));
  writeFileSync(join(project, 'sb-spec.json'), JSON.stringify({ parts: [{ n: 1 }, { n: 2 }] }));
  const fixture = join(root, 'source.mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=180x320:r=30:d=0.6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture]);
  const child = spawn(process.execPath, ['scripts/helper-server.mjs'], { cwd: resolve('.'), env: { ...process.env, REELS_WORKSPACE: workspace, REELS_PORT: '0', REELS_NO_OPEN: '1' } });
  let serverLog = '';
  const exit = once(child, 'exit');
  t.after(async () => { child.kill(); await exit; });
  child.stdout.on('data', x => { serverLog += x; });
  child.stderr.on('data', x => { serverLog += x; });
  const until = async fn => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`Timed out: ${serverLog}`);
  };
  const url = await until(() => serverLog.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);
  const api = async (path, options) => {
    const r = await fetch(url + path, options); return { status: r.status, data: await r.json() };
  };
  assert.equal((await api('/health')).data.version, '1.1.0');
  const importPart = async n => {
    const body = new FormData(); body.append('video', new Blob([readFileSync(fixture)], { type: 'video/mp4' }), `result ${n}.mp4`);
    return api(`/api/projects/fixture/approved/${n}`, { method: 'POST', body });
  };
  assert.equal((await importPart(1)).status, 200);
  const final = join(project, 'final.mp4');
  writeFileSync(final, 'previous final');
  await assert.rejects(assembleApproved(project), /части 2/);
  assert.equal(readFileSync(final, 'utf8'), 'previous final');
  assert.equal((await importPart(2)).status, 200);
  const denied = await api('/api/projects/fixture/assemble-approved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 400);
  const started = await api('/api/projects/fixture/assemble-approved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"reviewed":true}' });
  assert.equal(started.status, 202);
  const conflict = await api('/api/actions/flow', { method: 'POST' });
  assert.equal(conflict.status, 409);
  const job = await until(async () => { const { data } = await api(`/api/jobs/${started.data.job.id}`); return data.status !== 'running' ? data : null; });
  assert.equal(job.status, 'done', job.log);
  const media = probe(final);
  assert.equal(media.width, 1080); assert.equal(media.height, 1920); assert.equal(media.audio, true);
  assert.ok(Math.abs(media.duration - 1.2) < 0.15);
  const download = await fetch(url + '/api/projects/fixture/final');
  assert.equal(download.status, 200);
  assert.ok(download.headers.get('content-disposition').includes('fixture-final.mp4'));
  assert.ok((await download.arrayBuffer()).byteLength > 1000);
  assert.ok(existsSync(join(project, 'final-check.json')));
  const goodHash = await digest(final);
  const manifest = JSON.parse(readFileSync(join(project, 'approved-parts.json'), 'utf8'));
  writeFileSync(join(project, 'approved', manifest[1].file), 'corrupt');
  await assert.rejects(assembleApproved(project), /изменилась/);
  assert.equal(await digest(final), goodHash);
});
