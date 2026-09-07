import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsFile, readyAsset, selectProject, projectURL } from '../scripts/flow-evidence.mjs';
import { validatePart, validateProject } from '../scripts/media.mjs';

test('image wildcard cannot accept MP4 (reported Windows failure)', () => {
  assert.equal(acceptsFile('image/*', 'r2-snd.mp4'), false);
  for (const value of ['video/*,image/*', '.mp4', '*/*', 'video/mp4', '']) assert.equal(acceptsFile(value, 'r2-snd.mp4'), true);
  assert.equal(acceptsFile('image/*', 'r2-board.png'), true);
});
test('asset readiness requires exact name plus type, not a search echo or processing row', () => {
  assert.equal(readyAsset('r2-board.pngИзображение', 'r2-board'), true);
  assert.equal(readyAsset('r2-sndВидео', 'r2-snd.mp4'), true);
  for (const row of ['r1-board.pngИзображение', 'r2-board-copy.pngИзображение', 'Загрузка…r2-board.pngИзображение', 'r2-board', 'Search r2-board', 'r2-board.png']) {
    assert.equal(readyAsset(row, 'r2-board'), false, row);
  }
});
test('both Flow hosts supported; ambiguous projects fail rather than switch', () => {
  const a = { url: () => 'https://flow.google.com/project/one?x=2' };
  const b = { url: () => 'https://labs.google/fx/tools/flow/project/two' };
  assert.equal(selectProject([a]), a);
  assert.throws(() => selectProject([a, b]), /несколько/);
  assert.equal(selectProject([a, b], a.url()), a);
  assert.equal(projectURL('https://flow.google.com.evil.test/project/one'), null);
  assert.equal(projectURL('https://flow.google.com/'), null);
});
test('missing sound, wrong duration and non-contiguous parts rejected', () => {
  assert.throws(() => validatePart({ audio: false, duration: 8 }, 8), /звука/);
  assert.throws(() => validatePart({ audio: true, duration: 4 }, 9), /Длительность/);
  assert.doesNotThrow(() => validatePart({ audio: true, duration: 8.94 }, 8.9));
  assert.throws(() => validateProject({ parts: [{ n: 2, duration: 8 }] }), /нумерация/);
});
