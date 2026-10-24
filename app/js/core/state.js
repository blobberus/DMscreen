// The screen's saved documents (settings, layout, playlists, boards, bookmarks, keymap), kept on the
// server under data/state/. Edits apply at once, emit `state:<name>`, and save after a short pause.
// On the website they go to site.js instead (this browser, and the repo's screen/setup.json).
import { api } from './api.js';
import { bus } from './bus.js';
import { SITE } from './mode.js';
import * as site from './site.js';

export const DEFAULTS = {
  settings: {
    theme: 'dark',
    singleKeys: true,          // when not typing, keys work without Alt
    returnFocus: true,         // leaving a site pane gives the keyboard back to the screen
    sites: {
      wardens: 'https://blobberus.github.io/Stone-Wardens/',
    },
    search: 'google',
    levels: { master: 0.9, music: 0.75, ambience: 0.65, effects: 0.9 },
    duckAmount: 0.3,
    crossfade: 3,
    fadeAll: 3,
    railOpen: false,           // the side rail shows pane names and their tabs
    previewOutput: null,       // {id, label}: previews play on this device (headphones) instead of the main output
    previewLevel: 0.95,
  },
  layouts: null,               // filled by the workspace
  playlists: { list: [] },
  boards: { banks: [{ id: 'bank_main', name: 'Effects', pads: {} }], active: 'bank_main' },
  bookmarks: {
    list: [
      { name: 'Google', url: 'https://www.google.com/webhp?igu=1' },
      { name: '5e.tools', url: 'https://5e.tools/' },
      { name: '5e.tools spells', url: 'https://5e.tools/spells.html' },
      { name: '5e.tools bestiary', url: 'https://5e.tools/bestiary.html' },
      { name: 'D&D Beyond', url: 'https://www.dndbeyond.com/' },
      { name: 'Open5e', url: 'https://open5e.com/' },
      { name: '5e SRD', url: 'https://www.5esrd.com/' },
      { name: 'AideDD spells', url: 'https://www.aidedd.org/dnd-filters/spells-5e.php' },
      { name: 'Donjon generators', url: 'https://donjon.bin.sh/5e/' },
    ],
  },
  keymap: {},
};

export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?igu=1&q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
};

function isPlain(o) { return o && typeof o === 'object' && !Array.isArray(o); }

function merge(base, over) {
  if (over === undefined || over === null) return structuredClone(base);
  if (!isPlain(base) || !isPlain(over)) return structuredClone(over);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) out[k] = isPlain(out[k]) && isPlain(v) ? merge(out[k], v) : structuredClone(v);
  return out;
}

const docs = {};
const timers = {};
let failing = false;

async function save(name) {
  clearTimeout(timers[name]);
  timers[name] = null;
  if (SITE) { site.saveDoc(name, docs[name]); return; }
  try {
    await api.put(`/api/state/${name}`, docs[name]);
    if (failing) { failing = false; bus.emit('state:saved', { ok: true }); }
  } catch (e) {
    failing = true;
    bus.emit('state:saved', { ok: false, error: e.message });
    timers[name] = setTimeout(() => save(name), 5000);
  }
}

export const state = {
  async load() {
    const all = SITE ? site.loadDocs() : await api.get('/api/state');
    for (const name of Object.keys(DEFAULTS)) {
      docs[name] = DEFAULTS[name] === null ? all[name] ?? null : merge(DEFAULTS[name], all[name]);
    }
  },
  get(name) { return docs[name]; },
  /** Replace a document. With {save: false} it only takes a copy that came from elsewhere. */
  set(name, value, { silent = false, save: keep = true } = {}) {
    docs[name] = value;
    if (!silent) bus.emit(`state:${name}`, value);
    if (keep) this.schedule(name);
  },
  /** Change a document in place: state.update('settings', (s) => { s.theme = 'light'; }). */
  update(name, fn, { silent = false } = {}) {
    fn(docs[name]);
    if (!silent) bus.emit(`state:${name}`, docs[name]);
    this.schedule(name);
  },
  schedule(name, ms = 500) {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(() => save(name), ms);
  },
  /** Save everything still waiting, now (the website does this before it commits a rename). */
  saveNow() {
    for (const [name, t] of Object.entries(timers)) if (t) save(name);
  },
  /** Send anything still waiting (page closing). */
  flush() {
    if (SITE) { this.saveNow(); site.sync(); return; }
    for (const [name, t] of Object.entries(timers)) {
      if (!t) continue;
      clearTimeout(t);
      const blob = new Blob([JSON.stringify(docs[name])], { type: 'application/json' });
      navigator.sendBeacon(`/api/state/${name}`, blob);
    }
  },
};

window.addEventListener('pagehide', () => state.flush());

// The website's setup changed under us (a rename, or a save from another device): take the new copy.
bus.on('site:docs', (all) => {
  for (const name of ['playlists', 'boards', 'keymap', 'bookmarks']) {
    clearTimeout(timers[name]);
    timers[name] = null;
    const next = merge(DEFAULTS[name], all[name]);
    // keep the tracks we already know until the playlists are matched to the folders again
    if (name === 'playlists') for (const pl of next.list) pl.tracks = docs.playlists?.list.find((p) => p.id === pl.id)?.tracks || pl.tracks || [];
    docs[name] = next;
    bus.emit(`state:${name}`, docs[name]);
  }
});
