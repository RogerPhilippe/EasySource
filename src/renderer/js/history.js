// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Histórico (grafo de commits) e Busca.
import { h, esc, fmtDate, statusBadge, splitter, toast, avatar, basename } from './util.js';
import { computeGraph, graphSvg, LANE_W, ROW_H } from './graph.js';
import { renderDiff } from './diffview.js';
import { openModal } from './modal.js';
import * as A from './actions.js';
import { t } from './i18n.js';

const api = window.api;
const PAGE = 400;
export const WORKING = '__working__';

// ---------- tabela de commits virtualizada ----------
export class CommitTable {
  constructor({ graph = true, onSelect, onContext, onOpen }) {
    this.graph = graph;
    this.onSelect = onSelect;
    this.onContext = onContext;
    this.onOpen = onOpen;
    this.commits = [];
    this.layout = null;
    this.selected = null;
    this.head = null;
    this.headBranch = null;
    this.loadMore = null;
    this.spacer = h('div', { class: 'ct-spacer' });
    this.rowsEl = h('div', { class: 'ct-rows' });
    this.scroller = h('div', { class: 'ct-scroll', tabIndex: 0 }, this.spacer, this.rowsEl);
    this.scroller.addEventListener('scroll', () => this.paint());
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.paint()).observe(this.scroller);
    const cols = [graph ? h('div', { class: 'ct-c ct-graph' }, t('Graph')) : null, h('div', { class: 'ct-c ct-desc' }, t('Description')),
      h('div', { class: 'ct-c ct-date' }, t('Date')), h('div', { class: 'ct-c ct-author' }, t('Author')), h('div', { class: 'ct-c ct-sha' }, 'Commit')];
    this.header = h('div', { class: 'ct-header' }, cols);
    this.el = h('div', { class: 'commit-table' }, this.header, this.scroller);
  }

  set(commits, { keepScroll } = {}) {
    this.commits = commits;
    this.layout = this.graph ? computeGraph(commits) : null;
    const gw = this.layout ? Math.min(this.layout.maxCols, 24) * LANE_W + 6 : 0;
    this.el.style.setProperty('--graph-w', `${Math.max(gw, 40)}px`);
    this.spacer.style.height = `${commits.length * ROW_H}px`;
    if (!keepScroll) this.scroller.scrollTop = 0;
    this.paint(true);
  }

  paint(force) {
    const top = this.scroller.scrollTop;
    const hgt = this.scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(top / ROW_H) - 10);
    const end = Math.min(this.commits.length, Math.ceil((top + hgt) / ROW_H) + 10);
    if (!force && this.range && this.range[0] === start && this.range[1] === end) return;
    this.range = [start, end];
    let html = '';
    const gw = this.layout ? Math.min(this.layout.maxCols, 24) * LANE_W + 6 : 0;
    for (let i = start; i < end; i++) {
      const c = this.commits[i];
      const sel = this.selected === c.sha ? ' sel' : '';
      const isWork = c.sha === WORKING;
      const graphCell = this.layout ? `<div class="ct-c ct-graph">${graphSvg(this.layout.rows[i], gw, isWork || c.sha === this.head)}</div>` : '';
      const labels = c.refs.map((r) => {
        const cls = r.type === 'head' ? 'lbl-head' : r.type === 'branch' ? 'lbl-branch' : r.type === 'remote' ? 'lbl-remote' : r.type === 'tag' ? 'lbl-tag' : 'lbl-other';
        return `<span class="lbl ${cls}">${esc(r.name)}</span>`;
      }).join('');
      html += `<div class="ct-row${sel}${isWork ? ' working' : ''}" data-i="${i}" style="top:${i * ROW_H}px">${graphCell}`
        + `<div class="ct-c ct-desc">${labels}<span class="subj">${esc(c.subject)}</span></div>`
        + `<div class="ct-c ct-date">${isWork ? '' : fmtDate(c.time)}</div>`
        + `<div class="ct-c ct-author" title="${esc(c.email || '')}">${isWork ? '' : esc(c.author)}</div>`
        + `<div class="ct-c ct-sha">${isWork ? '*' : c.sha.slice(0, 7)}</div></div>`;
    }
    this.rowsEl.innerHTML = html;
    this.rowsEl.querySelectorAll('.ct-row').forEach((row) => {
      const c = this.commits[+row.dataset.i];
      row.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button === 2) this.select(c.sha); });
      row.addEventListener('dblclick', () => this.onOpen && this.onOpen(c));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); this.onContext && this.onContext(c); });
    });
    if (this.loadMore && end >= this.commits.length - 5) this.loadMore();
  }

  select(sha, scroll) {
    if (this.selected === sha && !scroll) return;
    this.selected = sha;
    const i = this.commits.findIndex((c) => c.sha === sha);
    if (scroll && i >= 0) {
      const top = i * ROW_H;
      if (top < this.scroller.scrollTop || top > this.scroller.scrollTop + this.scroller.clientHeight - ROW_H) {
        this.scroller.scrollTop = top - this.scroller.clientHeight / 3;
      }
    }
    this.paint(true);
    if (i >= 0 && this.onSelect) this.onSelect(this.commits[i]);
  }

  onKey(e) {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, this.commits.findIndex((c) => c.sha === this.selected));
    const page = Math.floor(this.scroller.clientHeight / ROW_H);
    const n = { ArrowDown: i + 1, ArrowUp: i - 1, PageDown: i + page, PageUp: i - page, Home: 0, End: this.commits.length - 1 }[e.key];
    const t = this.commits[Math.max(0, Math.min(this.commits.length - 1, n))];
    if (t) this.select(t.sha, true);
  }
}

