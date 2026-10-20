// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Cada idioma em src/locales precisa traduzir exatamente as chaves t('…') usadas
// no código, mantendo os mesmos {marcadores}.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LANGS } = require('../src/i18n');

const src = path.join(__dirname, '..', 'src');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : sources(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

function usedKeys() {
  const keys = new Set();
  for (const file of sources(src)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return keys;
}

const marks = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');

test('cada idioma traduz todas as chaves usadas, e só elas', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 100, `poucas chaves encontradas (${keys.size})`);
  for (const { code } of LANGS.filter((l) => l.code !== 'en')) {
    const dict = JSON.parse(fs.readFileSync(path.join(src, 'locales', `${code}.json`), 'utf8'));
    const missing = [...keys].filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !keys.has(k));
    assert.deepStrictEqual(missing, [], `${code}: chaves sem tradução`);
    assert.deepStrictEqual(extra, [], `${code}: chaves que o código não usa`);
    for (const k of keys) {
      assert.ok(dict[k].trim(), `${code}: tradução vazia para "${k}"`);
      assert.strictEqual(marks(dict[k]), marks(k), `${code}: marcadores diferentes em "${k}"`);
    }
  }
});

test('resolve escolhe o idioma salvo, depois o do sistema, depois inglês', () => {
  const { resolve } = require('../src/i18n');
  assert.strictEqual(resolve('es', ['pt-BR']), 'es');
  assert.strictEqual(resolve('system', ['pt-PT', 'en-US']), 'pt-BR');
  assert.strictEqual(resolve('system', ['zh-TW', 'ja-JP']), 'ja');
  assert.strictEqual(resolve('system', ['zh-Hans-CN']), 'zh-CN');
  assert.strictEqual(resolve('system', ['it-IT']), 'en');
});
