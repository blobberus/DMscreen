// Playlists: music for a scene plus the ambience that goes with it, on a number key (Alt+1 to 9).
// Ambience playlists (kind 'ambience') play on their own deck, so they run under any music.
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { uid } from '../core/util.js';
import { library } from '../core/library.js';
import { engine } from './engine.js';
import { SITE } from '../core/mode.js';
import { folderName } from '../core/site.js';

export const REPEAT = { off: 'Play through once', all: 'Repeat the playlist', one: 'Repeat the track' };

export const playlists = {
  list: () => state.get('playlists').list,
  /** The music playlists, or with 'ambience' the ambience playlists. */
  ofKind: (kind) => state.get('playlists').list.filter((p) => (p.kind === 'ambience') === (kind === 'ambience')),
  get: (id) => state.get('playlists').list.find((p) => p.id === id) || null,
  byKey: (n) => state.get('playlists').list.find((p) => p.key === n) || null,
  freeKey() {
    const used = new Set(this.list().map((p) => p.key).filter(Boolean));
    for (let n = 1; n <= 9; n++) if (!used.has(n)) return n;
    return null;
  },
  create(name = 'New playlist', kind = 'music') {
    const pl = { id: uid('pl'), name, key: this.freeKey(), tracks: [], ambience: [], shuffle: false, repeat: 'all', crossfade: state.get('settings').crossfade };
    if (kind === 'ambience') pl.kind = 'ambience';
    state.update('playlists', (d) => { d.list.push(pl); });
    return pl;
  },
  update(id, patch) {
    state.update('playlists', (d) => {
      const pl = d.list.find((p) => p.id === id);
      if (!pl) return;
      if (patch.key) for (const other of d.list) if (other.id !== id && other.key === patch.key) other.key = null;
      Object.assign(pl, patch);
    });
  },
  remove(id) {
    for (const deck of [engine.music, engine.ambience]) if (deck.playlistId === id) deck.playlistId = null;
    state.update('playlists', (d) => {
      d.list = d.list.filter((p) => p.id !== id);
      for (const p of d.list) if (p.withAmbience === id) p.withAmbience = null;
    });
  },
  /** Is it playing on its deck? */
  playing(pl) {
    const deck = engine.deckFor(pl);
    return !!pl && deck.playlistId === pl.id && !!deck.voice;
  },
  /** The ambience playlist that starts with a music playlist: the one chosen, or else the one with its name. */
  ambienceFor(pl) {
    if (!pl || pl.kind === 'ambience') return null;
    if (pl.withAmbience !== undefined) {
      const chosen = pl.withAmbience && this.get(pl.withAmbience);
      return chosen?.kind === 'ambience' ? chosen : null;
    }
    const name = pl.name.trim().toLowerCase();
    return this.ofKind('ambience').find((a) => a.name.trim().toLowerCase() === name) || null;
  },
  move(id, toIndex) {
    state.update('playlists', (d) => {
      const i = d.list.findIndex((p) => p.id === id);
      if (i < 0) return;
      const [pl] = d.list.splice(i, 1);
      d.list.splice(Math.max(0, Math.min(toIndex, d.list.length)), 0, pl);
    });
  },
  addTracks(id, ids, at = null) {
    state.update('playlists', (d) => {
      const pl = d.list.find((p) => p.id === id);
      if (!pl) return;
      const fresh = ids.filter((x) => library.has(x));
      if (at == null) pl.tracks.push(...fresh); else pl.tracks.splice(at, 0, ...fresh);
    });
  },
  addAmbience(id, ids) {
    state.update('playlists', (d) => {
      const pl = d.list.find((p) => p.id === id);
      if (!pl) return;
      for (const sid of ids) if (!pl.ambience.some((a) => a.id === sid)) pl.ambience.push({ id: sid, volume: 0.8 });
    });
  },
  duration(pl) {
    return pl.tracks.reduce((sum, id) => {
      const s = library.get(id);
      if (!s) return sum;
      const [a, b] = library.region(s);
      return sum + (b - a);
    }, 0);
  },
  /**
   * Website: one playlist per folder in sounds/Music, and one ambience playlist per folder in
   * sounds/Ambience, their tracks the files in them (in file-name order). A music playlist starts the
   * ambience playlist of the same name. Number keys go to the playlists in folder order, music first,
   * until you change them.
   */
  reconcile() {
    if (!SITE) return;
    const before = JSON.stringify(state.get('playlists'));
    const sounds = library.list();
    const d = structuredClone(state.get('playlists'));
    const byDir = new Map(d.list.filter((p) => p.dir).map((p) => [p.dir, p]));
    const make = (dir, kind) => {
      const pl = byDir.get(dir) || { id: dir, dir, ambience: [], shuffle: false, repeat: 'all', crossfade: state.get('settings').crossfade };
      pl.id = dir;
      pl.name = folderName(dir);
      if (kind === 'ambience') pl.kind = 'ambience'; else delete pl.kind;
      pl.tracks = sounds.filter((s) => s.group === dir).map((s) => s.id);
      // the layers that once joined by themselves (from the ambience folder of the same name) now come
      // as that folder's ambience playlist, so they would play twice
      const auto = new Set(pl.seenAmbience || []);
      pl.ambience = kind === 'ambience' ? [] : (pl.ambience || []).filter((a) => library.has(a.id) && !auto.has(a.id));
      delete pl.seenAmbience;
      return pl;
    };
    d.list = [...library.groups('music').map((dir) => make(dir, 'music')), ...library.groups('ambience').map((dir) => make(dir, 'ambience'))];
    const used = new Set(d.list.map((p) => p.key).filter(Boolean));
    for (const pl of d.list) {
      if (pl.key !== undefined) continue;     // null means "no key", chosen on purpose
      let n = 1;
      while (n <= 9 && used.has(n)) n++;
      pl.key = n <= 9 ? n : null;
      if (pl.key) used.add(pl.key);
    }
    if (JSON.stringify(d) !== before) state.set('playlists', d);
  },
  play(id, opts) {
    const pl = this.get(id);
    if (!pl) return;
    const amb = this.ambienceFor(pl);
    if (!pl.tracks.length && !pl.ambience.length && !amb?.tracks.length) {
      bus.emit('toast', { message: pl.kind === 'ambience'
        ? `“${pl.name}” is empty. ${SITE ? 'Add sounds to its folder in sounds/Ambience on GitHub.' : 'Add ambience to it in the Playlists pane.'}`
        : `“${pl.name}” is empty. Add music or ambience in the Playlists pane.` });
      return;
    }
    // its ambience playlist starts with it, unless that is already playing
    if (amb?.tracks.length && !this.playing(amb)) engine.playPlaylist(amb, { fade: Math.max(1.5, pl.crossfade ?? 3) });
    engine.playPlaylist(pl, opts);
    bus.emit('playlist:started', pl);
  },
  /** Stop an ambience playlist (music stops with Fade all or the transport). */
  stop(id, fade = 2) {
    const pl = this.get(id);
    if (pl && this.playing(pl)) engine.deckFor(pl).stop(fade);
  },
};

export function startPlaylistKey(n) {
  const pl = playlists.byKey(n);
  if (!pl) {
    bus.emit('toast', { message: `No playlist is on key ${n} yet. Give one a key in the Playlists pane.` });
    return;
  }
  if (playlists.playing(pl) && engine.deckFor(pl).playing) {
    bus.emit('toast', { message: `“${pl.name}” is already playing.` });
    return;
  }
  playlists.play(pl.id);
}

bus.on('library', () => playlists.reconcile());
bus.on('site:docs', () => playlists.reconcile());

// Forget deleted sounds.
bus.on('library:removed', (id) => {
  state.update('playlists', (d) => {
    for (const pl of d.list) {
      pl.tracks = pl.tracks.filter((t) => t !== id);
      pl.ambience = pl.ambience.filter((a) => a.id !== id);
    }
  });
});
