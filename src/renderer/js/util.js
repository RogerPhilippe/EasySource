// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Utilitários de DOM, formatação e ícones (SVG próprios, sem assets de terceiros).
import { t, LANG } from './i18n.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dia/mês/ano nos idiomas que usam essa ordem; ano-mês-dia nos demais. A data tem sempre 10 caracteres.
const DATE_SEP = { 'pt-BR': '/', es: '/', fr: '/', de: '.', ru: '.' };

export function fmtDate(unix) {
  const d = new Date(unix * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const sep = DATE_SEP[LANG];
  if (!sep) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
  return `${p(d.getDate())}${sep}${p(d.getMonth() + 1)}${sep}${d.getFullYear()} ${time}`;
}

export function relDate(unix) {
  const s = Date.now() / 1000 - unix;
  if (s < 60) return t('now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n} d ago', { n: Math.floor(s / 86400) });
  return fmtDate(unix).slice(0, 10);
}

// Nome do gerenciador de arquivos do sistema, para rótulos ("Mostrar no Explorer/Finder").
export function fileManager() {
  const p = window.app?.info?.platform;
  return p === 'darwin' ? 'Finder' : p === 'win32' ? 'Explorer' : t('file manager');
}

export const basename = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
export const joinPath = (a, b) => `${a.replace(/[\\/]+$/, '')}/${b}`;

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function hashColor(str, s = 55, l = 50) {
  let hsh = 0;
  for (const ch of str || '') hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hsh) % 360} ${s}% ${l}%)`;
}

export function avatar(name, email) {
  return h('span', { class: 'avatar', style: { background: hashColor(email || name) }, title: `${name} <${email}>` }, initials(name));
}

const P = {
  commit: '<circle cx="12" cy="12" r="4"/><path d="M2 12h6M16 12h6"/>',
  pull: '<path d="M12 3v13M6 11l6 6 6-6"/><path d="M4 21h16"/>',
  push: '<path d="M12 21V8M6 13l6-6 6 6"/><path d="M4 3h16"/>',
  fetch: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-12 3-12 7"/>',
  merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="14" r="2"/><path d="M6 7v10M6 7c0 5 6 7 10 7"/>',
  stash: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
  discard: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  flow: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
  remote: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M20 4v5h-5M4 20v-5h5"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  repo: '<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z"/><path d="M5 17a2 2 0 0 1 2-2h12"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9z"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  chevron: '<path d="M15 6l-6 6 6 6"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = `icon icon-${name}`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export const STATUS_LABEL = { M: t('Modified'), A: t('Added'), D: t('Deleted'), R: t('Renamed'), C: t('Copied'), '?': t('Untracked'), U: t('Conflict'), T: t('Type changed') };

export function statusBadge(st) {
  const s = st === '?' ? '?' : st;
  return h('span', { class: `st st-${s === '?' ? 'u' : s}`, title: STATUS_LABEL[s] || s }, s === '?' ? '?' : s);
}

export function toast(msg, kind = 'info', ms = 4000) {
  const root = document.getElementById('toast-root');
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  t.addEventListener('click', () => t.remove());
  root.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? ms * 2.5 : ms);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Divisor arrastável entre dois painéis (flex). dir: 'h' (lado a lado) ou 'v' (empilhado).
export function splitter(dir, first, key) {
  const el = h('div', { class: `splitter splitter-${dir}` });
  const saved = key && localStorage.getItem(`split:${key}`);
  if (saved) first.style.flexBasis = saved;
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = dir === 'h' ? e.clientX : e.clientY;
    const rect = first.getBoundingClientRect();
    const size0 = dir === 'h' ? rect.width : rect.height;
    document.body.classList.add(`resizing-${dir}`);
    const move = (ev) => {
      const d = (dir === 'h' ? ev.clientX : ev.clientY) - start;
      first.style.flexBasis = `${Math.max(80, size0 + d)}px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove(`resizing-${dir}`);
      if (key) try { localStorage.setItem(`split:${key}`, first.style.flexBasis); } catch { /* noop */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  return el;
}
