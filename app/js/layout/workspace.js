// The workspace: up to four panes on a grid whose lines you can drag, arranged by a preset,
// each pane holding tabs. Panels never move in the DOM: they float over their pane's body, so moving a
// tab, swapping panes or changing the layout never reloads a site or interrupts anything.
//
// Grid arithmetic: the grid has a 6px padding and 6px gaps (one gutter, --gap). With n columns the
// tracks share (width - 12 - 6(n-1)) px in proportion to their fractions; splitters sit centred in the
// gaps, so pane edges always land on the gutter lines.
import { h, icon, clear } from '../core/dom.js';
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { keys } from '../core/keys.js';
import { showMenu, promptDialog, confirmDialog, toast, dialogOpen } from '../core/ui.js';
import { clamp, isTyping, uid } from '../core/util.js';
import { KINDS, KIND_ORDER, kindOf } from '../panels/registry.js';

export const PRESETS = {
  quad: { label: 'Four panes', areas: [['a', 'b'], ['c', 'd']], cols: [0.52, 0.48], rows: [0.56, 0.44] },
  'left-3': { label: 'Large left, three stacked', areas: [['a', 'b'], ['a', 'c'], ['a', 'd']], cols: [0.6, 0.4], rows: [0.34, 0.33, 0.33] },
  'top-3': { label: 'Large top, three below', areas: [['a', 'a', 'a'], ['b', 'c', 'd']], cols: [0.34, 0.33, 0.33], rows: [0.58, 0.42] },
  'left-2': { label: 'Large left, two stacked', areas: [['a', 'b'], ['a', 'c']], cols: [0.6, 0.4], rows: [0.5, 0.5] },
  'cols-3': { label: 'Three columns', areas: [['a', 'b', 'c']], cols: [0.34, 0.33, 0.33], rows: [1] },
  'cols-2': { label: 'Two side by side', areas: [['a', 'b']], cols: [0.5, 0.5], rows: [1] },
  'rows-2': { label: 'Two stacked', areas: [['a'], ['b']], cols: [1], rows: [0.6, 0.4] },
  single: { label: 'One pane', areas: [['a']], cols: [1], rows: [1] },
};
const LETTERS = ['a', 'b', 'c', 'd'];
export const PANES = ['p1', 'p2', 'p3', 'p4'];
const GAP = 6;
const PAD = 6;
const MIN_W = 200;
const MIN_H = 130;
const COMPACT_W = 760;

// The starting screen: Stone Wardens (where sites and searches open) large on the left, the music and
// the pads stacked on the right. Notes wait in the fourth pane; showing it makes "large left, three stacked".
export function defaultLayout() {
  return {
    v: 1,
    current: {
      preset: 'left-2',
      four: 'left-3',
      sizes: {},
      order: PANES.slice(),
      panes: {
        p1: { tabs: ['wardens'], active: 'wardens' },
        p2: { tabs: ['console', 'playlists'], active: 'console' },
        p3: { tabs: ['pads', 'library', 'youtube'], active: 'pads' },
        p4: { tabs: ['notes'], active: 'notes' },
      },
      maximized: null,
      hidden: [],
      zoom: {},
      panelState: {},
      locked: false,
    },
    saved: [],
  };
}

/**
 * Take out tabs whose panel no longer exists (Combat Ring, the separate web panes). The first one goes to
 * Stone Wardens instead if no pane has it, since sites open there now. True if anything changed.
 */
function prune(L) {
  let wardens = Object.values(L.panes).some((p) => p.tabs.includes('wardens'));
  let changed = false;
  for (const p of Object.values(L.panes)) {
    if (p.tabs.every((t) => KINDS[kindOf(t)])) continue;
    changed = true;
    p.tabs = p.tabs.flatMap((t) => {
      if (KINDS[kindOf(t)]) return [t];
      if (wardens) return [];
      wardens = true;
      return ['wardens'];
    });
    if (!p.tabs.includes(p.active)) p.active = p.tabs.includes('wardens') ? 'wardens' : p.tabs[0] || null;
  }
  for (const bag of [L.panelState, L.zoom]) for (const id of Object.keys(bag || {})) if (!KINDS[kindOf(id)]) delete bag[id];
  return changed;
}

function presetBoxes(areas) {
  const boxes = {};
  areas.forEach((row, r) => row.forEach((l, c) => {
    const b = boxes[l] || (boxes[l] = { r0: r, r1: r, c0: c, c1: c });
    b.r0 = Math.min(b.r0, r); b.r1 = Math.max(b.r1, r); b.c0 = Math.min(b.c0, c); b.c1 = Math.max(b.c1, c);
  }));
  return boxes;
}

// Where the panes that grow into a hidden pane's space sit: beside it first, then above, then below.
const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** Give box b's cells to its neighbours on one side, if each of them can grow across it and stay a rectangle. */
function absorb(grid, b, [dr, dc]) {
  const boxes = presetBoxes(grid);
  const owners = [];
  if (dc) {
    const c = dc < 0 ? b.c0 - 1 : b.c1 + 1;
    if (c < 0 || c >= grid[0].length) return false;
    for (let r = b.r0; r <= b.r1; r++) {
      const n = boxes[grid[r][c]];
      if (n.r0 < b.r0 || n.r1 > b.r1) return false;
      owners.push([r, grid[r][c]]);
    }
    for (const [r, l] of owners) for (let c2 = b.c0; c2 <= b.c1; c2++) grid[r][c2] = l;
  } else {
    const r = dr < 0 ? b.r0 - 1 : b.r1 + 1;
    if (r < 0 || r >= grid.length) return false;
    for (let c = b.c0; c <= b.c1; c++) {
      const n = boxes[grid[r][c]];
      if (n.c0 < b.c0 || n.c1 > b.c1) return false;
      owners.push([c, grid[r][c]]);
    }
    for (const [c, l] of owners) for (let r2 = b.r0; r2 <= b.r1; r2++) grid[r2][c] = l;
  }
  return true;
}

/**
 * A preset's grid with some of its panes taken out. Each one's space goes to its neighbours on one
 * side, so every other pane stays where it was; rows and columns that end up the same are merged
 * (their sizes added). Null if a pane can't be taken out that way.
 */
