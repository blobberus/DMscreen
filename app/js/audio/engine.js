// The audio engine. One AudioContext, three buses (music, ambience, effects) into a duck stage,
// a master fader and a safety limiter. It runs on its own, so rearranging panes never stops a sound.
//
//   music:    one deck playing a playlist (or a single track), crossfading between tracks
//   ambience: any number of looping layers, each with its own level
//   effects:  soundboard pads (once / overlap / toggle loop), from any flag to the next
//
// Short files (two minutes or less) are decoded into memory and start instantly; longer ones stream
// through <audio> elements so an hour of rain never sits in RAM.
// Emits 'audio' when what is playing changes and 'audio:tick' on animation frames while playing.
import { library } from '../core/library.js';
import { state } from '../core/state.js';
import { bus } from '../core/bus.js';
import { clamp, shuffled } from '../core/util.js';
import { IOS } from '../core/mode.js';

// An iPad's Safari gives a tab far less memory, so it decodes less ahead and keeps fewer sounds decoded.
const BUFFER_MAX_DURATION = IOS ? 45 : 120;
const BUFFER_MAX_BYTES = (IOS ? 6 : 16) * 1024 * 1024;
const BUFFER_CACHE_MAX = IOS ? 24 : 80;

let ctx = null;
const levelToGain = (v) => clamp(v, 0, 1.25) ** 2;

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

class Voice {
  constructor(engine, sound, bus, opts = {}) {
    this.engine = engine;
    this.sound = sound;
    const [from, to] = library.region(sound);
    this.from = opts.from ?? from;
    this.to = Math.max(this.from + 0.02, opts.to ?? to);
    this.repeat = opts.repeat ?? (sound.repeat ?? 1);      // 1 once, N times, 0 forever
    this.loopFade = opts.loopFade ?? (sound.loopFade || 0);
    this.fadeIn = opts.fadeIn ?? (sound.fadeIn || 0);
    this.fadeOut = opts.fadeOut ?? (sound.fadeOut || 0);
    this.volume = opts.volume ?? 1;
    this.onEnd = opts.onEnd || null;
    this.onApproach = opts.onApproach || null;              // {lead, run}: just before the final end
    this.passes = 0;
    this.state = 'idle';
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.buses[bus]);
    engine.voices.add(this);
  }
  get length() { return this.to - this.from; }
  get gain() { return (this.sound.volume ?? 1) * this.volume; }
  get finalPass() { return this.repeat !== 0 && this.passes >= this.repeat - 1; }
  get progress() { return this.length > 0 ? clamp(this.position / this.length, 0, 1) : 0; }
  ramp(value, seconds) {
    const g = this.out.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (seconds > 0.005) g.linearRampToValueAtTime(value, t + seconds);
    else g.setValueAtTime(value, t);
  }
  setVolume(v) {
    this.volume = v;
    if (this.state === 'playing' && !this.fadingOut) this.ramp(this.gain, 0.06);
  }
  stop(fade = 0.12) {
    if (this.state === 'stopped' || this.state === 'stopping') return;
    this.state = 'stopping';
    this.fadingOut = true;
    this.ramp(0, fade);
    clearTimeout(this.endTimer);
    setTimeout(() => this.dispose(), fade * 1000 + 60);
  }
  finish() {
    if (this.state === 'stopped') return;
    this.dispose();
    this.onEnd?.(this);
  }
  dispose() {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    clearTimeout(this.endTimer);
    clearTimeout(this.fadeTimer);
    this.release();
    try { this.out.disconnect(); } catch { /* already */ }
    this.engine.voices.delete(this);
    this.engine.changed();
  }
  /** Called by the engine's clock, a few times a second. */
  check() {
    if (this.state !== 'playing' || !this.onApproach || this.approached || !this.finalPass) return;
    if (this.length - this.position <= this.onApproach.lead) {
      this.approached = true;
      this.onApproach.run(this);
    }
  }
  scheduleFadeOut() {
    clearTimeout(this.fadeTimer);
    if (!this.fadeOut || !this.finalPass || this.state !== 'playing') return;
    const remain = this.length - this.position;
    const start = Math.max(0, remain - this.fadeOut);
    this.fadeTimer = setTimeout(() => { if (this.state === 'playing') { this.fadingOut = true; this.ramp(0, Math.min(this.fadeOut, remain)); } }, start * 1000);
  }
}

