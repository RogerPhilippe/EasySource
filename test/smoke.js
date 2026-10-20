// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Teste de interface: abre o app num repositório de exemplo, captura a janela e
// falha se o processo morrer, se não houver captura ou se o renderer registrar erros.
// Uso: npm run test:smoke  (a captura fica em test-output/smoke.png)
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'test-output');
const shot = path.join(outDir, 'smoke.png');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'easysource-smoke-'));
const repo = path.join(tmp, 'repo');

function git(...args) {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

fs.mkdirSync(repo);
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Smoke Test');
git('config', 'user.email', 'smoke@example.com');
fs.writeFileSync(path.join(repo, 'README.md'), '# Smoke\n');
git('add', '.');
git('commit', '-q', '-m', 'Commit inicial');
git('checkout', '-q', '-b', 'feature/x');
fs.writeFileSync(path.join(repo, 'x.txt'), 'x\n');
git('add', '.');
git('commit', '-q', '-m', 'Feature X');
git('checkout', '-q', 'main');
git('merge', '-q', '--no-ff', 'feature/x', '-m', "Merge branch 'feature/x'");
git('tag', 'v1.0');
fs.appendFileSync(path.join(repo, 'README.md'), 'alteração pendente\n');

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(shot, { force: true });

const env = {
  ...process.env,
  EASYSOURCE_USERDATA: path.join(tmp, 'userdata'),
  EASYSOURCE_SCREENSHOT: shot,
  EASYSOURCE_SCREENSHOT_DELAY: '5000',
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root, repo], { env });
const errors = [];
const onData = (d) => {
  for (const line of d.toString().split('\n')) {
    if (line.includes('[renderer]')) errors.push(line.trim());
  }
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);

const timer = setTimeout(() => {
  child.kill();
  finish('o app não encerrou em 60 s');
}, 60000);

child.on('exit', (code) => {
  clearTimeout(timer);
  if (code !== 0) return finish(`o app saiu com código ${code}`);
  finish();
});

function finish(failure) {
  // Subprocessos do Electron podem segurar arquivos por alguns instantes no Windows.
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* limpeza opcional */ }
  const size = fs.existsSync(shot) ? fs.statSync(shot).size : 0;
  if (!failure && size < 10000) failure = `captura ausente ou vazia (${size} bytes)`;
  if (!failure && errors.length) failure = `erros no renderer:\n  ${errors.join('\n  ')}`;
  if (failure) {
    console.error(`✖ smoke: ${failure}`);
    process.exit(1);
  }
  console.log(`✔ smoke: app abriu o repositório sem erros (captura: ${path.relative(root, shot)}, ${size} bytes)`);
}
