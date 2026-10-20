// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Hook afterPack do electron-builder: no macOS, assina o app inteiro com assinatura
// ad-hoc ("-") antes de gerar o DMG/ZIP. Sem isso o pacote fica só com a assinatura
// do binário do Electron, que não cobre o Info.plist nem os recursos, e o macOS
// recusa o app baixado ("está danificado") em Apple Silicon.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
