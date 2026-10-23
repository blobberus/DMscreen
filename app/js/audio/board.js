// The soundboard's data and behaviour, independent of any pane: banks of pads keyed by the key that
// fires them. The board is the keyboard itself: number row for playlists, letters for pads,
// punctuation for the transport (whatever the keymap says each key does).
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { keys } from '../core/keys.js';
import { uid } from '../core/util.js';
import { engine } from './engine.js';
import { library } from '../core/library.js';
import { SITE } from '../core/mode.js';
import { folderName } from '../core/site.js';

// Rows as on a real keyboard; offsets are in quarter-keys from the "1" key.
export const ROWS = [
  { keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], offset: 0, number: true },
  { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'], offset: 2 },
  { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"], offset: 3 },
  { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'], offset: 5 },
];
export const GRID_UNITS = 50;

// The whole keyboard when the pane is wide; just the letter block when it isn't (the number row and the
// punctuation keys still work, and the board lists what they do underneath).
export const BOARD_LAYOUTS = {
  full: { units: GRID_UNITS, rows: ROWS, minWidth: 900 },
  letters: {
    units: 40,
    rows: [
      { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], offset: 0 },
      { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], offset: 1 },
      { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'], offset: 3 },
    ],
  },
};

export const PIGMENTS = ['rubric', 'vermilion', 'orpiment', 'ochre', 'malachite', 'verdigris', 'lapis', 'murrey', 'umber'];

// The order new sounds take free keys in: the letter rows, left to right, top to bottom.
const FILL_ORDER = ROWS.slice(1).flatMap((r) => r.keys).filter((k) => /^[A-Z]$/.test(k));

export const MODES = {
  once: { label: 'Play once', hint: 'Pressing again starts it over' },
  overlap: { label: 'Overlap', hint: 'Every press adds another copy' },
  toggle: { label: 'Toggle loop', hint: 'Press to start looping, press again to stop' },
};

export const board = {
  doc: () => state.get('boards'),
  banks() { return this.doc().banks; },
  active() {
    const d = this.doc();
    return d.banks.find((b) => b.id === d.active) || d.banks[0];
  },
  setActive(id) {
    state.update('boards', (d) => { d.active = id; });
    engine.preload(Object.values(this.active().pads).map((p) => p.sound));
    bus.emit('board:bank', this.active());
  },
  cycle(dir) {
    const banks = this.banks();
    const i = banks.findIndex((b) => b.id === this.active().id);
    const next = banks[(i + dir + banks.length) % banks.length];
    this.setActive(next.id);
    bus.emit('toast', { message: `Pad bank: ${next.name}` });
  },
  addBank(name) {
    const bank = { id: uid('bank'), name, pads: {} };
    state.update('boards', (d) => { d.banks.push(bank); d.active = bank.id; });
    return bank;
  },
  renameBank(id, name) {
    state.update('boards', (d) => { const b = d.banks.find((x) => x.id === id); if (b) b.name = name; });
  },
  removeBank(id) {
    state.update('boards', (d) => {
      d.banks = d.banks.filter((b) => b.id !== id);
      if (!d.banks.length) d.banks.push({ id: uid('bank'), name: 'Effects', pads: {} });
      if (!d.banks.some((b) => b.id === d.active)) d.active = d.banks[0].id;
    });
  },
  /** The action a key already does, if any (then it can't hold a pad). */
  reserved(key) {
    return keys.actionFor(`Alt+${key}`);
  },
  pad(key, bank = this.active()) { return bank.pads[key] || null; },
  setPad(key, pad, bank = this.active()) {
    state.update('boards', () => { bank.pads[key] = { ...(bank.pads[key] || {}), ...pad }; });
    engine.preload([pad.sound]);
  },
  clearPad(key, bank = this.active()) {
    state.update('boards', () => { delete bank.pads[key]; });
  },
  movePad(fromKey, toKey, bank = this.active()) {
    state.update('boards', () => {
      const a = bank.pads[fromKey];
      const b = bank.pads[toKey];
      if (a) bank.pads[toKey] = a; else delete bank.pads[toKey];
      if (b) bank.pads[fromKey] = b; else delete bank.pads[fromKey];
    });
  },
  voiceKey(key, bank = this.active()) { return `${bank.id}:${key}`; },
  fire(key, bank = this.active()) {
    const pad = bank.pads[key];
    if (!pad || !library.has(pad.sound)) return false;
    engine.firePad(this.voiceKey(key, bank), pad);
    bus.emit('pad:fired', { key, pad, bank });
    return true;
  },
  /**
   * Website: one bank per folder in sounds/Effects. A sound new to its folder takes the next free letter;
   * once placed it is remembered (seen), so clearing or moving its pad sticks.
   */
  reconcile() {
    if (!SITE) return;
    const before = JSON.stringify(this.doc());
    const groups = library.groups('effect');
    const sounds = library.list();
    const d = structuredClone(this.doc());
    const byDir = new Map(d.banks.filter((b) => b.dir).map((b) => [b.dir, b]));
    const banks = (groups.length ? groups : ['Effects']).map((dir) => {
      const b = byDir.get(dir) || { id: dir, dir, pads: {}, seen: [] };
      b.id = dir;
      b.name = folderName(dir);
      b.seen = (b.seen || []).filter((id) => library.has(id));
      for (const [k, p] of Object.entries(b.pads || {})) if (!p || !library.has(p.sound)) delete b.pads[k];
      for (const s of sounds) {
        if (s.group !== dir || b.seen.includes(s.id)) continue;
        const key = FILL_ORDER.find((k) => !b.pads[k] && !this.reserved(k));
        if (!key) break;
        b.pads[key] = { sound: s.id, mode: s.repeat === 0 ? 'toggle' : 'once', volume: 1 };
        b.seen.push(s.id);
      }
      return b;
    });
    d.banks = banks;
    if (!banks.some((b) => b.id === d.active)) d.active = banks[0].id;
    if (JSON.stringify(d) !== before) state.set('boards', d);
  },
  /** Live state of a pad for drawing: {playing, progress}. */
  live(key, bank = this.active()) {
    const set = engine.padVoices(this.voiceKey(key, bank));
    if (!set || !set.size) return { playing: false, progress: 0 };
    let best = 0;
    for (const v of set) best = Math.max(best, v.state === 'playing' ? v.progress : 0);
    return { playing: true, progress: best };
  },
};

keys.onPad((key) => board.fire(key));
keys.on('bank.prev', () => board.cycle(-1));
keys.on('bank.next', () => board.cycle(1));
keys.on('effects.stop', () => engine.stopEffects());

bus.on('library', () => board.reconcile());
bus.on('site:docs', () => board.reconcile());

// Forget pads whose sound was deleted.
bus.on('library:removed', (id) => {
  state.update('boards', (d) => {
    for (const b of d.banks) for (const [k, p] of Object.entries(b.pads)) if (p.sound === id) delete b.pads[k];
  });
});
