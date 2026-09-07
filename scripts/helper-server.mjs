#!/usr/bin/env node
import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, validatePart, validateProject, digest } from './media.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REELS = process.env.REELS_WORKSPACE ? resolve(process.env.REELS_WORKSPACE) : join(ROOT, 'workspace', 'reels');
const UPLOADS = join(REELS, '_uploads');
const PORT = Number(process.env.REELS_PORT || 3210);
const PAGES_URL = process.env.REELS_SITE || 'https://amalsabitov98-art.github.io/reels_shamsuditdinov/';
const PAGES_ORIGIN = new URL(PAGES_URL).origin;
const jobs = new Map();
mkdirSync(UPLOADS, { recursive: true });

const safe = (value, fallback = 'reel') => {
  const out = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return out || fallback;
};
const python = existsSync(join(ROOT, '.venv', 'Scripts', 'python.exe'))
  ? join(ROOT, '.venv', 'Scripts', 'python.exe')
  : (process.platform === 'win32' ? 'python' : 'python3');

function startJob(label, command, args) {
  if ([...jobs.values()].some(j => j.status === 'running')) throw Object.assign(new Error('Другая задача ещё выполняется. Дождитесь окончания.'), { status: 409 });
  const id = randomUUID();
  const job = { id, label, status: 'running', log: '', startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const child = spawn(command, args, { cwd: ROOT, env: process.env, shell: false });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const append = chunk => { job.log = (job.log + chunk.toString()).slice(-80000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => { append(`\n${error.message}\n`); job.status = 'failed'; job.finishedAt = new Date().toISOString(); });
  child.on('close', code => {
    job.exitCode = code;
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
  });
  return job;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 1536 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /video|mp4|quicktime|webm/i.test(`${file.mimetype} ${extname(file.originalname)}`)),
});

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !origin || origin === 'null' || origin === PAGES_ORIGIN || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (!allowed) return res.status(403).json({ error: 'Этот сайт не может управлять локальным движком.' });
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(ROOT, 'docs')));
// Reserve all mutations, including the time spent receiving an imported video.
let mutationPending = false;
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT'].includes(req.method)) return next();
  if (mutationPending || [...jobs.values()].some(j => j.status === 'running')) return res.status(409).json({ error: 'Задача ещё выполняется. Дождитесь окончания перед следующим действием.' });
  mutationPending = true;
  let released = false;
  const release = () => { if (!released) { released = true; mutationPending = false; } };
  res.on('finish', release);
  res.on('close', release);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, name: 'Reels Studio', version: '1.1.0', job: [...jobs.values()].find(j => j.status === 'running') || null }));
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена.' });
  res.json(job);
});
app.get('/api/projects', (_req, res) => {
  const projects = readdirSync(REELS, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => {
      try { return JSON.parse(readFileSync(join(REELS, entry.name, 'project.json'), 'utf8')); }
      catch { return null; }
    }).filter(Boolean).sort((a, b) => a.slug.localeCompare(b.slug));
  res.json(projects);
});

app.post('/api/projects', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Выберите видео MP4, MOV или WEBM.' });
  let slug = safe(req.body.slug, `reel-${Date.now()}`);
  if (existsSync(join(REELS, slug, 'project.json'))) slug = `${slug.slice(0, 39)}-${String(Date.now()).slice(-8)}`;
  const prefix = safe(req.body.prefix, 'r').slice(0, 12);
  const lang = ['ru', 'en', 'auto'].includes(req.body.lang) ? req.body.lang : 'ru';
  const job = startJob(`Подготовка ${slug}`, python, [
    join(ROOT, 'scripts', 'split-video.py'), req.file.path, '--slug', slug, '--prefix', prefix, '--lang', lang,
  ]);
  res.status(202).json({ job, slug });
});

function projectFile(slug, name) {
  return join(REELS, safe(slug), name);
}
app.get('/api/projects/:slug', (req, res) => {
  try {
    const project = JSON.parse(readFileSync(projectFile(req.params.slug, 'project.json'), 'utf8'));
    const spec = JSON.parse(readFileSync(projectFile(req.params.slug, 'sb-spec.json'), 'utf8'));
    const approvedPath = projectFile(req.params.slug, 'approved-parts.json');
    const approved = existsSync(approvedPath) ? JSON.parse(readFileSync(approvedPath, 'utf8')) : {};
    res.json({ project: { ...project, hasFinal: existsSync(projectFile(req.params.slug, 'final.mp4')) }, spec, approved });
  } catch { res.status(404).json({ error: 'Проект не найден или ещё готовится.' }); }
});
app.put('/api/projects/:slug/spec', (req, res) => {
  const spec = req.body;
  if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) return res.status(400).json({ error: 'В спеке нет частей.' });
  const path = projectFile(req.params.slug, 'sb-spec.json');
  if (!existsSync(dirname(path))) return res.status(404).json({ error: 'Проект не найден.' });
  const original = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['slug', 'prefix', 'outDir', 'framesDir', 'srcDir']) {
    if (spec[key] !== original[key]) return res.status(400).json({ error: `Поле ${key} менять нельзя. Редактируйте описания кадров.` });
  }
  if (JSON.stringify(spec.parts.map(p => p.n)) !== JSON.stringify(original.parts.map(p => p.n))) return res.status(400).json({ error: 'Нумерацию частей менять нельзя.' });
  writeFileSync(path, JSON.stringify(spec, null, 2), 'utf8');
  res.json({ ok: true });
});

