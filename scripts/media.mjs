import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

export function probe(file) {
  const data = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }));
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = data.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(video?.duration || data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) {
    throw new Error('Файл не содержит читаемого видео. Выберите скачанный MP4, а не картинку или HTML.');
  }
  return { duration, width: video.width, height: video.height, audio: Boolean(audio) };
}

export async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function validatePart(media, expectedDuration) {
  if (!media.audio) throw new Error('В этой части нет звука. Экспортируйте из Flow видео со звуком.');
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) throw new Error('Некорректная длительность исходной части.');
  // A frame or encoder padding is fine; whole missing/repeated phrases are not.
  if (Math.abs(media.duration - expectedDuration) > Math.max(0.6, expectedDuration * 0.1)) {
    throw new Error(`Длительность ${media.duration.toFixed(2)} с вместо ${expectedDuration.toFixed(2)} с. Проверьте номер части и её полноту.`);
  }
}

export function validateProject(project) {
  if (!Array.isArray(project.parts) || !project.parts.length) throw new Error('Нет частей проекта.');
  for (const [i, part] of project.parts.entries()) {
    if (part.n !== i + 1 || !Number.isFinite(part.duration) || part.duration <= 0) throw new Error('Нарушена нумерация или длительность частей.');
  }
  return project.parts;
}
