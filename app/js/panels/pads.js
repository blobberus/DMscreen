// Soundboard: the keyboard is the board. Number keys start playlists, letters fire pads, punctuation
// runs the transport, all exactly where they sit on your keyboard. Drop a sound on a key to make a pad;
// right-click (or turn on Edit) to change it.
// On the website each bank is a folder in sounds/Effects; its sounds take free letters by themselves.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { keys } from '../core/keys.js';
import { kbd } from '../core/kbd.js';
import { library } from '../core/library.js';
import { openDialog, pickSound, promptDialog, confirmDialog, showMenu, toast } from '../core/ui.js';
import { fmtTime } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { board, BOARD_LAYOUTS, PIGMENTS, MODES } from '../audio/board.js';
import { playlists } from '../audio/playlists.js';
import { SITE } from '../core/mode.js';
import { newFolder, renameFolder, folderItems, addButton, folderLabel } from '../dialogs/files.js';

const SHORT = {
  'music.toggle': 'Play / pause', 'music.prev': 'Previous track', 'music.next': 'Next track',
  'flag.prev': 'Previous flag', 'flag.next': 'Next flag', 'music.down': 'Music quieter', 'music.up': 'Music louder',
  duck: 'Duck', 'fade.all': 'Fade all', 'effects.stop': 'Stop effects', help: 'Shortcuts', 'pane.max': 'Maximise',
  'bank.prev': 'Previous bank', 'bank.next': 'Next bank',
};

