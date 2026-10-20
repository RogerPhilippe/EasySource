// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Diálogos e operações Git. Cada função recebe o RepoView (rv), que expõe
// rv.path, rv.status, rv.refs e rv.run(args, opts) -> resultado ou null em erro.
import { h, toast, fmtDate } from './util.js';
import { openForm, openModal, confirmBox, alertBox } from './modal.js';
import { t } from './i18n.js';

const api = window.api;

const current = (rv) => rv.status?.branch;
const localBranches = (rv) => rv.refs.branches.map((b) => b.name);
const remoteNames = (rv) => Object.keys(rv.refs.remotes);
const remoteBranches = (rv) => Object.values(rv.refs.remotes).flat().map((b) => b.name);
const shortSha = (s) => s.slice(0, 8);

function defaultRemote(rv) {
  const up = rv.status?.upstream;
  const names = remoteNames(rv);
  if (up) { const r = names.find((n) => up.startsWith(`${n}/`)); if (r) return r; }
  return names.includes('origin') ? 'origin' : names[0];
}

function needRemote(rv) {
  if (!remoteNames(rv).length) { alertBox(t('No remotes'), t('This repository has no remotes. Add one in Repository settings.')); return false; }
  return true;
}

// ---------- sincronização ----------
export async function fetch(rv, { quiet } = {}) {
  if (!needRemote(rv)) return;
  let v = { all: true, prune: true, tags: true };
  if (!quiet) {
    v = await openForm({
      title: 'Fetch', okLabel: 'Fetch',
      fields: [
        { name: 'all', type: 'checkbox', label: t('All remotes'), value: true },
        { name: 'prune', type: 'checkbox', label: t('Clean up references to branches deleted on the remote (--prune)'), value: true },
        { name: 'tags', type: 'checkbox', label: t('Fetch tags'), value: true },
      ],
    });
    if (!v) return;
  }
  const args = ['fetch', '--progress', v.all ? '--all' : defaultRemote(rv)];
  if (v.prune) args.push('--prune');
  if (v.tags) args.push('--tags');
  await rv.run(args, { title: 'Fetch', silent: quiet, progress: !quiet });
}

// Pull: escolhe remoto e branch e integra na branch atual.
export async function pull(rv, { remote: r0, branch: b0 } = {}) {
  if (!needRemote(rv)) return;
  const remote = r0 || defaultRemote(rv);
  const up = rv.status?.upstream;
  const branchesOf = (r) => (rv.refs.remotes[r] || []).map((b) => b.short);
  const defBranch = b0 || (up && up.startsWith(`${remote}/`) ? up.slice(remote.length + 1) : current(rv));
  const v = await openForm({
    title: 'Pull', okLabel: t('OK'), width: 540,
    fields: [
      { name: 'remote', type: 'select', label: t('Remote:'), options: remoteNames(rv), value: remote },
      { name: 'branch', type: 'select', label: 'Branch:', options: branchesOf(remote), value: defBranch },
      { name: 'info', type: 'info', label: t('Target: {branch}', { branch: current(rv) || t('(detached HEAD)') }) },
      { name: 'commit', type: 'checkbox', label: t('Create the merge commit automatically'), value: true },
      { name: 'log', type: 'checkbox', label: t('List the merged commits in the message (--log)'), value: false },
      { name: 'noff', type: 'checkbox', label: t('Always create a merge commit (--no-ff)'), value: false },
      { name: 'rebase', type: 'checkbox', label: t('Use rebase (--rebase). Avoid it if your local commits were already published'), value: false },
    ],
  });
  if (!v) return;
  const args = ['pull', '--progress'];
  if (v.rebase) args.push('--rebase'); else args.push('--no-rebase');
  if (!v.commit) args.push('--no-commit');
  if (v.log && !v.rebase) args.push('--log');
  if (v.noff && !v.rebase) args.push('--no-ff');
  args.push(v.remote);
  if (v.branch) args.push(v.branch);
  await rv.run(args, { title: 'Pull', progress: true });
}

// Push: escolhe as branches locais e o nome de destino de cada uma.
export async function push(rv, { branch, remote } = {}) {
  if (!needRemote(rv)) return;
  const cur = branch || current(rv);
  const rem = remote || defaultRemote(rv);
  const rows = rv.refs.branches.map((b) => {
    const tracked = b.upstream && b.upstream.startsWith(`${rem}/`);
    return {
      local: b.name,
      remote: tracked ? b.upstream.slice(rem.length + 1) : b.name,
      push: b.name === cur,
      track: !!tracked || !b.upstream,
      note: b.ahead ? `↑${b.ahead}` : '',
    };
  });
  const v = await openForm({
    title: 'Push', okLabel: 'Push', width: 620,
    fields: [
      { name: 'remote', type: 'select', label: t('Remote:'), options: remoteNames(rv), value: rem },
      { name: 'rows', type: 'grid', label: 'Branches:', columns: [t('Push?'), t('Local'), t('Target'), 'Upstream'], value: rows },
      { name: 'tags', type: 'checkbox', label: t('Include tags (--tags)'), value: false },
      { name: 'force', type: 'checkbox', label: t('Overwrite the remote (--force-with-lease)'), value: false },
    ],
  });
  if (!v) return;
  const sel = v.rows.filter((r) => r.push);
  if (!sel.length && !v.tags) return toast(t('Nothing selected to push'));
  if (v.force && !(await confirmBox(t('Force push'), t('A force push can overwrite commits on the remote. Continue?'), { okLabel: t('Force'), danger: true }))) return;
  const args = ['push', '--progress'];
  if (sel.some((r) => r.track)) args.push('--set-upstream');
  if (v.force) args.push('--force-with-lease');
  if (v.tags) args.push('--tags');
  args.push(v.remote, ...sel.map((r) => `refs/heads/${r.local}:refs/heads/${r.remote || r.local}`));
  await rv.run(args, { title: 'Push', progress: true });
}

