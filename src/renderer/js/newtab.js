// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Página "Nova aba": favoritos, clonar, abrir existente e criar.
import { h, icon, basename, toast, fileManager } from './util.js';
import { processDialog, confirmBox } from './modal.js';
import { t } from './i18n.js';

const api = window.api;
const TABS = [['local', t('Favorites')], ['clone', t('Clone')], ['add', t('Open existing')], ['create', t('New')]];

export class NewTabView {
  constructor(app, tab = 'local') {
    this.app = app;
    this.tab = tab;
    this.name = t('New tab');
    this.tabBar = h('div', { class: 'nt-tabs' });
    this.page = h('div', { class: 'nt-page' });
    this.el = h('div', { class: 'newtab' }, this.tabBar, this.page);
    this.show(tab);
  }

  show(tab) {
    this.tab = tab;
    this.tabBar.replaceChildren(...TABS.map(([id, label]) => h('button', { class: `nt-tab ${id === tab ? 'active' : ''}`, onclick: () => this.show(id) }, label)));
    this.page.replaceChildren(this[tab]());
  }

  // ---------- Local: repositórios marcados ----------
  local() {
    const search = h('input', { type: 'search', class: 'search-big', placeholder: t('Search repositories'), oninput: () => draw() });
    const list = h('div', { class: 'bm-list' });
    const draw = () => {
      const q = search.value.toLowerCase();
      const bms = this.app.bookmarks.filter((b) => !q || b.name.toLowerCase().includes(q) || b.path.toLowerCase().includes(q));
      list.innerHTML = '';
      if (!this.app.bookmarks.length) {
        list.append(h('div', { class: 'empty' }, t('No repositories yet. Open an existing folder, clone or create a repository, or drag folders here.')));
        return;
      }
      for (const b of bms) {
        list.append(h('div', {
          class: 'bm-row', title: b.path,
          ondblclick: () => this.app.openRepo(b.path, { replace: this }),
          onkeydown: (e) => { if (e.key === 'Enter') this.app.openRepo(b.path, { replace: this }); },
          tabIndex: 0,
          oncontextmenu: async (e) => {
            e.preventDefault();
            const id = await api.ui.contextMenu([
              { id: 'open', label: t('Open') },
              { id: 'explorer', label: t('Show in {app}', { app: fileManager() }) },
              { id: 'terminal', label: t('Open in terminal') },
              { type: 'separator' },
              { id: 'rename', label: t('Rename…') },
              { id: 'remove', label: t('Remove from favorites') },
            ]);
            if (id === 'open') this.app.openRepo(b.path, { replace: this });
            else if (id === 'explorer') api.shell.openPath(b.path);
            else if (id === 'terminal') api.shell.terminal(b.path);
            else if (id === 'rename') {
              const n = await this.app.prompt(t('Rename favorite'), t('Name:'), b.name);
              if (n) { b.name = n; this.app.saveBookmarks(); draw(); }
            } else if (id === 'remove') {
              if (await confirmBox(t('Remove favorite'), t('Remove "{name}" from the list? The files are not deleted.', { name: b.name }), { okLabel: t('Remove') })) {
                this.app.bookmarks = this.app.bookmarks.filter((x) => x !== b);
                this.app.saveBookmarks();
                draw();
              }
            }
          },
        }, icon('repo', 26), h('div', { class: 'bm-text' }, h('div', { class: 'bm-name' }, b.name), h('div', { class: 'bm-path' }, b.path))));
      }
    };
    draw();
    list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('drop'); });
    list.addEventListener('dragleave', () => list.classList.remove('drop'));
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drop');
      for (const f of e.dataTransfer.files) {
        const p = api.files.pathOf(f);
        if (p) await this.app.addBookmark(p);
      }
      draw();
    });
    setTimeout(() => search.focus(), 0);
    return h('div', { class: 'nt-local' }, h('div', { class: 'nt-toolbar' }, search,
      h('button', { class: 'btn', onclick: () => this.show('add') }, t('Open existing…')),
      h('button', { class: 'btn', onclick: () => this.show('clone') }, t('Clone…'))), list);
  }

  // ---------- Clonar ----------
  clone() {
    const url = h('input', { type: 'text', placeholder: t('https://… or git@…:user/repo.git'), spellcheck: false });
    const dest = h('input', { type: 'text', spellcheck: false });
    const name = h('input', { type: 'text', spellcheck: false });
    const branch = h('input', { type: 'text', placeholder: t('(remote default)') });
    const depth = h('input', { type: 'number', min: 0, placeholder: t('0 = full') });
    const recurse = h('input', { type: 'checkbox', checked: true });
    const info = h('div', { class: 'form-info' }, t('Enter the repository URL or path'));
    const base = this.app.prefs.cloneDir || this.app.home;
    let userEditedDest = false;
    url.addEventListener('input', () => {
      const n = basename(url.value.trim().replace(/\.git$/, '').replace(/:/g, '/')) || '';
      if (!userEditedDest) dest.value = n ? `${base.replace(/[\\/]+$/, '')}/${n}` : '';
      name.value = n;
      info.textContent = url.value.trim() ? '' : t('Enter the repository URL or path');
    });
    dest.addEventListener('input', () => { userEditedDest = true; name.value = basename(dest.value); });
    const browse = h('button', { class: 'btn', onclick: async () => {
      const p = await api.dialog.openDir(t('Destination folder'));
      if (p) { const n = name.value || 'repo'; dest.value = `${p}/${n}`; userEditedDest = true; }
    } }, t('Browse…'));
    const go = async () => {
      if (!url.value.trim() || !dest.value.trim()) return toast(t('Enter the source URL and the destination path'), 'error');
      if (await api.fs.exists(dest.value.trim())) {
        const empty = await api.git.exec(dest.value.trim(), ['rev-parse'], { allowFail: true, quiet: true }).catch(() => null);
        if (empty) return toast(t('The destination path already exists. Choose an empty folder.'), 'error');
      }
      const args = ['clone', '--progress'];
      if (branch.value.trim()) args.push('--branch', branch.value.trim());
      if (+depth.value > 0) args.push('--depth', String(+depth.value));
      if (recurse.checked) args.push('--recurse-submodules');
      args.push('--', url.value.trim(), dest.value.trim());
      const dlg = processDialog(t('Cloning'));
      dlg.append(`git ${args.join(' ')}\n`);
      this.app.progressSink = (text) => dlg.append(text);
      try {
        const parent = dest.value.trim().replace(/[\\/][^\\/]+[\\/]?$/, '') || base;
        await api.git.exec(parent, args);
        dlg.done(true, t('Clone finished.'));
        const top = await api.git.isRepo(dest.value.trim());
        if (top) {
          await this.app.addBookmark(top, name.value.trim());
          this.app.openRepo(top, { replace: this });
        }
      } catch (e) {
        dlg.done(false, e.message);
      } finally {
        this.app.progressSink = null;
      }
    };
    return h('div', { class: 'nt-form' },
      h('h3', {}, t('Clone a repository')),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Source (URL or path):')), url),
      info,
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Destination folder:')), h('div', { class: 'form-inline' }, dest, browse)),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Name:')), name),
      h('details', { class: 'advanced' }, h('summary', {}, t('Advanced options')),
        h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, 'Branch:'), branch),
        h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Shallow history (commits):')), depth),
        h('label', { class: 'form-check' }, recurse, h('span', {}, t('Include submodules')))),
      h('div', { class: 'nt-actions' }, h('button', { class: 'btn btn-primary', onclick: go }, t('Clone'))));
  }

  // ---------- Abrir repositório existente ----------
  add() {
    const path = h('input', { type: 'text', spellcheck: false });
    const name = h('input', { type: 'text' });
    const info = h('div', { class: 'form-info' }, '');
    const check = async () => {
      name.value = basename(path.value.trim());
      const top = path.value.trim() ? await api.git.isRepo(path.value.trim()) : null;
      info.textContent = top ? t('Repository found: {path}', { path: top }) : t('No Git repository in this folder');
      info.classList.toggle('warn', !top);
    };
    path.addEventListener('change', check);
    const browse = h('button', { class: 'btn', onclick: async () => { const p = await api.dialog.openDir(t('Repository')); if (p) { path.value = p; check(); } } }, t('Browse…'));
    const go = async () => {
      const top = await api.git.isRepo(path.value.trim());
      if (!top) return toast(t('Not a Git repository'), 'error');
      await this.app.addBookmark(top, name.value.trim() || basename(top));
      this.app.openRepo(top, { replace: this });
    };
    return h('div', { class: 'nt-form' },
      h('h3', {}, t('Open an existing repository')),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Folder:')), h('div', { class: 'form-inline' }, path, browse)),
      info,
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Name:')), name),
      h('div', { class: 'nt-actions' }, h('button', { class: 'btn btn-primary', onclick: go }, t('Open'))));
  }

  // ---------- Criar repositório ----------
  create() {
    const path = h('input', { type: 'text', spellcheck: false });
    const name = h('input', { type: 'text' });
    const branch = h('input', { type: 'text', value: 'main' });
    path.addEventListener('input', () => { name.value = basename(path.value.trim()); });
    const browse = h('button', { class: 'btn', onclick: async () => { const p = await api.dialog.openDir(t('New repository folder')); if (p) { path.value = p; name.value = basename(p); } } }, t('Browse…'));
    const go = async () => {
      const p = path.value.trim();
      if (!p) return toast(t('Enter the destination path'), 'error');
      try {
        if (await api.git.isRepo(p) === p) return toast(t('A repository already exists in this folder'), 'error');
        const parent = p.replace(/[\\/][^\\/]+[\\/]?$/, '');
        await api.git.exec(parent || p, ['init', `--initial-branch=${branch.value.trim() || 'main'}`, '--', p]);
        const top = await api.git.isRepo(p);
        await this.app.addBookmark(top, name.value.trim() || basename(top));
        this.app.openRepo(top, { replace: this });
      } catch (e) { toast(e.message, 'error'); }
    };
    return h('div', { class: 'nt-form' },
      h('h3', {}, t('New repository')),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Destination folder:')), h('div', { class: 'form-inline' }, path, browse)),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Name:')), name),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Initial branch:')), branch),
      h('div', { class: 'nt-actions' }, h('button', { class: 'btn btn-primary', onclick: go }, t('Create'))));
  }
}