// ---------- detalhes do commit + arquivos + diff ----------
export class CommitDetails {
  constructor(rv) {
    this.rv = rv;
    this.info = h('div', { class: 'commit-info' });
    this.files = h('div', { class: 'file-list' });
    this.diffHead = h('div', { class: 'pane-head diff-head' });
    this.diff = h('div', { class: 'diff-body' });
    const left = h('div', { class: 'col details-col' }, this.info, h('div', { class: 'pane-head' }, h('span', { class: 'pane-title' }, t('Changed files'))), this.files);
    const right = h('div', { class: 'col diff-col' }, this.diffHead, this.diff);
    this.el = h('div', { class: 'row grow commit-details' }, left, splitter('h', left, 'details-files'), right);
    this.clear();
  }

  clear(msg = t('Select a commit')) {
    this.sha = null;
    this.info.replaceChildren(h('div', { class: 'empty small' }, msg));
    this.files.innerHTML = '';
    this.diffHead.innerHTML = '';
    this.diff.innerHTML = '';
  }

  async show(sha) {
    this.sha = sha;
    let d;
    try { d = await api.git.commitDetails(this.rv.path, sha); } catch (e) { this.clear(e.message); return; }
    if (this.sha !== sha) return;
    const parentLinks = d.parents.map((p) => h('a', { class: 'sha-link', onclick: () => this.rv.jumpToRef(p) }, p.slice(0, 10)));
    this.info.replaceChildren(
      h('div', { class: 'ci-head' }, avatar(d.author, d.email), h('div', {},
        h('div', { class: 'ci-author' }, d.author, h('span', { class: 'muted' }, ` <${d.email}>`)),
        h('div', { class: 'muted' }, fmtDate(d.time)))),
      h('table', { class: 'ci-table' }, h('tbody', {},
        h('tr', {}, h('td', {}, 'Commit:'), h('td', {}, h('code', { class: 'selectable-text' }, d.sha), ' ', h('a', { class: 'sha-link', onclick: () => { api.clipboard.write(d.sha); toast(t('SHA copied')); } }, `[${t('copy')}]`))),
        h('tr', {}, h('td', {}, t('Parents:')), h('td', {}, parentLinks.length ? parentLinks.flatMap((l, i) => (i ? [', ', l] : [l])) : t('(none)'))),
        d.committer !== d.author ? h('tr', {}, h('td', {}, 'Committer:'), h('td', {}, `${d.committer} <${d.committerEmail}>`)) : null)),
      h('pre', { class: 'ci-msg selectable-text' }, d.message));
    this.renderFiles(d.files, (f) => this.showFile(sha, f));
  }