/** Streams through an <audio> element; loops by seeking or by crossfading two elements. */
class MediaVoice extends Voice {
  makeElement() {
    const el = new Audio();
    el.preload = 'auto';
    el.src = library.mediaUrl(this.sound.id);
    const node = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    node.connect(g).connect(this.out);
    const pair = { el, node, g };
    el.addEventListener('ended', () => { if (pair === this.cur && this.state === 'playing') this.passEnd(); });
    el.addEventListener('timeupdate', () => { if (pair === this.cur && this.state === 'playing') this.armEnd(); });
    return pair;
  }
  async start(at = 0) {
    this.cur = this.makeElement();
    this.state = 'loading';
    await seekReady(this.cur.el, this.from + at);
    if (this.state !== 'loading') return;
    try { await this.cur.el.play(); } catch (e) { this.dispose(); throw e; }
    if (this.state !== 'loading') { this.cur.el.pause(); return; }
    this.state = 'playing';
    this.ramp(this.gain, this.fadeIn || 0.02);
    this.armEnd();
    this.scheduleFadeOut();
    this.engine.changed();
  }
  get position() {
    if (!this.cur) return 0;
    return clamp(this.cur.el.currentTime - this.from, 0, this.length);
  }
  armEnd() {
    clearTimeout(this.endTimer);
    if (this.state !== 'playing') return;
    const lead = !this.finalPass && this.loopFade > 0 ? this.loopFade : 0;
    const remain = this.to - this.cur.el.currentTime - lead;
    this.endTimer = setTimeout(() => this.passEnd(), Math.max(0, remain * 1000 - 15));
  }
  passEnd() {
    if (this.state !== 'playing') return;
    const lead = !this.finalPass && this.loopFade > 0 ? this.loopFade : 0;
    if (!this.cur.el.ended && this.cur.el.currentTime < this.to - lead - 0.08) { this.armEnd(); return; }
    if (this.finalPass) { this.finish(); return; }
    this.passes++;
    this.approached = false;
    if (lead > 0) {
      const old = this.cur;
      const next = this.makeElement();
      next.g.gain.value = 0;
      this.cur = next;
      seekReady(next.el, this.from).then(() => next.el.play()).then(() => {
        const t = ctx.currentTime;
        next.g.gain.setValueAtTime(0, t);
        next.g.gain.linearRampToValueAtTime(1, t + lead);
        old.g.gain.setValueAtTime(old.g.gain.value, t);
        old.g.gain.linearRampToValueAtTime(0, t + lead);
        setTimeout(() => releasePair(old), lead * 1000 + 100);
        this.armEnd();
      }).catch(() => this.finish());
    } else {
      this.cur.el.currentTime = this.from;
      if (this.cur.el.paused) this.cur.el.play().catch(() => {});
      this.armEnd();
    }
    this.scheduleFadeOut();
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    clearTimeout(this.endTimer);
    clearTimeout(this.fadeTimer);
    this.ramp(0, 0.15);
    const el = this.cur.el;
    setTimeout(() => { if (this.state === 'paused') el.pause(); }, 160);
    this.engine.changed();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.cur.el.play().catch(() => {});
    this.fadingOut = false;
    this.ramp(this.gain, 0.2);
    this.armEnd();
    this.scheduleFadeOut();
    this.engine.changed();
  }
  seek(pos) {
    if (!this.cur) return;
    this.cur.el.currentTime = this.from + clamp(pos, 0, this.length - 0.05);
    this.approached = false;
    if (this.fadingOut && this.state === 'playing') { this.fadingOut = false; this.ramp(this.gain, 0.05); }
    this.armEnd();
    this.scheduleFadeOut();
    this.engine.changed();
  }
  release() {
    if (this.cur) releasePair(this.cur);
    this.cur = null;
  }
}

function releasePair(pair) {
  try { pair.el.pause(); } catch { /* gone */ }
  pair.el.removeAttribute('src');
  try { pair.el.load(); } catch { /* fine */ }
  try { pair.node.disconnect(); pair.g.disconnect(); } catch { /* fine */ }
}

