// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Layout do grafo de commits (lanes) para uma lista em --topo-order.
// Cada linha recebe: col (coluna do nó), color e segmentos [x1,y1,x2,y2,color], y em {0, .5, 1}.

export const LANE_W = 14;
export const ROW_H = 24;
const COLORS = ['#3b82f6', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#978365', '#0090ff', '#ab4aba'];

export function laneColor(i) { return COLORS[i % COLORS.length]; }

export function computeGraph(commits) {
  const lanes = []; // sha esperado em cada coluna
  const laneColors = [];
  let nextColor = 0;
  let maxCols = 1;
  const rows = [];
  for (const c of commits) {
    const segs = [];
    let col = lanes.indexOf(c.sha);
    const isTip = col === -1;
    if (isTip) {
      col = lanes.indexOf(null);
      if (col === -1) col = lanes.length;
      lanes[col] = c.sha;
      laneColors[col] = nextColor++;
    }
    const color = laneColors[col];
    // linhas que chegam pelo topo
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] == null) continue;
      if (lanes[j] === c.sha) {
        if (!(j === col && isTip)) segs.push([j, 0, col, 0.5, laneColors[j]]);
      } else {
        segs.push([j, 0, j, 1, laneColors[j]]);
      }
    }
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === c.sha) lanes[j] = null;
    // pais
    c.parents.forEach((p, i) => {
      const existing = lanes.indexOf(p);
      if (existing > col && i === 0 && lanes[col] == null) {
        // Puxa a linha do pai para a coluna atual, mantendo a linha principal à esquerda.
        const pass = segs.find((s) => s[0] === existing && s[1] === 0 && s[2] === existing && s[3] === 1);
        if (pass) pass[2] = col;
        lanes[existing] = null;
        lanes[col] = p;
        laneColors[col] = color;
        segs.push([col, 0.5, col, 1, color]);
        return;
      }
      if (existing !== -1) {
        segs.push([col, 0.5, existing, 1, laneColors[existing]]);
        return;
      }
      let target;
      if (i === 0 && lanes[col] == null) {
        target = col;
        laneColors[col] = color;
      } else {
        target = lanes.indexOf(null);
        if (target === -1) target = lanes.length;
        laneColors[target] = nextColor++;
      }
      lanes[target] = p;
      segs.push([col, 0.5, target, 1, laneColors[target]]);
    });
    while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
    maxCols = Math.max(maxCols, lanes.length, col + 1);
    rows.push({ col, color, segs });
  }
  return { rows, maxCols };
}

export function graphSvg(row, width, isHead) {
  const x = (c) => c * LANE_W + LANE_W / 2;
  const y = (v) => v * ROW_H;
  let paths = '';
  for (const [c1, y1, c2, y2, col] of row.segs) {
    const X1 = x(c1); const Y1 = y(y1); const X2 = x(c2); const Y2 = y(y2);
    const d = X1 === X2 ? `M${X1} ${Y1}L${X2} ${Y2}` : `M${X1} ${Y1}C${X1} ${(Y1 + Y2) / 2} ${X2} ${(Y1 + Y2) / 2} ${X2} ${Y2}`;
    paths += `<path d="${d}" stroke="${laneColor(col)}" stroke-width="2" fill="none"/>`;
  }
  const cx = x(row.col); const cy = ROW_H / 2;
  const fill = laneColor(row.color);
  const node = isHead
    ? `<circle cx="${cx}" cy="${cy}" r="5" fill="var(--bg)" stroke="${fill}" stroke-width="2.5"/>`
    : `<circle cx="${cx}" cy="${cy}" r="4" fill="${fill}"/>`;
  return `<svg width="${width}" height="${ROW_H}" class="graph">${paths}${node}</svg>`;
}
