// Maintainer-only packaging. Explicit allowlist: no auth, videos, diagnostics or dependencies.
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['INSTALL.bat', 'START.bat', 'README.md', 'RELIABILITY.md', 'AGENTS.md', '.gitignore', '.gitattributes',
  'package.json', 'package-lock.json', 'requirements.txt', 'docs/index.html', 'docs/app.js', 'docs/styles.css',
  'styles/kinetik.md', '.claude/skills/рилс/SKILL.md',
  ...readdirSync(join(root, 'scripts')).filter(f => /^[\w-]+\.(mjs|py|ps1)$/.test(f)).map(f => `scripts/${f}`),
  ...readdirSync(join(root, 'tests')).filter(f => /^[\w.-]+\.test\.mjs$/.test(f)).map(f => `tests/${f}`),
].sort();
const stage = mkdtempSync(join(tmpdir(), 'reels-package-'));
const archive = join(stage, 'reels-studio-1.1.zip');
execFileSync('zip', ['-q', archive, ...files], { cwd: root });
execFileSync('unzip', ['-t', archive], { stdio: 'inherit' });
copyFileSync(archive, join(root, 'docs', 'reels-studio-1.1.zip'));
console.log(`Packaged ${files.length} code/instruction files. No workspace, auth, or node_modules included.`);