app.post('/api/actions/chatgpt', (_req, res) => {
  const job = startJob('Запуск ChatGPT', process.execPath, [join(ROOT, 'scripts', 'chatgpt-launch.mjs')]);
  res.status(202).json({ job });
});
app.post('/api/actions/flow', (_req, res) => {
  const job = startJob('Запуск Google Flow', process.execPath, [join(ROOT, 'scripts', 'flow-launch.mjs')]);
  res.status(202).json({ job });
});
app.post('/api/actions/flow-diagnose', (_req, res) => {
  res.status(202).json({ job: startJob('Диагностика Flow — без генерации', process.execPath, [join(ROOT, 'scripts', 'flow-diagnose.mjs')]) });
});
app.get('/api/flow-diagnostic', (_req, res) => {
  const path = join(REELS, '_qa', 'flow-diagnostic.json');
  if (!existsSync(path)) return res.status(404).json({ error: 'Сначала запустите диагностику.' });
  res.download(path, 'flow-diagnostic.json');
});
app.post('/api/projects/:slug/approved/:n', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Выберите видео со звуком.' });
  const project = JSON.parse(readFileSync(projectFile(req.params.slug, 'project.json'), 'utf8'));
  const part = validateProject(project).find(p => String(p.n) === req.params.n);
  if (!part) return res.status(400).json({ error: 'Такой части нет.' });
  const media = probe(req.file.path);
  validatePart(media, part.duration);
  const sha256 = await digest(req.file.path);
  const dir = projectFile(req.params.slug, 'approved');
  mkdirSync(dir, { recursive: true });
  const file = `part-${part.n}-${randomUUID()}.mp4`;
  renameSync(req.file.path, join(dir, file));
  const path = projectFile(req.params.slug, 'approved-parts.json');
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  manifest[part.n] = { file, originalName: req.file.originalname, sha256, ...media };
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  res.json({ ok: true, part: manifest[part.n] });
});
app.get('/api/projects/:slug/approved/:n', (req, res) => {
  const path = projectFile(req.params.slug, 'approved-parts.json');
  if (!existsSync(path)) return res.status(404).end();
  const entry = JSON.parse(readFileSync(path, 'utf8'))[req.params.n];
  if (!entry || !/^part-\d+-[a-f0-9-]+\.mp4$/.test(entry.file)) return res.status(404).end();
  res.sendFile(projectFile(req.params.slug, join('approved', entry.file)));
});
app.post('/api/projects/:slug/assemble-approved', (req, res) => {
  if (req.body?.reviewed !== true) return res.status(400).json({ error: 'Сначала просмотрите части и подтвердите порядок и речь.' });
  res.status(202).json({ job: startJob('Сборка выбранных частей — без Flow', process.execPath,
    [join(ROOT, 'scripts', 'assemble-approved.mjs'), dirname(projectFile(req.params.slug, 'project.json'))]) });
});
app.post('/api/projects/:slug/storyboards', (req, res) => {
  const spec = projectFile(req.params.slug, 'sb-spec.json');
  if (!existsSync(spec)) return res.status(404).json({ error: 'Сначала подготовьте видео.' });
  const job = startJob(`Сториборды ${req.params.slug}`, process.execPath, [join(ROOT, 'scripts', 'storyboard-batch.mjs'), spec]);
  res.status(202).json({ job });
});
app.post('/api/projects/:slug/flow', (req, res) => {
  const spec = projectFile(req.params.slug, 'sb-spec.json');
  if (!existsSync(spec)) return res.status(404).json({ error: 'Сначала подготовьте видео.' });
  const job = startJob(`Монтаж ${req.params.slug}`, process.execPath, [join(ROOT, 'scripts', 'run-flow.mjs'), spec]);
  res.status(202).json({ job });
});
app.post('/api/projects/:slug/verify', (req, res) => {
  const final = projectFile(req.params.slug, 'final.mp4');
  if (!existsSync(final)) return res.status(404).json({ error: 'Финальный ролик ещё не собран.' });
  const job = startJob(`Проверка ${req.params.slug}`, python, [join(ROOT, 'scripts', 'transcribe.py'), final, '--txt']);
  res.status(202).json({ job });
});
app.get('/api/projects/:slug/final', (req, res) => {
  const final = projectFile(req.params.slug, 'final.mp4');
  if (!existsSync(final)) return res.status(404).json({ error: 'Финальный ролик ещё не собран.' });
  res.download(final, `${safe(req.params.slug)}-final.mp4`);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Ошибка локального движка.' });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\nReels Studio запущен: http://127.0.0.1:${server.address().port}`);
  console.log('Не закрывайте это окно во время монтажа.');
  if (process.platform === 'win32' && !process.env.REELS_NO_OPEN) {
    spawn('cmd', ['/c', 'start', '', PAGES_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});

export { safe };