function seekReady(el, t) {
  return new Promise((resolve) => {
    const done = () => { cleanup(); resolve(); };
    const cleanup = () => { el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('seeked', done); clearTimeout(timer); };
    const onMeta = () => {
      if (t > 0.01) { el.addEventListener('seeked', done, { once: true }); el.currentTime = t; } else done();
    };
    const timer = setTimeout(done, 6000);
    if (el.readyState >= 1) onMeta(); else el.addEventListener('loadedmetadata', onMeta, { once: true });
  });
}

/** Decoded in memory: instant start, sample-exact loops. */
class BufferVoice extends Voice {
  async start(at = 0) {
    this.state = 'loading';
    try {
      this.buffer = await this.engine.buffer(this.sound);
    } catch (e) {
      this.dispose();
      throw e;
    }
    if (this.state !== 'loading') return;
    this.to = Math.min(this.to, this.buffer.duration);
    this.state = 'playing';
    this.play(this.from + at);
    this.ramp(this.gain, this.fadeIn || 0.005);
    this.scheduleFadeOut();
    this.engine.changed();
  }
  play(offset) {
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.out);
    const looping = this.repeat === 0 || this.repeat - this.passes > 1;
    const now = ctx.currentTime;
    if (looping) {
      src.loop = true;
      src.loopStart = this.from;
      src.loopEnd = this.to;
      if (this.repeat !== 0) src.stop(now + (this.to - offset) + (this.repeat - this.passes - 1) * this.length);
    }
    src.start(now, offset, looping ? undefined : this.to - offset);
    src.onended = () => { if (src === this.src && this.state === 'playing') this.finish(); };
    this.src = src;
    this.t0 = now;
    this.off0 = offset;
  }
  get position() {
    if (this.state === 'paused') return this.pausedAt || 0;
    if (!this.src) return 0;
    const elapsed = ctx.currentTime - this.t0;
    let p = this.off0 - this.from + elapsed;
    if (p >= this.length && this.src.loop) {
      const laps = Math.floor(p / this.length);
      p -= laps * this.length;
      if (this.repeat !== 0) this.passes = Math.min(this.repeat - 1, this.passesAtStart() + laps);
    }
    return clamp(p, 0, this.length);
  }
  passesAtStart() { return this._p0 ?? 0; }
  halt() {
    if (!this.src) return;
    this.src.onended = null;
    try { this.src.stop(); } catch { /* not started */ }
    this.src.disconnect();
    this.src = null;
  }
  pause() {
    if (this.state !== 'playing') return;
    this.pausedAt = this.position;
    this.state = 'paused';
    clearTimeout(this.fadeTimer);
    this.ramp(0, 0.08);
    setTimeout(() => { if (this.state === 'paused') this.halt(); }, 90);
    this.engine.changed();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.halt();
    this.state = 'playing';
    this._p0 = this.passes;
    this.play(this.from + (this.pausedAt || 0));
    this.fadingOut = false;
    this.ramp(this.gain, 0.1);
    this.scheduleFadeOut();
    this.engine.changed();
  }
  seek(pos) {
    const p = clamp(pos, 0, this.length - 0.01);
    if (this.state === 'paused') { this.pausedAt = p; this.engine.changed(); return; }
    this.halt();
    this._p0 = this.passes;
    this.play(this.from + p);
    this.approached = false;
    if (this.fadingOut) { this.fadingOut = false; this.ramp(this.gain, 0.03); }
    this.scheduleFadeOut();
    this.engine.changed();
  }
  release() { this.halt(); }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

class Engine {
  constructor() {
    this.voices = new Set();
    this.buses = {};
    this.buffers = new Map();
    this.music = { voice: null, playlistId: null, queue: [], index: -1, repeat: 'all', shuffle: false, crossfade: 3, lastSound: null };
    this.layers = new Map();      // soundId -> {voice, volume}
    this.pads = new Map();        // pad key -> Set<Voice>
    this.ducked = false;
    this.preview = null;
  }

  get ctx() { return ctx; }
  get ready() { return !!ctx; }