  renderFiles(files, onPick) {
    this.files.innerHTML = '';
    if (!files.length) { this.files.append(h('div', { class: 'empty small' }, t('No changed files'))); this.diff.innerHTML = ''; this.diffHead.innerHTML = ''; return; }
    let selRow = null;
    files.forEach((f, i) => {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
      const row = h('div', {
        class: 'file-row', title: f.orig ? `${f.orig} → ${f.path}` : f.path,
        onmousedown: () => { if (selRow) selRow.classList.remove('sel'); row.classList.add('sel'); selRow = row; onPick(f); },
        oncontextmenu: (e) => { e.preventDefault(); this.fileMenu(f); },
      }, statusBadge(f.status), h('span', { class: 'fname' }, basename(f.path)), h('span', { class: 'fdir' }, dir));
      this.files.append(row);
      if (i === 0) { row.classList.add('sel'); selRow = row; onPick(f); }
    });
  }

  async showFile(sha, f) {
    this.diffHead.replaceChildren(h('span', { class: 'diff-path' }, f.orig ? `${f.orig} → ${f.path}` : f.path));
    const diff = await api.git.diff(this.rv.path, { commit: sha, file: f.path, orig: f.orig, context: this.rv.prefs.diffContext }).catch((e) => { this.diff.textContent = e.message; return null; });
    if (diff && this.sha === sha) renderDiff(this.diff, diff, { mode: 'commit' });
  }

  async fileMenu(f) {
    const rv = this.rv;
    const id = await api.ui.contextMenu([
      { id: 'log', label: t('File history…') },
      { id: 'blame', label: t('Line authorship in this version…'), enabled: f.status !== 'D' },
      { id: 'revert', label: t('Restore this version of the file…'), enabled: f.status !== 'D' },
      { type: 'separator' },
      { id: 'copy', label: t('Copy path') },
    ]);
    if (id === 'log') rv.fileLog(f.path);
    else if (id === 'blame') A.blame(rv, f.path, this.sha);
    else if (id === 'revert') rv.run(['checkout', this.sha, '--', f.path], { title: t('Restore file'), confirm: t('Restore "{path}" to {sha}? Local changes to this file will be lost.', { path: f.path, sha: this.sha.slice(0, 8) }) });
    else if (id === 'copy') api.clipboard.write(f.path);
  }
}

// Menu de contexto de commit
export async function commitMenu(rv, c) {
  if (c.sha === WORKING) return;
  const isMerge = c.parents.length > 1;
  const short = c.sha.slice(0, 7);
  const id = await api.ui.contextMenu([
    { id: 'checkout', label: 'Checkout…' },
    { id: 'merge', label: 'Merge…' },
    { id: 'rebase', label: 'Rebase…' },
    { type: 'separator' },
    { id: 'branch', label: 'Branch…' },
    { id: 'tag', label: 'Tag…' },
    { type: 'separator' },
    { id: 'archive', label: t('Export as archive…') },
    { id: 'patch', label: t('Create patch…') },
    { type: 'separator' },
    { id: 'reset', label: t('Move {branch} to this commit…', { branch: rv.status?.branch || 'HEAD' }) },
    { id: 'irebase', label: t('Rewrite commits after {sha}…', { sha: short }) },
    { id: 'revert', label: t('Revert commit…') },
    { id: 'cherry', label: 'Cherry-pick' },
    { type: 'separator' },
    { id: 'sha', label: t('Copy SHA') },
    { id: 'msg', label: t('Copy message') },
  ]);
  switch (id) {
    case 'checkout': {
      const b = c.refs.find((r) => r.type === 'branch' || r.type === 'head');
      return b ? A.checkoutBranch(rv, b.name, false) : A.checkoutCommit(rv, c.sha);
    }
    case 'merge': return rv.run(['merge', c.sha], { title: 'Merge', confirm: t('Merge {sha} into {branch}?', { sha: short, branch: rv.status?.branch || 'HEAD' }) });
    case 'rebase': return A.rebase(rv, c.sha);
    case 'branch': return A.newBranch(rv, c.sha);
    case 'tag': return A.tag(rv, c.sha);
    case 'archive': return A.archive(rv, c.sha);
    case 'patch': return A.createPatch(rv, c.sha);
    case 'reset': return A.resetTo(rv, c.sha);
    case 'irebase': return A.interactiveRebase(rv, c.sha);
    case 'revert': return A.revertCommit(rv, c.sha, isMerge);
    case 'cherry': return A.cherryPick(rv, c.sha, isMerge);
    case 'sha': api.clipboard.write(c.sha); return toast(t('SHA copied'));
    case 'msg': api.clipboard.write(c.subject); return toast(t('Message copied'));
    default:
  }
}

