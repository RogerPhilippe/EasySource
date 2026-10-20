// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const guard = require('../src/main/guard');

test('gitArgs aceita os comandos usados pela interface', () => {
  for (const args of [
    ['log', '--format=%H'],
    ['stash', 'push', '-u', '-m', 'wip'],
    ['push', '--progress', '--set-upstream', 'origin', 'refs/heads/main:refs/heads/main'],
    ['config', '--local', '--get', 'user.name'],
    ['config', '--global', 'user.email', 'a@b.c'],
    ['config', 'gitflow.prefix.feature', 'feature/'],
    ['clone', '--progress', '--depth', '1', '--', 'https://example.com/r.git', '/tmp/r'],
    ['branch', '-c', 'a', 'b'],
  ]) assert.deepStrictEqual(guard.gitArgs(args), args);
});

test('gitArgs bloqueia execução de programas e configuração injetada', () => {
  for (const args of [
    ['-c', 'core.fsmonitor=calc', 'status'],
    ['status'],
    ['fetch', '--upload-pack=calc', 'origin'],
    ['fetch', '-ucalc', 'origin'],
    ['pull', '-u', 'calc'],
    ['push', '--receive-pack=calc'],
    ['push', '--exec=calc'],
    ['rebase', '-x', 'calc', 'main'],
    ['rebase', '--exec', 'calc', 'main'],
    ['clone', '-c', 'core.sshCommand=calc', 'u', 'd'],
    ['clone', '--config=core.sshCommand=calc', 'u', 'd'],
    ['clone', '--template=/tmp/hooks', 'u', 'd'],
    ['clone', 'ext::sh -c calc', 'd'],
    ['remote', 'add', 'x', 'ext::sh -c calc'],
    ['config', 'core.sshCommand', 'calc'],
    ['config', '--local', 'core.fsmonitor', 'calc'],
    ['config', '--edit'],
    [],
    'log',
  ]) assert.throws(() => guard.gitArgs(args), /blocked/, JSON.stringify(args));
});

test('insideRepo aceita só caminhos dentro de repositórios abertos', () => {
  const repo = path.resolve('/tmp/repo');
  const repos = new Set([repo]);
  assert.strictEqual(guard.insideRepo(path.join(repo, 'a', 'b.txt'), repos), path.join(repo, 'a', 'b.txt'));
  assert.throws(() => guard.insideRepo(path.join(repo, '..', 'outro', 'x'), repos));
  assert.throws(() => guard.insideRepo(path.resolve('/tmp/repo-2/x'), repos));
  assert.throws(() => guard.insideRepo(42, repos));
});

test('webUrl aceita só http(s) e splitCommand não usa shell', () => {
  assert.strictEqual(guard.webUrl('https://github.com/x'), 'https://github.com/x');
  for (const u of ['file:///C:/Windows/System32/calc.exe', 'smb://host/share', 'javascript:alert(1)', 'nada']) {
    assert.throws(() => guard.webUrl(u), /blocked/);
  }
  assert.deepStrictEqual(guard.splitCommand('wt.exe -d "C:\\Meus Projetos" --title \'a b\''), ['wt.exe', '-d', 'C:\\Meus Projetos', '--title', 'a b']);
  assert.deepStrictEqual(guard.splitCommand('kitty & calc'), ['kitty', '&', 'calc']);
});
