/**
 * flow-assets-check.mjs — проверяет, что ассеты реально долетели в проект Flow.
 *
 * Ищет каждое имя через поиск В ПИКЕРЕ КОМПОЗЕРА (то же место, откуда потом цепляются
 * чипы) — левая медиатека прячет поиск за иконку и селектором не ловится.
 *
 * Usage: node scripts/flow-assets-check.mjs lv1-board lv1-snd ...
 */
import { chromium } from '@playwright/test';
import { readyAsset, selectProject, readAssetRows } from './flow-evidence.mjs';

const names = process.argv.slice(2);
if (!names.length) { console.error('usage: node scripts/flow-assets-check.mjs <name...>'); process.exit(2); }
const b = await chromium.connectOverCDP(process.env.FLOW_CDP || 'http://127.0.0.1:9223');
const p = selectProject(b.contexts().flatMap(c => c.pages()));
if (!p) { console.error('нет вкладки Flow'); process.exit(1); }
await p.bringToFront();
const wait = ms => new Promise(r => setTimeout(r, ms));

// flow-upload-video подтверждает сетевой POST раньше, чем Flow закончит локальную
// обработку. Пока видна строка «Загрузка…», композер может быть временно скрыт.
for (let i = 0; i < 60; i++) {
  const busy = await p.evaluate(() => /Загрузка…|Uploading…|Uploading|Обработка…|Processing…/i.test(document.body.innerText || ''));
  if (!busy) break;
  if (i === 59) throw new Error('Обработка ассетов не завершилась. Генерация не запускается.');
  if (i % 5 === 0) console.log('  жду завершения загрузки ассетов…');
  await wait(2000);
}

async function openPicker() {
  await p.keyboard.press('Escape'); await wait(400);
  const plus = await p.evaluate(() => {
    const e = [...document.querySelectorAll('button,[role="button"]')]
      .find(x => {
        const text = (x.textContent || '').trim();
        const label = `${x.getAttribute('aria-label') || ''} ${x.getAttribute('title') || ''}`;
        const r = x.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.y > innerHeight * 0.65
          && (/add_2|^add$|^\+$/i.test(text) || /add media|upload|добав|загруз/i.test(label));
      });
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!plus) throw new Error('кнопка композера не найдена');
  await p.mouse.click(plus.x, plus.y);
  await wait(1800);
}

await openPicker();
const box = await p.evaluate(() => {
  const i = [...document.querySelectorAll('input')].find(x => /ara|search|поиск|искать/i.test(x.placeholder || ''));
  if (!i) return null;
  const r = i.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (!box) { console.error('поле поиска в пикере не найдено'); process.exit(1); }

let missing = [];
for (const n of names) {
  await p.mouse.click(box.x, box.y); await wait(300);
  await p.keyboard.press('Control+A'); await p.keyboard.press('Delete');
  await p.keyboard.insertText(n); await wait(2400);
  const found = (await readAssetRows(p)).some(row => readyAsset(row, n));
  console.log(`  ${found ? '✅' : '❌'} ${n}`);
  if (!found) missing.push(n);
}
await p.keyboard.press('Escape');
console.log(missing.length ? `\n⚠️ не долетело: ${missing.join(', ')}` : '\n🏁 все ассеты на месте');
process.exit(missing.length ? 1 : 0);
