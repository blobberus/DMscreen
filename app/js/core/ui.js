// Shared UI: toasts, dialogs, menus, and the sound picker. Never window.alert/confirm/prompt.
import { h, icon, clear } from './dom.js';
import { bus } from './bus.js';
import { fmtTime } from './util.js';

const overlays = () => document.getElementById('overlays') || document.body;

// ---------- toasts -------------------------------------------------------------
let toastHost = null;
export function toast(message, { type = 'info', timeout = 3800, action } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); overlays().append(toastHost); }
  const el = h('div', { class: `toast is-${type}` }, h('span', { class: 'toast-mark' }), h('span', null, message));
  if (action) el.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label));
  toastHost.append(el);
  setTimeout(() => el.remove(), type === 'error' ? Math.max(timeout, 7000) : timeout);
  return el;
}
bus.on('toast', ({ message, type }) => toast(message, { type }));

// ---------- dialogs ------------------------------------------------------------
let openCount = 0;
export const dialogOpen = () => openCount > 0;

export function openDialog({ title, body, actions = [], wide = false, onClose, className = '', initialFocus } = {}) {
  const prevFocus = document.activeElement;
  const foot = actions.length ? h('div', { class: 'dialog-foot' }) : null;
  const card = h('div', { class: `dialog ${wide ? 'is-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'dialog-head' },
      h('h2', { class: 'dialog-title' }, title),
      h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    h('div', { class: 'dialog-body' }, body),
    foot);
  const backdrop = h('div', { class: 'dialog-backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, card);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    openCount--;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
    prevFocus?.focus?.();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  for (const a of actions) {
    foot.append(h('button', {
      class: `btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : ''}`,
      type: 'button',
      onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(a.value ?? r); },
    }, a.label));
  }
  openCount++;
  overlays().append(backdrop);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => {
    const target = initialFocus ? card.querySelector(initialFocus) : card.querySelector('input, select, textarea, .btn-primary');
    (target || card.querySelector('button'))?.focus();
  });
  return { close, el: card };
}

export function confirmDialog(message, { title = 'Are you sure?', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      body: h('p', null, message),
      actions: [
        { label: 'Cancel', value: false },
        { label: okLabel, kind: danger ? 'danger' : 'primary', value: true },
      ],
      onClose: (v) => resolve(v === true),
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', okLabel = 'OK', hint = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder });
    let result = null;
    const d = openDialog({
      title,
      body: h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, input, hint ? h('span', { class: 'field-hint' }, hint) : null),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, kind: 'primary', onClick: () => { result = input.value.trim(); if (!result) { input.focus(); return false; } } },
      ],
      onClose: () => resolve(result || null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); result = input.value.trim(); if (result) d.close(); }
    });
    requestAnimationFrame(() => input.select());
  });
}

// ---------- menus --------------------------------------------------------------
let openMenu = null;
export function closeMenu() { openMenu?.close(); }

/**
 * items: [{label, icon, hint, checked, disabled, onClick, sep, header, submenu}]
 * anchor: element (menu opens below it) or {x, y}.
 */
export function showMenu(anchor, items, { align = 'start', minWidth } = {}) {
  // measure the anchor first: a submenu's anchor sits in the menu that closes next
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  if (minWidth) menu.style.minWidth = `${minWidth}px`;
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { menu.append(h('div', { class: 'menu-label' }, it.header)); continue; }
    const btn = h('button', {
      class: `menu-item ${it.checked ? 'is-checked' : ''}`, type: 'button', role: 'menuitem', disabled: it.disabled,
      onclick: (e) => {
        e.stopPropagation();
        if (it.submenu) { showMenu(btn, it.submenu, { align: 'side' }); return; }
        close();
        it.onClick?.();
      },
    },
    it.checked !== undefined ? icon('check', 'menu-check') : (it.icon ? icon(it.icon) : null),
    h('span', { class: 'truncate' }, it.label),
    it.hint ? h('span', { class: 'menu-hint' }, it.hint) : it.submenu ? icon('chevron-right', 'menu-hint') : null);
    menu.append(btn);
  }
  overlays().append(menu);
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let x = align === 'end' ? r.right - mw : align === 'side' ? r.right + 4 : r.left;
  let y = align === 'side' ? r.top - 4 : r.bottom + 4;
  x = Math.max(6, Math.min(x, innerWidth - mw - 6));
  if (y + mh > innerHeight - 6) y = Math.max(6, (align === 'side' ? r.bottom : r.top) - mh - 4);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const onDown = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    }
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  });
  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenu?.menu === menu) openMenu = null;
  }
  openMenu = { menu, close };
  menu.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
  return openMenu;
}

// ---------- the sound picker ---------------------------------------------------

/**
 * Pick one or more sounds from the library.
 * Resolves to an array of ids (multi) or one id, or null.
 */
export function pickSound({ library, title = 'Choose a sound', kind = null, multi = false, okLabel } = {}) {
  return new Promise((resolve) => {
    const chosen = new Set();
    let filterKind = kind;
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search the library' });
    const list = h('div', { class: 'picker-list', role: 'listbox' });
    const kinds = h('div', { class: 'seg' });
    for (const [k, label] of [[null, 'All'], ['music', 'Music'], ['ambience', 'Ambience'], ['effect', 'Effects']]) {
      kinds.append(h('button', { type: 'button', 'aria-pressed': String(filterKind === k), onclick: (e) => {
        filterKind = k;
        kinds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
        render();
      } }, label));
    }
    let result = null;
    function render() {
      clear(list);
      const term = search.value.trim().toLowerCase();
      const items = library.list().filter((s) => (!filterKind || s.kind === filterKind) && (!term || s.name.toLowerCase().includes(term)));
      if (!items.length) {
        list.append(h('p', { class: 'muted', style: { padding: '12px' } }, library.list().length ? 'Nothing in the library matches.' : 'The library is empty. Add sounds in the Sound library pane first.'));
        return;
      }
      for (const s of items.slice(0, 300)) {
        const row = h('button', {
          class: `row-item picker-row ${chosen.has(s.id) ? 'is-selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(chosen.has(s.id)),
          onclick: () => {
            if (!multi) { result = s.id; d.close(); return; }
            chosen.has(s.id) ? chosen.delete(s.id) : chosen.add(s.id);
            row.classList.toggle('is-selected', chosen.has(s.id));
            row.setAttribute('aria-selected', String(chosen.has(s.id)));
            const tick = row.querySelector('.picker-tick');
            clear(tick);
            if (chosen.has(s.id)) tick.append(icon('check', 'icon-sm'));
          },
        },
        multi ? h('span', { class: 'picker-tick' }, chosen.has(s.id) ? icon('check', 'icon-sm') : null) : null,
        h('span', { class: 'name truncate' }, s.name),
        h('span', { class: 'meta' }, { music: 'Music', ambience: 'Ambience', effect: 'Effect' }[s.kind]),
        h('span', { class: 'meta num picker-dur' }, fmtTime(s.duration)));
        list.append(row);
      }
    }
    search.addEventListener('input', render);
    const d = openDialog({
      title,
      body: h('div', { class: 'picker' }, h('div', { class: 'picker-tools' }, search, kinds), list),
      actions: multi ? [{ label: 'Cancel' }, { label: okLabel || 'Add', kind: 'primary', onClick: () => { result = [...chosen]; } }] : [],
      onClose: () => resolve(result && (!multi || result.length) ? result : null),
    });
    render();
  });
}