// ---------- branches ----------
// Branches: criar (aba 1) ou apagar (aba 2).
export async function branchDialog(rv, { startPoint, tab = 0, preselected = [] } = {}) {
  const delOpts = [...rv.refs.branches.filter((b) => !b.current).map((b) => ({ value: b.name, label: b.name })),
    ...remoteBranches(rv).map((n) => ({ value: `remote:${n}`, label: `${n} (${t('remote')})` }))];
  const v = await openForm({
    title: 'Branch', width: 520, tab,
    tabs: [
      {
        label: t('New branch'), okLabel: t('Create branch'),
        fields: [
          { name: 'info', type: 'info', label: t('Current branch: {branch}', { branch: current(rv) || t('(detached HEAD)') }) },
          { name: 'name', label: t('Name:'), required: true, placeholder: t('feature/my-branch') },
          { name: 'start', type: 'radio', label: t('Starting point:'), value: startPoint ? 'spec' : 'head', options: [
            { value: 'head', label: t('Current HEAD') },
            { value: 'spec', label: t('Another commit:') },
          ] },
          { name: 'sha', label: 'SHA / ref:', value: startPoint || '' },
          { name: 'checkout', type: 'checkbox', label: t('Switch to the new branch'), value: true },
        ],
      },
      {
        label: t('Delete'), okLabel: t('Delete branches'), danger: true,
        fields: [
          { name: 'list', type: 'checklist', label: 'Branches:', options: delOpts, value: preselected },
          { name: 'force', type: 'checkbox', label: t('Delete even if not merged (-D)'), value: false },
        ],
      },
    ],
  });
  if (!v) return;
  if (v._tab === 0) {
    const from = v.start === 'spec' && v.sha ? [v.sha] : [];
    const args = v.checkout ? ['checkout', '-b', v.name, ...from] : ['branch', v.name, ...from];
    return rv.run(args, { title: t('New branch') });
  }
  if (!v.list.length) return;
  const locals = v.list.filter((n) => !n.startsWith('remote:'));
  const remotes = v.list.filter((n) => n.startsWith('remote:')).map((n) => n.slice(7));
  if (locals.length) await rv.run(['branch', v.force ? '-D' : '-d', ...locals], { title: t('Delete branches') });
  for (const r of remotes) {
    const i = r.indexOf('/');
    await rv.run(['push', r.slice(0, i), '--delete', r.slice(i + 1)], { title: t('Delete remote branch'), progress: true });
  }
}

export const newBranch = (rv, startPoint) => branchDialog(rv, { startPoint });
export const deleteBranches = (rv, preselected = []) => branchDialog(rv, { tab: 1, preselected });

// Se houver alterações locais ao trocar de branch, pergunta o que fazer com elas (stash, descartar ou manter).
async function handleUncommitted(rv) {
  const s = rv.status;
  if (!s || !(s.staged.length || s.unstaged.some((f) => f.status !== '?'))) return true;
  const v = await openForm({
    title: t('Pending changes'), okLabel: t('Continue'),
    intro: t('The working copy has uncommitted changes.'),
    fields: [
      { name: 'how', type: 'radio', value: 'nothing', options: [
        { value: 'stash', label: t('Save in a stash') },
        { value: 'clean', label: t('Discard (git reset --hard)') },
        { value: 'nothing', label: t('Bring the changes along') },
      ] },
      { name: 'desc', label: t('Stash message:'), value: t('Changes before checkout ({date})', { date: new Date().toLocaleString() }) },
    ],
  });
  if (!v) return false;
  if (v.how === 'stash') return !!(await rv.run(['stash', 'push', '-m', v.desc || 'stash'], { title: 'Stash', noRefresh: true }));
  if (v.how === 'clean') return !!(await rv.run(['reset', '--hard', 'HEAD'], { title: t('Discard'), noRefresh: true }));
  return true;
}

export async function renameBranch(rv, name) {
  const v = await openForm({ title: t('Rename branch'), okLabel: t('Rename'), fields: [{ name: 'name', label: t('New name'), value: name, required: true }] });
  if (v && v.name !== name) await rv.run(['branch', '-m', name, v.name], { title: t('Rename branch') });
}

