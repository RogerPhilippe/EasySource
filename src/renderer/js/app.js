// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Janela principal: abas de repositório + página "Nova aba".
import { h, basename, toast, debounce, fileManager } from './util.js';
import { openForm, openModal, alertBox } from './modal.js';
import { RepoView } from './repo.js';
import { NewTabView } from './newtab.js';
import { t, LANG, LANGS } from './i18n.js';

const api = window.api;

class App {
  constructor() {
    this.tabs = [];
    this.active = null;
    this.bookmarks = [];
    this.prefs = {};
    this.progressSink = null;
    this.tabsEl = document.getElementById('tabs');
    this.content = document.getElementById('content');
    this.cmdlog = document.getElementById('cmdlog-body');
    this.running = new Map();
  }

  async init() {
    const [bookmarks, prefs, openTabs, activeTab, info] = await Promise.all([
      api.store.get('bookmarks'), api.store.get('prefs'), api.store.get('openTabs'), api.store.get('activeTab'), api.app.info(),
    ]);
    this.bookmarks = bookmarks || [];
    this.prefs = prefs;
    this.home = info.home;
    this.info = info;
    document.documentElement.lang = LANG;
    document.getElementById('tab-add').title = t('Repository browser (Ctrl+B)');
    document.querySelector('.cmdlog-head span').textContent = t('Command history');
    document.getElementById('cmdlog-clear').textContent = t('Clear');
    document.getElementById('tab-add').onclick = () => this.newTab();
    document.getElementById('theme-toggle').onclick = () => this.cycleTheme();
    this.updateThemeButton();
    document.getElementById('cmdlog-close').onclick = () => this.toggleLog(false);
    document.getElementById('cmdlog-clear').onclick = () => { this.cmdlog.textContent = ''; };
    api.on('menu', ({ cmd, arg }) => this.onMenu(cmd, arg));
    api.on('git:cmd', (e) => this.onGitCmd(e));
    const changed = debounce((repo) => this.tabs.filter((t) => t.path === repo).forEach((t) => t.refresh()), 300);
    api.on('repo:changed', changed);
    api.on('app:focus', () => { if (this.active && this.active.refresh && this.prefs.autoRefresh) this.active.refresh(); });

    for (const t of openTabs || []) {
      if (t.path && (await api.git.isRepo(t.path))) await this.openRepo(t.path, { view: t.view, background: true });
    }
    if (info.openPath) await this.openRepo(info.openPath);
    if (!this.tabs.length) this.newTab();
    else if (!info.openPath) this.activate(this.tabs[Math.min(activeTab || 0, this.tabs.length - 1)]);
    this.updateStatusBar();
  }

  // ---------- abas ----------
  newTab(tab = 'local') {
    const existing = this.tabs.find((t) => t instanceof NewTabView);
    if (existing) { existing.show(tab); this.activate(existing); return existing; }
    const v = new NewTabView(this, tab);
    this.tabs.push(v);
    this.activate(v);
    return v;
  }

  async openRepo(path, { view, background, replace } = {}) {
    const top = await api.git.isRepo(path);
    if (!top) { alertBox(t('Invalid repository'), t('"{path}" is not a Git repository.', { path })); return null; }
    const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
    const found = this.tabs.find((t) => t.path && norm(t.path) === norm(top));
    if (found) { if (replace) this.closeTab(replace); this.activate(found); return found; }
    if (!this.bookmarks.some((b) => norm(b.path) === norm(top))) await this.addBookmark(top);
    const rv = new RepoView(top, this, view || 'status');
    if (replace) {
      const i = this.tabs.indexOf(replace);
      this.tabs.splice(i, 1, rv);
    } else this.tabs.push(rv);
    if (!background || !this.active) this.activate(rv);
    else this.renderTabs();
    rv.open();
    this.saveTabs();
    return rv;
  }

