// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Barra lateral: navegação, branches, tags, remotos, stashes e submódulos.
import { h, icon, fileManager } from './util.js';
import * as A from './actions.js';
import { t } from './i18n.js';

const api = window.api;

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem('sidebar:collapsed') || '{}'); } catch { return {}; }
}
function saveCollapsed(c) {
  try { localStorage.setItem('sidebar:collapsed', JSON.stringify(c)); } catch { /* noop */ }
}

// Agrupa nomes com "/" em pastas (feature/x -> feature > x).
function tree(items, nameOf) {
  const root = { dirs: new Map(), leaves: [] };
  for (const it of items) {
    const parts = nameOf(it).split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), leaves: [] });
      node = node.dirs.get(p);
    }
    node.leaves.push({ it, label: parts[parts.length - 1] });
  }
  return root;
}

export class Sidebar {
  constructor(rv) {
    this.rv = rv;
    this.collapsed = loadCollapsed();
    if (this.collapsed.tags === undefined) this.collapsed.tags = true;
    this.filter = '';
    this.list = h('div', { class: 'sb-list' });
    this.filterInput = h('input', { class: 'sb-filter', type: 'search', placeholder: t('Filter'), oninput: (e) => { this.filter = e.target.value.toLowerCase(); this.render(); } });
    this.el = h('aside', { class: 'sidebar' }, this.list, this.filterInput);
  }

  section(key, title, count, children, onAdd) {
    const collapsed = this.filter ? false : !!this.collapsed[key];
    const head = h('div', { class: 'sb-head', onclick: () => { this.collapsed[key] = !collapsed; saveCollapsed(this.collapsed); this.render(); } },
      h('span', { class: `chev ${collapsed ? '' : 'open'}` }), h('span', { class: 'sb-title' }, title),
      count ? h('span', { class: 'sb-count' }, count) : null,
      onAdd ? h('button', { class: 'sb-add', title: t('Add'), onclick: (e) => { e.stopPropagation(); onAdd(); } }, '+') : null);
    return h('div', { class: 'sb-section' }, head, collapsed ? null : h('div', { class: 'sb-items' }, children));
  }

  item({ label, iconName, active, bold, badge, title, onclick, ondblclick, oncontext, depth = 0, cls = '' }) {
    return h('div', {
      class: `sb-item ${active ? 'active' : ''} ${bold ? 'bold' : ''} ${cls}`,
      style: { paddingLeft: `${18 + depth * 14}px` },
      title: title || label,
      onclick, ondblclick,
      oncontextmenu: oncontext ? (e) => { e.preventDefault(); oncontext(e); } : null,
    }, iconName ? icon(iconName, 14) : null, h('span', { class: 'sb-label' }, label), badge ? h('span', { class: 'sb-badges' }, badge) : null);
  }

  renderTree(node, depth, leafFn, keyPrefix) {
    const out = [];
    for (const [name, sub] of [...node.dirs.entries()].sort()) {
      const key = `${keyPrefix}/${name}`;
      const collapsed = this.filter ? false : !!this.collapsed[key];
      out.push(h('div', {
        class: 'sb-item sb-folder', style: { paddingLeft: `${18 + depth * 14}px` },
        onclick: () => { this.collapsed[key] = !collapsed; saveCollapsed(this.collapsed); this.render(); },
      }, h('span', { class: `chev ${collapsed ? '' : 'open'}` }), icon('folder', 14), h('span', { class: 'sb-label' }, name)));
      if (!collapsed) out.push(...this.renderTree(sub, depth + 1, leafFn, key));
    }
    for (const leaf of node.leaves) out.push(leafFn(leaf, depth));
    return out;
  }

