#!/usr/bin/env node
// Read-only: no clicks, uploads, prompts, cookies, storage or response bodies.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectURL } from './flow-evidence.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = { version: '1.1.0', createdAt: new Date().toISOString(), node: process.version, connected: false, projects: [] };
try {
  const browser = await chromium.connectOverCDP(process.env.FLOW_CDP || 'http://127.0.0.1:9223', { timeout: 10000 });
  report.connected = true;
  for (const page of browser.contexts().flatMap(c => c.pages()).filter(p => projectURL(p.url()))) {
    const state = await page.evaluate(() => {
      const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
      const clean = s => String(s || '').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[email]').replace(/\s+/g, ' ').trim().slice(0, 100);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        fileInputs: [...document.querySelectorAll('input[type=file]')].map(e => ({ accept: e.accept, multiple: e.multiple })),
        controls: [...document.querySelectorAll('button,[role=button]')].filter(visible).slice(0, 150).map(e => ({
          text: clean(e.textContent), label: clean(e.getAttribute('aria-label')), disabled: Boolean(e.disabled),
          lowerComposer: e.getBoundingClientRect().y > innerHeight * 0.65,
        })),
        textInputs: [...document.querySelectorAll('input:not([type=file]),textarea,[contenteditable=true]')].filter(visible).map(e => ({
          tag: e.tagName, role: e.getAttribute('role'), placeholder: clean(e.getAttribute('placeholder')), label: clean(e.getAttribute('aria-label')),
        })),
      };
    });
    report.projects.push({ url: projectURL(page.url()), ...state });
  }
  report.note = report.projects.length === 1 ? 'Структура интерфейса прочитана. Это НЕ подтверждение совместимости или успешной генерации.' : 'Нужен ровно один открытый проект Flow.';
} catch (e) {
  report.error = /ECONNREFUSED/.test(e.message) ? 'Chrome на порту 9223 не запущен. Нажмите «Открыть Flow».' : String(e.message).split('\n')[0];
}
const folder = join(root, 'workspace', 'reels', '_qa');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'flow-diagnostic.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('Отчёт сохранён. В нём могут быть названия файлов и проекта; просмотрите перед отправкой. Cookies и пароли не собирались.');
process.exit(report.connected && report.projects.length === 1 ? 0 : 1);
