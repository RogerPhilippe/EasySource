// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
'use strict';
// Wrapper do git CLI + parsers. Sem dependências nativas.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { t } = require('../i18n');

const events = new EventEmitter();
let seq = 0;

// core.fsmonitor=false: um .git/config de uma pasta baixada não pode rodar programas
// só por abrirmos o repositório (git status executaria o fsmonitor configurado).
const BASE_ARGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'i18n.logOutputEncoding=UTF-8', '-c', 'core.fsmonitor=false'];
// Pelo mesmo motivo, diffs ignoram diff.external e textconv definidos no repositório.
const NO_EXTERNAL_DIFF = new Set(['diff', 'show', 'log', 'format-patch']);

function run(cwd, args, opts = {}) {
  if (NO_EXTERNAL_DIFF.has(args[0])) args = [args[0], '--no-ext-diff', '--no-textconv', ...args.slice(1)];
  else if (args[0] === 'blame') args = ['blame', '--no-textconv', ...args.slice(1)];
  const id = ++seq;
  const started = Date.now();
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LANG: 'C.UTF-8', ...(opts.env || {}) };
  if (!opts.quiet) events.emit('start', { id, cwd, args, started });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', [...BASE_ARGS, ...args], { cwd, env, windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err.push(d);
      if (!opts.quiet) events.emit('progress', { id, text: d.toString('utf8') });
    });
    child.on('error', (e) => {
      if (!opts.quiet) events.emit('end', { id, code: -1, stderr: String(e), ms: Date.now() - started });
      reject(e);
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (!opts.quiet) events.emit('end', { id, code, stderr, ms: Date.now() - started });
      if (code !== 0 && !opts.allowFail) {
        const e = new Error(stderr.trim() || t('git {command} exited with code {code}', { command: args.join(' '), code }));
        e.code = code;
        e.stdout = stdout;
        return reject(e);
      }
      resolve({ code, stdout, stderr });
    });
    if (opts.input != null) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

const out = async (cwd, args, opts) => (await run(cwd, args, { quiet: true, ...opts })).stdout;

// ---------- status (porcelain v2) ----------
function parseStatus(text) {
  const res = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], conflicted: [] };
  const parts = text.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.head') res.branch = val === '(detached)' ? null : val;
      else if (key === 'branch.oid') res.oid = val === '(initial)' ? null : val;
      else if (key === 'branch.upstream') res.upstream = val;
      else if (key === 'branch.ab') {
        const m = val.match(/\+(\d+) -(\d+)/);
        if (m) { res.ahead = +m[1]; res.behind = +m[2]; }
      }
      continue;
    }
    const type = line[0];
    if (type === '?') {
      res.unstaged.push({ path: line.slice(2), status: '?' });
    } else if (type === '1' || type === '2') {
      const f = line.split(' ');
      const xy = f[1];
      const n = type === '1' ? 8 : 9;
      const p = f.slice(n).join(' ');
      const orig = type === '2' ? parts[++i] : null;
      if (xy[0] !== '.') res.staged.push({ path: p, orig, status: xy[0] });
      if (xy[1] !== '.') res.unstaged.push({ path: p, orig: null, status: xy[1] });
    } else if (type === 'u') {
      const f = line.split(' ');
      res.conflicted.push({ path: f.slice(10).join(' '), status: 'U', xy: f[1] });
    }
  }
  return res;
}

async function status(cwd) {
  const t = await out(cwd, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=dirty']);
  const s = parseStatus(t);
  s.state = repoState(cwd);
  return s;
}

function gitDir(cwd) {
  const p = path.join(cwd, '.git');
  try {
    const st = fs.statSync(p);
    if (st.isFile()) {
      const m = fs.readFileSync(p, 'utf8').match(/gitdir:\s*(.+)/);
      if (m) return path.resolve(cwd, m[1].trim());
    }
  } catch { /* noop */ }
  return p;
}

function repoState(cwd) {
  const g = gitDir(cwd);
  const has = (f) => fs.existsSync(path.join(g, f));
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase';
  if (has('MERGE_HEAD')) return 'merge';
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick';
  if (has('REVERT_HEAD')) return 'revert';
  return null;
}

// ---------- log ----------
const LOG_FMT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e';

function parseLog(text) {
  return text.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [sha, parents, author, email, time, refs, subject] = r.split('\x1f');
    return {
      sha,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      time: +time,
      refs: parseRefs(refs),
      subject,
    };
  });
}

