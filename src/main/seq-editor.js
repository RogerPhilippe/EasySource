// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Usado como GIT_SEQUENCE_EDITOR: copia o todo preparado pela UI para o arquivo do git.
// Uso: node seq-editor.js <todo-preparado> <arquivo-do-git>
const fs = require('fs');
const [, , prepared, target] = process.argv;
fs.writeFileSync(target, fs.readFileSync(prepared, 'utf8'));