export async function checkoutBranch(rv, name, isRemote) {
  if (!isRemote) {
    if (name === current(rv)) return;
    if (!(await handleUncommitted(rv))) return;
    return rv.run(['checkout', name], { title: 'Checkout' });
  }
  const short = name.slice(name.indexOf('/') + 1);
  const exists = localBranches(rv).includes(short);
  const v = await openForm({
    title: t('New branch from remote'), okLabel: 'Checkout',
    fields: [
      { name: 'info', type: 'info', label: t('Remote branch: {name}', { name }) },
      { name: 'local', label: t('Local name'), value: exists ? `${short}-2` : short, required: true },
      { name: 'track', type: 'checkbox', label: t('Set as upstream'), value: true },
    ],
  });
  if (!v || !(await handleUncommitted(rv))) return;
  await rv.run(['checkout', '-b', v.local, ...(v.track ? ['--track'] : ['--no-track']), name], { title: 'Checkout' });
}

export async function checkoutDialog(rv) {
  const v = await openForm({
    title: 'Checkout', okLabel: 'Checkout',
    fields: [{ name: 'ref', type: 'select', label: 'Branch', options: [...localBranches(rv), ...remoteBranches(rv)], value: current(rv) }],
  });
  if (!v) return;
  await checkoutBranch(rv, v.ref, remoteBranches(rv).includes(v.ref) && !localBranches(rv).includes(v.ref));
}

export async function checkoutCommit(rv, sha) {
  const ok = await confirmBox(t('Commit checkout'), t('Checking out {sha} will leave the repository in a "detached HEAD" state. Commits made there will not belong to any branch.', { sha: shortSha(sha) }), { okLabel: 'Checkout' });
  if (ok && (await handleUncommitted(rv))) await rv.run(['checkout', sha], { title: 'Checkout' });
}

// Merge: escolhe um commit do histórico (aba 1) ou uma ref (aba 2).
export async function merge(rv, ref) {
  const logList = await api.git.log(rv.path, { all: true, max: 150 }).catch(() => []);
  const headSha = rv.status?.oid;
  const fetched = [...remoteBranches(rv), ...localBranches(rv).filter((b) => b !== current(rv)), ...rv.refs.tags.map((t) => t.name)];
  const opts = [
    { name: 'commit', type: 'checkbox', label: t('Create the merge commit automatically when there are no conflicts'), value: true },
    { name: 'log', type: 'checkbox', label: t('List the merged commits in the message (--log)'), value: false },
    { name: 'noff', type: 'checkbox', label: t('Always create a merge commit (--no-ff)'), value: false },
    { name: 'squash', type: 'checkbox', label: t('Squash (combine into a single commit)'), value: false },
  ];
  const v = await openForm({
    title: t('Merge into {branch}', { branch: current(rv) || 'HEAD' }), width: 680, tab: ref ? 1 : 0,
    tabs: [
      {
        label: 'Commit', okLabel: t('OK'),
        fields: [
          { name: 'sha', type: 'list', label: t('Commit to merge:'), options: logList.filter((c) => c.sha !== headSha).map((c) => ({
            value: c.sha, label: `${shortSha(c.sha)}  ${c.refs.length ? `[${c.refs.map((r) => r.name).join(', ')}] ` : ''}${c.subject}  — ${c.author}`,
          })) },
          ...opts.map((o) => ({ ...o })),
        ],
      },
      {
        label: t('Branch or tag'), okLabel: t('OK'),
        fields: [
          { name: 'ref', type: 'select', label: t('Ref to merge:'), options: fetched, value: ref || rv.status?.upstream },
          ...opts.map((o) => ({ ...o })),
        ],
      },
    ],
  });
  if (!v) return;
  const target = v._tab === 0 ? v.sha : v.ref;
  if (!target) return toast(t('Select what to merge'));
  const args = ['merge'];
  if (!v.commit) args.push('--no-commit');
  if (v.noff) args.push('--no-ff');
  if (v.squash) args.push('--squash');
  if (v.log) args.push('--log');
  args.push(target);
  await rv.run(args, { title: 'Merge' });
}

export async function rebase(rv, ref) {
  if (!ref) {
    const v = await openForm({ title: 'Rebase', okLabel: 'Rebase', fields: [{ name: 'ref', type: 'select', label: t('Rebase the current branch onto'), options: [...localBranches(rv), ...remoteBranches(rv)] }] });
    if (!v) return;
    ref = v.ref;
  }
  if (await confirmBox('Rebase', t('Rebase "{branch}" onto "{ref}"? This rewrites the history of the current branch.', { branch: current(rv), ref }), { okLabel: 'Rebase' })) {
    await rv.run(['rebase', ref], { title: 'Rebase' });
  }
}

