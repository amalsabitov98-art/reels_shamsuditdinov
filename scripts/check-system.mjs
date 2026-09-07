import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function command(name, args = ['--version']) {
  const result = spawnSync(name, args, { encoding: 'utf8', shell: false });
  return { ok: result.status === 0, version: (result.stdout || result.stderr || '').split(/\r?\n/)[0].trim() };
}

const checks = {
  node: command(process.execPath, ['--version']),
  python: command(process.platform === 'win32' ? 'python' : 'python3'),
  ffmpeg: command('ffmpeg', ['-version']),
  ffprobe: command('ffprobe', ['-version']),
  chrome: { ok: process.platform !== 'win32' || [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).some(existsSync), version: '' },
};

for (const [name, value] of Object.entries(checks)) {
  console.log(`${value.ok ? '✅' : '❌'} ${name}${value.version ? ` — ${value.version}` : ''}`);
}
if (Object.values(checks).some(x => !x.ok)) process.exitCode = 1;

export { checks };
