#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean);
const chrome = candidates.find(existsSync);
if (!chrome) throw new Error('Google Chrome не найден. Запустите INSTALL.bat.');

const port = 9222;
const profile = join(ROOT, 'auth', 'chatgpt-profile');
spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--new-window',
  'https://chatgpt.com/',
], { detached: true, stdio: 'ignore' }).unref();

console.log('ChatGPT открыт. Войдите в аккаунт один раз и не закрывайте окно во время генерации.');
