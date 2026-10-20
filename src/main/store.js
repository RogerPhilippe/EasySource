// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Persistência simples em JSON no diretório userData (bookmarks, abas, preferências).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  bookmarks: [], // { path, name }
  openTabs: [],
  activeTab: null,
  prefs: { theme: 'system', lang: 'system', cloneDir: '', diffContext: 3, autoRefresh: true, showAllBranches: true, terminal: '' },
  window: { width: 1280, height: 820 },
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'easysource.json');
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      this.data.prefs = { ...DEFAULTS.prefs, ...this.data.prefs };
    } catch {
      this.data = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    clearTimeout(this.t);
    this.t = setTimeout(() => this.flush(), 200);
  }
  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Store };
