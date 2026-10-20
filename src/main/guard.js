// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Validação do que o renderer pode pedir ao processo principal. O renderer não é
// confiável: um XSS não pode virar execução de código nem escrita fora do esperado.
const path = require('path');
const { t } = require('../i18n');

// Subcomandos git que a interface usa.
const SUBCOMMANDS = new Set([
  '--version', 'add', 'am', 'apply', 'archive', 'branch', 'checkout', 'cherry-pick', 'clone',
  'commit', 'config', 'diff', 'fetch', 'format-patch', 'init', 'log', 'ls-files', 'merge',
  'pull', 'push', 'rebase', 'remote', 'reset', 'rev-parse', 'revert', 'rm', 'show', 'stash',
  'submodule', 'tag',
]);

// Opções que executam programas ou injetam configuração, em qualquer subcomando.
const FORBIDDEN = /^--(upload-pack|receive-pack|exec|template|config|config-env|separate-git-dir)(=|$)/;
// Opções curtas perigosas só em alguns subcomandos (-u é --upload-pack em fetch/pull/clone,
// mas é --include-untracked em stash; -c é --config em clone; -x é --exec em rebase).
const FORBIDDEN_SHORT = { clone: ['-u', '-c'], fetch: ['-u'], pull: ['-u'], rebase: ['-x'] };
// Chaves de configuração que a interface grava.
const CONFIG_KEYS = /^(user\.(name|email)|gitflow\.(branch|prefix)\.[a-z]+)$/;
const CONFIG_FLAGS = new Set(['--local', '--global', '--get', '--unset']);

function fail(msg) { throw new Error(t('Operation blocked: {reason}', { reason: msg })); }

function gitArgs(args) {
  if (!Array.isArray(args) || !args.length || !args.every((a) => typeof a === 'string')) fail(t('invalid arguments'));
  const [sub, ...rest] = args;
  if (!SUBCOMMANDS.has(sub)) fail(`git ${sub}`);
  const short = FORBIDDEN_SHORT[sub] || [];
  for (const a of rest) {
    if (FORBIDDEN.test(a) || short.some((s) => a === s || (a.startsWith(s) && !a.startsWith('--')))) fail(t('option {name}', { name: a }));
    if (/^(ext|fd)::/i.test(a)) fail(t('transport protocol not allowed'));
  }
  if (sub === 'config') {
    const names = rest.filter((a) => !CONFIG_FLAGS.has(a));
    if (!names.length || !CONFIG_KEYS.test(names[0]) || rest.some((a) => a.startsWith('-') && !CONFIG_FLAGS.has(a))) fail('git config');
  }
  return args;
}

function configKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z][\w.-]*$/.test(key)) fail(t('invalid configuration key'));
  return key;
}

function inside(file, dirs) {
  const f = path.resolve(file);
  return [...dirs].some((d) => {
    const rel = path.relative(path.resolve(d), f);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function insideRepo(file, repos) {
  if (typeof file !== 'string' || !inside(file, repos)) fail(t('path outside the open repositories'));
  return path.resolve(file);
}

function webUrl(url) {
  let u;
  try { u = new URL(url); } catch { fail(t('invalid URL')); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(`URL ${u.protocol}`);
  return u.toString();
}

// Divide "programa arg1 'arg 2'" sem usar shell.
function splitCommand(cmd) {
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) parts.push(m[1] ?? m[2] ?? m[3]);
  return parts;
}

module.exports = { gitArgs, configKey, inside, insideRepo, webUrl, splitCommand };