export async function interactiveRebase(rv, baseSha) {
  if (!baseSha) {
    const recent = await api.git.log(rv.path, { all: false, max: 50 });
    if (recent.length < 2) return toast(t('Not enough commits for an interactive rebase'));
    const v = await openForm({
      title: t('Interactive rebase'), okLabel: t('Continue'),
      fields: [{ name: 'base', type: 'select', label: t('Rewrite commits after'), options: recent.slice(1).map((c) => ({ value: c.sha, label: `${shortSha(c.sha)}  ${c.subject}` })) }],
    });
    if (!v) return;
    baseSha = v.base;
  }
  const r = await api.git.exec(rv.path, ['log', '--reverse', '--format=%H%x1f%s', `${baseSha}..HEAD`]);
  const items = r.stdout.split('\n').filter(Boolean).map((l) => { const [sha, subject] = l.split('\x1f'); return { action: 'pick', sha, subject }; });
  if (!items.length) return toast(t('No commits after the chosen base'));
  const list = h('div', { class: 'irb-list' });
  const draw = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const sel = h('select', { onchange: (e) => { it.action = e.target.value; } },
        ['pick', 'squash', 'fixup', 'drop'].map((a) => h('option', { value: a, selected: a === it.action }, { pick: t('Keep'), squash: t('Squash into previous'), fixup: t('Fixup (discard message)'), drop: t('Drop') }[a])));
      list.append(h('div', { class: 'irb-row' },
        h('button', { class: 'btn btn-sm', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, '↑'),
        h('button', { class: 'btn btn-sm', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); } }, '↓'),
        sel, h('code', {}, shortSha(it.sha)), h('span', { class: 'irb-subj' }, it.subject)));
    });
  };
  draw();
  const ok = await openModal({
    title: t('Interactive rebase onto {sha}', { sha: shortSha(baseSha) }), width: 720,
    body: h('div', {}, h('p', { class: 'form-intro' }, t('Order from oldest (top) to newest. Squash/fixup combine with the commit above.')), list),
    buttons: [{ label: t('Cancel'), value: false }, { label: t('Start rebase'), primary: true, value: true,
      validate: () => { if (['squash', 'fixup'].includes(items[0].action)) { toast(t('The first commit cannot be squash/fixup'), 'error'); return false; } return true; } }],
  });
  if (!ok) return;
  await rv.run(null, { title: t('Interactive rebase'), fn: () => api.git.interactiveRebase(rv.path, baseSha, items) });
}

// ---------- commits ----------
export async function resetTo(rv, sha) {
  const v = await openForm({
    title: t('Move branch to this commit'), okLabel: t('Reset'),
    fields: [
      { name: 'info', type: 'info', label: t('Move "{branch}" to {sha}', { branch: current(rv) || 'HEAD', sha: shortSha(sha) }) },
      { name: 'mode', type: 'radio', label: t('Mode'), value: 'mixed', options: [
        { value: 'soft', label: 'Soft', hint: ` — ${t('keeps all local changes (staged)')}` },
        { value: 'mixed', label: 'Mixed', hint: ` — ${t('keeps the working copy, clears the stage')}` },
        { value: 'hard', label: 'Hard', hint: ` — ${t('DISCARDS the working copy changes')}` },
      ] },
    ],
  });
  if (!v) return;
  if (v.mode === 'hard' && !(await confirmBox('Reset hard', t('All local changes will be lost. Are you sure?'), { okLabel: t('Discard and reset'), danger: true }))) return;
  await rv.run(['reset', `--${v.mode}`, sha], { title: 'Reset' });
}

export async function revertCommit(rv, sha, isMerge) {
  if (await confirmBox(t('Revert commit'), t('Create a new commit that undoes {sha}?', { sha: shortSha(sha) }), { okLabel: t('Revert') })) {
    await rv.run(['revert', '--no-edit', ...(isMerge ? ['-m', '1'] : []), sha], { title: 'Revert' });
  }
}

export async function cherryPick(rv, sha, isMerge) {
  const v = await openForm({
    title: 'Cherry-pick', okLabel: 'Cherry-pick',
    fields: [
      { name: 'info', type: 'info', label: t('Apply {sha} to {branch}', { sha: shortSha(sha), branch: current(rv) || 'HEAD' }) },
      { name: 'nocommit', type: 'checkbox', label: t('Do not commit (only apply the changes)'), value: false },
    ],
  });
  if (v) await rv.run(['cherry-pick', ...(v.nocommit ? ['-n'] : []), ...(isMerge ? ['-m', '1'] : []), sha], { title: 'Cherry-pick' });
}

// Tags: criar (aba 1) ou apagar (aba 2).
export async function tag(rv, sha, { tab = 0, name } = {}) {
  const tags = rv.refs.tags.map((t) => t.name);
  const remote = defaultRemote(rv);
  const v = await openForm({
    title: 'Tag', width: 520, tab,
    tabs: [
      {
        label: t('New tag'), okLabel: t('Create tag'),
        fields: [
          { name: 'name', label: t('Tag name:'), required: true, placeholder: 'v1.0.0' },
          { name: 'start', type: 'radio', label: t('Starting point:'), value: sha ? 'spec' : 'head', options: [
            { value: 'head', label: t('Current HEAD') }, { value: 'spec', label: t('Another commit:') },
          ] },
          { name: 'sha', label: 'SHA / ref:', value: sha || '' },
          { name: 'push', type: 'checkbox', label: t('Publish to {name}', { name: remote || t('(no remote)') }), value: false },
          { name: 'force', type: 'checkbox', label: t('Replace if it already exists (-f)'), value: false },
          { name: 'light', type: 'checkbox', label: t('No annotation (lightweight tag)'), value: false },
          { name: 'message', type: 'textarea', label: t('Message:'), rows: 3 },
        ],
      },
      {
        label: t('Delete'), okLabel: t('Delete tags'), danger: true,
        fields: [
          { name: 'del', type: 'checklist', label: 'Tags:', options: tags, value: name ? [name] : [] },
          { name: 'remote', type: 'checkbox', label: t('Also delete on remotes'), value: false },
        ],
      },
    ],
  });
  if (!v) return;
  if (v._tab === 1) {
    if (!v.del.length) return;
    await rv.run(['tag', '-d', ...v.del], { title: t('Remove tag') });
    if (v.remote) for (const r of remoteNames(rv)) await rv.run(['push', r, ...v.del.map((t) => `:refs/tags/${t}`)], { title: t('Remove remote tag'), progress: true });
    return;
  }
  const commit = v.start === 'spec' && v.sha ? v.sha : 'HEAD';
  const annotated = !v.light;
  const args = ['tag', ...(v.force ? ['-f'] : []), ...(annotated ? ['-a', '-m', v.message || v.name] : []), v.name, commit];
  if (await rv.run(args, { title: 'Tag' }) && v.push && remote) {
    await rv.run(['push', ...(v.force ? ['-f'] : []), remote, `refs/tags/${v.name}`], { title: 'Push tag', progress: true });
  }
}