  init() {
    if (ctx) return;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.master = ctx.createGain();
    this.duck = ctx.createGain();
    this.master.connect(this.limiter).connect(ctx.destination);
    this.duck.connect(this.master);
    for (const name of ['music', 'ambience', 'effects', 'preview']) {
      const g = ctx.createGain();
      g.connect(name === 'music' || name === 'ambience' ? this.duck : this.master);
      this.buses[name] = g;
    }
    this.buses.preview.gain.value = 0.9;
    this.applyLevels(true);
    // Safari only lets sound start inside a tap (touchend or click), and "interrupts" it after a call
    // or another app's audio; any later tap or key wakes it again.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
    const wake = () => { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(type, wake, true);
    ctx.addEventListener('statechange', () => bus.emit('audio:state', ctx.state));
    setInterval(() => { for (const v of this.voices) v.check(); }, 100);
    this.loop();
    this.mediaSession();
  }

  get suspended() { return !ctx || ctx.state !== 'running'; }

  loop() {
    const frame = () => {
      if (this.voices.size) bus.emit('audio:tick');
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  changed() {
    clearTimeout(this._changed);
    this._changed = setTimeout(() => { bus.emit('audio'); this.updateSession(); }, 0);
  }

  // ---- levels ------------------------------------------------------------
  levels() { return state.get('settings').levels; }
  applyLevels(now = false) {
    if (!ctx) return;
    const l = this.levels();
    const t = ctx.currentTime;
    const set = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, now ? 0.001 : 0.03); };
    set(this.master.gain, levelToGain(l.master));
    for (const b of ['music', 'ambience', 'effects']) set(this.buses[b].gain, levelToGain(l[b]));
    set(this.duck.gain, this.ducked ? state.get('settings').duckAmount : 1);
  }
  setLevel(name, v) {
    state.update('settings', (s) => { s.levels[name] = clamp(Math.round(v * 100) / 100, 0, 1); }, { silent: true });
    this.applyLevels();
    bus.emit('audio:levels');
  }
  nudge(name, delta) { this.setLevel(name, this.levels()[name] + delta); }
  toggleDuck(on = !this.ducked) {
    this.ducked = on;
    if (ctx) {
      const t = ctx.currentTime;
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setTargetAtTime(on ? state.get('settings').duckAmount : 1, t, 0.12);
    }
    bus.emit('audio:levels');
  }

  // ---- buffers -------------------------------------------------------------
  useBuffer(sound) {
    return (sound.duration || 0) <= BUFFER_MAX_DURATION && (sound.size || 0) <= BUFFER_MAX_BYTES;
  }
  buffer(sound) {
    if (this.buffers.has(sound.id)) {
      const b = this.buffers.get(sound.id);
      this.buffers.delete(sound.id);
      this.buffers.set(sound.id, b);
      return b;
    }
    const p = fetch(library.mediaUrl(sound.id), { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error(`Couldn't load ${sound.name}`); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab));
    this.buffers.set(sound.id, p);
    p.catch(() => this.buffers.delete(sound.id));
    while (this.buffers.size > BUFFER_CACHE_MAX) this.buffers.delete(this.buffers.keys().next().value);
    return p;
  }
  /** Decode short sounds ahead of time so pads fire instantly. */
  preload(ids) {
    if (!ctx) return;
    for (const id of ids) {
      const s = library.get(id);
      if (s && this.useBuffer(s)) this.buffer(s).catch(() => {});
    }
  }

  voice(sound, busName, opts) {
    this.init();
    const fullRegion = opts?.from == null && opts?.to == null;
    const Kind = this.useBuffer(sound) || (!fullRegion && sound.duration <= BUFFER_MAX_DURATION) ? BufferVoice : MediaVoice;
    return new Kind(this, sound, busName, opts);
  }

  startVoice(v, at = 0) {
    v.start(at).catch((e) => {
      if (e?.name === 'NotAllowedError') bus.emit('toast', { message: 'Click anywhere on the screen once to let it play sound.', type: 'error' });
      else bus.emit('toast', { message: `Couldn't play “${v.sound.name}”. ${e?.message || ''}`, type: 'error' });
    });
    return v;
  }

  // ---- music deck ------------------------------------------------------------
  get track() { return this.music.voice?.sound || null; }
  get playing() { return this.music.voice?.state === 'playing' || this.music.voice?.state === 'loading'; }
  playlist() {
    return state.get('playlists').list.find((p) => p.id === this.music.playlistId) || null;
  }

  playPlaylist(pl, { index = 0, fade } = {}) {
    if (!pl) return;
    const tracks = (pl.tracks || []).filter((id) => library.has(id));
    const m = this.music;
    m.playlistId = pl.id;
    m.repeat = pl.repeat || 'all';
    m.shuffle = !!pl.shuffle;
    m.crossfade = pl.crossfade ?? state.get('settings').crossfade;
    m.order = tracks;
    m.queue = m.shuffle ? shuffled(tracks) : tracks.slice();
    if (m.shuffle && index > 0 && tracks[index]) {
      m.queue = [tracks[index], ...m.queue.filter((id) => id !== tracks[index])];
      index = 0;
    }
    // A playlist with ambience replaces the layers; one without leaves whatever is playing.
    if ((pl.ambience || []).length) this.setAmbience(pl.ambience, { fade: Math.max(1.5, m.crossfade) });
    if (m.queue.length) this.playAt(index, { fade: fade ?? m.crossfade });
    else { this.stopMusic(m.crossfade); }
    this.changed();
  }

  playSingle(sound, { fade = 1 } = {}) {
    const m = this.music;
    m.playlistId = null;
    m.queue = [sound.id];
    m.order = [sound.id];
    m.repeat = 'off';
    this.playAt(0, { fade });
  }

  playAt(i, { fade = this.music.crossfade, at = 0 } = {}) {
    const m = this.music;
    const id = m.queue[i];
    const s = id && library.get(id);
    if (!s) return;
    const old = m.voice;
    const v = this.voice(s, 'music', {
      fadeIn: old ? Math.max(fade, 0.05) : (s.fadeIn || 0.05),
      onEnd: (voice) => this.trackEnded(voice),
      onApproach: { lead: Math.max(0.1, m.crossfade), run: (voice) => this.trackApproaching(voice) },
    });
    m.voice = v;
    m.index = i;
    m.lastSound = s.id;
    this.startVoice(v, at);
    if (old) old.stop(Math.max(fade, 0.05));
    this.changed();
  }

  nextIndex(step = 1) {
    const m = this.music;
    const n = m.queue.length;
    if (!n) return -1;
    if (m.repeat === 'one') return m.index;
    const j = m.index + step;
    if (j >= n) return m.repeat === 'all' ? 0 : -1;
    if (j < 0) return m.repeat === 'all' ? n - 1 : 0;
    return j;
  }

  trackApproaching(voice) {
    if (voice !== this.music.voice || this.music.crossfade <= 0.15) return;
    const j = this.nextIndex(1);
    if (j < 0) return;
    voice.advanced = true;
    if (this.music.repeat === 'one') { this.playAt(j, { fade: this.music.crossfade }); return; }
    if (j === 0 && this.music.shuffle) this.music.queue = shuffled(this.music.order);
    this.playAt(j, { fade: this.music.crossfade });
  }

  trackEnded(voice) {
    if (voice !== this.music.voice) return;
    if (voice.advanced) return;
    const j = this.nextIndex(1);
    if (j < 0) { this.music.voice = null; this.changed(); return; }
    if (j === 0 && this.music.shuffle && this.music.repeat === 'all') this.music.queue = shuffled(this.music.order);
    this.playAt(j, { fade: 0.05 });
  }

  togglePlay() {
    this.init();
    const m = this.music;
    const v = m.voice;
    if (v && v.state === 'playing') { v.pause(); return; }
    if (v && v.state === 'paused') { v.resume(); return; }
    if (m.queue.length) { this.playAt(Math.max(0, m.index), { fade: 0.3 }); return; }
    const pl = state.get('playlists').list.find((p) => p.tracks?.length);
    if (pl) this.playPlaylist(pl);
    else bus.emit('toast', { message: 'No music to play yet. Make a playlist or play a track from the library.' });
  }
  next() {
    const m = this.music;
    if (!m.queue.length) return;
    let j = m.index + 1;
    if (j >= m.queue.length) { j = 0; if (m.shuffle) m.queue = shuffled(m.order); }
    this.playAt(j, { fade: Math.min(1.2, m.crossfade || 0.05) });
  }
  prev() {
    const m = this.music;
    if (!m.queue.length) return;
    if (m.voice && m.voice.position > 3) { m.voice.seek(0); return; }
    const j = m.index - 1 < 0 ? m.queue.length - 1 : m.index - 1;
    this.playAt(j, { fade: Math.min(1.2, m.crossfade || 0.05) });
  }
  seek(pos) { this.music.voice?.seek(pos); }
  stopMusic(fade = 1) {
    this.music.voice?.stop(fade);
    this.music.voice = null;
    this.changed();
  }
  setRepeat(mode) {
    this.music.repeat = mode;
    this.updatePlaylist({ repeat: mode });
    this.changed();
  }
  setShuffle(on) {
    const m = this.music;
    m.shuffle = on;
    const current = m.queue[m.index];
    m.queue = on ? [current, ...shuffled(m.order.filter((id) => id !== current))].filter(Boolean) : m.order.slice();
    m.index = Math.max(0, m.queue.indexOf(current));
    this.updatePlaylist({ shuffle: on });
    this.changed();
  }
  updatePlaylist(patch) {
    const pl = this.playlist();
    if (pl) state.update('playlists', () => Object.assign(pl, patch));
  }
  upNext() {
    const j = this.nextIndex(1);
    if (j < 0 || (j === this.music.index && this.music.repeat !== 'one')) return null;
    return library.get(this.music.queue[j]);
  }

  // ---- flags (on the music deck) --------------------------------------------
  flags() {
    const v = this.music.voice;
    if (!v) return [];
    return (v.sound.flags || []).filter((f) => f.t >= v.from - 0.001 && f.t < v.to);
  }
  jumpTo(seconds) {
    const v = this.music.voice;
    if (!v) return;
    if (v.state === 'paused') v.resume();
    v.seek(seconds - v.from);
  }
  jumpFlag(n) {
    const f = this.flags()[n];
    if (f) this.jumpTo(f.t);
    else if (this.music.voice) bus.emit('toast', { message: `This track has no flag ${n + 1}.` });
  }
  nextFlag() {
    const v = this.music.voice;
    if (!v) return;
    const now = v.from + v.position;
    const f = this.flags().find((x) => x.t > now + 0.25);
    if (f) this.jumpTo(f.t); else bus.emit('toast', { message: 'No more flags in this track.' });
  }
  prevFlag() {
    const v = this.music.voice;
    if (!v) return;
    const now = v.from + v.position;
    const before = this.flags().filter((x) => x.t < now - 1.5);
    if (before.length) this.jumpTo(before[before.length - 1].t); else v.seek(0);
  }

  // ---- ambience ----------------------------------------------------------------
  layerOn(id) { return this.layers.has(id); }
  startLayer(id, { volume = 1, fade = 2 } = {}) {
    const s = library.get(id);
    if (!s || this.layers.has(id)) return;
    const v = this.voice(s, 'ambience', {
      volume,
      repeat: s.repeat ?? 0,
      fadeIn: Math.max(fade, s.fadeIn || 0),
      onEnd: () => { if (this.layers.get(id)?.voice === v) { this.layers.delete(id); this.changed(); } },
    });
    this.layers.set(id, { voice: v, volume });
    this.startVoice(v);
    this.changed();
  }
  stopLayer(id, fade = 2) {
    const l = this.layers.get(id);
    if (!l) return;
    l.voice.stop(fade);
    this.layers.delete(id);
    this.changed();
  }
  toggleLayer(id, opts) { this.layers.has(id) ? this.stopLayer(id) : this.startLayer(id, opts); }
  setLayerVolume(id, volume) {
    const l = this.layers.get(id);
    if (!l) return;
    l.volume = volume;
    l.voice.setVolume(volume);
  }
  setAmbience(list, { fade = 2.5 } = {}) {
    const want = new Map(list.filter((a) => library.has(a.id)).map((a) => [a.id, a.volume ?? 1]));
    for (const id of [...this.layers.keys()]) if (!want.has(id)) this.stopLayer(id, fade);
    for (const [id, vol] of want) {
      if (this.layers.has(id)) this.setLayerVolume(id, vol);
      else this.startLayer(id, { volume: vol, fade });
    }
  }

  // ---- effects (pads) -----------------------------------------------------------
  padRegion(pad, s) {
    const [from0, to0] = library.region(s);
    const from = pad.from != null ? clamp(pad.from, 0, s.duration || 0) : from0;
    let to = to0;
    if (pad.toNextFlag) {
      const next = (s.flags || []).find((f) => f.t > from + 0.01);
      if (next) to = Math.min(to, next.t);
    }
    return [from, Math.max(from + 0.02, to)];
  }
  firePad(key, pad) {
    const s = pad && library.get(pad.sound);
    if (!s) return false;
    this.init();
    const set = this.pads.get(key) || new Set();
    this.pads.set(key, set);
    const mode = pad.mode || 'once';
    if (mode === 'toggle' && set.size) {
      for (const v of set) v.stop(0.25);
      set.clear();
      this.changed();
      return true;
    }
    if (mode === 'once') { for (const v of set) v.stop(0.03); set.clear(); }
    const [from, to] = this.padRegion(pad, s);
    const repeat = mode === 'toggle' ? 0 : (s.repeat === 0 ? 1 : (s.repeat || 1));
    const v = this.voice(s, 'effects', {
      from, to, repeat, volume: pad.volume ?? 1, loopFade: mode === 'toggle' ? Math.min(s.loopFade || 0, (to - from) / 3) : 0,
      onEnd: () => { set.delete(v); this.changed(); },
    });
    set.add(v);
    this.startVoice(v);
    this.changed();
    return true;
  }
  padVoices(key) { return this.pads.get(key) || null; }
  stopEffects(fade = 0.2) {
    for (const set of this.pads.values()) { for (const v of set) v.stop(fade); set.clear(); }
    this.changed();
  }
  effectCount() { let n = 0; for (const set of this.pads.values()) n += set.size; return n; }

  // ---- everything ---------------------------------------------------------------
  fadeAll(seconds = state.get('settings').fadeAll) {
    const m = this.music;
    if (m.voice) { m.voice.stop(seconds); m.voice = null; }
    for (const id of [...this.layers.keys()]) this.stopLayer(id, seconds);
    this.stopEffects(Math.min(seconds, 0.8));
    this.stopPreview();
    this.changed();
  }
  anythingPlaying() { return [...this.voices].some((v) => v.state === 'playing'); }

  // ---- auditioning from the library / editor --------------------------------------
  /** One preview at a time; it doesn't touch the deck, layers or pads. */
  previewSound(sound, { from, to, at = 0, loop = false, onEnd } = {}) {
    this.stopPreview(0.04);
    const v = this.voice(sound, 'preview', { from, to, repeat: loop ? 0 : 1, fadeIn: 0.01, fadeOut: 0, loopFade: 0, onEnd: () => { if (this.preview === v) this.preview = null; onEnd?.(); this.changed(); } });
    this.preview = v;
    this.startVoice(v, at);
    return v;
  }
  stopPreview(fade = 0.08) {
    if (this.preview) { this.preview.stop(fade); this.preview = null; this.changed(); }
  }

  // ---- hardware media keys ---------------------------------------------------------
  mediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const on = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
    on('play', () => this.togglePlay());
    on('pause', () => this.togglePlay());
    on('nexttrack', () => this.next());
    on('previoustrack', () => this.prev());
  }
  updateSession() {
    if (!('mediaSession' in navigator)) return;
    const s = this.track;
    const pl = this.playlist();
    try {
      navigator.mediaSession.metadata = s ? new MediaMetadata({ title: s.name, artist: pl?.name || 'DM Screen', album: 'DM Screen' }) : null;
      navigator.mediaSession.playbackState = this.playing ? 'playing' : s ? 'paused' : 'none';
    } catch { /* fine */ }
  }
}

export const engine = new Engine();

// A sound or folder has a new id (renamed or moved on the website): follow it everywhere it plays.
bus.on('library:moved', ({ from, to }) => {
  const map = (id) => (id === from || String(id).startsWith(`${from}/`) ? to + String(id).slice(from.length) : id);
  const m = engine.music;
  m.queue = m.queue.map(map);
  m.order = (m.order || []).map(map);
  if (m.playlistId) m.playlistId = map(m.playlistId);
  for (const [id, l] of [...engine.layers]) {
    if (map(id) === id) continue;
    engine.layers.delete(id);
    engine.layers.set(map(id), l);
  }
  for (const [id, b] of [...engine.buffers]) if (map(id) !== id) engine.buffers.set(map(id), b);
  for (const v of engine.voices) {
    const s = library.get(map(v.sound.id));
    if (s) v.sound = s;
  }
  engine.changed();
});

// Keep the deck honest when a sound is deleted or edited.
bus.on('library:removed', (id) => {
  if (engine.music.voice?.sound.id === id) engine.stopMusic(0.3);
  if (engine.layers.has(id)) engine.stopLayer(id, 0.3);
});
