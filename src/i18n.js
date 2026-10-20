// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Traduções do processo principal. As chaves são os textos em inglês (idioma
// padrão); cada outro idioma tem um JSON em src/locales com a tradução de cada chave.
// O renderer recebe o mesmo dicionário pelo preload (ver src/renderer/js/i18n.js).
const fs = require('fs');
const path = require('path');

const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'es', name: 'Español' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' },
];

let lang = 'en';
let dict = {};

// Preferência salva, ou ("system") o primeiro idioma do sistema que tivermos; senão inglês.
function resolve(pref, systemLocales = []) {
  const codes = LANGS.map((l) => l.code);
  if (codes.includes(pref)) return pref;
  for (const loc of systemLocales) {
    const l = String(loc).toLowerCase();
    // Chinês tradicional não é atendido pelo simplificado.
    if (/^zh-(tw|hk|mo|hant)/.test(l)) continue;
    const hit = codes.find((c) => c.toLowerCase() === l) || codes.find((c) => c.split('-')[0].toLowerCase() === l.split('-')[0]);
    if (hit) return hit;
  }
  return 'en';
}

function setLang(code) {
  lang = LANGS.some((l) => l.code === code) ? code : 'en';
  dict = {};
  if (lang !== 'en') {
    try { dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${lang}.json`), 'utf8')); } catch { /* sem arquivo: inglês */ }
  }
}

// t('Delete {name}', { name }) -> texto traduzido com as variáveis preenchidas.
function t(key, vars) {
  const s = dict[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

module.exports = { LANGS, resolve, setLang, t, get lang() { return lang; }, get dict() { return dict; } };