export async function deleteTag(rv, name) {
  const v = await openForm({
    title: t('Delete tag'), okLabel: t('Delete'), danger: true,
    fields: [
      { name: 'info', type: 'info', label: t('Delete the tag "{name}"?', { name }) },
      { name: 'remote', type: 'checkbox', label: t('Also delete from all remotes'), value: false },
    ],
  });
  if (!v) return;
  await rv.run(['tag', '-d', name], { title: t('Delete tag') });
  if (v.remote) for (const r of remoteNames(rv)) await rv.run(['push', r, `:refs/tags/${name}`], { title: t('Delete remote tag') });
}

// ---------- cópia de trabalho ----------
// Guarda as alterações pendentes num stash.
export async function stash(rv) {
  const v = await openForm({
    title: t('New stash'), okLabel: t('Save'),
    intro: t('Saves the pending changes and leaves the working copy clean.'),
    fields: [
      { name: 'message', label: t('Message:') },
      { name: 'keep', type: 'checkbox', label: t('Keep what is staged (--keep-index)'), value: false },
      { name: 'untracked', type: 'checkbox', label: t('Include untracked files'), value: true },
    ],
  });
  if (!v) return;
  const args = ['stash', 'push'];
  if (v.keep) args.push('--keep-index');
  if (v.untracked) args.push('-u');
  if (v.message) args.push('-m', v.message);
  await rv.run(args, { title: 'Stash' });
}

export async function applyStash(rv, ref) {
  const stashes = rv.refs.stashes || [];
  if (!stashes.length) return toast(t('There are no stashes'));
  const v = await openForm({
    title: t('Apply stash'), okLabel: t('Apply'),
    fields: [
      { name: 'ref', type: 'select', label: 'Stash', options: stashes.map((s) => ({ value: s.ref, label: `${s.ref}: ${s.message}` })), value: ref },
      { name: 'drop', type: 'checkbox', label: t('Delete after applying (pop)'), value: false },
      { name: 'index', type: 'checkbox', label: t('Also restore the index (staged)'), value: false },
    ],
  });
  if (v) await rv.run(['stash', v.drop ? 'pop' : 'apply', ...(v.index ? ['--index'] : []), v.ref], { title: t('Apply stash') });
}

export async function dropStash(rv, ref) {
  if (await confirmBox(t('Delete stash'), t('Delete {name}? This cannot be undone.', { name: ref }), { okLabel: t('Delete'), danger: true })) {
    await rv.run(['stash', 'drop', ref], { title: t('Delete stash') });
  }
}

// Descartar: arquivos escolhidos (aba 1) ou tudo (aba 2).
export async function discard(rv, preselected) {
  const s = rv.status;
  const files = new Map();
  for (const f of [...s.staged, ...s.unstaged, ...s.conflicted]) {
    const prev = files.get(f.path);
    files.set(f.path, { path: f.path, untracked: f.status === '?' || (prev && prev.untracked), added: f.status === 'A' || (prev && prev.added) });
  }
  if (!files.size) return toast(t('There are no changes to discard'));
  const v = await openForm({
    title: t('Discard'), width: 580,
    tabs: [
      {
        label: t('Files'), okLabel: t('Discard'), danger: true,
        fields: [
          { name: 'files', type: 'checklist', label: t('Files:'), options: [...files.keys()], value: preselected || [] },
          { name: 'info', type: 'info', warn: true, label: t('Changes to the checked files will be lost. Untracked files go to the trash.') },
        ],
      },
      {
        label: t('All'), okLabel: t('Discard all'), danger: true,
        fields: [
          { name: 'info', type: 'info', warn: true, label: t('Returns all tracked files to the last commit and cancels a merge in progress (git reset --hard). Untracked files stay.') },
        ],
      },
    ],
  });
  if (!v) return;
  if (v._tab === 1) {
    if (await confirmBox(t('Discard all'), t('Discard all local changes in tracked files?'), { okLabel: t('Discard all'), danger: true })) {
      await rv.run(['reset', '--hard', 'HEAD'], { title: t('Discard all') });
    }
    return;
  }
  if (!v.files.length) return toast(t('Select at least one file to discard'));
  await discardFiles(rv, v.files.map((p) => files.get(p)));
}

