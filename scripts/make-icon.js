// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Gera assets/icon.png (1024 px, macOS/Linux) e assets/icon.ico (16–256 px, Windows)
// a partir de assets/icon.svg usando o Electron.
// Uso: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 1024; // o electron-builder gera o .icns do macOS a partir dele

// Desenha o SVG num canvas do tamanho exato (independe da escala de exibição do Windows).
async function render(win, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${size};
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = ${JSON.stringify(src)};
  })`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// ICO com PNGs embutidos (suportado desde o Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const pngs = [];
  for (const size of ICO_SIZES) pngs.push({ size, data: await render(win, size) });
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(pngs));
  fs.writeFileSync(path.join(dir, 'icon.png'), await render(win, PNG_SIZE));
  console.log(`assets/icon.ico (${ICO_SIZES.join(', ')} px) e assets/icon.png (${PNG_SIZE} px) gerados`);
  app.quit();
});