function parseRefs(d) {
  if (!d) return [];
  return d.split(', ').map((r) => {
    if (r.startsWith('HEAD -> ')) return { type: 'head', name: r.slice(8).replace(/^refs\/heads\//, '') };
    if (r === 'HEAD') return { type: 'detached', name: 'HEAD' };
    if (r.startsWith('tag: ')) return { type: 'tag', name: r.slice(5).replace(/^refs\/tags\//, '') };
    if (r.startsWith('refs/remotes/')) return { type: 'remote', name: r.slice(13) };
    if (r.startsWith('refs/heads/')) return { type: 'branch', name: r.slice(11) };
    if (r.startsWith('refs/stash')) return { type: 'stash', name: 'stash' };
    return { type: 'other', name: r };
  }).filter((r) => !(r.type === 'remote' && r.name.endsWith('/HEAD')));
}

// order: 'date' (ordem por data, padrão) ou 'topo' (ordem de ancestralidade).
async function log(cwd, { all = true, remotes = true, order = 'date', skip = 0, max = 500, grep, author, pickaxe, file, ref } = {}) {
  const args = ['log', order === 'topo' ? '--topo-order' : '--date-order', '--decorate=full', `--format=${LOG_FMT}`, `--skip=${skip}`, `-n${max}`];
  if (grep) args.push(`--grep=${grep}`, '-i');
  if (author) args.push(`--author=${author}`, '-i');
  if (pickaxe) args.push(`-S${pickaxe}`);
  if (ref) args.push(ref);
  else if (all) args.push('--branches', ...(remotes ? ['--remotes'] : []), '--tags', 'HEAD');
  else args.push('HEAD');
  if (file) args.push('--follow', '--', file);
  const r = await run(cwd, args, { quiet: true, allowFail: true });
  if (r.code !== 0) {
    if (/does not have any commits|unknown revision|bad default revision/.test(r.stderr)) return [];
    throw new Error(r.stderr.trim());
  }
  return parseLog(r.stdout);
}

async function commitDetails(cwd, sha) {
  const fmt = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B';
  const head = await out(cwd, ['show', '-s', `--format=${fmt}`, sha]);
  const [h, parents, an, ae, at, cn, ce, ct, body] = head.split('\x1f');
  const files = parseNameStatus(await out(cwd, ['diff-tree', '-r', '-M', '--name-status', '-z', '--root', '-m', '--first-parent', '--no-commit-id', sha]));
  return { sha: h, parents: parents ? parents.split(' ') : [], author: an, email: ae, time: +at, committer: cn, committerEmail: ce, ctime: +ct, message: body.trim(), files };
}

function parseNameStatus(text) {
  const p = text.split('\0').filter((x) => x !== '');
  const files = [];
  for (let i = 0; i < p.length; i++) {
    const st = p[i];
    if (/^[RC]\d*$/.test(st)) { files.push({ status: st[0], orig: p[i + 1], path: p[i + 2] }); i += 2; }
    else { files.push({ status: st[0], path: p[i + 1] }); i += 1; }
  }
  return files;
}

// ---------- diff ----------
async function diff(cwd, { file, staged, untracked, commit, context = 3, orig }) {
  const U = `--unified=${context}`;
  let r;
  if (commit) {
    const paths = orig ? [orig, file] : [file];
    r = await run(cwd, ['show', '--format=', '--no-color', '-M', '-m', '--first-parent', U, commit, '--', ...paths], { quiet: true });
  } else if (untracked) {
    r = await run(cwd, ['diff', '--no-color', '--no-index', U, '--', '/dev/null', file], { quiet: true, allowFail: true });
  } else {
    r = await run(cwd, ['diff', '--no-color', U, ...(staged ? ['--cached'] : []), '--', file], { quiet: true });
  }
  return parseDiff(r.stdout);
}

async function diffRefs(cwd, a, b) {
  return parseDiff(await out(cwd, ['diff', '--no-color', '-M', a, b]));
}

function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      f = { header: [line], hunks: [], binary: false };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    if (line.startsWith('@@')) {
      const m = line.match(/^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+(.*)$/);
      h = { header: line, oldStart: m ? +m[1] : 0, newStart: m ? +m[3] : 0, lines: [] };
      f.hunks.push(h);
      continue;
    }
    if (!h) {
      f.header.push(line);
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) f.binary = true;
      continue;
    }
    if (line === '' ) continue;
    h.lines.push(line);
  }
  return files;
}

// Monta um patch aplicável com um único hunk ou só as linhas selecionadas.
// selected: Set de índices de linhas do hunk; reverse indica unstage/discard.
function buildPatch(file, hunk, selected, reverse) {
  const lines = [];
  let oldCount = 0;
  let newCount = 0;
  hunk.lines.forEach((l, i) => {
    const t = l[0];
    const sel = !selected || selected.has(i);
    if (t === ' ') { lines.push(l); oldCount++; newCount++; }
    else if (t === '\\') lines.push(l);
    else if (t === '-') {
      if (sel) { lines.push(l); oldCount++; }
      else if (!reverse) { lines.push(' ' + l.slice(1)); oldCount++; newCount++; }
    } else if (t === '+') {
      if (sel) { lines.push(l); newCount++; }
      else if (reverse) { lines.push(' ' + l.slice(1)); oldCount++; newCount++; }
    }
  });
  const hdr = file.header.filter((l) => !l.startsWith('index ') && !/^(similarity|rename|copy) /.test(l));
  const start = hunk.oldStart || (oldCount ? 1 : 0);
  const nstart = hunk.newStart || (newCount ? 1 : 0);
  return [...hdr, `@@ -${start},${oldCount} +${nstart},${newCount} @@`, ...lines, ''].join('\n');
}

// ---------- refs ----------
async function refs(cwd) {
  const fmt = '%(refname)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(creatordate:unix)';
  const text = await out(cwd, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  const r = { branches: [], remotes: {}, tags: [] };
  for (const line of text.split('\n').filter(Boolean)) {
    const [ref, sha, up, track, head, date] = line.split('\x1f');
    if (ref.startsWith('refs/heads/')) {
      const ahead = (track.match(/ahead (\d+)/) || [])[1];
      const behind = (track.match(/behind (\d+)/) || [])[1];
      r.branches.push({ name: ref.slice(11), sha, upstream: up || null, ahead: +ahead || 0, behind: +behind || 0, gone: track.includes('gone'), current: head === '*' });
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice(13);
      if (name.endsWith('/HEAD')) continue;
      const i = name.indexOf('/');
      const remote = name.slice(0, i);
      (r.remotes[remote] = r.remotes[remote] || []).push({ name, short: name.slice(i + 1), sha });
    } else if (ref.startsWith('refs/tags/')) {
      r.tags.push({ name: ref.slice(10), sha, date: +date });
    }
  }
  r.tags.sort((a, b) => b.date - a.date);
  const remoteNames = (await out(cwd, ['remote'])).split('\n').filter(Boolean);
  for (const n of remoteNames) r.remotes[n] = r.remotes[n] || [];
  const st = await run(cwd, ['stash', 'list', '--format=%gd%x1f%H%x1f%s'], { quiet: true, allowFail: true });
  r.stashes = st.stdout.split('\n').filter(Boolean).map((l) => {
    const [ref, sha, msg] = l.split('\x1f');
    return { ref, sha, message: msg };
  });
  const sm = await run(cwd, ['submodule', 'status'], { quiet: true, allowFail: true });
  r.submodules = sm.stdout.split('\n').filter(Boolean).map((l) => {
    const m = l.trim().match(/^[-+U ]?([0-9a-f]+) (\S+)/);
    return m ? { sha: m[1], path: m[2], state: l[0] } : null;
  }).filter(Boolean);
  return r;
}

async function remotes(cwd) {
  const text = await out(cwd, ['remote', '-v']);
  const map = {};
  for (const l of text.split('\n').filter(Boolean)) {
    const [name, url, kind] = l.split(/\s+/);
    map[name] = map[name] || { name, fetch: '', push: '' };
    map[name][kind === '(push)' ? 'push' : 'fetch'] = url;
  }
  return Object.values(map);
}

// ---------- blame ----------
async function blame(cwd, file, rev) {
  const text = await out(cwd, ['blame', '--line-porcelain', ...(rev ? [rev] : []), '--', file]);
  const lines = [];
  let cur = {};
  for (const l of text.split('\n')) {
    if (/^[0-9a-f]{40} /.test(l)) cur = { sha: l.slice(0, 40) };
    else if (l.startsWith('author ')) cur.author = l.slice(7);
    else if (l.startsWith('author-time ')) cur.time = +l.slice(12);
    else if (l.startsWith('summary ')) cur.summary = l.slice(8);
    else if (l.startsWith('\t')) lines.push({ ...cur, text: l.slice(1) });
  }
  return lines;
}

async function isRepo(dir) {
  const r = await run(dir, ['rev-parse', '--show-toplevel'], { quiet: true, allowFail: true }).catch(() => ({ code: 1 }));
  return r.code === 0 ? path.normalize(r.stdout.trim()) : null;
}

async function config(cwd, key, { global } = {}) {
  const r = await run(cwd || process.cwd(), ['config', ...(global ? ['--global'] : []), '--get', key], { quiet: true, allowFail: true });
  return r.code === 0 ? r.stdout.trim() : '';
}

module.exports = {
  events, run, status, parseStatus, log, parseLog, parseRefs, commitDetails, parseNameStatus,
  diff, diffRefs, parseDiff, buildPatch, refs, remotes, blame, isRepo, config, gitDir, repoState,
};
