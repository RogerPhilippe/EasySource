// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const git = require('../src/main/git');

async function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easysource-test-'));
  await git.run(dir, ['init', '-q', '-b', 'main'], { quiet: true });
  await git.run(dir, ['config', 'user.name', 'Teste'], { quiet: true });
  await git.run(dir, ['config', 'user.email', 'teste@example.com'], { quiet: true });
  await git.run(dir, ['config', 'core.autocrlf', 'false'], { quiet: true });
  return dir;
}

test('parseStatus lê porcelain v2 com renomeação, untracked e conflito', () => {
  const text = [
    '# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a a src/com espaço.js',
    '2 R. N... 100644 100644 100644 a a R100 novo.txt', 'velho.txt',
    'u UU N... 100644 100644 100644 100644 a b c conflito.txt',
    '? solto.txt', '',
  ].join('\0');
  const s = git.parseStatus(text);
  assert.strictEqual(s.branch, 'main');
  assert.strictEqual(s.ahead, 2);
  assert.strictEqual(s.behind, 1);
  assert.deepStrictEqual(s.staged.map((f) => [f.status, f.path, f.orig]), [['M', 'src/com espaço.js', null], ['R', 'novo.txt', 'velho.txt']]);
  assert.deepStrictEqual(s.unstaged, [{ path: 'solto.txt', status: '?' }]);
  assert.strictEqual(s.conflicted[0].path, 'conflito.txt');
});

test('parseRefs classifica HEAD, branches, remotos e tags', () => {
  const r = git.parseRefs('HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/dev');
  assert.deepStrictEqual(r.map((x) => `${x.type}:${x.name}`), ['head:main', 'tag:v1', 'remote:origin/main', 'branch:dev']);
});

test('fluxo real: status, log, stage por linhas e unstage por hunk', async () => {
  const dir = await tmpRepo();
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'um\ndois\ntres\n');
  await git.run(dir, ['add', '.'], { quiet: true });
  await git.run(dir, ['commit', '-q', '-m', 'inicial'], { quiet: true });
  fs.writeFileSync(file, 'um\nDOIS\ntres\nquatro\n');

  let s = await git.status(dir);
  assert.strictEqual(s.unstaged[0].path, 'a.txt');

  const [fd] = await git.diff(dir, { file: 'a.txt' });
  const hunk = fd.hunks[0];
  // seleciona só a linha "+quatro"
  const idx = hunk.lines.findIndex((l) => l === '+quatro');
  const patch = git.buildPatch(fd, hunk, new Set([idx]), false);
  await git.run(dir, ['apply', '--cached', '--recount', '-'], { input: patch, quiet: true });
  const cached = (await git.run(dir, ['diff', '--cached'], { quiet: true })).stdout;
  assert.match(cached, /\+quatro/);
  assert.doesNotMatch(cached, /DOIS/);

  // unstage do hunk inteiro
  const [sd] = await git.diff(dir, { file: 'a.txt', staged: true });
  await git.run(dir, ['apply', '--cached', '-R', '--recount', '-'], { input: git.buildPatch(sd, sd.hunks[0], null, true), quiet: true });
  s = await git.status(dir);
  assert.strictEqual(s.staged.length, 0);

  // descartar só a linha "-dois/+DOIS" na cópia de trabalho
  const [wd] = await git.diff(dir, { file: 'a.txt' });
  const sel = new Set(wd.hunks[0].lines.map((l, i) => (/^[-+](dois|DOIS)$/.test(l) ? i : -1)).filter((i) => i >= 0));
  await git.run(dir, ['apply', '-R', '--recount', '-'], { input: git.buildPatch(wd, wd.hunks[0], sel, true), quiet: true });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'um\ndois\ntres\nquatro\n');

  const log = await git.log(dir, {});
  assert.strictEqual(log.length, 1);
  assert.strictEqual(log[0].subject, 'inicial');
  assert.strictEqual(log[0].refs[0].type, 'head');

  const det = await git.commitDetails(dir, log[0].sha);
  assert.deepStrictEqual(det.files, [{ status: 'A', path: 'a.txt' }]);

  const refs = await git.refs(dir);
  assert.strictEqual(refs.branches[0].name, 'main');
  assert.ok(refs.branches[0].current);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diff de arquivo não rastreado funciona no Windows (/dev/null)', async () => {
  const dir = await tmpRepo();
  fs.writeFileSync(path.join(dir, 'novo.txt'), 'oi\n');
  const d = await git.diff(dir, { file: 'novo.txt', untracked: true });
  assert.strictEqual(d.length, 1);
  assert.deepStrictEqual(d[0].hunks[0].lines, ['+oi']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('grafo: merge gera duas lanes e reconverge', async () => {
  const { computeGraph } = await import('../src/renderer/js/graph.js');
  const commits = [
    { sha: 'M', parents: ['A', 'B'] },
    { sha: 'B', parents: ['C'] },
    { sha: 'A', parents: ['C'] },
    { sha: 'C', parents: [] },
  ];
  const g = computeGraph(commits);
  assert.strictEqual(g.maxCols, 2);
  assert.strictEqual(g.rows[0].col, 0);
  assert.strictEqual(g.rows[1].col, 1);
  assert.strictEqual(g.rows[2].col, 0);
  assert.strictEqual(g.rows[3].col, 0);
  // a lane de B converge em diagonal para a coluna 0 na linha de A
  assert.ok(g.rows[2].segs.some((s) => s[0] === 1 && s[2] === 0 && s[3] === 1));
});
