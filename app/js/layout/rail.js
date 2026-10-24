// The side rail: one button for each of the screen's four panes, drawn as a small map with its pane
// filled in. Tap one to hide that pane (its neighbours take its space) or to bring it back. Opened (the
// button under the mark), the rail names each pane and gives it a dropdown of its tabs; right-click or
// hold a pane button for the same list either way. A narrow window has only one pane, so there the rail
// lists the panels instead, as before.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { state } from '../core/state.js';
import { showMenu } from '../core/ui.js';
import { workspace, PANES } from './workspace.js';
import { KINDS, KIND_ORDER, kindOf } from '../panels/registry.js';

const PHONE = matchMedia('(max-width: 760px)');     // the rail is a bar along the bottom: never opened
const OVERLAY = matchMedia('(max-width: 999px)');   // no room to push the panes aside: the open rail floats over them
const expanded = new Set();                          // panes whose dropdown is open
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** utilities: [{label, icon, title, onClick}] for the foot of the rail. */
export function buildRail({ utilities }) {
  const app = document.getElementById('app');
  const rail = app.querySelector('.rail');
  const openGroup = document.getElementById('rail-open');
  const panesGroup = document.getElementById('rail-panes');
  const kindsGroup = document.getElementById('rail-kinds');
  const utils = document.getElementById('rail-utils');

  const isOpen = () => !!state.get('settings')?.railOpen && !PHONE.matches;
  const setOpen = (v) => state.update('settings', (s) => { s.railOpen = v; });
  const label = (name, meta) => h('span', { class: 'rail-label' }, h('span', { class: 'rail-name truncate' }, name), meta ? h('span', { class: 'rail-meta truncate' }, meta) : null);

  const openBtn = h('button', { class: 'rail-btn', type: 'button', 'data-rk': 'open', onclick: () => setOpen(!isOpen()) }, icon('sidebar'), label('Close the side menu'));
  openGroup.append(openBtn);

  // ---- narrow windows: the panels -------------------------------------------------
  const kindBtns = new Map();
  KIND_ORDER.forEach((k, i) => {
    const def = KINDS[k];
    if ((i === 5 || i === 6) && kindsGroup.lastChild) kindsGroup.append(h('div', { class: 'rail-sep' }));
    const btn = h('button', {
      class: 'rail-btn', type: 'button', title: `${def.title}: ${def.hint}`, 'aria-label': def.title, draggable: true, 'data-rk': `kind:${k}`,
      onclick: () => workspace.openKind(k),
      ondragstart: (e) => { e.dataTransfer.setData('application/x-dm-kind', k); e.dataTransfer.effectAllowed = 'copyMove'; workspace.beginDrag(); },
      ondragend: () => workspace.endDrag(),
    }, icon(def.icon), label(def.title));
    kindBtns.set(k, btn);
    kindsGroup.append(btn);
  });
  function markKinds() {
    const shown = new Set(workspace.visiblePanes().map((p) => workspace.activeFor(p)).map((id) => id && kindOf(id)));
    for (const [k, btn] of kindBtns) {
      const placed = Object.values(workspace.L.panes).some((p) => p.tabs.some((t) => kindOf(t) === k));
      btn.classList.toggle('is-shown', shown.has(k));
      btn.title = `${KINDS[k].title}: ${KINDS[k].hint}${placed && !shown.has(k) ? ' (in a tab)' : ''}`;
    }
  }

  // ---- the four panes ---------------------------------------------------------------
  const tabsOf = (pid) => workspace.L.panes[pid].tabs.filter((t) => KINDS[kindOf(t)]);
  const nameOf = (pid) => tabsOf(pid).map((t) => workspace.panelTitle(t)).join(' · ') || 'Empty pane';

  function paneRow(pid) {
    const on = workspace.shownPanes().includes(pid);
    const place = cap(workspace.placeName(pid));
    const name = nameOf(pid);
    const open = expanded.has(pid);
    const btn = h('button', {
      class: `rail-btn rail-pane-btn${on ? ' is-shown' : ''}`, type: 'button', 'data-rk': pid, 'aria-pressed': String(on),
      'aria-label': `${place} pane: ${name}`,
      title: `${place}: ${name}. ${on ? 'Tap to hide it; the others take its space.' : 'Tap to show it again.'} Right-click or hold for its tabs.`,
      onclick: () => workspace.togglePane(pid),
      oncontextmenu: (e) => { e.preventDefault(); paneMenu(pid, e.currentTarget); },
    }, workspace.paneGlyph(pid), label(name, on ? place : `${place} · hidden`));
    const caret = h('button', {
      class: 'btn-icon btn-sm rail-caret', type: 'button', 'data-rk': `${pid}:caret`, 'aria-expanded': String(open),
      title: open ? 'Fold its tabs away' : 'Its tabs', 'aria-label': `${place} pane's tabs`,
      onclick: () => { if (open) expanded.delete(pid); else expanded.add(pid); render(); },
    }, icon(open ? 'chevron-down' : 'chevron-right'));
    const row = h('div', { class: `rail-pane${on ? ' is-on' : ''}${open ? ' is-expanded' : ''}` }, h('div', { class: 'rail-pane-head' }, btn, caret));
    if (open) row.append(h('div', { class: 'rail-sub' }, subItems(pid, on)));
    return row;
  }

  function subItems(pid, on) {
    const active = workspace.activeFor(pid);
    const items = tabsOf(pid).map((t) => h('button', {
      class: 'rail-sub-item', type: 'button', 'data-rk': `${pid}:${t}`, 'aria-current': String(on && t === active),
      title: on && t === active ? 'Showing in this pane' : 'Show this tab',
      onclick: () => workspace.showTab(pid, t),
    }, icon(KINDS[kindOf(t)].icon), h('span', { class: 'rail-sub-label truncate' }, workspace.panelTitle(t))));
    if (!items.length) items.push(h('p', { class: 'rail-sub-empty' }, 'Nothing in this pane yet.'));
    items.push(h('button', { class: 'rail-sub-item', type: 'button', 'data-rk': `${pid}:add`, onclick: (e) => workspace.addMenu(pid, e.currentTarget, { align: 'side' }) },
      icon('plus'), h('span', { class: 'rail-sub-label' }, 'Add a panel here')));
    return items;
  }

  function paneMenu(pid, anchor) {
    const on = workspace.shownPanes().includes(pid);
    const active = workspace.activeFor(pid);
    showMenu(anchor, [
      { header: `${cap(workspace.placeName(pid))} pane` },
      ...tabsOf(pid).map((t) => ({ label: workspace.panelTitle(t), icon: KINDS[kindOf(t)].icon, hint: on && t === active ? 'showing' : '', onClick: () => workspace.showTab(pid, t) })),
      { label: 'Add a panel here', icon: 'plus', submenu: workspace.addItems(pid) },
      { sep: true },
      on ? { label: 'Hide this pane', icon: 'minimize', disabled: !workspace.canHide(pid), onClick: () => workspace.hidePane(pid) }
        : { label: 'Show this pane', icon: 'eye', onClick: () => workspace.showPane(pid) },
    ], { align: 'side', minWidth: 220 });
  }

  // ---- drawing -------------------------------------------------------------------------
  function render() {
    const open = isOpen();
    app.classList.toggle('is-rail-open', open);
    rail.classList.toggle('is-open', open);
    openBtn.title = open ? 'Close the side menu' : 'Open the side menu: pane names and their tabs';
    openBtn.setAttribute('aria-expanded', String(open));
    const compact = workspace.compact;
    panesGroup.hidden = compact;
    kindsGroup.hidden = !compact;
    const focusKey = rail.contains(document.activeElement) ? document.activeElement.dataset.rk : null;
    if (compact) markKinds();
    else {
      clear(panesGroup);
      panesGroup.append(h('div', { class: 'rail-heading' }, 'Panes on screen'), ...PANES.map(paneRow));
    }
    if (focusKey) rail.querySelector(`[data-rk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  };
  bus.on('layout:changed', schedule);
  bus.on('layout:tabs', schedule);
  bus.on('state:settings', schedule);
  PHONE.addEventListener('change', schedule);

  // Floating over the panes, the open rail closes when you tap elsewhere or press Esc.
  const floating = () => isOpen() && OVERLAY.matches;
  document.addEventListener('pointerdown', (e) => {
    if (floating() && !rail.contains(e.target) && !e.target.closest?.('.menu, .dialog-backdrop, .toast')) setOpen(false);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && floating() && !document.querySelector('.menu')) setOpen(false);
  });

  for (const u of utilities) {
    utils.append(h('button', { class: 'rail-btn', type: 'button', title: u.title || u.label, 'aria-label': u.label, onclick: u.onClick }, icon(u.icon), label(u.label)));
  }
  schedule();
}
