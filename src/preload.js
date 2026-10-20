// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld('api', {
  // Idioma e dicionário de traduções: { lang, dict, langs }.
  i18n: ipcRenderer.sendSync('i18n:get'),
  store: { get: (k) => call('store:get', k), set: (k, v) => call('store:set', k, v) },
  git: {
    exec: (repo, args, opts) => call('git:exec', repo, args, opts),
    status: (repo) => call('git:status', repo),
    log: (repo, opts) => call('git:log', repo, opts),
    refs: (repo) => call('git:refs', repo),
    remotes: (repo) => call('git:remotes', repo),
    commitDetails: (repo, sha) => call('git:commit-details', repo, sha),
    diff: (repo, opts) => call('git:diff', repo, opts),
    diffRefs: (repo, a, b) => call('git:diff-refs', repo, a, b),
    blame: (repo, file, rev) => call('git:blame', repo, file, rev),
    isRepo: (dir) => call('git:is-repo', dir),
    config: (repo, key, opts) => call('git:config', repo, key, opts),
    state: (repo) => call('git:state', repo),
    applyPatch: (repo, file, hunk, selected, mode) => call('git:apply-patch', repo, file, hunk, selected, mode),
    interactiveRebase: (repo, base, todo) => call('git:interactive-rebase', repo, base, todo),
  },
  repo: { watch: (r) => call('repo:watch', r), unwatch: (r) => call('repo:unwatch', r) },
  dialog: {
    openDir: (t) => call('dialog:open-dir', t),
    openFile: (t, f) => call('dialog:open-file', t, f),
    saveFile: (t, d, f) => call('dialog:save-file', t, d, f),
  },
  ui: { contextMenu: (items) => call('ui:context-menu', items) },
  shell: {
    openPath: (p) => call('shell:open-path', p),
    showItem: (p) => call('shell:show-item', p),
    openExternal: (u) => call('shell:open-external', u),
    trash: (p) => call('shell:trash', p),
    terminal: (d) => call('shell:terminal', d),
  },
  files: { pathOf: (file) => webUtils.getPathForFile(file) },
  clipboard: { write: (t) => call('clipboard:write', t) },
  fs: {
    appendLine: (f, l) => call('fs:append-line', f, l),
    exists: (p) => call('fs:exists', p),
    write: (p, c) => call('fs:write', p, c),
  },
  app: {
    theme: (t) => call('app:theme', t),
    info: () => call('app:info'),
    rebuildMenu: () => call('app:rebuild-menu'),
    setLang: (code) => call('app:set-lang', code),
  },
  on: (ch, fn) => {
    const allowed = ['menu', 'repo:changed', 'git:cmd', 'app:focus'];
    if (!allowed.includes(ch)) throw new Error('channel not allowed');
    ipcRenderer.on(ch, (_e, p) => fn(p));
  },
});
