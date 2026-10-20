// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 Roger Philippe Pereira
// Diálogos modais.
// Formulários descritos por campos; suportam abas (ex.: New Branch / Delete Branches).
import { h } from './util.js';
import { t } from './i18n.js';

export function openModal({ title, body, buttons = [], width = 480, onKey, onOpen }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', key, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const btnEls = buttons.map((b) => h('button', {
      class: `btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''}`,
      onclick: async () => {
        if (b.validate && !(await b.validate())) return;
        close(typeof b.value === 'function' ? b.value() : b.value);
      },
    }, b.label));
    const dlg = h('div', { class: 'modal', style: { width: `${width}px` }, role: 'dialog' },
      h('div', { class: 'modal-title' }, title),
      h('div', { class: 'modal-body' }, body),
      buttons.length ? h('div', { class: 'modal-buttons' }, btnEls) : null);
    const overlay = h('div', { class: 'modal-overlay' }, dlg);
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const p = buttons.findIndex((b) => b.primary);
        if (p >= 0) { e.preventDefault(); btnEls[p].click(); }
      } else if (onKey) onKey(e);
    };
    document.addEventListener('keydown', key, true);
    root.append(overlay);
    const first = dlg.querySelector('.modal-body input:not([type=checkbox]):not([type=radio]), .modal-body textarea, .modal-body select');
    setTimeout(() => (first || btnEls[btnEls.length - 1])?.focus(), 30);
    if (onOpen) onOpen({ close, dialog: dlg });
  });
}

const opts = (list) => (list || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));

function buildFields(fields, inputs) {
  return fields.map((f) => {
    let input;
    switch (f.type) {
      case 'info':
        return h('div', { class: `form-info ${f.warn ? 'warn' : ''}` }, f.label);
      case 'textarea':
        input = h('textarea', { rows: f.rows || 4, placeholder: f.placeholder || '' });
        input.value = f.value || '';
        break;
      case 'select':
        input = h('select', {}, opts(f.options).map((o) => h('option', { value: o.value }, o.label)));
        if (f.value != null) input.value = f.value;
        break;
      case 'checkbox':
        input = h('input', { type: 'checkbox' });
        input.checked = !!f.value;
        inputs[f.name] = input;
        return h('label', { class: 'form-check' }, input, h('span', {}, f.label, f.hint ? h('small', {}, f.hint) : null));
      case 'radio': {
        const group = h('div', { class: 'form-radio' }, opts(f.options).map((o) => {
          const r = h('input', { type: 'radio', name: `r-${f.name}-${Math.random()}`, value: o.value });
          r.checked = o.value === f.value;
          return h('label', {}, r, ' ', o.label, o.hint ? h('small', {}, o.hint) : null);
        }));
        inputs[f.name] = { get value() { return group.querySelector('input:checked')?.value; } };
        return h('div', { class: 'form-row' }, f.label ? h('span', { class: 'form-label' }, f.label) : null, group);
      }
      case 'checklist': {
        const boxes = opts(f.options).map((o) => {
          const c = h('input', { type: 'checkbox', value: o.value });
          c.checked = (f.value || []).includes(o.value);
          return { c, el: h('label', {}, c, ' ', o.label) };
        });
        const all = h('label', { class: 'form-selectall' }, h('input', { type: 'checkbox', onchange: (e) => boxes.forEach((b) => { b.c.checked = e.target.checked; }) }), ' ', t('Select all'));
        inputs[f.name] = { get value() { return boxes.filter((b) => b.c.checked).map((b) => b.c.value); } };
        return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), h('div', { class: 'form-checklist' }, boxes.map((b) => b.el)), boxes.length > 1 ? all : null);
      }
      case 'grid': {
        // Grade editável no estilo do diálogo de Push (Push? | Local | Remoto | Track?)
        const rows = (f.value || []).map((r) => ({ ...r }));
        const body = h('tbody', {}, rows.map((r) => {
          const chk = h('input', { type: 'checkbox', checked: !!r.push, onchange: (e) => { r.push = e.target.checked; } });
          const remote = h('input', { type: 'text', value: r.remote || '', oninput: (e) => { r.remote = e.target.value; } });
          const track = h('input', { type: 'checkbox', checked: !!r.track, onchange: (e) => { r.track = e.target.checked; } });
          return h('tr', {}, h('td', { class: 'c' }, chk), h('td', {}, r.local, r.note ? h('small', { class: 'muted' }, ` ${r.note}`) : null), h('td', {}, remote), h('td', { class: 'c' }, track));
        }));
        const all = h('label', { class: 'form-selectall' }, h('input', { type: 'checkbox', onchange: (e) => {
          rows.forEach((r) => { r.push = e.target.checked; });
          body.querySelectorAll('tr td:first-child input').forEach((c) => { c.checked = e.target.checked; });
        } }), ' ', t('Select all'));
        inputs[f.name] = { get value() { return rows; } };
        return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label),
          h('div', { class: 'grid-wrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, (f.columns || []).map((c) => h('th', {}, c)))), body)), all);
      }
      case 'list': {
        // Lista de seleção única (ex.: "Merge from log")
        let value = f.value;
        const list = h('div', { class: 'pick-list' }, opts(f.options).map((o) => {
          const row = h('div', { class: `pick-row ${o.value === value ? 'sel' : ''}`, onclick: () => {
            value = o.value;
            list.querySelectorAll('.pick-row').forEach((r) => r.classList.remove('sel'));
            row.classList.add('sel');
          } }, o.label);
          return row;
        }));
        inputs[f.name] = { get value() { return value; } };
        return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), list);
      }
      case 'path': {
        input = h('input', { type: 'text', placeholder: f.placeholder || '' });
        input.value = f.value || '';
        const browse = h('button', { class: 'btn', type: 'button', onclick: async () => {
          const p = f.file ? await window.api.dialog.openFile(f.label) : await window.api.dialog.openDir(f.label);
          if (p) { input.value = p; input.dispatchEvent(new Event('input')); }
        } }, t('Browse…'));
        inputs[f.name] = input;
        if (f.oninput) input.addEventListener('input', () => f.oninput(input.value, inputs));
        return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), h('div', { class: 'form-inline' }, input, browse));
      }
      default:
        input = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', spellcheck: false });
        input.value = f.value || '';
    }
    inputs[f.name] = input;
    if (f.oninput) input.addEventListener('input', () => f.oninput(input.value, inputs));
    return h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, f.label), input, f.hint ? h('small', { class: 'form-hint' }, f.hint) : null);
  });
}