export async function discardFiles(rv, list) {
  const tracked = list.filter((f) => !f.untracked && !f.added).map((f) => f.path);
  const added = list.filter((f) => f.added).map((f) => f.path);
  const untracked = list.filter((f) => f.untracked).map((f) => f.path);
  await rv.run(null, {
    title: t('Discard'),
    fn: async () => {
      if (tracked.length) await api.git.exec(rv.path, ['checkout', 'HEAD', '--', ...tracked]);
      if (added.length) await api.git.exec(rv.path, ['rm', '--cached', '-f', '-q', '--', ...added]);
      for (const p of [...untracked, ...added]) await api.shell.trash(`${rv.path}/${p}`).catch(() => {});
    },
  });
}

export async function ignore(rv, file) {
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')) : null;
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : null;
  const v = await openForm({
    title: t('Ignore'), okLabel: t('OK'),
    fields: [{ name: 'pattern', type: 'radio', label: t('Ignore'), value: file, options: [
      { value: `/${file}`, label: t('Only this file ({file})', { file }) },
      ...(ext ? [{ value: `*${ext}`, label: t('All files with the {ext} extension', { ext }) }] : []),
      ...(dir ? [{ value: `/${dir}/`, label: t('Everything under {dir}/', { dir }) }] : []),
    ] }],
  });
  if (!v || !v.pattern) return;
  await api.fs.appendLine(`${rv.path}/.gitignore`, v.pattern);
  await rv.run(['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', file], { title: t('Ignore'), silent: true });
}

export async function resolve(rv, files, how) {
  if (!files.length) return toast(t('Select conflicted files'));
  await rv.run(null, {
    title: t('Resolve conflicts'),
    fn: async () => {
      if (how === 'ours' || how === 'theirs') await api.git.exec(rv.path, ['checkout', `--${how}`, '--', ...files]);
      await api.git.exec(rv.path, ['add', '--', ...files]);
    },
  });
}

export async function abortOperation(rv) {
  const st = rv.status?.state;
  if (!st) return toast(t('No merge/rebase/cherry-pick in progress'));
  if (await confirmBox(t('Abort'), t('Abort the {operation} in progress and return to the previous state?', { operation: st }), { okLabel: t('Abort'), danger: true })) {
    await rv.run([st, '--abort'], { title: t('Abort') });
  }
}

export async function continueOperation(rv) {
  const st = rv.status?.state;
  if (!st) return toast(t('No operation in progress'));
  if (st === 'merge') return rv.run(['commit', '--no-edit'], { title: t('Finish merge') });
  await rv.run([st, '--continue'], { title: t('Continue {operation}', { operation: st }), noEditor: true });
}

// ---------- repositório ----------
export async function repoSettings(rv) {
  const remotes = await api.git.remotes(rv.path);
  const [uname, umail] = await Promise.all([
    api.git.exec(rv.path, ['config', '--local', '--get', 'user.name'], { allowFail: true, quiet: true }),
    api.git.exec(rv.path, ['config', '--local', '--get', 'user.email'], { allowFail: true, quiet: true }),
  ]);
  const table = h('div', { class: 'remote-table' });
  const draw = () => {
    table.innerHTML = '';
    if (!remotes.length) table.append(h('div', { class: 'empty' }, t('No remotes')));
    remotes.forEach((r, i) => table.append(h('div', { class: 'remote-row' },
      h('b', {}, r.name), h('span', { class: 'mono' }, r.fetch),
      h('button', { class: 'btn btn-sm', onclick: async () => {
        const e = await editRemote(r);
        if (e) { remotes[i] = { ...r, ...e, changed: true }; draw(); }
      } }, t('Edit')),
      h('button', { class: 'btn btn-sm btn-danger-text', onclick: () => { r.removed = !r.removed; draw(); } }, r.removed ? t('Undo') : t('Remove')))));
    table.querySelectorAll('.remote-row').forEach((row, i) => row.classList.toggle('removed', !!remotes[i].removed));
  };
  draw();
  const name = h('input', { type: 'text', placeholder: t('(use global)'), value: uname.stdout.trim() });
  const mail = h('input', { type: 'text', placeholder: t('(use global)'), value: umail.stdout.trim() });
  const ok = await openModal({
    title: t('Repository settings'), width: 640,
    body: h('div', { class: 'form' },
      h('h4', {}, t('Remotes')), table,
      h('button', { class: 'btn', onclick: async () => { const e = await editRemote(); if (e) { remotes.push({ ...e, added: true }); draw(); } } }, `+ ${t('Add remote')}`),
      h('h4', {}, t('Identity in this repository')),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Name')), name),
      h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, t('Email')), mail)),
    buttons: [{ label: t('Cancel'), value: false }, { label: t('OK'), primary: true, value: true }],
  });
  if (!ok) return;
  await rv.run(null, {
    title: t('Settings'),
    fn: async () => {
      for (const r of remotes) {
        if (r.removed && !r.added) await api.git.exec(rv.path, ['remote', 'remove', r.origName || r.name]);
        else if (r.added && !r.removed) await api.git.exec(rv.path, ['remote', 'add', r.name, r.fetch]);
        else if (r.changed && !r.removed) {
          if (r.origName && r.origName !== r.name) await api.git.exec(rv.path, ['remote', 'rename', r.origName, r.name]);
          await api.git.exec(rv.path, ['remote', 'set-url', r.name, r.fetch]);
        }
      }
      const setOrUnset = (k, val) => (val
        ? api.git.exec(rv.path, ['config', '--local', k, val])
        : api.git.exec(rv.path, ['config', '--local', '--unset', k], { allowFail: true }));
      await setOrUnset('user.name', name.value.trim());
      await setOrUnset('user.email', mail.value.trim());
    },
  });
}