function collapse(areas, sizes, gone) {
  const grid = areas.map((r) => r.slice());
  const cols = sizes.cols.slice();
  const rows = sizes.rows.slice();
  for (const x of gone) {
    const b = presetBoxes(grid)[x];
    if (b && !SIDES.some((side) => absorb(grid, b, side))) return null;
  }
  for (let j = grid.length - 1; j > 0; j--) {
    if (grid[j].join() === grid[j - 1].join()) { grid.splice(j, 1); rows[j - 1] += rows[j]; rows.splice(j, 1); }
  }
  for (let i = grid[0].length - 1; i > 0; i--) {
    if (grid.every((r) => r[i] === r[i - 1])) { for (const r of grid) r.splice(i, 1); cols[i - 1] += cols[i]; cols.splice(i, 1); }
  }
  return { areas: grid, cols, rows };
}

/** A small drawing of a preset, for the layout menu. */
export function presetGlyph(id) {
  return areaGlyph(PRESETS[id].areas);
}

/** The layout button's icon: an arrangement drawn like the other icons, a frame and the lines between panes. */
export function layoutIcon(areas) {
  const rows = areas.length;
  const cols = areas[0].length;
  const X = (c) => +(3.5 + (17 * c) / cols).toFixed(2);
  const Y = (r) => +(4.5 + (15 * r) / rows).toFixed(2);
  let d = '';
  for (const b of Object.values(presetBoxes(areas))) {
    if (b.c1 < cols - 1) d += `M${X(b.c1 + 1)} ${Y(b.r0)}V${Y(b.r1 + 1)}`;
    if (b.r1 < rows - 1) d += `M${X(b.c0)} ${Y(b.r1 + 1)}H${X(b.c1 + 1)}`;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>${d ? `<path d="${d}"/>` : ''}</g>`;
  return svg;
}

/** A small drawing of a grid; the box of letter `mark` is filled in (where one pane sits). */
export function areaGlyph(areas, mark = null) {
  const rows = areas.length;
  const cols = areas[0].length;
  const W = 26, H = 18, g = 1.5;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', mark ? 'preset-glyph pane-glyph' : 'preset-glyph');
  svg.setAttribute('aria-hidden', 'true');
  for (const [l, b] of Object.entries(presetBoxes(areas))) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    if (l === mark) r.setAttribute('class', 'is-mark');
    const cw = (W - g * (cols + 1)) / cols;
    const rh = (H - g * (rows + 1)) / rows;
    r.setAttribute('x', g + b.c0 * (cw + g));
    r.setAttribute('y', g + b.r0 * (rh + g));
    r.setAttribute('width', (b.c1 - b.c0 + 1) * cw + (b.c1 - b.c0) * g);
    r.setAttribute('height', (b.r1 - b.r0 + 1) * rh + (b.r1 - b.r0) * g);
    r.setAttribute('rx', 1.2);
    svg.append(r);
  }
  return svg;
}

class Workspace {
  constructor() {
    this.instances = new Map();     // panelId -> {id, kind, el, inner, api, pane, loading}
    this.paneEls = {};
    this.focused = 'p1';
    this.compact = false;
    this.compactActive = null;
    this.toResize = new Set();     // panels to tell about their new size on the next frame
    this.resizeFrame = 0;
  }

  get doc() {
    let d = state.get('layouts');
    if (!d || !d.current || d.v !== 1) { d = defaultLayout(); state.set('layouts', d, { silent: true }); }
    return d;
  }
  get L() { return this.doc.current; }
  save() { state.schedule('layouts', 400); }

  mount(root) {
    this.root = root;
    this.grid = h('div', { class: 'ws-grid' });
    this.splitters = h('div', { class: 'ws-splitters' });
    this.layer = h('div', { class: 'ws-layer' });
    root.append(this.grid, this.splitters, this.layer);
    for (const id of PANES) {
      const el = this.buildPane(id);
      this.paneEls[id] = el;
      this.grid.append(el.root);
    }
    new ResizeObserver(() => this.reflow()).observe(root);
    root.addEventListener('pointerdown', (e) => {
      const pane = e.target.closest?.('[data-pane]')?.dataset.pane || this.instances.get(e.target.closest?.('[data-panel]')?.dataset.panel)?.pane;
      if (pane) this.setFocused(pane);
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.L.maximized && !isTyping(e.target) && !dialogOpen() && !document.querySelector('.menu')) {
        this.toggleMax(this.L.maximized);
      }
    });
    keys.on('pane.max', () => this.toggleMax(this.focused));
    keys.on('pane.hide', () => this.hidePane(this.focusedVisible()));
    keys.on('pane.show', () => this.showAllPanes());
    bus.on('state:layouts', () => this.render());
    this.render();
  }

  // ---- panes -------------------------------------------------------------------
  buildPane(id) {
    const tabs = h('div', { class: 'pane-tabs', role: 'tablist' });
    const add = h('button', { class: 'btn-icon btn-sm pane-add', type: 'button', title: 'Add a panel to this pane', 'aria-label': 'Add a panel to this pane', onclick: (e) => this.addMenu(id, e.currentTarget) }, icon('plus'));
    const hide = h('button', { class: 'btn-icon btn-sm pane-hide', type: 'button', title: 'Hide this pane; the others take its space (Alt+Shift+H)', 'aria-label': 'Hide this pane', onclick: () => this.hidePane(id) }, icon('minimize'));
    const max = h('button', { class: 'btn-icon btn-sm pane-max', type: 'button', title: 'Maximise (Alt+Enter)', 'aria-label': 'Maximise this pane', onclick: () => this.toggleMax(id) }, icon('maximize'));
    const more = h('button', { class: 'btn-icon btn-sm pane-more', type: 'button', title: 'Pane options', 'aria-label': 'Pane options', onclick: (e) => this.paneMenu(id, e.currentTarget) }, icon('more'));
    const head = h('header', { class: 'pane-head' }, tabs, add, h('span', { class: 'pane-spacer' }), hide, max, more);
    const body = h('div', { class: 'pane-body' });
    const drop = h('div', { class: 'pane-drop' }, h('span', null, 'Drop to show it here'));
    const root = h('section', { class: 'pane', 'data-pane': id }, head, body, drop);
    drop.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-dm-panel') || e.dataTransfer.types.includes('application/x-dm-kind')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        drop.classList.add('is-over');
      }
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      const panel = e.dataTransfer.getData('application/x-dm-panel');
      const kind = e.dataTransfer.getData('application/x-dm-kind');
      this.endDrag();
      if (panel) this.movePanel(panel, id);
      else if (kind) this.openKind(kind, id);
    });
    head.addEventListener('dblclick', (e) => { if (e.target === head || e.target.classList.contains('pane-spacer')) this.toggleMax(id); });
    return { root, head, tabs, body, drop, hide, max };
  }

  /** The panes the arrangement has room for, hidden or not. */
  slotPanes() {
    const L = this.L;
    return L.order.slice(0, new Set(PRESETS[L.preset].areas.flat()).size);
  }
  /** The arrangement's panes that are hidden (never all of them). */
  hiddenPanes() {
    const hidden = this.L.hidden || [];
    const slots = this.slotPanes();
    const gone = slots.filter((p) => hidden.includes(p));
    return gone.length < slots.length ? gone : [];
  }
  /** The arrangement's panes that aren't hidden (all on screen, unless one is maximised). */
  shownPanes() {
    const gone = this.hiddenPanes();
    return this.slotPanes().filter((p) => !gone.includes(p));
  }
  visiblePanes() {
    if (this.compact) return [this.L.order[0]];
    const L = this.L;
    if (L.maximized) return [L.maximized];
    return this.shownPanes();
  }
  /** The four-pane arrangement the screen uses: this one, or the last four-pane one picked. */
  fourBase() {
    const L = this.L;
    if (this.slotPanes().length === 4) return L.preset;
    return PRESETS[L.four] ? L.four : 'quad';
  }
  /** Where a pane sits among four: "top left", "right"… */
  placeName(pid) {
    const areas = PRESETS[this.fourBase()].areas;
    const b = presetBoxes(areas)[LETTERS[this.L.order.indexOf(pid)]];
    const rows = areas.length;
    const cols = areas[0].length;
    const cy = (b.r0 + b.r1 + 1) / 2 / rows;
    const cx = (b.c0 + b.c1 + 1) / 2 / cols;
    const v = b.r0 === 0 && b.r1 === rows - 1 ? '' : cy < 0.4 ? 'top' : cy > 0.6 ? 'bottom' : 'middle';
    const hz = b.c0 === 0 && b.c1 === cols - 1 ? '' : cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'centre';
    return [v, hz].filter(Boolean).join(' ') || 'whole screen';
  }
  /** A drawing of the four panes with this one filled in. */
  paneGlyph(pid) {
    return areaGlyph(PRESETS[this.fourBase()].areas, LETTERS[this.L.order.indexOf(pid)]);
  }
  isVisible(paneId) { return this.visiblePanes().includes(paneId); }
  paneOf(panelId) {
    for (const [pid, p] of Object.entries(this.L.panes)) if (p.tabs.includes(panelId)) return pid;
    return null;
  }
  setFocused(pane) {
    if (this.focused === pane) return;
    this.focused = pane;
    for (const [id, el] of Object.entries(this.paneEls)) el.root.classList.toggle('is-focused', id === pane);
  }
  focusedVisible() {
    const vis = this.visiblePanes();
    return vis.includes(this.focused) ? this.focused : vis[0];
  }
  /** "top left", "right", ... from where a pane sits. */
  paneName(paneId) {
    if (!this.isVisible(paneId)) return 'a hidden pane';
    const r = this.paneEls[paneId].root.getBoundingClientRect();
    const W = this.root.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - W.left) / W.width;
    const cy = (r.top + r.height / 2 - W.top) / W.height;
    const full = (a, b) => a > 0.9 * b;
    const v = full(r.height, W.height) ? '' : cy < 0.4 ? 'top' : cy > 0.6 ? 'bottom' : 'middle';
    const hz = full(r.width, W.width) ? '' : cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'centre';
    return [v, hz].filter(Boolean).join(' ') || 'the only pane';
  }

  // ---- rendering -----------------------------------------------------------------
  sizes(preset) {
    const L = this.L;
    const def = PRESETS[preset];
    const s = L.sizes[preset];
    if (s && s.cols?.length === def.cols.length && s.rows?.length === def.rows.length) return s;
    L.sizes[preset] = { cols: def.cols.slice(), rows: def.rows.slice() };
    return L.sizes[preset];
  }

  /**
   * What the grid shows now: {key, areas, sizes}. The preset, or one pane, or the preset with the hidden
   * panes' space given to their neighbours. That last one keeps its own sizes (key "quad/c"), starting
   * from the preset's.
   */
  arrangement() {
    const L = this.L;
    if (this.compact || L.maximized) return { key: 'single', areas: PRESETS.single.areas, sizes: this.sizes('single') };
    const def = PRESETS[L.preset];
    const gone = this.hiddenPanes().map((p) => LETTERS[L.order.indexOf(p)]);
    const shape = gone.length && collapse(def.areas, this.sizes(L.preset), gone);
    if (!shape) return { key: L.preset, areas: def.areas, sizes: this.sizes(L.preset) };
    const key = `${L.preset}/${gone.sort().join('')}`;
    const s = L.sizes[key];
    if (!(s && s.cols?.length === shape.cols.length && s.rows?.length === shape.rows.length)) L.sizes[key] = { cols: shape.cols, rows: shape.rows };
    return { key, areas: shape.areas, sizes: L.sizes[key] };
  }

  render() {
    const L = this.L;
    if (prune(L)) this.save();      // a layout saved before a panel was retired
    this.compact = this.root.clientWidth > 0 && this.root.clientWidth < COMPACT_W;
    const { areas, sizes: sz } = this.arrangement();
    this.grid.style.gridTemplateColumns = sz.cols.map((f) => `minmax(0, ${f}fr)`).join(' ');
    this.grid.style.gridTemplateRows = sz.rows.map((f) => `minmax(0, ${f}fr)`).join(' ');
    this.grid.style.gridTemplateAreas = areas.map((r) => `"${r.join(' ')}"`).join(' ');
    const visible = this.visiblePanes();
    const one = this.compact || L.maximized;
    for (const pid of PANES) {
      const el = this.paneEls[pid];
      const shown = visible.includes(pid);
      el.root.hidden = !shown;
      el.root.style.gridArea = !shown ? '' : one ? 'a' : LETTERS[L.order.indexOf(pid)];
      el.hide.disabled = !this.canHide(pid);
      el.max.replaceChildren(icon(L.maximized === pid ? 'restore' : 'maximize'));
      el.max.title = L.maximized === pid ? 'Restore the layout (Alt+Enter or Esc)' : 'Maximise (Alt+Enter)';
      this.renderTabs(pid);
    }
    this.root.classList.toggle('is-locked', !!L.locked);
    this.root.classList.toggle('is-compact', this.compact);
    this.root.classList.toggle('is-maximized', !!L.maximized);
    bus.emit('layout:changed');
    this.reflow();
  }

  tabsFor(pid) {
    if (this.compact) return PANES.flatMap((p) => this.L.panes[p].tabs);
    return this.L.panes[pid].tabs;
  }
  activeFor(pid) {
    if (this.compact) {
      const all = this.tabsFor(pid);
      if (!all.includes(this.compactActive)) this.compactActive = this.L.panes[pid].active || all[0];
      return this.compactActive;
    }
    const p = this.L.panes[pid];
    if (!p.tabs.includes(p.active)) p.active = p.tabs[0] || null;
    return p.active;
  }

  panelTitle(panelId) {
    const inst = this.instances.get(panelId);
    const kind = KINDS[kindOf(panelId)];
    if (inst?.api?.title) return inst.api.title();
    return kind.title;
  }

  renderTabs(pid) {
    const el = this.paneEls[pid];
    const tabs = this.tabsFor(pid);
    const active = this.activeFor(pid);
    clear(el.tabs);
    for (const panelId of tabs) {
      const kind = KINDS[kindOf(panelId)];
      if (!kind) continue;
      const tab = h('button', {
        class: 'pane-tab', type: 'button', role: 'tab', 'aria-selected': String(panelId === active), draggable: !this.L.locked && !this.compact,
        title: kind.hint,
        onclick: () => this.activate(pid, panelId),
        oncontextmenu: (e) => { e.preventDefault(); this.tabMenu(pid, panelId, { x: e.clientX, y: e.clientY }); },
        onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); this.closePanel(panelId); } },
        ondblclick: () => this.toggleMax(pid),
        ondragstart: (e) => {
          e.dataTransfer.setData('application/x-dm-panel', panelId);
          e.dataTransfer.effectAllowed = 'move';
          this.beginDrag();
        },
        ondragend: () => this.endDrag(),
      }, icon(kind.icon, 'icon-sm'), h('span', { class: 'pane-tab-label truncate' }, this.panelTitle(panelId)));
      el.tabs.append(tab);
    }
    el.root.classList.toggle('is-empty', !tabs.length);
    clear(el.body);
    if (!tabs.length) el.body.append(this.emptyPane(pid));
    bus.emit('layout:tabs', pid);
  }

  emptyPane(pid) {
    const list = h('div', { class: 'pane-empty-list' });
    for (const k of KIND_ORDER) {
      const kind = KINDS[k];
      const where = this.paneOf(k);
      list.append(h('button', { class: 'pane-empty-item', type: 'button', onclick: () => this.openKind(k, pid) },
        icon(kind.icon), h('span', null, h('strong', null, kind.title), h('span', { class: 'meta' }, where ? (this.isVisible(where) ? ` · now in the ${this.paneName(where)} pane` : ' · now in a hidden pane') : ` · ${kind.hint}`))));
    }
    return h('div', { class: 'pane-empty' }, h('p', null, 'This pane is empty. Choose what to show:'), list);
  }

  /** Position every panel over its pane's body and draw the splitters. */
  reflow() {
    if (!this.root) return;
    const wasCompact = this.compact;
    const nowCompact = this.root.clientWidth > 0 && this.root.clientWidth < COMPACT_W;
    if (wasCompact !== nowCompact) { this.render(); return; }
    const base = this.root.getBoundingClientRect();
    // Measure every pane, then move the panels: measuring after each move would make the browser lay
    // the whole screen out again once per pane.
    const spots = [];
    for (const pid of this.visiblePanes()) {
      const active = this.activeFor(pid);
      if (!active) continue;
      const r = this.paneEls[pid].body.getBoundingClientRect();
      spots.push([active, pid, { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height }]);
    }
    const shown = new Set(spots.map(([id]) => id));
    for (const [id, pid, rect] of spots) this.place(id, pid, rect);
    for (const [id, inst] of this.instances) {
      if (!shown.has(id) && !inst.el.hidden) {
        inst.el.hidden = true;
        inst.api?.hide?.();
      }
    }
    if (!this.dragging) this.drawSplitters();
  }

  place(panelId, pid, rect) {
    let inst = this.instances.get(panelId);
    if (!inst) inst = this.create(panelId);
    inst.pane = this.compact ? pid : this.paneOf(panelId) || pid;
    const box = `${rect.left},${rect.top},${rect.width},${rect.height}`;
    let changed = inst.box !== box;
    if (changed) {
      inst.box = box;
      Object.assign(inst.el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
    const zoom = this.L.zoom[panelId] || 1;
    const z = zoom === 1 ? '' : String(zoom);
    if (!KINDS[inst.kind].ownZoom && inst.inner.style.zoom !== z) { inst.inner.style.zoom = z; changed = true; }
    const wasHidden = inst.el.hidden;
    inst.el.hidden = false;
    if (inst.api) {
      if (wasHidden) inst.api.show?.();
      if (changed || wasHidden) this.resizeSoon(inst);
    }
  }

  /** Panels redraw for their new size (waveforms, the pad layout) once a frame, after every panel has moved. */
  resizeSoon(inst) {
    this.toResize.add(inst);
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      const due = [...this.toResize];
      this.toResize.clear();
      for (const i of due) if (!i.el.hidden) i.api?.resize?.();
    });
  }

  create(panelId) {
    const kind = kindOf(panelId);
    const inner = h('div', { class: 'panel-inner' });
    const el = h('div', { class: 'panel', 'data-panel': panelId, 'data-kind': kind }, inner);
    this.layer.append(el);
    const inst = { id: panelId, kind, el, inner, api: null, pane: null };
    this.instances.set(panelId, inst);
    inner.append(h('div', { class: 'panel-loading' }, h('span', { class: 'spinner' })));
    KINDS[kind].load().then((mod) => {
      clear(inner);
      inst.api = mod.default({
        id: panelId,
        kind,
        el: inner,
        workspace: this,
        getState: () => this.L.panelState[panelId] || {},
        setState: (patch) => {
          this.L.panelState[panelId] = { ...(this.L.panelState[panelId] || {}), ...patch };
          this.save();
          if ('title' in patch) for (const pid of PANES) if (this.L.panes[pid].tabs.includes(panelId)) this.renderTabs(pid);
        },
      }) || {};
      if (!inst.el.hidden) { inst.api.show?.(); inst.api.resize?.(); }
    }).catch((err) => {
      console.error(err);
      mountError(inner, `This panel failed to load: ${err.message}`);
    });
    return inst;
  }

  // ---- splitters --------------------------------------------------------------------
  tracks() {
    const cs = getComputedStyle(this.grid);
    const parse = (s) => s.split(/\s+/).map(parseFloat).filter((n) => Number.isFinite(n));
    return { cols: parse(cs.gridTemplateColumns), rows: parse(cs.gridTemplateRows) };
  }

  drawSplitters() {
    clear(this.splitters);
    const L = this.L;
    if (this.compact || L.maximized || L.locked) return;
    const def = this.arrangement();
    const { cols, rows } = this.tracks();
    if (cols.length !== def.areas[0].length || rows.length !== def.areas.length) return;
    const colStart = [];
    let x = PAD;
    for (const c of cols) { colStart.push(x); x += c + GAP; }
    const rowStart = [];
    let y = PAD;
    for (const r of rows) { rowStart.push(y); y += r + GAP; }
    const vSegs = [];
    for (let i = 0; i < cols.length - 1; i++) {
      let seg = null;
      for (let r = 0; r < rows.length; r++) {
        const split = def.areas[r][i] !== def.areas[r][i + 1];
        if (split) {
          if (!seg) seg = { i, r0: r, r1: r };
          else seg.r1 = r;
        } else if (seg) { vSegs.push(seg); seg = null; }
      }
      if (seg) vSegs.push(seg);
    }
    const hSegs = [];
    for (let j = 0; j < rows.length - 1; j++) {
      let seg = null;
      for (let c = 0; c < cols.length; c++) {
        const split = def.areas[j][c] !== def.areas[j + 1][c];
        if (split) {
          if (!seg) seg = { j, c0: c, c1: c };
          else seg.c1 = c;
        } else if (seg) { hSegs.push(seg); seg = null; }
      }
      if (seg) hSegs.push(seg);
    }
    for (const s of vSegs) {
      const left = colStart[s.i] + cols[s.i];
      const top = rowStart[s.r0];
      const height = rowStart[s.r1] + rows[s.r1] - top;
      const el = h('div', { class: 'splitter is-v', style: { left: `${left - 2}px`, top: `${top}px`, width: `${GAP + 4}px`, height: `${height}px` }, title: 'Drag to resize' });
      el.addEventListener('pointerdown', (e) => this.dragLine(e, el, { col: s.i }));
      el.addEventListener('dblclick', () => this.resetSizes());
      this.splitters.append(el);
    }
    for (const s of hSegs) {
      const top = rowStart[s.j] + rows[s.j];
      const left = colStart[s.c0];
      const width = colStart[s.c1] + cols[s.c1] - left;
      const el = h('div', { class: 'splitter is-h', style: { top: `${top - 2}px`, left: `${left}px`, height: `${GAP + 4}px`, width: `${width}px` }, title: 'Drag to resize' });
      el.addEventListener('pointerdown', (e) => this.dragLine(e, el, { row: s.j }));
      el.addEventListener('dblclick', () => this.resetSizes());
      this.splitters.append(el);
    }
    // Where a vertical and a horizontal line meet, one handle moves both.
    for (const v of vSegs) {
      for (const hs of hSegs) {
        const crossesRow = v.r0 <= hs.j && v.r1 >= hs.j + 1;
        const touchesCol = hs.c0 <= v.i + 1 && hs.c1 >= v.i;
        if (!crossesRow || !touchesCol) continue;
        const cx = colStart[v.i] + cols[v.i] + GAP / 2;
        const cy = rowStart[hs.j] + rows[hs.j] + GAP / 2;
        const el = h('div', { class: 'splitter is-x', style: { left: `${cx - 9}px`, top: `${cy - 9}px` }, title: 'Drag to resize both ways' });
        el.addEventListener('pointerdown', (e) => this.dragLine(e, el, { col: v.i, row: hs.j }));
        el.addEventListener('dblclick', () => this.resetSizes());
        this.splitters.append(el);
      }
    }
  }

  dragLine(e, handle, { col, row }) {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const sz = this.arrangement().sizes;
    const { cols, rows } = this.tracks();
    const start = { x: e.clientX, y: e.clientY };
    const c0 = col != null ? { a: cols[col], b: cols[col + 1], fa: sz.cols[col], fb: sz.cols[col + 1] } : null;
    const r0 = row != null ? { a: rows[row], b: rows[row + 1], fa: sz.rows[row], fb: sz.rows[row + 1] } : null;
    document.body.classList.add('is-resizing', col != null && row != null ? 'is-resizing-both' : col != null ? 'is-resizing-col' : 'is-resizing-row');
    handle.classList.add('is-active');
    this.dragging = true;
    // Sites in panes keep their size until you let go: a big page laid out again at every step of the
    // drag is what made resizing lag. The other panels follow the line as it moves.
    const frozen = [...this.layer.querySelectorAll('iframe')].filter((f) => f.offsetWidth)
      .map((f) => { const was = [f.style.width, f.style.height]; f.style.width = `${f.offsetWidth}px`; f.style.height = `${f.offsetHeight}px`; return [f, was]; });
    // At most one update a frame, however fast the pointer reports.
    let last = null;
    let frame = 0;
    const move = (ev) => {
      last = ev;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const apply = () => {
      frame = 0;
      const ev = last;
      let dx = 0, dy = 0;
      if (c0) {
        const total = c0.a + c0.b;
        const a = clamp(c0.a + ev.clientX - start.x, MIN_W, total - MIN_W);
        const sum = c0.fa + c0.fb;
        sz.cols[col] = (sum * a) / total;
        sz.cols[col + 1] = sum - sz.cols[col];
        this.grid.style.gridTemplateColumns = sz.cols.map((f) => `minmax(0, ${f}fr)`).join(' ');
        dx = a - c0.a;
      }
      if (r0) {
        const total = r0.a + r0.b;
        const a = clamp(r0.a + ev.clientY - start.y, MIN_H, total - MIN_H);
        const sum = r0.fa + r0.fb;
        sz.rows[row] = (sum * a) / total;
        sz.rows[row + 1] = sum - sz.rows[row];
        this.grid.style.gridTemplateRows = sz.rows.map((f) => `minmax(0, ${f}fr)`).join(' ');
        dy = a - r0.a;
      }
      handle.style.transform = `translate(${dx}px, ${dy}px)`;
      this.reflow();
    };
    const up = () => {
      if (frame) { cancelAnimationFrame(frame); apply(); }
      for (const [f, [w, hgt]] of frozen) { f.style.width = w; f.style.height = hgt; }
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing', 'is-resizing-both', 'is-resizing-col', 'is-resizing-row');
      this.dragging = false;
      this.save();
      this.reflow();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  resetSizes() {
    const L = this.L;
    const { key, sizes } = this.arrangement();
    if (key.includes('/')) L.sizes[key] = { cols: sizes.cols.map(() => 1 / sizes.cols.length), rows: sizes.rows.map(() => 1 / sizes.rows.length) };
    else delete L.sizes[L.preset];
    this.save();
    this.render();
  }

  // ---- actions ------------------------------------------------------------------------
  activate(pid, panelId) {
    if (this.compact) { this.compactActive = panelId; this.renderTabs(pid); this.reflow(); return; }
    const p = this.L.panes[pid];
    if (!p.tabs.includes(panelId)) return;
    p.active = panelId;
    this.setFocused(pid);
    this.save();
    this.renderTabs(pid);
    this.reflow();
  }

  /** Show a panel kind: bring it forward where it is, or add it to a pane. */
  openKind(kind, targetPane = null) {
    if (!KINDS[kind]) return;
    const panelId = kind;
    const where = this.paneOf(panelId);
    if (where && !targetPane && !this.compact && !this.L.maximized && this.hiddenPanes().includes(where)) { this.showPane(where, panelId); return; }
    if (this.compact) {
      if (!where) this.L.panes[this.L.order[0]].tabs.push(panelId);
      this.compactActive = panelId;
      this.save();
      this.render();
      return;
    }
    if (where && !targetPane && this.isVisible(where)) { this.activate(where, panelId); this.flash(where); return; }
    const to = targetPane || this.focusedVisible();
    if (!this.shownPanes().includes(to)) this.showPane(to);
    this.movePanel(panelId, to);
    this.flash(to);
  }

  /** Show one of a pane's tabs, putting the pane back on screen if it was off. */
  showTab(pid, panelId) {
    const L = this.L;
    if (!this.shownPanes().includes(pid)) { this.showPane(pid, panelId); return; }
    if (L.maximized && L.maximized !== pid) this.toggleMax(L.maximized);
    this.activate(pid, panelId);
    this.flash(pid);
  }

  /** Open an address in the Stone Wardens tab: the screen's one place for sites, searches and links. */
  openSite(url) {
    const api = this.instances.get('wardens')?.api;
    if (api?.open) api.open(url);
    else this.L.panelState.wardens = { ...(this.L.panelState.wardens || {}), url };   // read when it loads
    this.openKind('wardens');
  }

  movePanel(panelId, toPane) {
    const L = this.L;
    if (L.locked) { toast('The layout is locked. Unlock it from the layout menu to move panels.'); return; }
    for (const p of Object.values(L.panes)) {
      const i = p.tabs.indexOf(panelId);
      if (i >= 0) {
        p.tabs.splice(i, 1);
        if (p.active === panelId) p.active = p.tabs[Math.min(i, p.tabs.length - 1)] || null;
      }
    }
    L.panes[toPane].tabs.push(panelId);
    L.panes[toPane].active = panelId;
    this.setFocused(toPane);
    this.save();
    this.render();
  }

  closePanel(panelId) {
    const L = this.L;
    if (L.locked) { toast('The layout is locked.'); return; }
    for (const p of Object.values(L.panes)) {
      const i = p.tabs.indexOf(panelId);
      if (i >= 0) {
        p.tabs.splice(i, 1);
        if (p.active === panelId) p.active = p.tabs[Math.min(i, p.tabs.length - 1)] || null;
      }
    }
    this.save();
    this.render();
  }

  swapPanes(a, b) {
    const L = this.L;
    const ia = L.order.indexOf(a);
    const ib = L.order.indexOf(b);
    [L.order[ia], L.order[ib]] = [L.order[ib], L.order[ia]];
    this.save();
    this.render();
  }

  toggleMax(pid) {
    const L = this.L;
    if (this.compact) return;
    L.maximized = L.maximized === pid ? null : pid;
    this.save();
    this.render();
  }

  /** A pane can be hidden while another of the arrangement's panes stays on screen. */
  canHide(pid) {
    const gone = this.hiddenPanes();
    return !this.compact && this.slotPanes().some((p) => p !== pid && !gone.includes(p));
  }

  /** Take a pane off the screen; its neighbours grow into its space and its tabs wait, untouched. */
  hidePane(pid) {
    const L = this.L;
    if (!this.slotPanes().includes(pid) || this.hiddenPanes().includes(pid)) return;
    if (!this.canHide(pid)) { toast('That is the only pane on screen.'); return; }
    L.hidden = [...(L.hidden || []).filter((p) => p !== pid), pid];
    L.maximized = null;
    if (this.focused === pid) this.setFocused(this.visiblePanes()[0]);
    this.save();
    this.render();
    this.hideToast?.remove();
    this.hideToastPane = pid;
    this.hideToast = toast(`Hid ${this.paneLabel(pid)}. Bring it back from the side menu or the top bar.`, { action: { label: 'Undo', run: () => this.showPane(pid) } });
  }

  /**
   * Put a hidden pane back where it was (showing panelId, if given). A pane outside a smaller
   * arrangement brings back four panes, with only the ones on screen now and this one showing.
   */
  showPane(pid, panelId = null) {
    const L = this.L;
    if (!this.slotPanes().includes(pid)) {
      const keep = new Set([...this.shownPanes(), pid]);
      L.preset = this.fourBase();
      L.hidden = PANES.filter((p) => !keep.has(p));
    } else {
      L.hidden = (L.hidden || []).filter((p) => p !== pid);
    }
    if (panelId && L.panes[pid].tabs.includes(panelId)) L.panes[pid].active = panelId;
    if (this.hideToastPane === pid) this.hideToast?.remove();
    L.maximized = null;
    this.setFocused(pid);
    this.save();
    this.render();
    this.flash(pid);
  }

  /** The rail's pane buttons: hide a pane that's on screen, show one that isn't. */
  togglePane(pid) {
    if (this.compact) return;
    if (this.shownPanes().includes(pid)) this.hidePane(pid);
    else this.showPane(pid);
  }

  showAllPanes() {
    const L = this.L;
    if (!L.hidden?.length) return;
    const back = this.hiddenPanes();
    L.hidden = [];
    L.maximized = null;
    this.save();
    this.render();
    for (const p of back) this.flash(p);
  }

  /** A pane by what it holds: "Notes", "Console · Playlists". */
  paneLabel(pid) {
    const titles = this.L.panes[pid].tabs.filter((t) => KINDS[kindOf(t)]).map((t) => this.panelTitle(t));
    return titles.length ? titles.join(' · ') : 'the empty pane';
  }

  setPreset(id) {
    const L = this.L;
    if (L.locked) { toast('The layout is locked.'); return; }
    L.preset = id;
    L.maximized = null;
    const count = new Set(PRESETS[id].areas.flat()).size;
    if (count === 4) L.four = id;
    // An arrangement shows all its panes: hidden ones make way for shown ones where there are spares.
    const hiddenBefore = L.hidden || [];
    for (const hp of L.order.slice(0, count).filter((p) => hiddenBefore.includes(p))) {
      const spare = L.order.slice(count).find((p) => !hiddenBefore.includes(p) && L.panes[p].tabs.length);
      if (!spare) break;
      const ia = L.order.indexOf(hp);
      const ib = L.order.indexOf(spare);
      [L.order[ia], L.order[ib]] = [L.order[ib], L.order[ia]];
    }
    L.hidden = [];
    // Panes that fall outside the preset keep their tabs; bring the busiest panes forward.
    const hidden = L.order.slice(count).filter((p) => L.panes[p].tabs.length);
    const emptyShown = L.order.slice(0, count).filter((p) => !L.panes[p].tabs.length);
    for (const h of hidden) {
      const e = emptyShown.shift();
      if (!e) break;
      const ia = L.order.indexOf(h);
      const ib = L.order.indexOf(e);
      [L.order[ia], L.order[ib]] = [L.order[ib], L.order[ia]];
    }
    this.save();
    this.render();
  }

  flash(pid) {
    const el = this.paneEls[pid]?.root;
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  }

  setZoom(panelId, z) {
    this.L.zoom[panelId] = z;
    if (z === 1) delete this.L.zoom[panelId];
    this.save();
    this.reflow();
  }

  beginDrag() { document.body.classList.add('is-dragging-panel'); }
  endDrag() { document.body.classList.remove('is-dragging-panel'); }

  // ---- menus ---------------------------------------------------------------------------
  addMenu(pid, anchor, opts = {}) {
    showMenu(anchor, this.addItems(pid), { minWidth: 240, ...opts });
  }

  addItems(pid) {
    const items = [{ header: 'Show in this pane' }];
    for (const k of KIND_ORDER) {
      const def = KINDS[k];
      const where = this.paneOf(k);
      items.push({
        label: def.title,
        icon: def.icon,
        hint: where === pid ? 'here' : where ? (this.isVisible(where) ? this.paneName(where) : 'hidden') : '',
        onClick: () => this.openKind(k, pid),
      });
    }
    return items;
  }

  tabMenu(pid, panelId, at) {
    const others = this.visiblePanes().filter((p) => p !== pid);
    showMenu(at, [
      { label: this.L.maximized === pid ? 'Restore the layout' : 'Maximise this pane', icon: this.L.maximized === pid ? 'restore' : 'maximize', hint: 'Alt+Enter', onClick: () => this.toggleMax(pid) },
      others.length ? { label: 'Move to', icon: 'swap', submenu: others.map((o) => ({ label: `The ${this.paneName(o)} pane`, onClick: () => this.movePanel(panelId, o) })) } : null,
      ...this.zoomItems(panelId),
      { sep: true },
      { label: 'Close this tab', icon: 'close', hint: 'middle-click', onClick: () => this.closePanel(panelId) },
    ]);
  }

  zoomItems(panelId) {
    const kind = KINDS[kindOf(panelId)];
    if (!panelId || kind.ownZoom) return [];
    const z = this.L.zoom[panelId] || 1;
    return [{
      label: 'Text size', icon: 'zoom-in', hint: `${Math.round(z * 100)}%`,
      submenu: [0.85, 0.92, 1, 1.1, 1.2, 1.35].map((v) => ({ label: `${Math.round(v * 100)}%`, checked: Math.abs(v - z) < 0.01, onClick: () => this.setZoom(panelId, v) })),
    }];
  }

  paneMenu(pid, anchor) {
    const active = this.activeFor(pid);
    const inst = active && this.instances.get(active);
    const others = this.visiblePanes().filter((p) => p !== pid);
    const extra = inst?.api?.menuItems?.() || [];
    showMenu(anchor, [
      ...extra,
      extra.length ? { sep: true } : null,
      { label: this.L.maximized === pid ? 'Restore the layout' : 'Maximise this pane', icon: this.L.maximized === pid ? 'restore' : 'maximize', hint: 'Alt+Enter', onClick: () => this.toggleMax(pid) },
      this.canHide(pid) ? { label: 'Hide this pane', icon: 'minimize', hint: 'Alt+Shift+H', onClick: () => this.hidePane(pid) } : null,
      others.length && !this.L.maximized ? { label: 'Swap with', icon: 'swap', submenu: others.map((o) => ({ label: `The ${this.paneName(o)} pane`, onClick: () => this.swapPanes(pid, o) })) } : null,
      ...(active ? this.zoomItems(active) : []),
      active ? { sep: true } : null,
      active ? { label: `Close ${this.panelTitle(active)}`, icon: 'close', onClick: () => this.closePanel(active) } : null,
    ], { align: 'end' });
  }

  layoutMenu(anchor) {
    const doc = this.doc;
    const L = this.L;
    const items = [{ header: 'Arrangement' }];
    for (const [id, p] of Object.entries(PRESETS)) {
      items.push({ label: p.label, checked: L.preset === id && !L.maximized, glyph: presetGlyph(id), onClick: () => this.setPreset(id) });
    }
    const slots = this.slotPanes();
    // panes a smaller arrangement has no room for: ticking one brings back four panes
    const spare = L.order.filter((p) => !slots.includes(p) && L.panes[p].tabs.length);
    if ((slots.length > 1 || spare.length) && !this.compact) {
      const gone = this.hiddenPanes();
      items.push({ sep: true }, { header: 'Panes on screen' });
      for (const p of slots) {
        const hidden = gone.includes(p);
        items.push({
          label: this.paneLabel(p), checked: !hidden, glyph: areaGlyph(PRESETS[L.preset].areas, LETTERS[L.order.indexOf(p)]),
          disabled: !hidden && !this.canHide(p),
          onClick: () => (hidden ? this.showPane(p) : this.hidePane(p)),
        });
      }
      for (const p of spare) items.push({ label: this.paneLabel(p), checked: false, glyph: this.paneGlyph(p), onClick: () => this.showPane(p) });
    }
    items.push({ sep: true }, { header: 'Saved layouts' });
    if (!doc.saved.length) items.push({ label: 'None saved yet', disabled: true });
    for (const s of doc.saved) items.push({ label: s.name, icon: 'layout', onClick: () => this.applySaved(s) });
    items.push(
      { label: 'Save this layout…', icon: 'plus', onClick: () => this.saveCurrent() },
      doc.saved.length ? { label: 'Delete a saved layout', icon: 'trash', submenu: doc.saved.map((s) => ({ label: s.name, onClick: () => this.deleteSaved(s) })) } : null,
      { sep: true },
      { label: L.locked ? 'Unlock the layout' : 'Lock the layout', icon: L.locked ? 'unlock' : 'lock', onClick: () => { L.locked = !L.locked; this.save(); this.render(); } },
      { label: 'Even out the pane sizes', icon: 'layout', onClick: () => this.resetSizes() },
      { label: 'Reset to the starting layout', icon: 'refresh', onClick: () => this.resetAll() },
    );
    showMenu(anchor, items, { align: 'end', minWidth: 260 });
  }

  /** The top bar's list of hidden panes. */
  hiddenMenu(anchor) {
    const L = this.L;
    const gone = this.hiddenPanes();
    showMenu(anchor, [
      { header: 'Hidden panes' },
      ...gone.map((p) => ({ label: this.paneLabel(p), icon: 'eye', glyph: areaGlyph(PRESETS[L.preset].areas, LETTERS[L.order.indexOf(p)]), onClick: () => this.showPane(p) })),
      gone.length > 1 ? { sep: true } : null,
      gone.length > 1 ? { label: 'Show every pane', icon: 'layout', hint: 'Alt+Shift+S', onClick: () => this.showAllPanes() } : null,
    ], { align: 'end', minWidth: 260 });
  }

  async saveCurrent() {
    const name = await promptDialog('Save this layout', { label: 'Name', placeholder: 'Combat, Roleplay, Prep…', okLabel: 'Save' });
    if (!name) return;
    const L = this.L;
    const snapshot = structuredClone({ preset: L.preset, sizes: L.sizes, order: L.order, panes: L.panes, zoom: L.zoom, hidden: L.hidden || [] });
    state.update('layouts', (d) => {
      d.saved = d.saved.filter((s) => s.name.toLowerCase() !== name.toLowerCase());
      d.saved.push({ id: uid('lay'), name, snapshot });
    }, { silent: true });
    toast(`Saved “${name}”. Pick it from the layout menu any time.`, { type: 'ok' });
  }

  applySaved(s) {
    const L = this.L;
    Object.assign(L, { hidden: [] }, structuredClone(s.snapshot), { maximized: null });
    this.save();
    this.render();
  }

  async deleteSaved(s) {
    if (!(await confirmDialog(`Delete the saved layout “${s.name}”?`, { okLabel: 'Delete', danger: true }))) return;
    state.update('layouts', (d) => { d.saved = d.saved.filter((x) => x.id !== s.id); }, { silent: true });
  }

  async resetAll() {
    if (!(await confirmDialog('Put the panes back the way they started? Saved layouts stay.', { okLabel: 'Reset' }))) return;
    const d = this.doc;
    const fresh = defaultLayout().current;
    fresh.panelState = d.current.panelState;
    d.current = fresh;
    this.save();
    this.render();
  }
}

function mountError(el, message) {
  clear(el);
  el.append(h('div', { class: 'empty' }, h('strong', null, 'Something went wrong'), h('span', null, message)));
}

export const workspace = new Workspace();
