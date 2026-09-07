#!/usr/bin/env node
/**
 * flow-upload-video.mjs — заливка изображения или видео в Google Flow через CDP 9223.
 *
 * ROOT CAUSE старых попыток:
 *   • На странице по умолчанию ОДИН <input type=file> и он accept=image/* (инпут картинок).
 *     setInputFiles видео туда → Flow молча отбрасывает («done, но видео не появляется»).
 *   • Настоящая точка загрузки — кнопка модалки СЛЕВА-ВНИЗУ "Upload media"
 *     (textContent = "uploadUpload media": иконка-лигатура 'upload' + подпись).
 *     Клик по ней ДИНАМИЧЕСКИ ИНЖЕКТИТ второй <input type=file> с
 *     accept="video/*,image/*,.heic,.heif" — вот куда должно уходить видео.
 *   • Старые скрипты: (а) матчили ^Upload media$ и мимо (лигатура ломает exact-match);
 *     (б) кликали "Uploads" в ЛЕВОМ САЙДБАРЕ ПРИЛОЖЕНИЯ (не в модалке) и попадали на
 *     верхний "+Add Media", который видео-инпут НЕ инжектит.
 *
 * FIX: открыть композер "+" → кликнуть модальный "Upload media" → setInputFiles на
 *      инпут с accept, содержащим video → дождаться появления новой плитки/asset-id.
 *
 * Ограничения: НИКОГДА не жмёт Generate/Send. hard process.exit(0), без browser.close().
 * Usage: node scripts/flow-upload-video.mjs "d:\\...\\sysv1.mp4"
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.argv[2];
if (!FILE) { console.error('usage: node scripts/flow-upload-video.mjs "<abs path .mp4>"'); process.exit(2); }
const ABS = path.resolve(FILE);
if (!existsSync(ABS)) { console.error('файл не найден:', ABS); process.exit(2); }
const sizeMB = (statSync(ABS).size / 1048576).toFixed(2);
const BASE = path.basename(ABS);
const NOEXT = BASE.replace(/\.[^.]+$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA = path.join(ROOT, 'workspace', 'reels', '_qa');
mkdirSync(QA, { recursive: true });

const b = await chromium.connectOverCDP(process.env.FLOW_CDP || 'http://127.0.0.1:9223');
const isFlowProject = url => /^https:\/\/(?:flow\.google\.com\/project\/|labs\.google\/fx\/tools\/flow\/project\/)/i.test(url);
const p = b.contexts()[0].pages().find(x => isFlowProject(x.url()));
if (!p) { console.error('НЕТ вкладки проекта Flow (ожидается flow.google.com/project/...)'); process.exit(9); }
await p.bringToFront();
console.log(`file: ${ABS} (${sizeMB} MB)`);

// ── сеть: отделяем настоящие upload-эндпоинты от телеметрии ─────────────────
const TELEMETRY = /batchLogFrontendEvents|fetchUserAcknowledgement|credits|clientstreamz|google-analytics|\/g\/collect|gstatic|fonts|\.css|\.js(\?|$)/i;
const UPLOADISH = /upload|scotty|resumable|blobstore|media\.(create|upload)|uploads\b/i;
const netUpload = [];
p.on('response', r => {
  const u = r.url();
  if (TELEMETRY.test(u)) return;
  if (UPLOADISH.test(u)) netUpload.push({ st: r.status(), m: r.request().method(), u: u.slice(0, 120) });
});

// safety net: если клик вызовет системный file chooser — обслужим его
let chooserHandled = false;
let method = '';
p.on('filechooser', async fc => {
  try {
    await fc.setFiles(ABS);
    chooserHandled = true;
    method = 'filechooser';
    console.log('filechooser -> setFiles OK');
  }
  catch (e) { console.log('filechooser err:', e.message); }
});

// В новом flow.google.com input уже может присутствовать в DOM и больше не
// требовать промежуточной кнопки "Upload media". Проверяем все подходящие input.
async function setExistingFileInput(stage) {
  const loc = p.locator('input[type=file]');
  const n = await loc.count();
  const wantsVideo = /\.(mp4|mov|webm)$/i.test(ABS);
  const accepts = [];
  const candidates = [];
  for (let i = 0; i < n; i++) {
    const accept = (await loc.nth(i).getAttribute('accept')) || '';
    accepts.push(accept);
    if (!accept || /\*/.test(accept) || (wantsVideo ? /video/i.test(accept) : /image/i.test(accept))) candidates.push(i);
  }
  console.log(`${stage}: file inputs =`, JSON.stringify(accepts));
  for (const i of candidates.reverse()) {
    try {
      await loc.nth(i).setInputFiles(ABS);
      chooserHandled = true;
      method = `input#${i} (${stage}, accept=${accepts[i] || 'any'})`;
      console.log('->', method);
      return true;
    } catch (e) {
      console.log(`input#${i} rejected:`, e.message.split('\n')[0]);
    }
  }
  return false;
}