  activate(tab) {
    this.active = tab;
    this.content.replaceChildren(tab.el);
    this.renderTabs();
    this.saveTabs();
    document.title = tab.path ? `${tab.name} — EasySource` : 'EasySource';
    if (tab.refresh && tab.status) tab.refresh();
    this.updateStatusBar();
  }

  async closeTab(tab = this.active) {
    if (!tab) return;
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (tab.close) await tab.close();
    if (this.active === tab) {
      if (this.tabs.length) this.activate(this.tabs[Math.max(0, i - 1)]);
      else this.newTab();
    } else this.renderTabs();
    this.saveTabs();
  }

  renderTabs() {
    this.tabsEl.replaceChildren(...this.tabs.map((tab) => {
      const st = tab.status;
      const dirty = st && (st.staged.length || st.unstaged.length || st.conflicted.length);
      return h('div', {
        class: `tab ${tab === this.active ? 'active' : ''}`,
        title: tab.path || t('New tab'),
        onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); this.closeTab(tab); } else if (e.button === 0) this.activate(tab); },
        oncontextmenu: async (e) => {
          e.preventDefault();
          const id = await api.ui.contextMenu([
            { id: 'close', label: t('Close tab') },
            { id: 'others', label: t('Close other tabs') },
            ...(tab.path ? [{ type: 'separator' }, { id: 'explorer', label: t('Show in {app}', { app: fileManager() }) }, { id: 'copy', label: t('Copy path') }] : []),
          ]);
          if (id === 'close') this.closeTab(tab);
          else if (id === 'others') for (const o of this.tabs.filter((x) => x !== tab)) await this.closeTab(o);
          else if (id === 'explorer') api.shell.openPath(tab.path);
          else if (id === 'copy') api.clipboard.write(tab.path);
        },
      }, h('span', { class: 'tab-name' }, tab.name), dirty ? h('span', { class: 'tab-dot', title: t('Uncommitted changes') }) : null,
      h('button', { class: 'tab-close', title: t('Close (Ctrl+W)'), onmousedown: (e) => e.stopPropagation(), onclick: () => this.closeTab(tab) }, '×'));
    }));
  }

  updateTab(rv) {
    this.renderTabs();
    if (rv === this.active) this.updateStatusBar();
  }

  saveTabs(now) {
    clearTimeout(this.saveT);
    const save = () => {
      const repos = this.tabs.filter((tab) => tab.path);
      return Promise.all([
        api.store.set('openTabs', repos.map((tab) => ({ path: tab.path, view: tab.view }))),
        api.store.set('activeTab', Math.max(0, repos.indexOf(this.active))),
      ]);
    };
    if (now) return save();
    this.saveT = setTimeout(save, 200);
    return null;
  }

  async addBookmark(path, name) {
    const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
    if (this.bookmarks.some((b) => norm(b.path) === norm(path))) return;
    this.bookmarks.push({ path, name: name || basename(path) });
    this.bookmarks.sort((a, b) => a.name.localeCompare(b.name));
    this.saveBookmarks();
  }

  saveBookmarks() { api.store.set('bookmarks', this.bookmarks); }

  // ---------- barra de status e log de comandos ----------
  updateStatusBar() {
    const left = document.getElementById('status-left');
    const right = document.getElementById('status-right');
    const rv = this.active;
    if (!rv || !rv.status) { left.textContent = ''; right.textContent = `git via CLI • Electron ${this.info?.electron || ''}`; return; }
    const s = rv.status;
    const n = new Set([...s.staged, ...s.unstaged, ...s.conflicted].map((f) => f.path)).size;
    left.textContent = `${s.branch ? `Branch: ${s.branch}` : t('Detached HEAD')}${s.upstream ? ` → ${s.upstream}` : ''}${s.ahead ? `  ↑${s.ahead}` : ''}${s.behind ? `  ↓${s.behind}` : ''}`;
    right.textContent = n ? t('{n} changed file(s)', { n }) : t('Clean');
  }

  onGitCmd(e) {
    const busy = document.getElementById('status-busy');
    const text = document.getElementById('status-busy-text');
    const ts = new Date().toLocaleTimeString();
    if (e.phase === 'start') {
      this.running.set(e.id, e);
      this.cmdlog.textContent += `[${ts}] ${basename(e.cwd)}> git ${e.args.join(' ')}\n`;
      text.textContent = `git ${e.args[0]}…`;
      busy.classList.remove('hidden');
    } else if (e.phase === 'progress') {
      if (this.progressSink) this.progressSink(e.text);
    } else {
      this.running.delete(e.id);
      if (e.code !== 0 && e.stderr) this.cmdlog.textContent += `  ✗ (${e.code}) ${e.stderr.trim()}\n`;
      else this.cmdlog.textContent += `  ✓ ${e.ms} ms\n`;
      if (!this.running.size) busy.classList.add('hidden');
    }
    if (this.cmdlog.textContent.length > 200000) this.cmdlog.textContent = this.cmdlog.textContent.slice(-150000);
    this.cmdlog.scrollTop = this.cmdlog.scrollHeight;
  }

  toggleLog(force) {
    document.getElementById('cmdlog').classList.toggle('hidden', force === undefined ? undefined : !force);
  }

  // ---------- utilitários ----------
  async prompt(title, label, value = '') {
    const v = await openForm({ title, fields: [{ name: 'v', label, value, required: true }] });
    return v ? v.v : null;
  }

  async options() {
    const [gname, gmail, ver] = await Promise.all([
      api.git.config(null, 'user.name', { global: true }),
      api.git.config(null, 'user.email', { global: true }),
      api.git.exec(this.home, ['--version'], { quiet: true }).then((r) => r.stdout.trim()).catch(() => t('git not found')),
    ]);
    const p = this.prefs;
    const v = await openForm({
      title: t('Options'), width: 600, okLabel: t('OK'),
      fields: [
        { type: 'info', label: t('General') },
        { name: 'name', label: t('Full name (global):'), value: gname },
        { name: 'email', label: t('Email address (global):'), value: gmail },
        { name: 'cloneDir', type: 'path', label: t('Default projects folder:'), value: p.cloneDir || this.home },
        { name: 'theme', type: 'select', label: t('Theme:'), value: p.theme, options: [{ value: 'system', label: t('Follow the system') }, { value: 'light', label: t('Light') }, { value: 'dark', label: t('Dark') }] },
        { name: 'lang', type: 'select', label: t('Language:'), value: p.lang || 'system', options: [{ value: 'system', label: t('System language') }, ...LANGS.map((l) => ({ value: l.code, label: l.name }))] },
        { name: 'autoRefresh', type: 'checkbox', label: t('Refresh automatically when files change / when the window gets focus'), value: p.autoRefresh },
        { type: 'info', label: 'Diff' },
        { name: 'diffContext', type: 'select', label: t('Context lines in diff:'), value: String(p.diffContext), options: ['1', '3', '5', '10', '25'] },
        { type: 'info', label: 'Git' },
        { type: 'info', label: t('Version in use: {version} (system git)', { version: ver }) },
        { name: 'terminal', label: t('Custom terminal command:'), value: p.terminal, placeholder: t('empty = system default terminal') },
      ],
    });
    if (!v) return;
    this.prefs = { ...p, cloneDir: v.cloneDir, theme: v.theme, lang: v.lang, autoRefresh: v.autoRefresh, diffContext: +v.diffContext, terminal: v.terminal };
    await api.store.set('prefs', this.prefs);
    await api.app.theme(v.theme);
    this.updateThemeButton();
    const setGlobal = (k, val, old) => (val !== old ? api.git.exec(this.home, ['config', '--global', k, val]) : null);
    await Promise.all([setGlobal('user.name', v.name, gname), setGlobal('user.email', v.email, gmail)]).catch((e) => toast(e.message, 'error'));
    if (v.lang !== (p.lang || 'system')) {
      // Novo idioma: o processo principal troca os menus e a janela recarrega, reabrindo as abas.
      await api.app.setLang(v.lang);
      await this.saveTabs(true);
      window.location.reload();
      return;
    }
    api.app.rebuildMenu();
    if (this.active && this.active.refresh) this.active.refresh();
  }

  async setTheme(theme) {
    this.prefs = { ...this.prefs, theme };
    await api.store.set('prefs', this.prefs);
    await api.app.theme(theme);
    api.app.rebuildMenu(); // mantém Exibir > Tema sincronizado
    this.updateThemeButton();
  }

  // Botão da barra de status: Sistema → Claro → Escuro
  cycleTheme() {
    const order = ['system', 'light', 'dark'];
    this.setTheme(order[(order.indexOf(this.prefs.theme || 'system') + 1) % order.length]);
  }

  updateThemeButton() {
    const theme = this.prefs.theme || 'system';
    const label = { system: t('System'), light: t('Light'), dark: t('Dark') }[theme];
    const glyph = { system: '◐', light: '☀', dark: '☾' }[theme];
    const btn = document.getElementById('theme-toggle');
    btn.textContent = `${glyph} ${label}`;
    btn.title = t('Theme: {name} (click to switch)', { name: label });
  }

  // Avisos legais exigidos pela AGPLv3 (seção 5d) para programas interativos.
  about() {
    const i = this.info;
    const repo = 'https://github.com/RogerPhilippe/EasySource';
    // Insere os links no lugar de {nome} no texto traduzido.
    const fill = (text, nodes) => text.split(/(\{\w+\})/).map((part) => nodes[part.slice(1, -1)] || part);
    const link = (label, url) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.shell.openExternal(url); } }, label);
    openModal({
      title: t('About EasySource'),
      width: 520,
      body: h('div', { class: 'about' }, h('h2', {}, 'EasySource'), h('p', {}, t('Version {version}', { version: i.version })),
        h('p', { class: 'muted' }, t('Visual, cross-platform Git client built with Node.js and Electron.')),
        h('p', {}, 'Copyright © 2026 Roger Philippe Pereira'),
        h('p', {}, fill(t('Free software under the {license} (or any later version), provided WITHOUT ANY WARRANTY. Closed/proprietary use requires the {commercial}.'), {
          license: link('GNU AGPLv3', `${repo}/blob/main/LICENSE`),
          commercial: link(t('commercial license'), `${repo}/blob/main/COMMERCIAL-LICENSE${{ 'pt-BR': '.pt-BR', es: '.es' }[LANG] || ''}.md`),
        })),
        h('p', {}, t('Source code:'), ' ', link(repo.replace('https://', ''), repo)),
        h('p', { class: 'muted' }, `Electron ${i.electron} • Node ${i.node} • ${i.platform}`)),
      buttons: [{ label: t('OK'), primary: true, value: true }],
    });
  }

  async onMenu(cmd, arg) {
    switch (cmd) {
      case 'new-tab': return this.newTab(arg);
      case 'open-repo': {
        const p = await api.dialog.openDir(t('Open repository'));
        if (p) this.openRepo(p, { replace: this.active instanceof NewTabView ? this.active : undefined });
        return;
      }
      case 'close-tab': return this.closeTab();
      case 'next-tab': case 'prev-tab': {
        if (this.tabs.length < 2) return;
        const i = this.tabs.indexOf(this.active);
        return this.activate(this.tabs[(i + (cmd === 'next-tab' ? 1 : -1) + this.tabs.length) % this.tabs.length]);
      }
      case 'preferences': return this.options();
      case 'theme': return this.setTheme(arg);
      case 'toggle-log': return this.toggleLog();
      case 'about': return this.about();
      case 'open-url': return api.shell.openExternal(arg);
      default:
        if (this.active instanceof RepoView) return this.active.menu(cmd, arg);
        return toast(t('Open a repository to use this command'));
    }
  }
}

window.app = new App();
window.app.init().catch((e) => alertBox(t('Startup error'), e.message));
