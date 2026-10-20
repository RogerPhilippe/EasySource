// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Inicia o Electron removendo ELECTRON_RUN_AS_NODE, que terminais do VS Code exportam
// e que faria o Electron rodar como Node puro.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Um primeiro argumento .js é usado como entrada (ex.: scripts/make-icon.js); senão, abre o app.
const args = process.argv.slice(2);
const entry = args[0] && args[0].endsWith('.js') ? path.resolve(args.shift()) : path.join(__dirname, '..');
const child = spawn(electron, [entry, ...args], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
