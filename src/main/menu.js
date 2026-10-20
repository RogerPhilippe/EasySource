// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Menu da aplicação: Arquivo, Editar, Exibir, Repositório, Ações, Ferramentas, Ajuda.
const { Menu, app } = require('electron');
const i18n = require('../i18n');

const { t } = i18n;
// Livro Pro Git na língua da interface (git-scm.com tem todas estas traduções).
const BOOK = { 'pt-BR': 'pt-br', 'zh-CN': 'zh', es: 'es', ja: 'ja', de: 'de', fr: 'fr', ko: 'ko', ru: 'ru' };
const LICENSE = { 'pt-BR': '.pt-BR', es: '.es' };

function buildMenu(emit, store) {
  const c = (label, cmd, accelerator, arg) => ({ label, accelerator, click: () => emit(cmd, arg) });
  const theme = store.get('prefs').theme;
  const isMac = process.platform === 'darwin';
  const fm = isMac ? 'Finder' : process.platform === 'win32' ? 'Explorer' : t('file manager');
  const tpl = [
    // macOS: menu do aplicativo padrão (Sobre, Ajustes, Ocultar, Encerrar)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        c(t('About EasySource'), 'about'),
        { type: 'separator' },
        c(t('Settings…'), 'preferences', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services', label: t('Services') },
        { type: 'separator' },
        { role: 'hide', label: t('Hide EasySource') },
        { role: 'hideOthers', label: t('Hide Others') },
        { role: 'unhide', label: t('Show All') },
        { type: 'separator' },
        { role: 'quit', label: t('Quit EasySource') },
      ],
    }] : []),
    {
      label: t('&File'),
      submenu: [
        c(t('Clone or create repository…'), 'new-tab', 'CmdOrCtrl+N', 'clone'),
        c(t('Open…'), 'open-repo', 'CmdOrCtrl+O'),
        c(t('New tab'), 'new-tab', 'CmdOrCtrl+T', 'local'),
        c(t('Close tab'), 'close-tab', 'CmdOrCtrl+W'),
        { type: 'separator' },
        c(t('Next tab'), 'next-tab', 'Ctrl+Tab'),
        c(t('Previous tab'), 'prev-tab', 'Ctrl+Shift+Tab'),
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit', label: t('Exit') }]),
      ],
    },
    {
      label: t('&Edit'),
      submenu: [
        { role: 'undo', label: t('Undo') }, { role: 'redo', label: t('Redo') }, { type: 'separator' },
        { role: 'cut', label: t('Cut') }, { role: 'copy', label: t('Copy') }, { role: 'paste', label: t('Paste') },
        { role: 'selectAll', label: t('Select all') }, { type: 'separator' },
        c(t('Find'), 'focus-search', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: t('&View'),
      submenu: [
        c(t('Changes'), 'view', 'CmdOrCtrl+1', 'status'),
        c(t('History'), 'view', 'CmdOrCtrl+2', 'history'),
        c(t('Search'), 'view', 'CmdOrCtrl+3', 'search'),
        { type: 'separator' },
        c(t('Refresh'), 'refresh', 'F5'),
        c(t('Fetch updates from remotes'), 'fetch-quiet', 'Shift+F5'),
        { type: 'separator' },
        c(t('Show/hide sidebar'), 'toggle-sidebar', 'CmdOrCtrl+Alt+S'),
        c(t('Git command log'), 'toggle-log', 'CmdOrCtrl+Alt+L'),
        { type: 'separator' },
        {
          label: t('Theme'),
          submenu: [
            { label: t('Follow the system'), type: 'radio', checked: theme === 'system', click: () => emit('theme', 'system') },
            { label: t('Light'), type: 'radio', checked: theme === 'light', click: () => emit('theme', 'light') },
            { label: t('Dark'), type: 'radio', checked: theme === 'dark', click: () => emit('theme', 'dark') },
          ],
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Full screen') },
        { role: 'resetZoom', label: t('Actual size') }, { role: 'zoomIn', label: t('Zoom in') }, { role: 'zoomOut', label: t('Zoom out') },
        { role: 'toggleDevTools', label: t('Developer tools') },
      ],
    },
    {
      label: t('&Repository'),
      submenu: [
        c('Commit…', 'commit', 'CmdOrCtrl+Shift+C'),
        c('Checkout…', 'checkout'),
        c('Fetch…', 'fetch', 'CmdOrCtrl+Shift+F'),
        c('Pull…', 'pull', 'CmdOrCtrl+Shift+L'),
        c('Push…', 'push', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        c('Branch…', 'branch', 'CmdOrCtrl+Shift+B'),
        c('Merge…', 'merge', 'CmdOrCtrl+Shift+M'),
        c('Rebase…', 'rebase'),
        c(t('Interactive rebase…'), 'interactive-rebase'),
        c('Tag…', 'tag', 'CmdOrCtrl+Shift+T'),
        c('Stash…', 'stash', 'CmdOrCtrl+Shift+S'),
        c(t('Apply stash…'), 'apply-stash'),
        c(t('Discard…'), 'discard', 'CmdOrCtrl+Shift+R'),
        c(t('Move branch to commit…'), 'reset-current'),
        { type: 'separator' },
        c(t('Add remote…'), 'add-remote'),
        c(t('Add submodule…'), 'add-submodule'),
        c(t('Create patch…'), 'create-patch'),
        c(t('Apply patch…'), 'apply-patch'),
        c(t('Export as archive…'), 'archive'),
        { type: 'separator' },
        {
          label: 'Git flow',
          submenu: [
            c(t('Initialize repository'), 'flow', null, 'init'),
            { type: 'separator' },
            c(t('Start new feature'), 'flow', null, 'start-feature'),
            c(t('Finish feature'), 'flow', null, 'finish-feature'),
            c(t('Start new release'), 'flow', null, 'start-release'),
            c(t('Finish release'), 'flow', null, 'finish-release'),
            c(t('Start new hotfix'), 'flow', null, 'start-hotfix'),
            c(t('Finish hotfix'), 'flow', null, 'finish-hotfix'),
          ],
        },
        { type: 'separator' },
        c(t('Open remote page'), 'view-remote'),
        c(t('Show in {app}', { app: fm }), 'show-in-folder'),
        c(t('Open in terminal'), 'terminal', 'CmdOrCtrl+Alt+T'),
        c(t('Repository settings…'), 'repo-settings'),
      ],
    },
    {
      label: t('Actio&ns'),
      submenu: [
        c(t('Stage all and commit…'), 'commit-all'),
        c(t('Stage all'), 'stage-all'),
        c(t('Unstage all'), 'unstage-all'),
        c(t('Discard selected…'), 'discard-selected'),
        c(t('Stop tracking'), 'stop-tracking'),
        c(t('Ignore…'), 'ignore-selected'),
        { type: 'separator' },
        {
          label: t('Resolve conflicts'),
          submenu: [
            c(t('Keep my version'), 'resolve', null, 'ours'),
            c(t('Use the incoming version'), 'resolve', null, 'theirs'),
            { type: 'separator' },
            c(t('Mark as resolved'), 'resolve', null, 'mark'),
            c(t('Mark as unresolved'), 'resolve', null, 'unmark'),
            c(t('Recreate conflict markers'), 'resolve', null, 'restart'),
          ],
        },
        c(t('Continue operation in progress'), 'continue-operation'),
        c(t('Abort operation in progress'), 'abort-operation'),
        { type: 'separator' },
        c(t('File history…'), 'log-selected'),
        c(t('Line authorship (blame)…'), 'blame-selected'),
        c(t('Copy SHA'), 'copy-sha', 'CmdOrCtrl+Shift+H'),
      ],
    },
    {
      label: t('&Tools'),
      submenu: [
        c(t('Options…'), 'preferences', 'CmdOrCtrl+,'),
      ],
    },
    {
      label: t('&Help'),
      submenu: [
        c(t('Git documentation'), 'open-url', null, 'https://git-scm.com/doc'),
        c(t('Learn Git (Pro Git book)'), 'open-url', null, `https://git-scm.com/book/${BOOK[i18n.lang] || 'en'}/v2`),
        { type: 'separator' },
        c(t('EasySource source code'), 'open-url', null, 'https://github.com/RogerPhilippe/EasySource'),
        c(t('License (AGPLv3)'), 'open-url', null, 'https://github.com/RogerPhilippe/EasySource/blob/main/LICENSE'),
        c(t('Commercial license'), 'open-url', null, `https://github.com/RogerPhilippe/EasySource/blob/main/COMMERCIAL-LICENSE${LICENSE[i18n.lang] || ''}.md`),
        { type: 'separator' },
        c(t('About EasySource'), 'about'),
      ],
    },
  ];
  return Menu.buildFromTemplate(tpl);
}

module.exports = { buildMenu };