// Последний вариант для нового пустого проекта — настоящий drop событиями на
// область с текстом "перетащите медиафайлы". Части короткие, поэтому передача
// файла через CDP не создаёт заметной нагрузки.
async function dropOnWorkspace() {
  const ext = path.extname(ABS).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'video/mp4';
  const base64 = readFileSync(ABS).toString('base64');
  const dt = await p.evaluateHandle(({ data, name, type }) => {
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type }));
    return transfer;
  }, { data: base64, name: BASE, type: mime });
  const hint = p.getByText(/перетащите медиафайлы|drag.*media/i).first();
  const target = await hint.count() ? hint : p.locator('body');
  try {
    await target.dispatchEvent('dragenter', { dataTransfer: dt });
    await target.dispatchEvent('dragover', { dataTransfer: dt });
    await target.dispatchEvent('drop', { dataTransfer: dt });
    chooserHandled = true;
    method = 'drag-and-drop';
    console.log('-> drag-and-drop OK');
    return true;
  } catch (e) {
    console.log('drag-and-drop err:', e.message.split('\n')[0]);
    return false;
  } finally {
    await dt.dispose();
  }
}

// ── снапшот строк пикера (имя + Image/Video) для диффа ──────────────────────
async function pickerRows() {
  return p.evaluate(() => {
    const rows = [];
    for (const e of document.querySelectorAll('div,li')) {
      const r = e.getBoundingClientRect();
      if (r.width < 200 || r.width > 780 || r.height < 40 || r.height > 110) continue;
      if (r.x > innerWidth * 0.62) continue;
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/(Image|Video|Изображение|Видео)$/.test(t)) continue;
      rows.push({ t: t.slice(0, 46), y: Math.round(r.y) });
    }
    const out = [];
    for (const row of rows.sort((a, b) => a.y - b.y)) if (!out.some(o => Math.abs(o.y - row.y) < 14)) out.push(row);
    return out.map(o => o.t);
  });
}
async function scrollListTop() { await p.mouse.move(790, 400); await p.mouse.wheel(0, -2500); await wait(400); }

await p.keyboard.press('Escape'); await wait(600);
let before = [];

// 1) Новый Flow часто держит подходящий input прямо на странице.
let uploadStarted = await setExistingFileInput('initial');

