#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = resolve(process.argv[2] || '');
if (!process.argv[2] || !existsSync(specPath)) {
  console.error('usage: node scripts/run-flow.mjs <sb-spec.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const projectDir = dirname(specPath);
const prefix = spec.prefix || 'r';
const count = spec.parts.length;
const uploadDir = join(ROOT, 'workspace', 'reels', '_flow-upload', spec.slug);
const omniDir = join(projectDir, 'omni');
mkdirSync(uploadDir, { recursive: true });
mkdirSync(omniDir, { recursive: true });

function run(script, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: ROOT, env: process.env, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`${script} завершился с кодом ${code}`)));
  });
}

console.log(`\n=== ${spec.slug}: подготовка ${count} частей ===`);
await run('omni-prompt.mjs', [specPath]);
await run('flow-prep-uploads.mjs', [join(projectDir, 'parts'), prefix, uploadDir]);

// Проверяем комплект до первой загрузки. Иначе при отсутствующей поздней картинке
// ранние ассеты уже попадают в Flow, а повторный запуск упирается в дубликаты.
const missingBoards = [];
for (let n = 1; n <= count; n++) {
  const boardSource = join(projectDir, 'storyboard', `p${n}-board.png`);
  if (!existsSync(boardSource)) missingBoards.push(boardSource);
}
if (missingBoards.length) {
  throw new Error(`не хватает раскадровок:\n${missingBoards.join('\n')}\nСначала нажмите «Создать сториборды».`);
}

const names = [];
for (let n = 1; n <= count; n++) {
  const boardSource = join(projectDir, 'storyboard', `p${n}-board.png`);
  if (!existsSync(boardSource)) throw new Error(`нет сториборда: ${boardSource}`);
  const board = join(uploadDir, `${prefix}${n}-board.png`);
  copyFileSync(boardSource, board);
  const video = join(uploadDir, `${prefix}${n}-snd.mp4`);
  await run('flow-upload-video.mjs', [board]);
  await run('flow-upload-video.mjs', [video]);
  names.push(`${prefix}${n}-board`, `${prefix}${n}-snd`);
}

await run('flow-assets-check.mjs', names);
const after = new Date(Date.now() - 30_000).toISOString();
writeFileSync(join(projectDir, 'flow-started-at.txt'), after, 'utf8');
await run('flow-omni-queue.mjs', [prefix, join(projectDir, 'storyboard'), '1', String(count)]);

for (let n = 1; n <= count; n++) {
  const skip = count - n;
  await run('flow-dl-omni.mjs', [join(omniDir, `${prefix}${n}-omni.mp4`), '--after', after, '--skip', String(skip)]);
}

await run('omni-assemble.mjs', [omniDir, join(projectDir, 'parts'), prefix, join(projectDir, 'final.mp4'), '--no-badge']);
console.log(`\nГОТОВО: ${join(projectDir, 'final.mp4')}`);
