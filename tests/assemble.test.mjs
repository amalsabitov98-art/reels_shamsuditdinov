import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFMPEG, probe, digest } from '../scripts/media.mjs';
import { assembleApproved } from '../scripts/assemble-approved.mjs';

test('real two-part export, Unicode/spaces/apostrophe paths, order, sound, safe failure', { timeout: 120000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'reels-offline-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "shams' тест");
  mkdirSync(join(project, 'approved'), { recursive: true });
  writeFileSync(join(project, 'project.json'), JSON.stringify({ parts: [{ n: 1, duration: 0.6 }, { n: 2, duration: 0.6 }] }));
  const manifest = {};
  for (const [i, color] of ['red', 'blue'].entries()) {
    const file = `part-${i + 1}-abc.mp4`;
    const path = join(project, 'approved', file);
    execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=180x320:r=30:d=0.6`, '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 200}:duration=0.6`, '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path]);
    manifest[i + 1] = { file, sha256: await digest(path) };
  }
  const final = join(project, 'final.mp4');
  writeFileSync(final, 'previous final');
  writeFileSync(join(project, 'approved-parts.json'), JSON.stringify({ 1: manifest[1] }));
  await assert.rejects(assembleApproved(project), /части 2/);
  assert.equal(readFileSync(final, 'utf8'), 'previous final');
  writeFileSync(join(project, 'approved-parts.json'), JSON.stringify(manifest));
  const report = await assembleApproved(project);
  assert.equal(report.parts, 2); assert.equal(report.speechVerified, false);
  const media = probe(final);
  assert.equal(media.width, 1080); assert.equal(media.height, 1920); assert.equal(media.audio, true);
  assert.ok(Math.abs(media.duration - 1.2) < 0.15);
  const pixel = time => execFileSync(FFMPEG, ['-v', 'error', '-ss', time, '-i', final, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1024 });
  const red = pixel('0.2'), blue = pixel('0.9');
  assert.ok(red[0] > red[2] * 2, `First part must be red: ${red}`);
  assert.ok(blue[2] > blue[0] * 2, `Second part must be blue: ${blue}`);
  const good = await digest(final);
  writeFileSync(join(project, 'approved', manifest[1].file), 'corrupt');
  await assert.rejects(assembleApproved(project), /изменилась/);
  assert.equal(await digest(final), good);
});