// ---------- Histórico ----------
export class HistoryView {
  constructor(rv) {
    this.rv = rv;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('history:opts') || '{}'); } catch { /* noop */ }
    this.opts = { scope: 'all', remotes: true, order: 'date', ...saved };
    this.commits = [];
    this.exhausted = false;
    this.loading = false;

    const scope = h('select', { onchange: (e) => this.setOpt('scope', e.target.value) },
      h('option', { value: 'all' }, t('All branches')), h('option', { value: 'current' }, t('Current branch')));
    scope.value = this.opts.scope;
    const remotes = h('input', { type: 'checkbox', checked: this.opts.remotes, onchange: (e) => this.setOpt('remotes', e.target.checked) });
    const order = h('select', { onchange: (e) => this.setOpt('order', e.target.value) },
      h('option', { value: 'date' }, t('Date order')), h('option', { value: 'topo' }, t('Topological order')));
    order.value = this.opts.order;
    const bar = h('div', { class: 'view-bar' }, scope,
      h('label', { class: 'form-check inline' }, remotes, h('span', {}, t('Include remotes'))), order,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', onclick: () => this.jumpPrompt() }, t('Go to: …')));

    this.table = new CommitTable({
      graph: true,
      onSelect: (c) => this.onSelect(c),
      onContext: (c) => commitMenu(rv, c),
      onOpen: (c) => { if (c.sha === WORKING) rv.setView('status'); },
    });
    this.table.loadMore = () => this.load(true);
    this.details = new CommitDetails(rv);
    const top = h('div', { class: 'col log-top' }, this.table.el);
    this.el = h('div', { class: 'view history-view' }, bar, h('div', { class: 'col grow' }, top, splitter('v', top, 'history-log'), this.details.el));
  }

  setOpt(k, v) {
    this.opts[k] = v;
    try { localStorage.setItem('history:opts', JSON.stringify(this.opts)); } catch { /* noop */ }
    this.update(true);
  }

  async update(reset) {
    if (reset || !this.commits.length) {
      this.commits = [];
      this.exhausted = false;
    }
    await this.load(false, true);
  }

  async load(more, replace) {
    if (this.loading || (more && this.exhausted)) return;
    this.loading = true;
    const rv = this.rv;
    try {
      const real = replace ? [] : this.commits.filter((c) => c.sha !== WORKING);
      const max = replace ? Math.max(PAGE, this.commits.filter((c) => c.sha !== WORKING).length) : PAGE;
      const page = await api.git.log(rv.path, { all: this.opts.scope === 'all', remotes: this.opts.remotes, order: this.opts.order, skip: real.length, max });
      if (page.length < max) this.exhausted = true;
      let list = [...real, ...page];
      const st = rv.status;
      const dirty = st && (st.staged.length || st.unstaged.length || st.conflicted.length);
      if (dirty) list = [{ sha: WORKING, parents: st.oid ? [st.oid] : [], refs: [], subject: t('Uncommitted changes'), author: '', time: 0 }, ...list];
      this.commits = list;
      this.table.head = st?.oid;
      this.table.set(list, { keepScroll: true });
      if (!this.table.selected || !list.some((c) => c.sha === this.table.selected)) {
        const first = list.find((c) => c.sha !== WORKING) || list[0];
        if (first) this.table.select(first.sha);
        else this.details.clear(t('No commits yet'));
      } else if (replace) {
        const c = list.find((x) => x.sha === this.table.selected);
        if (c) this.onSelect(c, true);
      }
    } catch (e) {
      this.details.clear(e.message);
    } finally {
      this.loading = false;
    }
  }

  onSelect(c, refreshOnly) {
    if (c.sha === WORKING) {
      const st = this.rv.status;
      this.details.sha = WORKING;
      this.details.info.replaceChildren(h('div', { class: 'ci-msg' }, h('b', {}, t('Uncommitted changes')), h('div', { class: 'muted' }, t('Double-click to open Changes.'))));
      const files = [...st.conflicted, ...st.staged.map((f) => ({ ...f, staged: true })), ...st.unstaged.filter((f) => !st.staged.some((s) => s.path === f.path))];
      this.details.renderFiles(files, async (f) => {
        this.details.diffHead.replaceChildren(h('span', { class: 'diff-path' }, f.path));
        const d = await api.git.diff(this.rv.path, { file: f.path, staged: !!f.staged, untracked: f.status === '?', context: this.rv.prefs.diffContext }).catch(() => []);
        renderDiff(this.details.diff, d, { mode: 'commit' });
      });
      return;
    }
    if (refreshOnly && this.details.sha === c.sha) return;
    this.details.show(c.sha);
  }

  async jumpTo(sha) {
    for (let tries = 0; tries < 25; tries++) {
      const hit = this.commits.find((c) => c.sha.startsWith(sha));
      if (hit) { this.table.select(hit.sha, true); return true; }
      if (this.exhausted) break;
      await this.load(true);
    }
    toast(t('Commit {sha} is not in the current log (check the branch filter)', { sha: sha.slice(0, 10) }), 'error');
    return false;
  }

  async jumpPrompt() {
    const sha = await window.app.prompt(t('Go to commit'), t('Enter a full or partial SHA to find in the log:'));
    if (!sha) return;
    const r = await api.git.exec(this.rv.path, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { allowFail: true, quiet: true });
    if (r.code !== 0) return toast(t('Commit not found'), 'error');
    this.jumpTo(r.stdout.trim());
  }
}

