#!/usr/bin/env node
// Only explicitly assigned and previewed parts. No browser, credits, order guessing,
// source-audio substitution, watermark overlays or partial finals.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FFMPEG, probe, validatePart, validateProject, digest } from './media.mjs';

export async function assembleApproved(projectDir) {
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const parts = validateProject(project);
  const manifest = JSON.parse(readFileSync(join(projectDir, 'approved-parts.json'), 'utf8'));
  const inputs = [];
  for (const part of parts) {
    const entry = manifest[part.n];
    if (!entry || !/^part-\d+-[a-f0-9-]+\.mp4$/.test(entry.file)) throw new Error(`Не выбрано видео для части ${part.n}.`);
    const path = join(projectDir, 'approved', entry.file);
    if (!existsSync(path) || await digest(path) !== entry.sha256) throw new Error(`Часть ${part.n} изменилась. Выберите файл заново.`);
    const media = probe(path);
    validatePart(media, part.duration);
    inputs.push({ path, media });
  }
  // Unique staging directory: never overwrite an earlier final while encoding.
  const tmp = mkdtempSync(join(projectDir, '_export-'));
  const ff = args => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-xerror', ...args],
    { stdio: 'inherit', windowsHide: true, timeout: 30 * 60000 });
  for (const [i, input] of inputs.entries()) {
    console.log(`Часть ${i + 1}/${inputs.length}: нормализация, звук Flow сохраняется.`);
    ff(['-i', input.path, '-map', '0:v:0', '-map', '0:a:0', '-vf',
      'scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-af', 'apad', '-t', String(input.media.duration), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', join(tmp, `${i}.mov`)]);
  }
  // Relative generated names make concat safe for Windows spaces and apostrophes.
  writeFileSync(join(tmp, 'list.txt'), inputs.map((_, i) => `file '${i}.mov'`).join('\n'));
  const staged = join(tmp, 'final.mp4');
  // PCM intermediates avoid AAC encoder-delay overlap at every join. Encode AAC once.
  ff(['-f', 'concat', '-safe', '1', '-i', join(tmp, 'list.txt'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', staged]);
  const media = probe(staged);
  const expected = inputs.reduce((sum, x) => sum + x.media.duration, 0);
  if (!media.audio || media.width !== 1080 || media.height !== 1920 || Math.abs(media.duration - expected) > 0.5) {
    throw new Error('Финал не прошёл проверку размера, звука или длительности. Предыдущий финал сохранён.');
  }
  ff(['-i', staged, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const report = { version: 1, createdAt: new Date().toISOString(), parts: parts.length, ...media,
    sha256: await digest(staged), speechVerified: false, visualVerifiedBy: 'user', stagingDirectory: tmp };
  const final = join(projectDir, 'final.mp4');
  const backup = join(projectDir, `final-backup-${randomUUID()}.mp4`);
  if (existsSync(final)) renameSync(final, backup);
  try { renameSync(staged, final); }
  catch (e) { if (existsSync(backup)) renameSync(backup, final); throw e; }
  writeFileSync(join(projectDir, 'final-check.json'), JSON.stringify(report, null, 2));
  console.log(`MP4 собран: ${parts.length} частей, ${media.duration.toFixed(2)} с, 1080×1920, звук есть, файл полностью декодируется.`);
  console.log('Смысл и точность речи автоматически НЕ подтверждены. Прослушайте финал; кнопка «Расшифровать речь» поможет сверить текст.');
  console.log(`Промежуточные файлы и предыдущий финал сохранены в папке проекта. Итог: ${final}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('usage: node scripts/assemble-approved.mjs <project-directory>');
    await assembleApproved(resolve(process.argv[2]));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