const valueOf = (i) => (i.type === 'checkbox' ? i.checked : (typeof i.value === 'string' ? i.value.trim() : i.value));

// openForm({ title, fields }) ou openForm({ title, tabs: [{ label, fields, okLabel, danger }] })
// Com abas, o resultado inclui _tab (índice da aba ativa) e só os campos dessa aba.
export function openForm({ title, fields, tabs, okLabel = t('OK'), danger = false, width, intro, tab = 0 }) {
  const pages = tabs || [{ fields, okLabel, danger }];
  const inputSets = pages.map(() => ({}));
  let active = tab;
  const err = h('div', { class: 'form-error' });
  const panels = pages.map((p, i) => h('div', { class: 'form-page', hidden: i !== active }, buildFields(p.fields, inputSets[i])));
  let okBtn;
  const tabBar = tabs ? h('div', { class: 'form-tabs' }, tabs.map((tb, i) => h('button', {
    class: `form-tab ${i === active ? 'active' : ''}`,
    onclick: (e) => {
      active = i;
      e.currentTarget.parentNode.querySelectorAll('.form-tab').forEach((b, k) => b.classList.toggle('active', k === i));
      panels.forEach((p, k) => { p.hidden = k !== i; });
      if (okBtn) {
        okBtn.textContent = tabs[i].okLabel || okLabel;
        okBtn.classList.toggle('btn-danger', !!tabs[i].danger);
      }
      err.textContent = '';
    },
  }, tb.label))) : null;
  const collect = () => {
    const v = { _tab: active };
    for (const [k, i] of Object.entries(inputSets[active])) v[k] = valueOf(i);
    return v;
  };
  const p = openModal({
    title,
    width,
    body: h('div', { class: 'form' }, intro ? h('p', { class: 'form-intro' }, intro) : null, tabBar, panels, err),
    buttons: [
      { label: t('Cancel'), value: null },
      {
        label: pages[active].okLabel || okLabel, primary: true, danger: pages[active].danger || danger, value: collect,
        validate: () => {
          const v = collect();
          const miss = pages[active].fields.find((f) => f.required && !v[f.name]);
          if (miss) { err.textContent = t('Fill in: {field}', { field: miss.label }); return false; }
          return true;
        },
      },
    ],
    onOpen: ({ dialog }) => { okBtn = dialog.querySelector('.modal-buttons .btn-primary'); },
  });
  return p;
}

export function confirmBox(title, message, { okLabel = t('OK'), danger = false, detail } = {}) {
  return openModal({
    title,
    body: h('div', {}, h('p', {}, message), detail ? h('pre', { class: 'form-detail' }, detail) : null),
    buttons: [{ label: t('Cancel'), value: false }, { label: okLabel, primary: true, danger, value: true }],
  });
}

export function alertBox(title, message, detail) {
  return openModal({
    title,
    width: 560,
    body: h('div', {}, h('p', {}, message), detail ? h('pre', { class: 'form-detail' }, detail) : null),
    buttons: [{ label: t('OK'), primary: true, value: true }],
  });
}

// Janela de progresso: mostra a saída do git ao vivo.
// Fecha sozinha em caso de sucesso se "Fechar automaticamente" estiver marcado.
export function processDialog(title) {
  const pre = h('pre', { class: 'process-out' });
  const bar = h('div', { class: 'process-bar' }, h('i'));
  let autoClose = true;
  try { autoClose = localStorage.getItem('process:autoclose') !== '0'; } catch { /* noop */ }
  const auto = h('input', { type: 'checkbox', checked: autoClose, onchange: (e) => { try { localStorage.setItem('process:autoclose', e.target.checked ? '1' : '0'); } catch { /* noop */ } } });
  let closeFn;
  let finished = false;
  const closeBtn = h('button', { class: 'btn', disabled: true, onclick: () => closeFn && closeFn(true) }, t('Close'));
  openModal({
    title, width: 620,
    body: h('div', { class: 'process' }, bar, pre, h('div', { class: 'process-foot' }, h('label', { class: 'form-check' }, auto, h('span', {}, t('Close when finished without errors'))), closeBtn)),
    onOpen: ({ close }) => { closeFn = close; },
  });
  return {
    append(text) {
      // Respeita \r (progresso do git sobrescreve a linha)
      const cur = pre.textContent;
      const parts = text.split(/\r(?!\n)/);
      let base = cur;
      parts.forEach((part, i) => {
        if (i > 0) base = base.slice(0, base.lastIndexOf('\n') + 1);
        base += part;
      });
      pre.textContent = base;
      pre.scrollTop = pre.scrollHeight;
    },
    done(ok, message) {
      if (finished) return;
      finished = true;
      bar.classList.add(ok ? 'ok' : 'fail');
      if (message) this.append(`\n${message}\n`);
      closeBtn.disabled = false;
      closeBtn.classList.add('btn-primary');
      closeBtn.focus();
      if (ok && auto.checked) setTimeout(() => closeFn && closeFn(true), 400);
    },
  };
}
