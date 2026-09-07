#!/usr/bin/env node
import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REELS = join(ROOT, 'workspace', 'reels');
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
  const id = randomUUID();
  const job = { id, label, status: 'running', log: '', startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const child = spawn(command, args, { cwd: ROOT, env: process.env, shell: false });
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
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${safe(file.originalname.replace(extname(file.originalname), ''), 'source')}${extname(file.originalname).toLowerCase()}`),
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

app.get('/health', (_req, res) => res.json({ ok: true, name: 'Reels Studio', version: '1.0.0' }));
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
    res.json({ project: { ...project, hasFinal: existsSync(projectFile(req.params.slug, 'final.mp4')) }, spec });
  } catch { res.status(404).json({ error: 'Проект не найден или ещё готовится.' }); }
});
app.put('/api/projects/:slug/spec', (req, res) => {
  const spec = req.body;
  if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) return res.status(400).json({ error: 'В спеке нет частей.' });
  const path = projectFile(req.params.slug, 'sb-spec.json');
  if (!existsSync(dirname(path))) return res.status(404).json({ error: 'Проект не найден.' });
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
  res.status(500).json({ error: error.message || 'Ошибка локального движка.' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\nReels Studio запущен: http://127.0.0.1:${PORT}`);
  console.log('Не закрывайте это окно во время монтажа.');
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', PAGES_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});

export { safe };