  render() {
    const rv = this.rv;
    const refs = rv.refs || { branches: [], remotes: {}, tags: [], stashes: [], submodules: [] };
    const st = rv.status;
    const changes = st ? new Set([...st.staged, ...st.unstaged, ...st.conflicted].map((f) => f.path)).size : 0;
    const match = (s) => !this.filter || s.toLowerCase().includes(this.filter);
    this.list.innerHTML = '';

    this.list.append(this.section('workspace', t('Navigate'), 0, [
      this.item({ label: t('Changes'), iconName: 'file', active: rv.view === 'status', badge: changes ? h('span', { class: 'pill' }, changes) : null, onclick: () => rv.setView('status') }),
      this.item({ label: t('History'), iconName: 'history', active: rv.view === 'history', onclick: () => rv.setView('history') }),
      this.item({ label: t('Search'), iconName: 'search', active: rv.view === 'search', onclick: () => rv.setView('search') }),
    ]));

    const branches = refs.branches.filter((b) => match(b.name));
    this.list.append(this.section('branches', 'Branches', 0,
      this.renderTree(tree(branches, (b) => b.name), 0, ({ it: b, label }, depth) => this.item({
        label, depth, iconName: 'branch', bold: b.current, cls: b.current ? 'current' : '',
        title: `${b.name}${b.upstream ? ` → ${b.upstream}` : ''}${b.gone ? ` ${t('(remote deleted)')}` : ''}`,
        badge: [b.ahead ? h('span', { class: 'ab' }, `${b.ahead}↑`) : null, b.behind ? h('span', { class: 'ab' }, `${b.behind}↓`) : null],
        onclick: () => rv.jumpToRef(b.sha),
        ondblclick: () => A.checkoutBranch(rv, b.name, false),
        oncontext: () => this.branchMenu(b),
      }), 'b'),
    () => A.newBranch(rv)));

    const tags = refs.tags.filter((tg) => match(tg.name));
    this.list.append(this.section('tags', 'Tags', refs.tags.length,
      tags.map((tg) => this.item({
        label: tg.name, iconName: 'tag', onclick: () => rv.jumpToRef(tg.sha),
        ondblclick: () => A.checkoutCommit(rv, tg.name),
        oncontext: () => this.tagMenu(tg),
      })),
    () => A.tag(rv)));

    const remoteNodes = [];
    for (const [remote, list] of Object.entries(refs.remotes)) {
      const key = `r:${remote}`;
      const collapsed = this.filter ? false : this.collapsed[key] !== false;
      const filtered = list.filter((b) => match(b.name));
      if (this.filter && !filtered.length) continue;
      remoteNodes.push(h('div', {
        class: 'sb-item sb-folder', style: { paddingLeft: '18px' },
        onclick: () => { this.collapsed[key] = !collapsed; saveCollapsed(this.collapsed); this.render(); },
        oncontextmenu: (e) => { e.preventDefault(); this.remoteMenu(remote); },
      }, h('span', { class: `chev ${collapsed ? '' : 'open'}` }), icon('cloud', 14), h('span', { class: 'sb-label' }, remote)));
      if (!collapsed) {
        remoteNodes.push(...this.renderTree(tree(filtered, (b) => b.short), 1, ({ it: b, label }, depth) => this.item({
          label, depth, iconName: 'branch', title: b.name,
          onclick: () => rv.jumpToRef(b.sha),
          ondblclick: () => A.checkoutBranch(rv, b.name, true),
          oncontext: () => this.remoteBranchMenu(b),
        }), key));
      }
    }
    this.list.append(this.section('remotes', t('Remotes'), 0, remoteNodes, () => A.addRemote(rv)));

    if (refs.stashes.length) {
      this.list.append(this.section('stashes', 'Stashes', refs.stashes.length, refs.stashes.filter((s) => match(s.message)).map((s) => this.item({
        label: s.message, iconName: 'stash', title: `${s.ref}: ${s.message}`,
        onclick: () => rv.showStash(s),
        ondblclick: () => A.applyStash(rv, s.ref),
        oncontext: () => this.stashMenu(s),
      }))));
    }
    if (refs.submodules.length) {
      this.list.append(this.section('submodules', t('Submodules'), refs.submodules.length, refs.submodules.map((s) => this.item({
        label: s.path, iconName: 'box', title: `${s.path} @ ${s.sha.slice(0, 8)}${s.state === '-' ? ` ${t('(not initialized)')}` : s.state === '+' ? ` ${t('(different commit)')}` : ''}`,
        ondblclick: () => window.app.openRepo(`${rv.path}/${s.path}`),
        oncontext: () => this.submoduleMenu(s),
      }))));
    }
  }

