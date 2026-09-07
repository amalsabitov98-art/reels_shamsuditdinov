import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('GitHub Pages points to the local helper', () => {
  const app = readFileSync(join(root, 'docs', 'app.js'), 'utf8');
  assert.match(app, /http:\/\/127\.0\.0\.1:3210/);
});

test('portable scripts do not contain the old machine path', () => {
  for (const file of ['flow-launch.mjs', 'flow-upload-video.mjs', 'storyboard-batch.mjs', 'omni-assemble.mjs']) {
    const source = readFileSync(join(root, 'scripts', file), 'utf8');
    assert.doesNotMatch(source, /D:\/Claude-Projects|D:\/tools\/ffmpeg/i, file);
  }
});

test('secrets and generated video are ignored', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^auth\/$/m);
  assert.match(ignore, /^workspace\/reels\/\*$/m);
});