export default function createPads({ el }) {
  let editing = false;
  const banksEl = h('div', { class: 'tabs pd-banks', role: 'tablist' });
  const editBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false', title: 'Click pads to change them instead of playing them', onclick: () => { editing = !editing; editBtn.setAttribute('aria-pressed', String(editing)); root.classList.toggle('is-editing', editing); } }, icon('edit'), 'Edit pads');
  const stopBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Stop all effects', onclick: () => engine.stopEffects() }, icon('stop'), 'Stop effects', kbd(keys.combo('effects.stop')));
  const boardEl = h('div', { class: 'pd-board' });
  const legend = h('div', { class: 'pd-legend' });
  const HINT = 'Alt plus a key fires its pad from anywhere, or the key alone when you are not typing. Drop a sound from the library onto a key to make a pad; right-click a pad to change it.';
  const hint = h('p', { class: 'pd-hint' }, HINT);
  /** Website: say which folder fills this bank, with its Add button. */
  function renderHint(bank) {
    if (!SITE || !bank.dir) return;
    clear(hint);
    const n = Object.keys(bank.pads).length;
    hint.append(
      h('span', null, n
        ? `Sounds in ${folderLabel(bank.dir)} take free letters by themselves. Alt plus a key fires its pad from anywhere; hold or right-click a pad to change it.`
        : `This bank plays the sounds in ${folderLabel(bank.dir)} on GitHub, and it's empty. Each sound you add takes the next free letter.`),
      ' ', addButton(bank.dir, 'Add sounds'));
  }
  const root = h('div', { class: 'pd' }, h('div', { class: 'pd-bar' }, banksEl, h('span', { class: 'pd-spacer' }), editBtn, stopBtn), boardEl, legend, hint);
  let layoutName = null;
  const pickLayout = () => ((root.clientWidth || 1000) >= BOARD_LAYOUTS.full.minWidth ? 'full' : 'letters');
  el.append(root);
  const padEls = new Map();

  // ---- banks -------------------------------------------------------------------
  function renderBanks() {
    clear(banksEl);
    const active = board.active();
    for (const b of board.banks()) {
      const count = Object.keys(b.pads).length;
      banksEl.append(h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(b.id === active.id), title: 'Double-click to rename. Alt+Up and Alt+Down switch banks.',
        onclick: () => board.setActive(b.id),
        ondblclick: () => rename(b),
        oncontextmenu: (e) => { e.preventDefault(); bankMenu(b, { x: e.clientX, y: e.clientY }); },
      }, b.name, h('span', { class: 'count' }, String(count))));
    }
    banksEl.append(h('button', { class: 'btn-icon btn-sm pd-addbank', type: 'button', title: SITE ? 'New bank of pads (a folder in sounds/Effects)' : 'New bank of pads', 'aria-label': 'New bank of pads', onclick: async () => {
      if (SITE) { const dir = await newFolder('Effects'); if (dir) { await library.load(); board.setActive(dir); } return; }
      const name = await promptDialog('New bank of pads', { label: 'Name', placeholder: 'Combat, Weather, Creatures…', okLabel: 'Create' });
      if (name) board.addBank(name);
    } }, icon('plus')));
  }
  async function rename(b) {
    if (SITE) { if (b.dir?.includes('/')) renameFolder(b.dir); return; }
    const name = await promptDialog('Rename this bank', { label: 'Name', value: b.name, okLabel: 'Rename' });
    if (name) board.renameBank(b.id, name);
  }
  function bankMenu(b, at) {
    if (SITE) { showMenu(at, folderItems(b.dir || 'Effects')); return; }
    showMenu(at, [
      { label: 'Rename', icon: 'edit', onClick: () => rename(b) },
      { label: 'Delete this bank', icon: 'trash', onClick: async () => {
        if (await confirmDialog(`Delete the bank “${b.name}” and its ${Object.keys(b.pads).length} pads? The sounds stay in the library.`, { okLabel: 'Delete', danger: true })) board.removeBank(b.id);
      } },
    ]);
  }

  // ---- the board -------------------------------------------------------------------
  function renderBoard() {
    clear(boardEl);
    padEls.clear();
    const bank = board.active();
    layoutName = pickLayout();
    const L = BOARD_LAYOUTS[layoutName];
    boardEl.dataset.layout = layoutName;
    boardEl.style.gridTemplateColumns = `repeat(${L.units}, minmax(0, 1fr))`;
    boardEl.style.gridTemplateRows = L.rows.map((r) => (r.number ? 'minmax(34px, 0.6fr)' : 'minmax(52px, 1fr)')).join(' ');
    L.rows.forEach((row, r) => {
      row.keys.forEach((key, i) => {
        const col = row.offset + i * 4 + 1;
        const cell = row.number ? numberKey(key) : letterKey(key, bank);
        cell.style.gridRow = String(r + 1);
        cell.style.gridColumn = `${col} / span 4`;
        boardEl.append(cell);
      });
    });
    renderLegend(L);
    renderHint(bank);
    tick();
  }

  /** In the letters-only board, say what the keys that aren't drawn do. */
  function renderLegend(L) {
    clear(legend);
    if (layoutName === 'full') { legend.hidden = true; return; }
    legend.hidden = false;
    const shown = new Set(L.rows.flatMap((r) => r.keys));
    const items = [];
    const lists = playlists.list().filter((p) => p.key).sort((a, b) => a.key - b.key);
    if (lists.length) items.push(h('span', { class: 'pd-leg' }, h('kbd', { class: 'kbd' }, `${lists[0].key}–${lists[lists.length - 1].key}`), lists.map((p) => p.name).join(', ')));
    for (const key of ['0', '-', '=', '[', ']', ',', '.', '/']) {
      if (shown.has(key)) continue;
      const a = board.reserved(key);
      if (a) items.push(h('button', { class: 'pd-leg', type: 'button', title: a.label, onclick: () => a.run?.() }, h('kbd', { class: 'kbd' }, key), SHORT[a.id] || a.label));
    }
    legend.append(...items);
  }

  function numberKey(key) {
    const action = board.reserved(key);
    const n = Number(key);
    if (action && action.id.startsWith('playlist.')) {
      const pl = playlists.byKey(Number(action.id.split('.')[1]));
      const playing = pl && playlists.playing(pl);
      return h('button', {
        class: `pd-key is-number ${pl ? '' : 'is-blank'} ${playing ? 'is-selected' : ''}`, type: 'button',
        title: pl ? `Start ${pl.name}` : `No playlist on ${key} yet`,
        onclick: () => pl ? playlists.play(pl.id) : toast(`Give a playlist the key ${key} in the Playlists pane.`),
      }, h('span', { class: 'pd-cap' }, key), h('span', { class: 'pd-label' }, pl ? pl.name : '–'));
    }
    if (action) return actionKey(key, action, true);
    return h('div', { class: 'pd-key is-number is-blank' }, h('span', { class: 'pd-cap' }, key), Number.isNaN(n) ? null : h('span', { class: 'pd-label' }, '–'));
  }

  function actionKey(key, action, number = false) {
    return h('button', { class: `pd-key is-action ${number ? 'is-number' : ''}`, type: 'button', title: action.label, onclick: () => action.run?.() },
      h('span', { class: 'pd-cap' }, key), h('span', { class: 'pd-label' }, SHORT[action.id] || action.label));
  }

  function letterKey(key, bank) {
    const action = board.reserved(key);
    if (action) return actionKey(key, action);
    const pad = bank.pads[key];
    const s = pad && library.get(pad.sound);
    const progress = h('i', { class: 'pd-progress' });
    const btn = h('button', {
      class: `pd-key is-pad ${s ? '' : 'is-empty'}`, type: 'button', 'data-key': key,
      style: pad?.color ? { '--pad-edge': `var(--pig-${pad.color})` } : null,
      title: s ? `${pad.label || s.name} (Alt+${key}) · ${MODES[pad.mode || 'once'].label}` : `Empty: drop a sound here, or click to choose one (Alt+${key})`,
      draggable: !!s,
      onclick: () => { if (editing || !s) editPad(key); else board.fire(key); },
      oncontextmenu: (e) => { e.preventDefault(); editPad(key); },
      ondragstart: (e) => { e.dataTransfer.setData('application/x-dm-pad', key); e.dataTransfer.effectAllowed = 'move'; },
    },
    h('span', { class: 'pd-cap' }, key),
    s ? h('span', { class: `pd-label ${longWord(pad.label || s.name)}` }, pad.label || s.name) : null,
    s ? modeGlyph(pad.mode) : null,
    progress);
    btn.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('application/x-dm-sound') || t.includes('application/x-dm-pad')) { e.preventDefault(); btn.classList.add('is-over'); }
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('is-over'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('is-over');
      const sid = e.dataTransfer.getData('application/x-dm-sound');
      const from = e.dataTransfer.getData('application/x-dm-pad');
      if (sid && library.has(sid)) {
        const snd = library.get(sid);
        board.setPad(key, { sound: sid, label: SITE ? null : snd.name, mode: snd.repeat === 0 ? 'toggle' : 'once', from: null, toNextFlag: false, volume: 1 });
        toast(`${snd.name} is on ${key}. Alt+${key} fires it.`, { type: 'ok' });
      } else if (from && from !== key) {
        board.movePad(from, key);
      }
    });
    padEls.set(key, { btn, progress });
    return btn;
  }

  /** A label whose longest word won't fit a key sets a size smaller instead of breaking the word. */
  function longWord(text) {
    const n = Math.max(...String(text).split(/\s+/).map((w) => w.length));
    return n >= 10 ? 'is-longer' : n >= 7 ? 'is-long' : '';
  }

  function modeGlyph(mode) {
    if (mode === 'toggle') return h('span', { class: 'pd-mode', title: 'Toggle loop' }, icon('loop', 'icon-sm'));
    if (mode === 'overlap') return h('span', { class: 'pd-mode', title: 'Overlap' }, icon('layers', 'icon-sm'));
    return null;
  }

  function tick() {
    const bank = board.active();
    for (const [key, { btn, progress }] of padEls) {
      const live = board.live(key, bank);
      btn.classList.toggle('is-playing', live.playing);
      progress.style.width = live.playing ? `${(live.progress * 100).toFixed(1)}%` : '0';
    }
  }

  // ---- the pad editor -------------------------------------------------------------
  function editPad(key) {
    const bank = board.active();
    const current = () => bank.pads[key] || null;
    const body = h('div', { class: 'pd-edit' });
    const dialog = openDialog({
      title: `Pad ${key}`,
      body,
      actions: [
        { label: 'Clear this pad', kind: 'danger', onClick: () => { board.clearPad(key); } },
        { label: 'Done', kind: 'primary' },
      ],
      onClose: () => renderBoard(),
    });
    function draw() {
      clear(body);
      const pad = current();
      const s = pad && library.get(pad.sound);
      const soundBtn = h('button', { class: 'btn pd-soundbtn', type: 'button', onclick: async () => {
        const id = await pickSound({ library, title: `A sound for ${key}`, kind: 'effect' });
        if (!id) return;
        const snd = library.get(id);
        board.setPad(key, { sound: id, label: pad?.label && s && pad.label !== s.name ? pad.label : snd.name, mode: pad?.mode || (snd.repeat === 0 ? 'toggle' : 'once'), from: null, toNextFlag: false });
        draw();
      } }, icon('wave'), h('span', { class: 'truncate' }, s ? s.name : 'Choose a sound'));
      body.append(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Sound'), h('div', { class: 'pd-soundrow' }, soundBtn,
        s ? h('button', { class: 'btn', type: 'button', onclick: () => board.fire(key) }, icon('play'), 'Try it') : null)));
      if (!s) {
        body.append(h('p', { class: 'muted' }, 'Pick a sound from the library, or close this and drag one onto the key.'));
        return;
      }
      const label = h('input', { class: 'input', value: pad.label || s.name, maxlength: 40 });
      label.addEventListener('input', () => board.setPad(key, { label: label.value.trim() || s.name }));
      body.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Label'), label));

      const seg = h('div', { class: 'seg' });
      const modeHint = h('span', { class: 'field-hint' }, MODES[pad.mode || 'once'].hint);
      for (const [m, def] of Object.entries(MODES)) {
        seg.append(h('button', { type: 'button', 'aria-pressed': String((pad.mode || 'once') === m), onclick: () => { board.setPad(key, { mode: m }); draw(); } }, def.label));
      }
      body.append(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'When pressed'), seg, modeHint));

      const flags = s.flags || [];
      const [from0, to0] = library.region(s);
      const startSel = h('select', { class: 'select' },
        h('option', { value: '' }, `From the start (${fmtTime(from0)})`),
        flags.map((f) => h('option', { value: String(f.t), selected: pad.from === f.t }, `From the flag “${f.label}” (${fmtTime(f.t)})`)));
      startSel.addEventListener('change', () => board.setPad(key, { from: startSel.value === '' ? null : Number(startSel.value) }));
      const endSel = h('select', { class: 'select', disabled: !flags.length },
        h('option', { value: 'end' }, `To the end (${fmtTime(to0)})`),
        h('option', { value: 'flag', selected: !!pad.toNextFlag }, 'To the next flag'));
      endSel.addEventListener('change', () => board.setPad(key, { toNextFlag: endSel.value === 'flag' }));
      body.append(h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Start'), startSel),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Stop'), endSel)));
      if (!flags.length) body.append(h('p', { class: 'field-hint' }, 'Add flags to this sound in the Sound library to start pads part-way through, or to cut one long recording into many pads.'));

      const vol = h('input', { class: 'range', type: 'range', min: 0, max: 150, step: 1, value: Math.round((pad.volume ?? 1) * 100) });
      const volNum = h('span', { class: 'num pd-volnum' }, `${vol.value}%`);
      const syncVol = () => { vol.style.setProperty('--fill', `${(vol.value / 150) * 100}%`); volNum.textContent = `${vol.value}%`; };
      vol.addEventListener('input', () => { board.setPad(key, { volume: vol.value / 100 }); syncVol(); });
      syncVol();
      body.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Pad volume'), h('div', { class: 'pd-volrow' }, vol, volNum)));

      const swatches = h('div', { class: 'pd-swatches', role: 'radiogroup', 'aria-label': 'Edge colour' });
      swatches.append(h('button', { class: `pd-swatch is-none ${!pad.color ? 'is-on' : ''}`, type: 'button', title: 'No colour', 'aria-label': 'No colour', onclick: () => { board.setPad(key, { color: null }); draw(); } }));
      for (const p of PIGMENTS) {
        swatches.append(h('button', { class: `pd-swatch ${pad.color === p ? 'is-on' : ''}`, type: 'button', title: p, 'aria-label': p, style: { background: `var(--pig-${p})` }, onclick: () => { board.setPad(key, { color: p }); draw(); } }));
      }
      body.append(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Edge colour'), swatches, h('span', { class: 'field-hint' }, 'A thin mark on the pad’s left edge, to group pads by kind.')));
    }
    draw();
    return dialog;
  }

  let lastList = null;
  renderBanks();
  renderBoard();
  const offs = [
    bus.on('state:boards', () => { renderBanks(); renderBoard(); }),
    bus.on('board:bank', () => { renderBanks(); renderBoard(); }),
    bus.on('state:playlists', renderBoard),
    bus.on('state:keymap', renderBoard),
    bus.on('library', renderBoard),
    bus.on('audio', () => {
      const playingList = [engine.music, engine.ambience].map((d) => (d.voice ? d.playlistId : '')).join('|');
      if (playingList !== lastList) { lastList = playingList; renderBoard(); } else tick();
    }),
    bus.on('audio:tick', tick),
    bus.on('playlist:started', renderBoard),
    bus.on('pad:fired', ({ key }) => {
      const p = padEls.get(key);
      if (!p) return;
      p.btn.classList.remove('is-hit');
      void p.btn.offsetWidth;
      p.btn.classList.add('is-hit');
    }),
  ];
  return {
    show() { renderBoard(); engine.preload(Object.values(board.active().pads).map((p) => p.sound)); },
    resize() { if (pickLayout() !== layoutName) renderBoard(); },
    destroy() { offs.forEach((off) => off()); },
  };
}
