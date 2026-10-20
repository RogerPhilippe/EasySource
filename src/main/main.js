// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const git = require('./git');
const guard = require('./guard');
const { Store } = require('./store');
const { buildMenu } = require('./menu');
const i18n = require('../i18n');

const { t } = i18n;

let win;
let store;
const watchers = new Map();
// Repositórios abertos em abas: limitam onde o renderer pode apagar ou abrir arquivos.
const openRepos = new Set();
// Caminhos escolhidos pelo usuário no diálogo "Salvar": únicos destinos de fs:write.
const savePaths = new Set();
const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER).href;

function send(ch, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try { win.webContents.send(ch, payload); } catch { /* janela fechando */ }
}

git.events.on('start', (e) => send('git:cmd', { ...e, phase: 'start' }));
git.events.on('progress', (e) => send('git:cmd', { ...e, phase: 'progress' }));
git.events.on('end', (e) => send('git:cmd', { ...e, phase: 'end' }));

function createWindow() {
  const b = store.get('window');
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 560,
    title: 'EasySource',
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#f5f6f7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (b.maximized) win.maximize();
  win.loadFile(RENDERER);
  // Erros do renderer vão para o stdout (útil em desenvolvimento).
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error(`[renderer] ${e.message} (${path.basename(e.sourceId || '')}:${e.lineNumber})`);
  });
  // A janela só mostra a interface local: nada de navegar para outra página.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  // EASYSOURCE_SCREENSHOT=arquivo.png: captura a janela após carregar e encerra (testes visuais).
  if (process.env.EASYSOURCE_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.EASYSOURCE_SCREENSHOT_JS) {
        await win.webContents.executeJavaScript(process.env.EASYSOURCE_SCREENSHOT_JS).catch((e) => console.error(e));
        await new Promise((r) => setTimeout(r, 1200));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.EASYSOURCE_SCREENSHOT, img.toPNG());
      app.quit();
    }, +(process.env.EASYSOURCE_SCREENSHOT_DELAY || 4000)));
  }
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    store.set('window', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('focus', () => send('app:focus'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  Menu.setApplicationMenu(buildMenu((cmd, arg) => send('menu', { cmd, arg }), store));
}

// ---------- watcher da cópia de trabalho ----------
function watch(repo) {
  if (watchers.has(repo)) return;
  let timer = null;
  try {
    const w = fs.watch(repo, { recursive: true }, (_ev, file) => {
      if (file && /(^|[\\/])\.git[\\/](objects|logs)[\\/]/.test(file)) return;
      if (file && /(^|[\\/])\.git[\\/].*\.lock$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => send('repo:changed', repo), 600);
    });
    w.on('error', () => unwatch(repo));
    watchers.set(repo, w);
  } catch { /* sistema sem watch recursivo: o renderer recarrega ao focar */ }
}
function unwatch(repo) {
  const w = watchers.get(repo);
  if (w) { w.close(); watchers.delete(repo); }
}

// ---------- IPC ----------
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    try {
      if (!e.senderFrame || !e.senderFrame.url.startsWith(RENDERER_URL)) throw new Error(t('origin not allowed'));
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

handle('store:get', (k) => store.get(k));
handle('store:set', (k, v) => store.set(k, v));

// Só opções inofensivas passam; o ambiente do processo git nunca vem do renderer.
handle('git:exec', (repo, args, opts = {}) => git.run(repo, guard.gitArgs(args), {
  input: typeof opts.input === 'string' ? opts.input : undefined,
  allowFail: !!opts.allowFail,
  quiet: !!opts.quiet,
  env: opts.noEditor ? { GIT_EDITOR: 'true' } : undefined,
}));
handle('git:status', (repo) => git.status(repo));
handle('git:log', (repo, opts) => git.log(repo, opts));
handle('git:refs', (repo) => git.refs(repo));
handle('git:remotes', (repo) => git.remotes(repo));
handle('git:commit-details', (repo, sha) => git.commitDetails(repo, sha));
handle('git:diff', (repo, opts) => git.diff(repo, opts));
handle('git:diff-refs', (repo, a, b) => git.diffRefs(repo, a, b));
handle('git:blame', (repo, file, rev) => git.blame(repo, file, rev));
handle('git:is-repo', (dir) => git.isRepo(dir));
handle('git:config', (repo, key, opts) => git.config(repo, guard.configKey(key), { global: !!opts?.global }));
handle('git:state', (repo) => git.repoState(repo));

// Aplica patch (stage/unstage/discard de hunk ou linhas) via stdin.
handle('git:apply-patch', async (repo, file, hunk, selected, mode) => {
  const reverse = mode === 'unstage' || mode === 'discard';
  const patch = git.buildPatch(file, hunk, selected ? new Set(selected) : null, reverse);
  const args = ['apply', '--whitespace=nowarn', '--recount'];
  if (mode !== 'discard') args.push('--cached');
  if (reverse) args.push('-R');
  args.push('-');
  return git.run(repo, args, { input: patch });
});

// Rebase interativo: escreve o todo num arquivo e usa um "editor" Node que o copia.
handle('git:interactive-rebase', async (repo, base, todo) => {
  const actions = new Set(['pick', 'squash', 'fixup', 'drop']);
  if (!Array.isArray(todo) || !todo.every((t) => actions.has(t.action) && /^[0-9a-f]{7,64}$/.test(t.sha))) throw new Error(t('invalid rebase list'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easysource-'));
  const tmp = path.join(dir, 'todo.txt');
  fs.writeFileSync(tmp, todo.map((t) => `${t.action} ${t.sha} ${String(t.subject).replace(/[\r\n]/g, ' ')}`).join('\n') + '\n');
  // No app empacotado o script fica em app.asar.unpacked (asarUnpack), acessível ao git.
  const editor = path.join(__dirname, 'seq-editor.js').replace('app.asar', 'app.asar.unpacked').replace(/\\/g, '/');
  const node = process.execPath.replace(/\\/g, '/');
  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    GIT_SEQUENCE_EDITOR: `"${node}" "${editor}" "${tmp.replace(/\\/g, '/')}"`,
    GIT_EDITOR: 'true',
  };
  try {
    return await git.run(repo, ['rebase', '-i', '--autostash', base], { env });
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
});

handle('repo:watch', async (repo) => {
  if (!(await git.isRepo(repo))) throw new Error(t('not a Git repository'));
  openRepos.add(path.resolve(repo));
  watch(repo);
});
handle('repo:unwatch', (repo) => { openRepos.delete(path.resolve(repo)); unwatch(repo); });

handle('dialog:open-dir', async (title) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:open-file', async (title, filters) => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:save-file', async (title, defaultPath, filters) => {
  const r = await dialog.showSaveDialog(win, { title, defaultPath, filters });
  if (r.canceled) return null;
  savePaths.add(path.resolve(r.filePath));
  return r.filePath;
});

// Menu de contexto nativo: o renderer envia [{id,label,enabled,type}] e recebe o id escolhido.
handle('ui:context-menu', (items) => new Promise((resolve) => {
  let chosen = null;
  const toTpl = (list) => list.map((it) => (it.type === 'separator'
    ? { type: 'separator' }
    : {
      label: it.label,
      enabled: it.enabled !== false,
      submenu: it.submenu ? toTpl(it.submenu) : undefined,
      click: it.submenu ? undefined : () => { chosen = it.id; },
    }));
  Menu.buildFromTemplate(toTpl(items)).popup({ window: win, callback: () => setTimeout(() => resolve(chosen), 0) });
}));

const isDir = (p) => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isDirectory();
// Pastas abrem no gerenciador de arquivos; arquivos só se estiverem num repositório aberto.
handle('shell:open-path', (p) => shell.openPath(isDir(p) ? path.resolve(p) : guard.insideRepo(p, openRepos)));
handle('shell:show-item', (p) => shell.showItemInFolder(String(p)));
handle('shell:open-external', (url) => shell.openExternal(guard.webUrl(url)));
handle('shell:trash', (p) => shell.trashItem(guard.insideRepo(p, openRepos)));
handle('shell:terminal', (dir) => {
  if (!isDir(dir)) throw new Error(t('folder does not exist'));
  const custom = store.get('prefs').terminal;
  if (custom) {
    // Sem shell: o comando é dividido em programa e argumentos.
    const [cmd, ...args] = guard.splitCommand(custom);
    spawn(cmd, args, { cwd: dir, detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/K', `cd /d "${dir}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', dir], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Linux: primeiro terminal encontrado no PATH
    const candidates = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'tilix', 'alacritty', 'kitty', 'xterm'];
    const inPath = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));
    const term = candidates.find(inPath);
    if (!term) throw new Error(t('No terminal found. Set one in Tools > Options.'));
    spawn(term, [], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
  }
});
handle('clipboard:write', (t) => clipboard.writeText(t));
handle('fs:append-line', (file, line) => {
  if (path.basename(String(file)) !== '.gitignore') throw new Error(t('Operation blocked: {reason}', { reason: t('only .gitignore') }));
  file = guard.insideRepo(file, openRepos);
  line = String(line).replace(/[\r\n]/g, '');
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.writeFileSync(file, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
});
handle('fs:exists', (p) => fs.existsSync(p));
handle('fs:write', (p, content) => {
  const file = path.resolve(String(p));
  if (!savePaths.delete(file)) throw new Error(t('Operation blocked: {reason}', { reason: t('destination not chosen in the Save dialog') }));
  fs.writeFileSync(file, String(content));
});
handle('app:theme', (t) => { nativeTheme.themeSource = ['system', 'light', 'dark'].includes(t) ? t : 'system'; return nativeTheme.shouldUseDarkColors; });
// Repositório a abrir, passado na linha de comando (<pasta> ou -f <pasta>).
function argPath() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') || a === '-f');
  const i = args.indexOf('-f');
  const p = i >= 0 ? args[i + 1] : args.find((a) => a !== '.' && fs.existsSync(a) && fs.statSync(a).isDirectory());
  return p ? path.resolve(p) : null;
}
handle('app:info', () => ({ openPath: argPath(), version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, home: os.homedir() }));
handle('app:rebuild-menu', () => Menu.setApplicationMenu(buildMenu((cmd, arg) => send('menu', { cmd, arg }), store)));
// Troca o idioma do processo principal (menus, erros); o renderer recarrega em seguida.
handle('app:set-lang', (code) => {
  i18n.setLang(i18n.resolve(code, app.getPreferredSystemLanguages()));
  Menu.setApplicationMenu(buildMenu((cmd, arg) => send('menu', { cmd, arg }), store));
});
// O preload pede o dicionário de forma síncrona, antes de qualquer módulo do renderer rodar.
ipcMain.on('i18n:get', (e) => {
  const ok = e.senderFrame && e.senderFrame.url.startsWith(RENDERER_URL);
  e.returnValue = { lang: ok ? i18n.lang : 'en', dict: ok ? i18n.dict : {}, langs: i18n.LANGS };
});

if (process.env.EASYSOURCE_USERDATA) app.setPath('userData', process.env.EASYSOURCE_USERDATA);

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  // EASYSOURCE_LANG força um idioma (testes e capturas de tela).
  i18n.setLang(i18n.resolve(process.env.EASYSOURCE_LANG || store.get('prefs').lang, app.getPreferredSystemLanguages()));
  nativeTheme.themeSource = store.get('prefs').theme || 'system';
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { for (const r of [...watchers.keys()]) unwatch(r); });

app.on('window-all-closed', () => {
  for (const r of [...watchers.keys()]) unwatch(r);
  if (store) store.flush();
  if (process.platform !== 'darwin') app.quit();
});
