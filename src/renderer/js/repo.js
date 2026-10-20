// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Aba de repositório: barras de ações, sidebar e views.
import { h, icon, basename, toast, fileManager } from './util.js';
import { alertBox, confirmBox, processDialog } from './modal.js';
import { Sidebar } from './sidebar.js';
import { StatusView } from './status.js';
import { HistoryView, SearchView, showDiffModal } from './history.js';
import * as A from './actions.js';
import { t } from './i18n.js';

const api = window.api;

const STATE_LABEL = { merge: t('Merge in progress'), rebase: t('Rebase in progress'), 'cherry-pick': t('Cherry-pick in progress'), revert: t('Revert in progress') };

export class RepoView {
  constructor(path, app, view = 'status') {
    this.path = path;
    this.name = basename(path);
    this.app = app;
    this.view = view;
    this.status = null;
    this.refs = null;
    this.user = { name: '', email: '' };
    this.busy = 0;
    this.build();
  }

  get prefs() { return this.app.prefs; }

  build() {
    const tb = (name, label, fn, title) => {
      const b = h('button', { class: 'tb-btn', title: title || label, onclick: fn }, icon(name, 18), h('span', { class: 'tb-label' }, label));
      return b;
    };
    this.pullBadge = h('span', { class: 'tb-badge hidden' });
    this.pushBadge = h('span', { class: 'tb-badge hidden' });
    const pullBtn = tb('pull', 'Pull', () => A.pull(this), t('Pull from a remote'));
    const pushBtn = tb('push', 'Push', () => A.push(this), t('Push to a remote'));
    pullBtn.append(this.pullBadge);
    pushBtn.append(this.pushBadge);
    const sep = () => h('span', { class: 'tb-sep' });
    // Barras verticais: ações à esquerda, ferramentas à direita. Cada uma
    // começa retraída (só ícones) e expande/retrai sozinha pela seta do topo.
    const rail = (side, ...items) => {
      const key = `rail:${side}`;
      const el = h('nav', { class: `rail rail-${side}` });
      let open = false;
      try { open = localStorage.getItem(key) === '1'; } catch { /* noop */ }
      el.classList.toggle('open', open);
      const toggle = h('button', { class: 'tb-btn rail-toggle', title: t('Expand or collapse'), onclick: () => {
        open = !open;
        el.classList.toggle('open', open);
        try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* noop */ }
      } }, icon('chevron', 18));
      el.append(toggle, sep(), ...items);
      return el;
    };
    this.actionsRail = rail('left',
      tb('commit', 'Commit', () => this.focusCommit(), t('Commit your changes')),
      pullBtn, pushBtn,
      tb('fetch', 'Fetch', () => A.fetch(this), t('Fetch commits from remotes')), sep(),
      tb('branch', 'Branch', () => A.branchDialog(this), t('Create or delete branches')),
      tb('merge', 'Merge', () => A.merge(this), t('Merge another branch into the current one')), sep(),
      tb('stash', 'Stash', () => A.stash(this), t('Save the current changes for later')),
      tb('discard', t('Discard'), () => A.discard(this), t('Discard local changes')),
      tb('tag', 'Tag', () => A.tag(this), t('Create or remove tags')), sep(),
      tb('flow', 'Git Flow', () => A.flowMenu(this), 'Git flow'));
    this.toolsRail = rail('right',
      tb('remote', t('Remote'), () => A.viewRemote(this), t('Open the remote repository website')),
      tb('terminal', 'Terminal', () => api.shell.terminal(this.path), t('Open a terminal in the repository folder')),
      tb('folder', this.app.info?.platform === 'linux' ? t('Files') : fileManager(), () => api.shell.openPath(this.path), t('Open the repository folder in {app}', { app: fileManager() })),
      tb('settings', t('Settings'), () => A.repoSettings(this), t('Repository settings')));