// ---------- Busca ----------
export class SearchView {
  constructor(rv) {
    this.rv = rv;
    this.input = h('input', { type: 'search', class: 'search-big', placeholder: t('Search'), onkeydown: (e) => { if (e.key === 'Enter') this.run(); } });
    this.mode = h('select', {},
      h('option', { value: 'grep' }, t('Message')),
      h('option', { value: 'pickaxe' }, t('Changed content')),
      h('option', { value: 'author' }, t('Authors')),
      h('option', { value: 'file' }, t('File')));
    this.count = h('span', { class: 'muted' });
    const bar = h('div', { class: 'view-bar' }, this.input, this.mode, h('button', { class: 'btn btn-primary btn-sm', onclick: () => this.run() }, t('Search')), this.count);
    this.table = new CommitTable({ graph: false, onSelect: (c) => this.details.show(c.sha), onContext: (c) => commitMenu(rv, c) });
    this.details = new CommitDetails(rv);
    const top = h('div', { class: 'col log-top' }, this.table.el);
    this.el = h('div', { class: 'view search-view' }, bar, h('div', { class: 'col grow' }, top, splitter('v', top, 'search-log'), this.details.el));
    this.details.clear(t('Type a term and press Enter'));
  }

  focus() { this.input.focus(); this.input.select(); }

  async update() { /* busca só sob demanda */ }

  async search(text, mode) {
    this.input.value = text;
    this.mode.value = mode;
    await this.run();
  }

  async run() {
    const q = this.input.value.trim();
    if (!q) return;
    const m = this.mode.value;
    this.count.textContent = t('Searching…');
    try {
      const res = await api.git.log(this.rv.path, { all: true, max: 1000, order: 'date', [m]: q });
      this.count.textContent = t('{n} result(s)', { n: `${res.length}${res.length === 1000 ? '+' : ''}` });
      this.table.set(res);
      if (res.length) this.table.select(res[0].sha);
      else this.details.clear(t('No results'));
    } catch (e) {
      this.count.textContent = '';
      this.details.clear(e.message);
    }
  }
}

// Diff entre duas referências ou de um stash, em janela modal.
export async function showDiffModal(rv, title, files) {
  const list = h('div', { class: 'file-list' });
  const diff = h('div', { class: 'diff-body' });
  files.forEach((f, i) => {
    const name = (f.header[0].match(/ b\/(.+)$/) || [])[1] || f.header[0];
    const row = h('div', { class: 'file-row', onmousedown: () => { list.querySelectorAll('.sel').forEach((r) => r.classList.remove('sel')); row.classList.add('sel'); renderDiff(diff, [f], { mode: 'commit' }); } }, h('span', { class: 'fname' }, basename(name)), h('span', { class: 'fdir' }, name));
    list.append(row);
    if (i === 0) row.dispatchEvent(new MouseEvent('mousedown'));
  });
  if (!files.length) diff.append(h('div', { class: 'empty' }, t('No differences')));
  await openModal({
    title, width: Math.min(1200, window.innerWidth - 60),
    body: h('div', { class: 'row diff-modal' }, h('div', { class: 'col', style: { flexBasis: '280px' } }, list), h('div', { class: 'col grow' }, diff)),
    buttons: [{ label: t('Close'), primary: true, value: true }],
  });
}