async function editRemote(r) {
  const v = await openForm({
    title: r ? t('Edit remote') : t('Add remote'), okLabel: t('OK'),
    fields: [
      { name: 'name', label: t('Name'), value: r ? r.name : 'origin', required: true },
      { name: 'fetch', label: t('URL / path'), value: r ? r.fetch : '', required: true, placeholder: t('https://… or git@…') },
    ],
  });
  return v ? { ...v, origName: r ? (r.origName || r.name) : undefined } : null;
}

export async function addRemote(rv) {
  const e = await editRemote();
  if (e) await rv.run(['remote', 'add', e.name, e.fetch], { title: t('Add remote') });
}

export async function addSubmodule(rv) {
  const v = await openForm({
    title: t('Add submodule'), okLabel: t('Add'),
    fields: [
      { name: 'url', label: t('Source URL'), required: true },
      { name: 'path', label: t('Local path'), required: true, placeholder: t('libs/my-lib') },
    ],
  });
  if (v) await rv.run(['submodule', 'add', '--', v.url, v.path], { title: t('Add submodule') });
}

export async function createPatch(rv, sha) {
  const file = await api.dialog.saveFile(t('Save patch'), sha ? `${shortSha(sha)}.patch` : 'changes.patch', [{ name: 'Patch', extensions: ['patch', 'diff'] }]);
  if (!file) return;
  const r = sha
    ? await api.git.exec(rv.path, ['format-patch', '-1', '--stdout', sha])
    : await api.git.exec(rv.path, ['diff', 'HEAD', '--binary']);
  await api.fs.write(file, r.stdout);
  toast(t('Patch saved'));
}

export async function applyPatchFile(rv) {
  const v = await openForm({
    title: t('Apply patch'), okLabel: t('Apply'),
    fields: [
      { name: 'file', type: 'path', file: true, label: t('Patch file'), required: true },
      { name: 'mode', type: 'radio', label: t('Apply to'), value: 'wc', options: [
        { value: 'wc', label: t('Working copy') }, { value: 'index', label: 'Index (staged)' }, { value: 'am', label: t('Create commits (git am)') },
      ] },
    ],
  });
  if (!v) return;
  const args = v.mode === 'am' ? ['am', '--3way', v.file] : ['apply', ...(v.mode === 'index' ? ['--index'] : []), v.file];
  await rv.run(args, { title: t('Apply patch') });
}

export async function archive(rv, sha) {
  const file = await api.dialog.saveFile(t('Archive'), `${rv.name}-${sha ? shortSha(sha) : 'HEAD'}.zip`, [{ name: 'Zip', extensions: ['zip'] }, { name: 'Tar', extensions: ['tar'] }]);
  if (file) await rv.run(['archive', `--format=${file.endsWith('.tar') ? 'tar' : 'zip'}`, '-o', file, sha || 'HEAD'], { title: t('Archive'), silent: true });
}