    this.banner = h('div', { class: 'banner hidden' });
    this.sidebar = new Sidebar(this);
    this.views = { status: new StatusView(this), history: new HistoryView(this), search: new SearchView(this) };
    this.main = h('div', { class: 'repo-main' });
    this.body = h('div', { class: 'repo-body' }, this.actionsRail, this.sidebar.el, h('div', { class: 'splitter splitter-h sb-splitter' }), this.main, this.toolsRail);
    this.el = h('div', { class: 'repo' }, this.banner, this.body);
    this.initSidebarResize();
    this.setView(this.view, true);
  }

  initSidebarResize() {
    const sp = this.body.querySelector('.sb-splitter');
    const sb = this.sidebar.el;
    try { const w = localStorage.getItem('sidebar:w'); if (w) sb.style.width = w; } catch { /* noop */ }
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const x0 = e.clientX; const w0 = sb.offsetWidth;
      const move = (ev) => { sb.style.width = `${Math.min(500, Math.max(160, w0 + ev.clientX - x0))}px`; };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); try { localStorage.setItem('sidebar:w', sb.style.width); } catch { /* noop */ } };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  setView(v, initial) {
    this.view = v;
    this.main.replaceChildren(this.views[v].el);
    this.sidebar.render();
    if (!initial && this.status) this.views[v].update();
    if (v === 'search') setTimeout(() => this.views.search.focus(), 0);
    this.app.saveTabs();
  }

  async open() {
    await api.repo.watch(this.path);
    await this.refresh();
  }

  async close() {
    await api.repo.unwatch(this.path);
  }

  async refresh() {
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshing = true;
    try {
      const [status, refs, name, email] = await Promise.all([
        api.git.status(this.path),
        api.git.refs(this.path),
        api.git.config(this.path, 'user.name'),
        api.git.config(this.path, 'user.email'),
      ]);
      this.status = status;
      this.refs = refs;
      this.user = { name, email };
      this.renderChrome();
      this.sidebar.render();
      await this.views[this.view].update();
      if (this.view !== 'history') this.views.history.stale = true;
    } catch (e) {
      this.main.replaceChildren(h('div', { class: 'empty' }, t('Could not read the repository: {error}', { error: e.message })));
    } finally {
      this.refreshing = false;
      if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); }
    }
  }

  renderChrome() {
    const s = this.status;
    const set = (el, n, title) => { el.textContent = n ? `${n}` : ''; el.classList.toggle('hidden', !n); el.title = n ? title : ''; };
    set(this.pullBadge, s.behind, t('{n} commit(s) to pull', { n: s.behind }));
    set(this.pushBadge, s.ahead, t('{n} commit(s) to push', { n: s.ahead }));
    if (s.state) {
      this.banner.replaceChildren(
        h('span', {}, `${STATE_LABEL[s.state]}. ${s.conflicted.length ? t('{n} conflicted file(s): resolve them and stage them.', { n: s.conflicted.length }) : t('No pending conflicts.')}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => A.continueOperation(this) }, s.state === 'merge' ? t('Finish merge (commit)') : t('Continue')),
        h('button', { class: 'btn btn-sm', onclick: () => A.abortOperation(this) }, t('Abort')));
      this.banner.classList.remove('hidden');
    } else this.banner.classList.add('hidden');
    this.app.updateTab(this);
  }

  // Executa um comando git (ou fn) com tratamento de erro, progresso e refresh.
  async run(args, { title = 'Git', input, noEditor, fn, progress, silent, confirm, noRefresh } = {}) {
    if (confirm && !(await confirmBox(title, confirm, { okLabel: t('OK') }))) return null;
    let dlg = null;
    if (progress) {
      dlg = processDialog(title);
      if (args) dlg.append(`git ${args.join(' ')}\n`);
      this.app.progressSink = (text) => dlg.append(text);
    }
    this.busy++;
    try {
      const r = fn ? await fn() : await api.git.exec(this.path, args, { input, noEditor });
      if (dlg) dlg.done(true, t('Completed successfully.'));
      else if (!silent && r && r.stderr && /CONFLICT|warning/i.test(r.stderr)) toast(r.stderr.trim().split('\n').slice(-2).join(' '), 'warn');
      return r || true;
    } catch (e) {
      const msg = e.message || String(e);
      if (dlg) dlg.done(false, msg);
      else await alertBox(t('{title}: error', { title }), /CONFLICT/.test(msg) ? t('The command ended with conflicts. Resolve them in Changes.') : t('The command failed.'), msg);
      return null;
    } finally {
      this.busy--;
      if (dlg) this.app.progressSink = null;
      if (!noRefresh) this.refresh();
    }
  }

  focusCommit() {
    this.setView('status');
    setTimeout(() => this.views.status.msg.focus(), 0);
  }

  async jumpToRef(sha) {
    if (this.view !== 'history') this.setView('history');
    if (!this.views.history.commits.length) await this.views.history.update();
    this.views.history.jumpTo(sha);
  }

  fileLog(path) {
    this.setView('search');
    this.views.search.search(path, 'file');
  }

  async showStash(s) {
    const files = await api.git.diffRefs(this.path, `${s.ref}^1`, s.ref).catch(() => []);
    showDiffModal(this, `Stash: ${s.message}`, files);
  }

  async showRefDiff(a, b) {
    const files = await api.git.diffRefs(this.path, a, b).catch((e) => { toast(e.message, 'error'); return null; });
    if (files) showDiffModal(this, `Diff: ${a} ↔ ${b}`, files);
  }

  selectedCommit() {
    const t = this.views[this.view === 'search' ? 'search' : 'history'].table;
    return t.selected && t.selected !== '__working__' ? t.selected : null;
  }

  // Comandos do menu da aplicação direcionados ao repositório ativo.
  async menu(cmd, arg) {
    const st = this.views.status;
    switch (cmd) {
      case 'view': return this.setView(arg);
      case 'refresh': return this.refresh();
      case 'fetch-quiet': return A.fetch(this, { quiet: true });
      case 'commit': return this.focusCommit();
      case 'commit-all': await this.run(['add', '-A'], { title: 'Stage', silent: true }); return this.focusCommit();
      case 'checkout': return A.checkoutDialog(this);
      case 'fetch': return A.fetch(this);
      case 'pull': return A.pull(this);
      case 'push': return A.push(this);
      case 'branch': return A.branchDialog(this);
      case 'merge': return A.merge(this);
      case 'rebase': return A.rebase(this);
      case 'interactive-rebase': return A.interactiveRebase(this, this.selectedCommit());
      case 'tag': return A.tag(this);
      case 'stash': return A.stash(this);
      case 'apply-stash': return A.applyStash(this);
      case 'discard': return A.discard(this);
      case 'discard-selected': return A.discard(this, st.selectedPaths());
      case 'reset-current': {
        const sha = this.selectedCommit();
        if (!sha) return toast(t('Select a commit in History'));
        return A.resetTo(this, sha);
      }
      case 'add-remote': return A.addRemote(this);
      case 'add-submodule': return A.addSubmodule(this);
      case 'create-patch': return A.createPatch(this, this.view === 'status' ? null : this.selectedCommit());
      case 'apply-patch': return A.applyPatchFile(this);
      case 'archive': return A.archive(this, this.selectedCommit());
      case 'flow': return A.flow(this, arg);
      case 'show-in-folder': return api.shell.openPath(this.path);
      case 'terminal': return api.shell.terminal(this.path);
      case 'view-remote': return A.viewRemote(this);
      case 'repo-settings': return A.repoSettings(this);
      case 'stage-all': return st.stage(null);
      case 'unstage-all': return st.unstage(null);
      case 'stop-tracking': {
        const p = st.selectedPaths();
        return p.length ? this.run(['rm', '--cached', '-r', '-q', '--', ...p], { title: t('Stop tracking') }) : toast(t('Select files in Changes'));
      }
      case 'ignore-selected': {
        const p = st.selectedPaths();
        return p.length ? A.ignore(this, p[0]) : toast(t('Select a file in Changes'));
      }
      case 'resolve': {
        const conflicted = this.status.conflicted.map((f) => f.path);
        const sel = st.selectedPaths().filter((p) => conflicted.includes(p));
        const files = sel.length ? sel : conflicted;
        if (arg === 'unmark') {
          return sel.length ? this.run(['checkout', '-m', '--', ...sel], { title: t('Mark as unresolved') }) : toast(t('Select files'));
        }
        if (arg === 'restart') {
          return this.run(['checkout', '-m', '--', ...conflicted.concat(this.status.staged.map((f) => f.path))], { title: t('Recreate conflict markers'), confirm: t('Recreate the conflict markers of all files? The resolutions you made will be lost.') });
        }
        return A.resolve(this, files, arg);
      }
      case 'abort-operation': return A.abortOperation(this);
      case 'continue-operation': return A.continueOperation(this);
      case 'log-selected': {
        const p = st.selectedPaths()[0];
        return p ? this.fileLog(p) : toast(t('Select a file'));
      }
      case 'blame-selected': {
        const p = st.selectedPaths()[0];
        return p ? A.blame(this, p) : toast(t('Select a file'));
      }
      case 'copy-sha': {
        const sha = this.selectedCommit();
        if (!sha) return toast(t('Select a commit'));
        api.clipboard.write(sha);
        return toast(t('SHA copied'));
      }
      case 'focus-search':
        if (this.view === 'status') return st.searchInput.focus();
        return this.setView('search');
      case 'toggle-sidebar':
        this.sidebar.el.classList.toggle('hidden');
        return this.body.querySelector('.sb-splitter').classList.toggle('hidden');
      default:
    }
  }
}
