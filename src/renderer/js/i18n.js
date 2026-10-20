// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Traduções da interface. O dicionário do idioma escolhido chega pronto pelo
// preload, então t() já funciona ao carregar os módulos. As chaves são os textos
// em inglês; termos do Git (commit, push, branch…) ficam em inglês em todos os idiomas.
const { lang, dict, langs } = window.api.i18n;

export const LANG = lang;
export const LANGS = langs;

// t('Delete {name}', { name }) -> texto traduzido com as variáveis preenchidas.
export function t(key, vars) {
  const s = dict[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