// 2) Если input пока нет, открываем композер "+". В разных версиях Flow это
// либо сразу file chooser, либо меню с ещё одной кнопкой загрузки.
if (!uploadStarted) {
  const plus = await p.evaluate(() => {
    const all = [...document.querySelectorAll('button,[role="button"]')];
    const e = all.find(x => {
      const text = (x.textContent || '').trim();
      const label = `${x.getAttribute('aria-label') || ''} ${x.getAttribute('title') || ''}`;
      const r = x.getBoundingClientRect();
      return r.y > innerHeight * 0.7 && (/add_2|^add$|^\+$/i.test(text) || /add media|upload|добав|загруз/i.test(label));
    });
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (plus) {
    await p.mouse.click(plus.x, plus.y); await wait(1800);
    await scrollListTop();
    before = await pickerRows();
    console.log('picker rows before:', before.length, JSON.stringify(before));

    // Повторный запуск после частичного сбоя: ассеты загружаются строго парами
    // board/snd для каждой части. Если нужный порядковый слот уже присутствует,
    // Flow проигнорирует тот же файл как дубль — поэтому сразу считаем его готовым.
    const slot = NOEXT.match(/(\d+)-(board|snd)$/i);
    if (slot) {
      const part = Number(slot[1]);
      const requiredRows = (part - 1) * 2 + (/snd$/i.test(slot[2]) ? 2 : 1);
      if (before.length >= requiredRows) {
        console.log(`ALREADY UPLOADED: ${NOEXT} (слот ${requiredRows}, в проекте ${before.length})`);
        process.exit(0);
      }
    }
    uploadStarted = chooserHandled || await setExistingFileInput('after +');
  } else {
    console.log('composer + не найден, пробую drag-and-drop');
  }
}

// 2) кнопка модалки "Upload media" (contains, самая маленькая; лигатура в тексте — ищем contains)
async function findUploadMedia() {
  return p.evaluate(() => {
    const c = [...document.querySelectorAll('button,[role="button"]')].map(e => {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim(); const r = e.getBoundingClientRect();
      return { t, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: r.width, h: r.height };
    }).filter(o => o.w > 0 && o.h > 0 && /Upload media|Medya yükle|Загрузить (медиа|медиафайл)/i.test(o.t) && o.t.length < 40);
    c.sort((a, b) => a.w * a.h - b.w * b.h);
    return c[0] || null;
  });
}
let umBtn = await findUploadMedia();
console.log('Upload media btn:', JSON.stringify(umBtn));
if (!uploadStarted && umBtn) {
  await p.mouse.click(umBtn.x, umBtn.y);
  await wait(2000);
  uploadStarted = chooserHandled || await setExistingFileInput('after Upload media');
}

// 3) В новом пустом проекте основным UX может быть только drag-and-drop.
if (!uploadStarted) uploadStarted = await dropOnWorkspace();
if (!uploadStarted) {
  await p.screenshot({ path: QA + '/upvid-noupload.png' });
  const controls = await p.evaluate(() => [...document.querySelectorAll('button,[role="button"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => `${(e.textContent || '').replace(/\s+/g, ' ').trim()} | ${e.getAttribute('aria-label') || ''}`)
    .filter(Boolean).slice(-40));
  console.error('НЕ найдена точка загрузки. Видимые кнопки:', JSON.stringify(controls));
  process.exit(5);
}
await wait(1500);
await p.screenshot({ path: QA + '/upvid-after-set.png' });

// 4) ждём обработку/транскод; поллим появление новой строки в пикере (Recent → сверху)
let newRows = [], ok = false, nameSeen = false;
for (let t = 0; t < 30 && !ok; t++) {
  await wait(4000);
  await scrollListTop();
  const now = await pickerRows();
  newRows = now.filter(s => !before.includes(s));
  nameSeen = await p.evaluate(nx => (document.body.innerText || '').includes(nx), NOEXT).catch(() => false);
  const up2xx = netUpload.filter(x => x.st >= 200 && x.st < 300 && /POST|PUT/.test(x.m));
  process.stdout.write(`  poll ${String(t).padStart(2)}: newRows=${newRows.length} name(${NOEXT})=${nameSeen} netUpload=${netUpload.length} 2xx-POST/PUT=${up2xx.length}\n`);
  if (newRows.length > 0 || nameSeen || up2xx.length > 0) ok = true;
}

await p.screenshot({ path: QA + '/upvid-final.png' });
console.log('\n──────── RESULT ────────');
console.log('method      :', method);
console.log('new rows    :', newRows.length, newRows.slice(0, 8));
console.log('name seen   :', nameSeen, `(${NOEXT})`);
console.log('net uploads :', netUpload.length);
netUpload.slice(-10).forEach(x => console.log(`   [${x.st}] ${x.m} ${x.u}`));
console.log('VERDICT     :', ok ? 'UPLOAD CONFIRMED ✅' : `NOT CONFIRMED ❌ (см. ${QA})`);
process.exit(ok ? 0 : 1);
