// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Status de arquivos: staged/não staged, diff e caixa de commit.
import { h, icon, statusBadge, avatar, splitter, toast, basename, fileManager } from './util.js';
import { renderDiff } from './diffview.js';
import { confirmBox, alertBox } from './modal.js';
import * as A from './actions.js';
import { t } from './i18n.js';

const api = window.api;

const FILTERS = [
  ['pending', t('Pending')], ['conflicts', t('Conflicts')], ['untracked', t('Untracked')],
  ['modified', t('Modified')], ['ignored', t('Ignored')],
];
const SORTS = [
  ['path', t('path')], ['name', t('file name')], ['status', t('file status')], ['ext', t('extension')],
];
// Ordem de "status": o que exige ação primeiro (conflitos), arquivos novos e ignorados por último.
const STATUS_ORDER = ['U', 'M', 'T', 'A', 'C', 'D', 'R', '?', '!'];

export class StatusView {
  constructor(rv) {
    this.rv = rv;
    this.filter = 'pending';
    this.sort = 'path';
    try {
      const saved = localStorage.getItem('status:sort');
      if (SORTS.some(([id]) => id === saved)) this.sort = saved;
    } catch { /* noop */ }
    this.search = '';
    this.sel = { staged: new Set(), unstaged: new Set() };
    this.focusList = 'unstaged';
    this.current = null; // { path, list, status }
    this.ignored = [];
    this.build();
  }

  build() {
    this.filterBtn = h('button', { class: 'btn btn-flat filter-btn', onclick: () => this.filterMenu() });
    this.searchInput = h('input', { type: 'search', class: 'search-small', placeholder: t('Search (Ctrl+F)'), oninput: (e) => { this.search = e.target.value.toLowerCase(); this.renderLists(); } });
    const bar = h('div', { class: 'view-bar' }, this.filterBtn, h('span', { class: 'spacer' }), this.searchInput);

    this.stagedList = h('div', { class: 'file-list', tabIndex: 0 });
    this.unstagedList = h('div', { class: 'file-list', tabIndex: 0 });
    for (const [el, name] of [[this.stagedList, 'staged'], [this.unstagedList, 'unstaged']]) {
      el.addEventListener('keydown', (e) => this.onKey(e, name));
      el.addEventListener('focus', () => { this.focusList = name; });
    }
    this.stagedCount = h('span', { class: 'muted' });
    this.unstagedCount = h('span', { class: 'muted' });
    const stagedPane = h('div', { class: 'pane staged-pane' },
      h('div', { class: 'pane-head' }, h('span', { class: 'pane-title' }, t('Staged'), ' ', this.stagedCount), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', onclick: () => this.unstage(null) }, t('Unstage all')),
        h('button', { class: 'btn btn-sm', onclick: () => this.unstage([...this.sel.staged]) }, t('Unstage selected'))),
      this.stagedList);
    const unstagedPane = h('div', { class: 'pane unstaged-pane' },
      h('div', { class: 'pane-head' }, h('span', { class: 'pane-title' }, t('Unstaged'), ' ', this.unstagedCount), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', onclick: () => this.stage(null) }, t('Stage all')),
        h('button', { class: 'btn btn-sm', onclick: () => this.stage([...this.sel.unstaged]) }, t('Stage selected'))),
      this.unstagedList);
    const left = h('div', { class: 'col files-col' }, stagedPane, splitter('v', stagedPane, 'status-lists'), unstagedPane);

    this.diffHead = h('div', { class: 'pane-head diff-head' });
    this.diffBody = h('div', { class: 'diff-body' });
    const right = h('div', { class: 'col diff-col' }, this.diffHead, this.diffBody);
    const main = h('div', { class: 'row grow' }, left, splitter('h', left, 'status-files'), right);

    this.buildCommitBox();
    this.el = h('div', { class: 'view status-view' }, bar, main, this.commitBox);
    this.updateFilterLabel();
  }

