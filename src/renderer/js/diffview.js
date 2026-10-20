// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Visualizador de diff unificado com ações por hunk e por linhas.
import { h } from './util.js';
import { t } from './i18n.js';

// mode: 'unstaged' | 'staged' | 'untracked' | 'commit' | 'conflict'
export function renderDiff(container, files, { mode = 'commit', onAction, empty = t('No changes to display') } = {}) {
  container.innerHTML = '';
  if (!files || !files.length) {
    container.append(h('div', { class: 'empty' }, empty));
    return;
  }
  for (const file of files) {
    const wrap = h('div', { class: 'diff-file' });
    if (file.binary) {
      wrap.append(h('div', { class: 'diff-hunk-head' }, h('span', {}, t('Binary file'))));
      container.append(wrap);
      continue;
    }
    if (!file.hunks.length) {
      const meta = file.header.filter((l) => /^(new|deleted|old|similarity|rename)/.test(l)).join('\n');
      wrap.append(h('div', { class: 'empty' }, meta || t('No content changes')));
    }
    file.hunks.forEach((hunk) => wrap.append(renderHunk(file, hunk, mode, onAction)));
    container.append(wrap);
  }
}

function renderHunk(file, hunk, mode, onAction) {
  const selected = new Set();
  let anchor = null;
  const lineEls = [];
  const buttons = h('span', { class: 'diff-hunk-actions' });
  const head = h('div', { class: 'diff-hunk-head' }, h('span', { class: 'diff-hunk-title' }, hunk.header), buttons);

  const act = (action) => onAction && onAction(file, hunk, selected.size ? [...selected] : null, action);
  const refreshButtons = () => {
    buttons.innerHTML = '';
    const lines = selected.size > 0;
    if (mode === 'unstaged') {
      buttons.append(
        h('button', { class: 'btn btn-sm', onclick: () => act('stage') }, lines ? t('Stage lines') : t('Stage hunk')),
        h('button', { class: 'btn btn-sm btn-danger-text', onclick: () => act('discard') }, lines ? t('Discard lines') : t('Discard hunk')),
      );
    } else if (mode === 'staged') {
      buttons.append(h('button', { class: 'btn btn-sm', onclick: () => act('unstage') }, lines ? t('Unstage lines') : t('Unstage hunk')));
    }
  };
  refreshButtons();

  const body = h('div', { class: 'diff-lines' });
  let oldN = hunk.oldStart;
  let newN = hunk.newStart;
  hunk.lines.forEach((l, i) => {
    const k = l[0];
    let o = '';
    let n = '';
    if (k === ' ') { o = oldN++; n = newN++; } else if (k === '-') { o = oldN++; } else if (k === '+') { n = newN++; }
    const cls = k === '+' ? 'add' : k === '-' ? 'del' : k === '\\' ? 'meta' : 'ctx';
    const el = h('div', { class: `dl dl-${cls}` },
      h('span', { class: 'ln' }, o), h('span', { class: 'ln' }, n),
      h('span', { class: 'code' }, l.slice(1) || ' '));
    const selectable = (k === '+' || k === '-') && (mode === 'unstaged' || mode === 'staged');
    if (selectable) {
      el.classList.add('selectable');
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.shiftKey && anchor != null) {
          const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
          for (let k = a; k <= b; k++) if ('+-'.includes(hunk.lines[k][0])) selected.add(k);
        } else if (selected.has(i)) selected.delete(i);
        else { selected.add(i); anchor = i; }
        lineEls.forEach((le, k) => le.classList.toggle('sel', selected.has(k)));
        refreshButtons();
      });
    }
    lineEls.push(el);
    body.append(el);
  });
  return h('div', { class: 'diff-hunk' }, head, body);
}