  async branchMenu(b) {
    const rv = this.rv;
    const cur = rv.status?.branch;
    const id = await api.ui.contextMenu([
      { id: 'checkout', label: `Checkout ${b.name}`, enabled: !b.current },
      { id: 'merge', label: t('Merge {name} into the current branch', { name: b.name }), enabled: !b.current },
      { id: 'rebase', label: t('Rebase the current branch onto {name}', { name: b.name }), enabled: !b.current },
      { type: 'separator' },
      { id: 'pull', label: b.upstream ? t('Pull from {name}', { name: b.upstream }) : t('Pull (no upstream)'), enabled: !!b.upstream && b.current },
      { id: 'push', label: b.upstream ? t('Push to {name}', { name: b.upstream }) : `Push ${b.name}…` },
      { id: 'pushto', label: t('Push to'), submenu: Object.keys(rv.refs.remotes).map((r) => ({ id: `pushto:${r}`, label: r })) },
      { id: 'track', label: t('Set upstream'), submenu: [{ id: 'track:', label: t('(None)') }, ...Object.values(rv.refs.remotes).flat().map((r) => ({ id: `track:${r.name}`, label: r.name }))] },
      { type: 'separator' },
      { id: 'diff', label: t('Compare with the current branch'), enabled: !b.current },
      { id: 'rename', label: t('Rename {name}…', { name: b.name }) },
      { id: 'delete', label: t('Delete {name}', { name: b.name }), enabled: !b.current },
      { type: 'separator' },
      { id: 'copy', label: t('Copy branch name') },
    ]);
    if (!id) return;
    if (id === 'checkout') A.checkoutBranch(rv, b.name, false);
    else if (id === 'merge') A.merge(rv, b.name);
    else if (id === 'rebase') A.rebase(rv, b.name);
    else if (id === 'pull') rv.run(['pull', '--progress', '--no-rebase'], { title: 'Pull', progress: true });
    else if (id === 'push') {
      if (b.upstream) {
        const i = b.upstream.indexOf('/');
        rv.run(['push', '--progress', b.upstream.slice(0, i), `refs/heads/${b.name}:refs/heads/${b.upstream.slice(i + 1)}`], { title: 'Push', progress: true });
      } else A.push(rv, { branch: b.name });
    } else if (id.startsWith('pushto:')) A.push(rv, { branch: b.name, remote: id.slice(7) });
    else if (id.startsWith('track:')) {
      const up = id.slice(6);
      rv.run(up ? ['branch', `--set-upstream-to=${up}`, b.name] : ['branch', '--unset-upstream', b.name], { title: t('Track') });
    } else if (id === 'diff') rv.showRefDiff(cur || 'HEAD', b.name);
    else if (id === 'rename') A.renameBranch(rv, b.name);
    else if (id === 'delete') A.deleteBranches(rv, [b.name]);
    else if (id === 'copy') api.clipboard.write(b.name);
  }