  // ---------- commit box ----------
  buildCommitBox() {
    this.msg = h('textarea', { class: 'commit-msg', placeholder: t('Commit message'), rows: 1, spellcheck: true,
      onfocus: () => this.expandCommit(true),
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); } },
    });
    this.amend = false;
    this.signoff = false;
    this.noverify = false;
    this.pushNow = h('input', { type: 'checkbox' });
    this.pushLabel = h('span', {});
    this.who = h('span', { class: 'commit-who' });
    this.optBtn = h('button', { class: 'btn btn-sm', onclick: () => this.commitOptions() }, `${t('Options')} ▾`);
    this.commitBtn = h('button', { class: 'btn btn-primary', onclick: () => this.commit() }, 'Commit');
    const cancel = h('button', { class: 'btn', onclick: () => { this.msg.value = ''; this.setAmend(false); this.expandCommit(false); this.msg.blur(); } }, t('Cancel'));
    this.commitBox = h('div', { class: 'commit-box collapsed' },
      h('div', { class: 'commit-top' }, this.avatarSlot = h('span'), this.msg),
      h('div', { class: 'commit-bottom' }, this.who, h('span', { class: 'spacer' }), this.optBtn,
        h('label', { class: 'form-check inline' }, this.pushNow, this.pushLabel), cancel, this.commitBtn));
  }

  expandCommit(on) {
    this.commitBox.classList.toggle('collapsed', !on);
    this.msg.rows = on ? 4 : 1;
  }

  async commitOptions() {
    const id = await api.ui.contextMenu([
      { id: 'amend', label: `${this.amend ? '✓ ' : ''}${t('Amend the last commit')}` },
      { id: 'signoff', label: `${this.signoff ? '✓ ' : ''}${t('Sign off (Signed-off-by)')}` },
      { id: 'noverify', label: `${this.noverify ? '✓ ' : ''}${t('Skip commit hooks')}` },
    ]);
    if (id === 'amend') this.setAmend(!this.amend);
    else if (id === 'signoff') this.signoff = !this.signoff;
    else if (id === 'noverify') this.noverify = !this.noverify;
    this.optBtn.classList.toggle('on', this.amend || this.signoff || this.noverify);
  }

  async setAmend(on) {
    if (on) {
      const r = await api.git.exec(this.rv.path, ['log', '-1', '--format=%B'], { allowFail: true, quiet: true });
      if (r.code !== 0) return toast(t('There is no commit to amend'));
      if (this.msg.value.trim() && !(await confirmBox(t('Amend last commit'), t('Replace the current message with the message of the last commit?'), { okLabel: t('Replace') }))) return;
      this.msg.value = r.stdout.trim();
      this.expandCommit(true);
    }
    this.amend = on;
    this.commitBtn.textContent = on ? 'Commit (amend)' : 'Commit';
    this.optBtn.classList.toggle('on', this.amend || this.signoff || this.noverify);
  }

  async commit() {
    const rv = this.rv;
    const message = this.msg.value.trim();
    if (!rv.status.staged.length && !this.amend) {
      return alertBox(t('Nothing to commit'), t('Nothing is staged. Stage files before committing.'));
    }
    if (!message) { this.msg.focus(); return toast(t('Enter a commit message'), 'error'); }
    const args = ['commit', '-F', '-'];
    if (this.amend) args.push('--amend');
    if (this.signoff) args.push('--signoff');
    if (this.noverify) args.push('--no-verify');
    const ok = await rv.run(args, { title: 'Commit', input: message });
    if (!ok) return;
    const push = this.pushNow.checked;
    this.msg.value = '';
    this.setAmend(false);
    this.expandCommit(false);
    this.msg.blur();
    if (push) {
      const st = await api.git.status(rv.path);
      const r = st.upstream ? st.upstream.slice(0, st.upstream.indexOf('/')) : 'origin';
      const remoteBranch = st.upstream ? st.upstream.slice(r.length + 1) : st.branch;
      const res = await rv.run(['push', '--progress', ...(st.upstream ? [] : ['-u']), r, `refs/heads/${st.branch}:refs/heads/${remoteBranch}`], { title: 'Push', progress: true });
      if (!res) alertBox(t('Push failed'), t('Your commit was created, but the push failed. To try again, use the Push button.'));
    }
  }

  // ---------- dados ----------
  async update() {
    const rv = this.rv;
    const st = rv.status;
    if (!st) return;
    if (this.filter === 'ignored') {
      const r = await api.git.exec(rv.path, ['ls-files', '-o', '-i', '--exclude-standard', '--directory'], { quiet: true });
      this.ignored = r.stdout.split('\n').filter(Boolean).map((p) => ({ path: p, status: '!' }));
    }
    const up = st.upstream || `origin/${st.branch || ''}`;
    this.pushLabel.textContent = t('Push to {name} after committing', { name: up });
    this.pushNow.disabled = !st.branch || !Object.keys(rv.refs?.remotes || {}).length;
    this.avatarSlot.replaceChildren(avatar(rv.user.name, rv.user.email));
    this.who.textContent = rv.user.name ? `${rv.user.name} <${rv.user.email}>` : t('Set your name and email in Tools > Options');
    this.renderLists();
    if (this.current) {
      const still = this.findEntry(this.current.path, this.current.list);
      if (still) this.showDiff(still, this.current.list, true);
      else { this.current = null; this.showDiff(null); }
    } else this.showDiff(null);
  }

  findEntry(path, list) {
    const st = this.rv.status;
    if (list === 'staged') return st.staged.find((f) => f.path === path);
    return [...st.conflicted, ...st.unstaged, ...this.ignored].find((f) => f.path === path);
  }

  sortFn() {
    const name = (f) => basename(f.path).toLowerCase();
    const p = (f) => f.path.toLowerCase();
    const rank = (f) => { const i = STATUS_ORDER.indexOf(f.status); return i < 0 ? STATUS_ORDER.length : i; };
    const ext = (f) => { const n = name(f); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1) : ''; };
    switch (this.sort) {
      case 'name': return (a, b) => name(a).localeCompare(name(b)) || p(a).localeCompare(p(b));
      case 'status': return (a, b) => rank(a) - rank(b) || p(a).localeCompare(p(b));
      case 'ext': return (a, b) => ext(a).localeCompare(ext(b)) || p(a).localeCompare(p(b));
      default: return (a, b) => p(a).localeCompare(p(b));
    }
  }

  visible(list) {
    const st = this.rv.status;
    let files;
    if (list === 'staged') files = this.filter === 'ignored' || this.filter === 'untracked' ? [] : st.staged;
    else {
      switch (this.filter) {
        case 'conflicts': files = st.conflicted; break;
        case 'untracked': files = st.unstaged.filter((f) => f.status === '?'); break;
        case 'modified': files = [...st.conflicted, ...st.unstaged.filter((f) => f.status !== '?')]; break;
        case 'ignored': files = this.ignored; break;
        default: files = [...st.conflicted, ...st.unstaged];
      }
    }
    if (list === 'staged' && this.filter === 'conflicts') files = [];
    if (this.search) files = files.filter((f) => f.path.toLowerCase().includes(this.search));
    return [...files].sort(this.sortFn());
  }

  renderLists() {
    const staged = this.visible('staged');
    const unstaged = this.visible('unstaged');
    this.stagedCount.textContent = staged.length ? `(${staged.length})` : '';
    this.unstagedCount.textContent = unstaged.length ? `(${unstaged.length})` : '';
    this.renderList(this.stagedList, staged, 'staged');
    this.renderList(this.unstagedList, unstaged, 'unstaged');
  }

  renderList(el, files, list) {
    const sel = this.sel[list];
    for (const p of [...sel]) if (!files.some((f) => f.path === p)) sel.delete(p);
    el.innerHTML = '';
    if (!files.length) {
      el.append(h('div', { class: 'empty small' }, list === 'staged' ? t('Nothing staged') : t('No pending changes')));
      return;
    }
    files.forEach((f, idx) => {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
      const quick = f.status === '!' ? null : h('button', {
        class: 'row-quick', title: list === 'staged' ? 'Unstage' : 'Stage',
        onclick: (e) => { e.stopPropagation(); list === 'staged' ? this.unstage([f.path]) : this.stage([f.path]); },
      }, list === 'staged' ? '−' : '+');
      const row = h('div', {
        class: `file-row ${sel.has(f.path) ? 'sel' : ''} ${this.current && this.current.path === f.path && this.current.list === list ? 'focus' : ''}`,
        title: f.orig ? `${f.orig} → ${f.path}` : f.path,
        onmousedown: (e) => this.onRowClick(e, files, idx, list),
        ondblclick: () => (f.status === '!' ? null : list === 'staged' ? this.unstage([f.path]) : this.stage([f.path])),
        oncontextmenu: (e) => { e.preventDefault(); this.rowMenu(f, list); },
      }, statusBadge(f.status === '!' ? 'I' : f.status), h('span', { class: 'fname' }, basename(f.path)), h('span', { class: 'fdir' }, dir), quick);
      el.append(row);
    });
  }

  onRowClick(e, files, idx, list) {
    if (e.button === 2 && this.sel[list].has(files[idx].path)) return;
    const other = list === 'staged' ? 'unstaged' : 'staged';
    this.sel[other].clear();
    const sel = this.sel[list];
    const path = files[idx].path;
    if (e.shiftKey && this.anchor && this.anchor.list === list) {
      const a = files.findIndex((f) => f.path === this.anchor.path);
      sel.clear();
      for (let i = Math.min(a, idx); i <= Math.max(a, idx); i++) sel.add(files[i].path);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(path) ? sel.delete(path) : sel.add(path);
      this.anchor = { list, path };
    } else {
      sel.clear();
      sel.add(path);
      this.anchor = { list, path };
    }
    this.focusList = list;
    this.renderLists();
    this.showDiff(files[idx], list);
    (list === 'staged' ? this.stagedList : this.unstagedList).focus();
  }

  onKey(e, list) {
    const files = this.visible(list);
    if (!files.length) return;
    const sel = [...this.sel[list]];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = this.current && this.current.list === list ? files.findIndex((f) => f.path === this.current.path) : -1;
      const next = Math.max(0, Math.min(files.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      this.onRowClick({ button: 0, shiftKey: false, ctrlKey: false }, files, next, list);
    } else if ((e.key === '+' || e.key === '=' || e.key === ' ' || e.key === 'Enter') && list === 'unstaged' && sel.length) {
      e.preventDefault(); this.stage(sel);
    } else if ((e.key === '-' || e.key === ' ' || e.key === 'Enter' || e.key === 'Backspace') && list === 'staged' && sel.length) {
      e.preventDefault(); this.unstage(sel);
    } else if (e.key === 'Delete' && sel.length) {
      e.preventDefault(); A.discard(this.rv, sel);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      files.forEach((f) => this.sel[list].add(f.path));
      this.renderLists();
    }
  }

  filterMenu() {
    api.ui.contextMenu([
      ...FILTERS.map(([id, label]) => ({ id: `f:${id}`, label: `${this.filter === id ? '✓ ' : ''}${t('Show: {filter}', { filter: label })}` })),
      { type: 'separator' },
      ...SORTS.map(([id, label]) => ({ id: `s:${id}`, label: `${this.sort === id ? '✓ ' : ''}${t('Sort by {field}', { field: label })}` })),
    ]).then((id) => {
      if (!id) return;
      if (id.startsWith('f:')) this.filter = id.slice(2);
      else { this.sort = id.slice(2); try { localStorage.setItem('status:sort', this.sort); } catch { /* noop */ } }
      this.updateFilterLabel();
      this.update();
    });
  }

  updateFilterLabel() {
    const f = FILTERS.find(([id]) => id === this.filter)[1];
    const s = SORTS.find(([id]) => id === this.sort)[1];
    this.filterBtn.textContent = `${t('{filter} · by {field}', { filter: f, field: s })} ▾`;
  }

  // ---------- diff ----------
  async showDiff(file, list, keepScroll) {
    const rv = this.rv;
    if (!file) {
      this.current = null;
      this.diffHead.replaceChildren(h('span', { class: 'muted' }, t('Select a file to see its changes')));
      this.diffBody.innerHTML = '';
      return;
    }
    this.current = { path: file.path, list, status: file.status };
    const top = this.diffBody.scrollTop;
    const btns = [];
    if (file.status === 'U') {
      btns.push(h('button', { class: 'btn btn-sm', onclick: () => A.resolve(rv, [file.path], 'ours') }, t('Keep my version')),
        h('button', { class: 'btn btn-sm', onclick: () => A.resolve(rv, [file.path], 'theirs') }, t('Use the incoming version')),
        h('button', { class: 'btn btn-sm', onclick: () => A.resolve(rv, [file.path], 'mark') }, t('Mark resolved')));
    } else if (list === 'staged') {
      btns.push(h('button', { class: 'btn btn-sm', onclick: () => this.unstage([file.path]) }, t('Unstage file')));
    } else if (file.status !== '!') {
      btns.push(h('button', { class: 'btn btn-sm', onclick: () => this.stage([file.path]) }, t('Stage file')),
        h('button', { class: 'btn btn-sm btn-danger-text', onclick: () => A.discard(rv, [file.path]) }, t('Discard file')));
    }
    this.diffHead.replaceChildren(icon('file', 14), h('span', { class: 'diff-path' }, file.orig ? `${file.orig} → ${file.path}` : file.path), h('span', { class: 'spacer' }), ...btns);
    if (file.status === '!') { this.diffBody.replaceChildren(h('div', { class: 'empty' }, t('Ignored file'))); return; }
    try {
      const diff = await api.git.diff(rv.path, {
        file: file.path, staged: list === 'staged', untracked: file.status === '?', context: rv.prefs.diffContext,
      });
      if (!this.current || this.current.path !== file.path) return;
      const mode = file.status === 'U' ? 'conflict' : file.status === '?' ? 'untracked' : list;
      renderDiff(this.diffBody, diff, {
        mode: mode === 'untracked' ? 'unstaged-new' : mode,
        empty: file.status === '?' ? t('Empty new file') : t('No content changes'),
        onAction: (f, hunk, selected, action) => this.hunkAction(file, f, hunk, selected, action),
      });
      if (keepScroll) this.diffBody.scrollTop = top;
    } catch (e) {
      this.diffBody.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }

  async hunkAction(entry, f, hunk, selected, action) {
    const rv = this.rv;
    if (action === 'discard' && !(await confirmBox(t('Discard'), selected ? t('Discard the selected lines? This cannot be undone.') : t('Discard this hunk? This cannot be undone.'), { okLabel: t('Discard'), danger: true }))) return;
    await rv.run(null, { title: action, fn: () => api.git.applyPatch(rv.path, f, hunk, selected, action) });
  }

  // ---------- operações ----------
  async stage(paths) {
    const rv = this.rv;
    if (paths && !paths.length) return toast(t('Select files to stage'));
    const conflicted = new Set(rv.status.conflicted.map((f) => f.path));
    if (paths && paths.some((p) => conflicted.has(p)) && !(await confirmBox(t('Conflicted file'), t('Staging a conflicted file marks it as resolved. Continue?'), { okLabel: 'Stage' }))) return;
    await rv.run(paths ? ['add', '-A', '--', ...paths] : ['add', '-A'], { title: 'Stage', silent: true });
  }

  async unstage(paths) {
    const rv = this.rv;
    if (paths && !paths.length) return toast(t('Select files to unstage'));
    const hasHead = !!rv.status.oid;
    const args = hasHead ? ['reset', '-q', 'HEAD', '--', ...(paths || ['.'])] : ['rm', '--cached', '-r', '-q', '--', ...(paths || ['.'])];
    await rv.run(args, { title: 'Unstage', silent: true });
  }

  selectedPaths() {
    return [...this.sel[this.focusList]];
  }

  async rowMenu(f, list) {
    const rv = this.rv;
    const paths = this.sel[list].has(f.path) ? [...this.sel[list]] : [f.path];
    const conflict = f.status === 'U';
    const id = await api.ui.contextMenu([
      list === 'staged' ? { id: 'unstage', label: 'Unstage' } : { id: 'stage', label: t('Stage selected'), enabled: f.status !== '!' },
      { id: 'discard', label: t('Discard…'), enabled: f.status !== '!' },
      { id: 'remove', label: t('Remove (delete file)') },
      { id: 'untrack', label: t('Stop tracking'), enabled: f.status !== '?' && f.status !== '!' },
      { id: 'ignore', label: t('Ignore…'), enabled: f.status === '?' || f.status === '!' ? f.status === '?' : true },
      { type: 'separator' },
      { id: 'commit', label: t('Commit selected…') },
      { id: 'resolve', label: t('Resolve conflicts'), enabled: conflict, submenu: [
        { id: 'ours', label: t('Keep my version') }, { id: 'theirs', label: t('Use the incoming version') },
        { type: 'separator' }, { id: 'mark', label: t('Mark as resolved') },
      ] },
      { type: 'separator' },
      { id: 'log', label: t('File history…'), enabled: f.status !== '?' },
      { id: 'blame', label: t('Line authorship (blame)…'), enabled: f.status !== '?' && f.status !== 'A' },
      { type: 'separator' },
      { id: 'copy', label: t('Copy path') },
      { id: 'explorer', label: t('Show in {app}', { app: fileManager() }) },
      { id: 'open', label: t('Open with the default program') },
    ]);
    if (!id) return;
    switch (id) {
      case 'stage': return this.stage(paths);
      case 'unstage': return this.unstage(paths);
      case 'discard': return A.discard(rv, paths);
      case 'remove':
        if (await confirmBox(t('Remove'), t('Delete {n} file(s) from disk? (They go to the trash.)', { n: paths.length }), { okLabel: t('Remove'), danger: true })) {
          await rv.run(null, { title: t('Remove'), fn: async () => { for (const p of paths) await api.shell.trash(`${rv.path}/${p}`); } });
        }
        return;
      case 'untrack': return rv.run(['rm', '--cached', '-r', '-q', '--', ...paths], { title: t('Stop tracking') });
      case 'ignore': return A.ignore(rv, f.path);
      case 'commit':
        if (list !== 'staged') await this.stage(paths);
        this.msg.focus();
        return;
      case 'ours': case 'theirs': case 'mark': return A.resolve(rv, paths, id);
      case 'log': return rv.fileLog(f.path);
      case 'blame': return A.blame(rv, f.path);
      case 'copy': return api.clipboard.write(paths.join('\n'));
      case 'explorer': return api.shell.showItem(`${rv.path}/${f.path}`);
      case 'open': return api.shell.openPath(`${rv.path}/${f.path}`);
      default:
    }
  }
}