export async function viewRemote(rv) {
  const remotes = await api.git.remotes(rv.path);
  const r = remotes.find((x) => x.name === defaultRemote(rv)) || remotes[0];
  if (!r) return toast(t('No remotes'));
  let url = r.fetch.replace(/\.git$/, '');
  const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
  if (/^https?:\/\//.test(url)) api.shell.openExternal(url.replace(/\/\/[^@/]+@/, '//'));
  else toast(t('The remote is not a web URL: {url}', { url: r.fetch }));
}

export async function blame(rv, file, rev) {
  const lines = await api.git.blame(rv.path, file, rev);
  let last = null;
  const rows = lines.map((l, i) => {
    const first = l.sha !== last;
    last = l.sha;
    return h('tr', { class: first ? 'blame-first' : '' },
      h('td', { class: 'blame-meta', title: l.summary }, first ? `${l.sha.slice(0, 7)} ${l.author}` : ''),
      h('td', { class: 'blame-meta' }, first ? fmtDate(l.time).slice(0, 10) : ''),
      h('td', { class: 'ln' }, i + 1),
      h('td', { class: 'code' }, l.text));
  });
  await openModal({
    title: `Blame: ${file}`, width: Math.min(1100, window.innerWidth - 80),
    body: h('div', { class: 'blame-wrap' }, h('table', { class: 'blame' }, h('tbody', {}, rows))),
    buttons: [{ label: t('Close'), primary: true, value: true }],
  });
}

// ---------- Git flow (implementado com comandos git simples) ----------
async function flowConfig(rv) {
  const get = async (k, d) => (await api.git.config(rv.path, k)) || d;
  return {
    master: await get('gitflow.branch.master', ''),
    develop: await get('gitflow.branch.develop', ''),
    feature: await get('gitflow.prefix.feature', 'feature/'),
    release: await get('gitflow.prefix.release', 'release/'),
    hotfix: await get('gitflow.prefix.hotfix', 'hotfix/'),
    tag: await get('gitflow.prefix.versiontag', ''),
  };
}

export async function flowMenu(rv) {
  const cfg = await flowConfig(rv);
  if (!cfg.develop) return flow(rv, 'init');
  const cur = current(rv) || '';
  const kind = ['feature', 'release', 'hotfix'].find((k) => cur.startsWith(cfg[k]));
  const id = await api.ui.contextMenu([
    { id: 'start-feature', label: t('Start new feature') },
    { id: 'start-release', label: t('Start new release') },
    { id: 'start-hotfix', label: t('Start new hotfix') },
    { type: 'separator' },
    { id: `finish-${kind}`, label: kind ? t('Finish current {kind} ({branch})', { kind, branch: cur }) : t('Finish…'), enabled: !!kind },
    { type: 'separator' },
    { id: 'init', label: t('Configure git flow…') },
  ]);
  if (id) flow(rv, id);
}

export async function flow(rv, action) {
  let cfg = await flowConfig(rv);
  if (action === 'init' || !cfg.develop) {
    const names = localBranches(rv);
    const v = await openForm({
      title: t('Initialize Git flow'), okLabel: t('OK'),
      fields: [
        { name: 'master', label: t('Production branch'), value: cfg.master || (names.includes('main') ? 'main' : 'master') },
        { name: 'develop', label: t('Development branch'), value: cfg.develop || 'develop' },
        { name: 'feature', label: t('Feature prefix'), value: cfg.feature },
        { name: 'release', label: t('Release prefix'), value: cfg.release },
        { name: 'hotfix', label: t('Hotfix prefix'), value: cfg.hotfix },
        { name: 'tag', label: t('Version tag prefix'), value: cfg.tag },
      ],
    });
    if (!v) return;
    await rv.run(null, {
      title: 'Git flow init',
      fn: async () => {
        for (const [k, key] of [['master', 'branch.master'], ['develop', 'branch.develop'], ['feature', 'prefix.feature'], ['release', 'prefix.release'], ['hotfix', 'prefix.hotfix'], ['tag', 'prefix.versiontag']]) {
          await api.git.exec(rv.path, ['config', `gitflow.${key}`, v[k]]);
        }
        if (!names.includes(v.develop)) await api.git.exec(rv.path, ['branch', v.develop, ...(names.includes(v.master) ? [v.master] : [])]);
      },
    });
    if (action === 'init') return;
    cfg = await flowConfig(rv);
  }
  const [verb, kind] = action.split('-');
  const base = kind === 'hotfix' ? cfg.master : cfg.develop;
  if (verb === 'start') {
    const v = await openForm({ title: t('Start {kind}', { kind }), okLabel: t('OK'), fields: [{ name: 'name', label: t('Name ({prefix}…)', { prefix: cfg[kind] }), required: true }, { name: 'info', type: 'info', label: t('From: {branch}', { branch: base }) }] });
    if (v) await rv.run(['checkout', '-b', `${cfg[kind]}${v.name}`, base], { title: t('Start {kind}', { kind }) });
    return;
  }
  const branches = localBranches(rv).filter((b) => b.startsWith(cfg[kind]));
  if (!branches.length) return toast(t('No {prefix}* branch found', { prefix: cfg[kind] }));
  const cur = current(rv);
  const v = await openForm({
    title: t('Finish {kind}', { kind }), okLabel: t('Finish'),
    fields: [
      { name: 'branch', type: 'select', label: 'Branch', options: branches, value: branches.includes(cur) ? cur : branches[0] },
      ...(kind !== 'feature' ? [{ name: 'tag', label: t('Version tag'), value: '' }] : []),
      { name: 'keep', type: 'checkbox', label: t('Keep the branch after finishing'), value: false },
    ],
  });
  if (!v) return;
  const name = v.branch.slice(cfg[kind].length);
  await rv.run(null, {
    title: t('Finish {kind}', { kind }),
    fn: async () => {
      const ex = (a) => api.git.exec(rv.path, a);
      if (kind === 'feature') {
        await ex(['checkout', cfg.develop]);
        await ex(['merge', '--no-ff', '--no-edit', v.branch]);
      } else {
        await ex(['checkout', cfg.master]);
        await ex(['merge', '--no-ff', '--no-edit', v.branch]);
        const tagName = v.tag || `${cfg.tag}${name}`;
        await ex(['tag', '-a', tagName, '-m', `${kind} ${name}`]);
        await ex(['checkout', cfg.develop]);
        await ex(['merge', '--no-ff', '--no-edit', v.branch]);
      }
      if (!v.keep) await ex(['branch', '-d', v.branch]);
    },
  });
}