  async remoteBranchMenu(b) {
    const rv = this.rv;
    const remote = b.name.slice(0, b.name.indexOf('/'));
    const id = await api.ui.contextMenu([
      { id: 'checkout', label: `Checkout ${b.name}…` },
      { id: 'pull', label: t('Pull {name} into the current branch', { name: b.name }) },
      { id: 'merge', label: t('Merge {name} into the current branch', { name: b.name }) },
      { id: 'rebase', label: t('Rebase the current branch onto {name}', { name: b.name }) },
      { type: 'separator' },
      { id: 'diff', label: t('Compare with the current branch') },
      { id: 'delete', label: t('Delete {name}', { name: b.name }) },
      { id: 'copy', label: t('Copy branch name') },
    ]);
    if (id === 'checkout') A.checkoutBranch(rv, b.name, true);
    else if (id === 'pull') A.pull(rv, { remote, branch: b.short });
    else if (id === 'merge') A.merge(rv, b.name);
    else if (id === 'rebase') A.rebase(rv, b.name);
    else if (id === 'diff') rv.showRefDiff(rv.status?.branch || 'HEAD', b.name);
    else if (id === 'delete') A.deleteBranches(rv, [`remote:${b.name}`]);
    else if (id === 'copy') api.clipboard.write(b.name);
  }

  async remoteMenu(remote) {
    const rv = this.rv;
    const id = await api.ui.contextMenu([
      { id: 'fetch', label: t('Fetch from {name}', { name: remote }) },
      { id: 'pull', label: t('Pull from {name}…', { name: remote }) },
      { id: 'push', label: t('Push to {name}…', { name: remote }) },
      { type: 'separator' },
      { id: 'edit', label: t('Edit remotes…') },
      { id: 'remove', label: t('Delete {name}', { name: remote }) },
    ]);
    if (id === 'fetch') rv.run(['fetch', '--progress', '--prune', remote], { title: 'Fetch', progress: true });
    else if (id === 'pull') A.pull(rv, { remote });
    else if (id === 'push') A.push(rv, { remote });
    else if (id === 'edit') A.repoSettings(rv);
    else if (id === 'remove') rv.run(['remote', 'remove', remote], { title: t('Remove remote'), confirm: t('Remove the remote "{name}"?', { name: remote }) });
  }

  async tagMenu(tg) {
    const rv = this.rv;
    const id = await api.ui.contextMenu([
      { id: 'checkout', label: `Checkout ${tg.name}…` },
      { id: 'push', label: t('Push tag to'), submenu: Object.keys(rv.refs.remotes).map((r) => ({ id: `push:${r}`, label: r })) },
      { id: 'delete', label: t('Delete {name}', { name: tg.name }) },
      { type: 'separator' },
      { id: 'copy', label: t('Copy tag name') },
    ]);
    if (id === 'checkout') A.checkoutCommit(rv, tg.name);
    else if (id?.startsWith('push:')) rv.run(['push', '--progress', id.slice(5), `refs/tags/${tg.name}`], { title: 'Push tag', progress: true });
    else if (id === 'delete') A.tag(rv, null, { tab: 1, name: tg.name });
    else if (id === 'copy') api.clipboard.write(tg.name);
  }

  async stashMenu(s) {
    const rv = this.rv;
    const id = await api.ui.contextMenu([
      { id: 'apply', label: t('Apply stash "{name}"', { name: s.message }) },
      { id: 'delete', label: t('Delete stash "{name}"', { name: s.message }) },
      { id: 'branch', label: t('Create branch from stash…') },
    ]);
    if (id === 'apply') A.applyStash(rv, s.ref);
    else if (id === 'delete') A.dropStash(rv, s.ref);
    else if (id === 'branch') {
      const name = await window.app.prompt(t('Branch from stash'), t('Branch name:'));
      if (name) rv.run(['stash', 'branch', name, s.ref], { title: 'Stash → branch' });
    }
  }

  async submoduleMenu(s) {
    const rv = this.rv;
    const id = await api.ui.contextMenu([
      { id: 'open', label: t('Open {name}', { name: s.path }) },
      { id: 'update', label: t('Update (init + update)') },
      { id: 'explorer', label: t('Show in {app}', { app: fileManager() }) },
    ]);
    if (id === 'open') window.app.openRepo(`${rv.path}/${s.path}`);
    else if (id === 'update') rv.run(['submodule', 'update', '--init', '--recursive', '--', s.path], { title: t('Submodule'), progress: true });
    else if (id === 'explorer') api.shell.openPath(`${rv.path}/${s.path}`);
  }
}
