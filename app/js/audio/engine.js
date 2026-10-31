// The audio engine. One AudioContext, three buses (music, ambience, effects) into a duck stage,
// a master fader and a safety limiter. It runs on its own, so rearranging panes never stops a sound.
//
//   the deck: one playlist (music or ambience) or a single track at a time, crossfading between
//             tracks; starting another ends the one before
//   on top:   any number of sounds played over the deck on purpose, each with its own level (layers)
//   effects:  soundboard pads (once / overlap / toggle loop), from any flag to the next
// A sound plays on the bus of its kind (music, ambience, effects), wherever it was started from.
//
// Short files (two minutes or less) are decoded into memory and start instantly; longer ones stream
// through <audio> elements so an hour of rain never sits in RAM.
// Previews (auditioning a sound) have their own bus, which can go to a second device such as headphones.
// Every voice runs through its own low-pass filter, wide open unless the sound is switched into the
// one sweep the Console controls (setLowpass), so it can be muffled live like a knob on a desk.
// Emits 'audio' when what is playing changes and 'audio:tick' on animation frames while playing.
import { library, MAX_VOLUME } from '../core/library.js';
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
const BUS = { music: 'music', ambience: 'ambience', effect: 'effects' };
const busOf = (sound) => BUS[sound.kind] || 'music';
const LP_OPEN = 20000;
const LP_MIN = 150;            // the low-pass at its most muffled
export const SPEED_MIN = 0.5;  // the speed control's range: half to double, pitch following like a tape
export const SPEED_MAX = 2;
let serial = 0;
// Pitch follows speed for every voice: decoded sounds can't keep it, so streamed ones don't either.
const rateOn = (el, r) => {
  el.preservesPitch = false;
  el.webkitPreservesPitch = false;
  el.defaultPlaybackRate = r;                 // a reload of the element resets playbackRate to this
  el.playbackRate = r;
};

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
    this.serial = ++serial;
    this.slot = opts.slot || null;                    // 'deck', 'top' or 'pad': which low-pass switch it follows
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.8;
    this.filter.frequency.value = engine.cutoffFor(this);
    this.rate = engine.rateFor(this);                  // playback speed, 1 normal; times below are real seconds
    this.out.connect(this.filter).connect(engine.buses[bus]);
    engine.voices.add(this);
  }
  get length() { return this.to - this.from; }
  get gain() {
    const mixed = this.slot && this.engine.mix.get(this.sound.id);      // the Console's fader, for this play
    return clamp(mixed ? mixed.level : (this.sound.volume ?? 1), 0, MAX_VOLUME) * clamp(this.volume, 0, MAX_VOLUME);
  }
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
  setRate(r) { this.rate = r; }
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
    try { this.out.disconnect(); this.filter.disconnect(); } catch { /* already */ }
    this.engine.voices.delete(this);
    this.engine.changed();
  }
  /** Called by the engine's clock, a few times a second. */
  check() {
    if (this.state !== 'playing' || !this.onApproach || this.approached || !this.finalPass) return;
    if ((this.length - this.position) / this.rate <= this.onApproach.lead) {
      this.approached = true;
      this.onApproach.run(this);
    }
  }
  /** Loop from now on, or stop looping (it ends after the pass it is in). Works while it plays. */
  setLooping(on) {
    this.repeat = on ? 0 : this.passes + 1;
    if (on && !this.loopFade && this.length > 6) this.loopFade = 1;      // a long sound loops without a click
    if (this.fadingOut && this.state === 'playing' && on) { this.fadingOut = false; this.ramp(this.gain, 0.1); }
    this.relooped();
  }
  scheduleFadeOut() {
    clearTimeout(this.fadeTimer);
    if (!this.fadeOut || !this.finalPass || this.state !== 'playing') return;
    const remain = (this.length - this.position) / this.rate;
    const fade = this.fadeOut / this.rate;                   // over the same stretch of the sound at any speed
    const start = Math.max(0, remain - fade);
    this.fadeTimer = setTimeout(() => { if (this.state === 'playing') { this.fadingOut = true; this.ramp(0, Math.min(fade, remain)); } }, start * 1000);
  }
}

/** Streams through an <audio> element; loops by seeking or by crossfading two elements. */
class MediaVoice extends Voice {
  makeElement() {
    const el = new Audio();
    el.preload = 'auto';
    el.src = library.mediaUrl(this.sound.id);
    rateOn(el, this.rate);
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
    const remain = (this.to - this.cur.el.currentTime - lead) / this.rate;
    this.endTimer = setTimeout(() => this.passEnd(), Math.max(0, remain * 1000 - 15));
  }
  setRate(r) {
    this.rate = r;
    if (this.cur) rateOn(this.cur.el, r);
    if (this.state === 'playing') { this.armEnd(); this.scheduleFadeOut(); }
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
        // what the old pass has left by now (the new one took a moment to start), at the speed it plays:
        // a fade timed from the start ran past the end of the file and cut off
        const fade = clamp((this.to - old.el.currentTime) / (old.el.playbackRate || 1), 0.05, lead / this.rate);
        next.g.gain.setValueAtTime(0, t);
        next.g.gain.linearRampToValueAtTime(1, t + fade);
        old.g.gain.setValueAtTime(old.g.gain.value, t);
        old.g.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => releasePair(old), fade * 1000 + 100);
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
    const target = this.from + clamp(pos, 0, this.length - 0.05);
    this.approached = false;
    if (this.fadingOut && this.state === 'playing') { this.fadingOut = false; this.ramp(this.gain, 0.05); }
    const jumped = () => { this.armEnd(); this.scheduleFadeOut(); this.engine.changed(); };
    if (this.state !== 'playing') { this.cur.el.currentTime = target; jumped(); return; }
    // A jump mid-wave clicked (every seek, on a tone): the element dips to silence, jumps, and comes back
    // once it is playing from there. A newer seek takes over a pending one.
    const pair = this.cur;
    const g = pair.g.gain;
    const n = this.seekN = (this.seekN || 0) + 1;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + 0.012);
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => {
      if (n !== this.seekN || pair !== this.cur) return;
      const up = () => {
        clearTimeout(this.seekBack);
        if (n !== this.seekN || pair !== this.cur) return;
        const t2 = ctx.currentTime;
        g.cancelScheduledValues(t2);
        g.setValueAtTime(0, t2);
        g.linearRampToValueAtTime(1, t2 + 0.015);
      };
      pair.el.addEventListener('seeked', up, { once: true });
      this.seekBack = setTimeout(up, 600);           // no 'seeked' (already there, or an error): back anyway
      pair.el.currentTime = target;
      jumped();
    }, 14);
  }
  release() {
    if (this.cur) releasePair(this.cur);
    this.cur = null;
  }
  relooped() {
    if (this.state !== 'playing') return;
    this.approached = false;
    this.armEnd();
    this.scheduleFadeOut();
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
  // A new speed changes the playing source in place (no second copy: two copies a few ms apart cancelled
  // each other out). Its end is a length of the sound's own seconds, which holds at any speed (the Web
  // Audio spec, and what Chrome does); a sound looping a set number of times has a stop time instead,
  // moved with each speed. Positions count from the last change (t0, off0, srcRate).
  play(offset, fadeIn = 0) {
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    const g = ctx.createGain();
    src.connect(g).connect(this.out);
    const looping = this.repeat === 0 || this.repeat - this.passes > 1;
    const now = ctx.currentTime;
    if (fadeIn > 0) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + fadeIn); }
    if (looping) {
      src.loop = true;
      src.loopStart = this.from;
      src.loopEnd = this.to;
      src.start(now, offset);
    } else {
      src.start(now, offset, this.to - offset);
    }
    src.onended = () => { if (src === this.src && this.state === 'playing') this.finish(); };
    this.src = src;
    this.srcGain = g;
    this.srcRate = this.rate;
    this.t0 = now;
    this.off0 = offset;
    this._p0 = this.passes;
    this.endLoops();
  }
  /** A set number of loops ends at a time: from the last change, what is left at the speed it plays. */
  endLoops() {
    if (!this.src?.loop || this.repeat === 0) return true;
    const left = (this.to - this.off0) + (this.repeat - this._p0 - 1) * this.length;
    try { this.src.stop(this.t0 + left / this.srcRate); return true; } catch { return false; }   // an older browser allows one stop
  }
  setRate(r) {
    this.rate = r;
    if (this.state !== 'playing' || !this.src || r === this.srcRate) return;   // the next play() takes it
    const tc = ctx.currentTime + 0.01;                // a moment ahead, so the change lands where it is counted
    const p = this.positionAt(tc);
    this.src.playbackRate.cancelScheduledValues(tc);
    this.src.playbackRate.setValueAtTime(r, tc);
    this.t0 = tc;
    this.off0 = this.from + p;
    this._p0 = this.passes;
    this.srcRate = r;
    if (!this.endLoops()) {                           // a browser that won't move a stop: a new source, crossfaded
      this.halt(0.03);
      this.play(this.from + p, 0.03);
    }
    this.scheduleFadeOut();
  }
  get position() {
    if (this.state === 'paused') return this.pausedAt || 0;
    return this.positionAt(ctx.currentTime);
  }
  positionAt(t) {
    if (!this.src) return 0;
    let p = this.off0 - this.from + (t - this.t0) * this.srcRate;
    if (p >= this.length && this.src.loop) {
      const laps = Math.floor(p / this.length);
      p -= laps * this.length;
      if (this.repeat !== 0) this.passes = Math.min(this.repeat - 1, this.passesAtStart() + laps);
    }
    return clamp(p, 0, this.length);
  }
  passesAtStart() { return this._p0 ?? 0; }
  halt(fade = 0) {
    const { src, srcGain: g } = this;
    if (!src) return;
    this.src = null;
    this.srcGain = null;
    src.onended = null;
    if (fade > 0) {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      try { src.stop(t + fade + 0.01); } catch { /* its end was set already */ }
      setTimeout(() => { try { src.disconnect(); g.disconnect(); } catch { /* gone */ } }, (fade + 0.06) * 1000);
      return;
    }
    try { src.stop(); } catch { /* not started */ }
    src.disconnect();
    g.disconnect();
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
    this.halt(0.012);                                 // the old place fades out as the new one comes in: a
    this._p0 = this.passes;                           // jump mid-wave clicked
    this.play(this.from + p, 0.012);
    this.approached = false;
    if (this.fadingOut) { this.fadingOut = false; this.ramp(this.gain, 0.03); }
    this.scheduleFadeOut();
    this.engine.changed();
  }
  release() { this.halt(); }
  // a playing source can't change between once and looping, so it carries on from where it is
  relooped() { if (this.state === 'playing') this.seek(this.position); }
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/**
 * A playlist playing track after track, crossfading between them. A sound set to loop forever (ambience
 * is, by default) plays once per pass here, and the deck's repeat decides what comes next.
 */
class Deck {
  constructor(engine) {
    this.engine = engine;
    this.voice = null;
    this.playlistId = null;
    this.queue = [];
    this.order = [];
    this.index = -1;
    this.repeat = 'all';
    this.shuffle = false;
    this.crossfade = 3;
    this.lastSound = null;
    this.queued = null;           // one sound queued to play when this track ends (its id), shown at the top
  }
  get track() { return this.voice?.sound || null; }
  get playing() { return this.voice?.state === 'playing' || this.voice?.state === 'loading'; }
  playlist() {
    return state.get('playlists').list.find((p) => p.id === this.playlistId) || null;
  }

  play(pl, { index = 0, fade } = {}) {
    const tracks = (pl.tracks || []).filter((id) => library.has(id));
    this.playlistId = pl.id;
    this.repeat = pl.repeat || 'all';
    this.shuffle = !!pl.shuffle;
    this.crossfade = pl.crossfade ?? state.get('settings').crossfade;
    this.order = tracks;
    this.queue = this.shuffle ? shuffled(tracks) : tracks.slice();
    if (this.shuffle && index > 0 && tracks[index]) {
      this.queue = [tracks[index], ...this.queue.filter((id) => id !== tracks[index])];
      index = 0;
    }
    if (this.queue.length) this.playAt(index, { fade: fade ?? this.crossfade });
    else this.stop(this.crossfade);
    this.engine.changed();
  }

  playSingle(sound, { fade = 1 } = {}) {
    this.playlistId = null;
    this.queue = [sound.id];
    this.order = [sound.id];
    this.repeat = sound.kind === 'ambience' ? 'one' : 'off';     // ambience keeps going until stopped
    this.playAt(0, { fade });
  }

  playAt(i, opts = {}) {
    const s = this.queue[i] && library.get(this.queue[i]);
    if (!s) return;
    this.index = i;
    this.startTrack(s, opts);
  }

  /** Start a sound on the deck, crossfading from what plays; the place in the playlist stays put. */
  startTrack(s, { fade = this.crossfade, at = 0 } = {}) {
    const old = this.voice;
    const v = this.engine.voice(s, busOf(s), {
      ...(s.repeat === 0 ? { repeat: 1, loopFade: 0 } : {}),
      slot: 'deck',
      fadeIn: old ? Math.max(fade, 0.05) : (s.fadeIn || 0.05),
      onEnd: (voice) => this.ended(voice),
      onApproach: { lead: Math.max(0.1, this.crossfade), run: (voice) => this.approaching(voice) },
    });
    this.voice = v;
    this.lastSound = s.id;
    this.engine.startVoice(v, at);
    if (old) old.stop(Math.max(fade, 0.05));
    this.engine.changed();
  }

  nextIndex(step = 1) {
    const n = this.queue.length;
    if (!n) return -1;
    if (this.repeat === 'one') return this.index;
    const j = this.index + step;
    if (j >= n) return this.repeat === 'all' ? 0 : -1;
    if (j < 0) return this.repeat === 'all' ? n - 1 : 0;
    return j;
  }

  // The queue holds one sound: it plays when this track ends, then the playlist carries on from where it was.
  queueNext(sound) {
    if (!this.voice) { this.playSingle(sound); return; }        // nothing playing: it starts now
    this.queued = sound.id;                                       // a second sound takes the first one's place
    this.engine.changed();
  }
  clearNext() {
    if (!this.queued) return;
    this.queued = null;
    this.engine.changed();
  }
  takeNext() {
    const s = this.queued && library.get(this.queued);
    this.queued = null;
    return s || null;
  }

  approaching(voice) {
    if (voice !== this.voice || this.crossfade <= 0.15) return;
    const q = this.takeNext();
    if (q) { voice.advanced = true; this.startTrack(q, { fade: this.crossfade }); return; }
    const j = this.nextIndex(1);
    if (j < 0) return;
    voice.advanced = true;
    if (this.repeat === 'one') { this.playAt(j, { fade: this.crossfade }); return; }
    if (j === 0 && this.shuffle) this.queue = shuffled(this.order);
    this.playAt(j, { fade: this.crossfade });
  }

  ended(voice) {
    if (voice !== this.voice) return;
    if (voice.advanced) return;
    const q = this.takeNext();
    if (q) { this.startTrack(q, { fade: 0.05 }); return; }
    const j = this.nextIndex(1);
    if (j < 0) { this.voice = null; this.engine.changed(); return; }
    if (j === 0 && this.shuffle && this.repeat === 'all') this.queue = shuffled(this.order);
    this.playAt(j, { fade: 0.05 });
  }

  /** Pause, resume, or play again from the last track. False when there is nothing to play. */
  toggle() {
    const v = this.voice;
    if (v && v.state === 'playing') { v.pause(); return true; }
    if (v && v.state === 'paused') { v.resume(); return true; }
    if (this.queue.length) { this.playAt(Math.max(0, this.index), { fade: 0.3 }); return true; }
    return false;
  }
  next() {
    const q = this.takeNext();
    if (q) { this.startTrack(q, { fade: Math.min(1.2, this.crossfade || 0.05) }); return; }
    if (!this.queue.length) return;
    let j = this.index + 1;
    if (j >= this.queue.length) { j = 0; if (this.shuffle) this.queue = shuffled(this.order); }
    this.playAt(j, { fade: Math.min(1.2, this.crossfade || 0.05) });
  }
  prev() {
    if (!this.queue.length) return;
    if (this.voice && this.voice.position > 3) { this.voice.seek(0); return; }
    const j = this.index - 1 < 0 ? this.queue.length - 1 : this.index - 1;
    this.playAt(j, { fade: Math.min(1.2, this.crossfade || 0.05) });
  }
  seek(pos) { this.voice?.seek(pos); }
  stop(fade = 1) {
    this.voice?.stop(fade);
    this.voice = null;
    this.queued = null;
    this.engine.changed();
  }
  setRepeat(mode) {
    this.repeat = mode;
    this.update({ repeat: mode });
    this.engine.changed();
  }
  setShuffle(on) {
    this.shuffle = on;
    const current = this.queue[this.index];
    this.queue = on ? [current, ...shuffled(this.order.filter((id) => id !== current))].filter(Boolean) : this.order.slice();
    this.index = Math.max(0, this.queue.indexOf(current));
    this.update({ shuffle: on });
    this.engine.changed();
  }
  update(patch) {
    const pl = this.playlist();
    if (pl) state.update('playlists', () => Object.assign(pl, patch));
  }
  upNext() {
    if (this.queued) return library.get(this.queued);
    const j = this.nextIndex(1);
    if (j < 0 || (j === this.index && this.repeat !== 'one')) return null;
    return library.get(this.queue[j]);
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

class Engine {
  constructor() {
    this.voices = new Set();
    this.buses = {};
    this.buffers = new Map();
    this.music = new Deck(this);  // the deck: whatever playlist or track is playing
    this.layers = new Map();      // sounds on top: soundId -> {voice, volume, lowpass}
    this.lowpass = { amount: 0, deck: true, pads: false };     // amount 0 open .. 1 muffled; who goes through it
    this.speed = 1;               // playback speed for the same sounds as the low-pass (SPEED_MIN..SPEED_MAX)
    this.pads = new Map();        // pad key -> Set<Voice>
    this.mix = new Map();         // the Console's faders: soundId -> {level, base}, only while it plays
    this.ducked = false;
    this.preview = null;
    this.previewRoute = 'main';   // 'main', 'device' (the chosen output) or 'missing' (chosen, not connected: silent)
    this.cue = null;              // {out, el}: the preview bus's way to another device
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
    this.applyLevels(true);
    this.routePreview();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.routePreview());
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
    this._changed = setTimeout(() => { this.pruneMix(); bus.emit('audio'); this.updateSession(); }, 0);
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
    set(this.buses.preview.gain, levelToGain(state.get('settings').previewLevel ?? 0.95));
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

  // ---- the deck ----------------------------------------------------------------
  // One playlist or track at a time: starting one ends the one before. Sounds on top stay.
  get track() { return this.music.track; }
  get playing() { return this.music.playing; }
  playlist() { return this.music.playlist(); }

  playPlaylist(pl, opts = {}) {
    if (pl) this.music.play(pl, opts);
  }
  playSingle(sound, opts) { this.music.playSingle(sound, opts); }
  /** Queue one sound to play after the current track (shown at the top), or take it off. */
  queueNext(sound) { this.init(); this.music.queueNext(sound); }
  clearNext() { this.music.clearNext(); }

  togglePlay() {
    this.init();
    if (this.music.toggle()) return;
    const pl = state.get('playlists').list.find((p) => p.tracks?.length);
    if (pl) this.playPlaylist(pl);
    else bus.emit('toast', { message: 'No music to play yet. Make a playlist or play a track from the library.' });
  }
  next() { this.music.next(); }
  prev() { this.music.prev(); }
  seek(pos) { this.music.seek(pos); }
  stopMusic(fade = 1) { this.music.stop(fade); }
  setRepeat(mode) { this.music.setRepeat(mode); }
  setShuffle(on) { this.music.setShuffle(on); }
  upNext() { return this.music.upNext(); }

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

  // ---- sounds on top ----------------------------------------------------------------
  // Started on purpose (a track's on-top button), over whatever the deck plays. Each plays as the sound
  // is set: ambience loops until stopped, music plays once.
  layerOn(id) { return this.layers.has(id); }
  startLayer(id, { volume = 1, fade } = {}) {
    const s = library.get(id);
    if (!s || this.layers.has(id)) return;
    const v = this.voice(s, busOf(s), {
      volume,
      slot: 'top',
      repeat: s.repeat ?? (s.kind === 'ambience' ? 0 : 1),
      fadeIn: Math.max(fade ?? (s.kind === 'ambience' ? 2 : 0.3), s.fadeIn || 0),
      onEnd: () => { if (this.layers.get(id)?.voice === v) { this.layers.delete(id); this.changed(); } },
    });
    this.layers.set(id, { voice: v, volume, lowpass: true });
    this.startVoice(v);
    this.changed();
  }
  stopLayer(id, fade = 1.5) {
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
      from, to, repeat, volume: pad.volume ?? 1, loopFade: mode === 'toggle' ? Math.min(s.loopFade || 0, (to - from) / 3) : 0, slot: 'pad',
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
  stopPadVoice(v, fade = 0.2) {
    for (const set of this.pads.values()) set.delete(v);
    v.stop(fade);
    this.changed();
  }

  // ---- the Console's faders -----------------------------------------------------------
  // A fader sets how loud a sound plays this time, never its saved volume (Volume…, the editor): the
  // level goes when the sound leaves the Playing list (checked after the change, so the next pass of a
  // looping track keeps it) and when the saved volume changes, which is then what plays.
  mixLevel(id) { return this.mix.get(id)?.level ?? library.get(id)?.volume ?? 1; }
  setMix(id, level) {
    this.mix.set(id, { level: clamp(level, 0, MAX_VOLUME), base: library.get(id)?.volume ?? 1 });
    for (const v of this.voices) if (v.slot && v.sound.id === id) v.setVolume(v.volume);
  }
  pruneMix() {
    if (!this.mix.size) return;
    const live = new Set();
    for (const v of this.voices) if (v.slot && v.state !== 'stopped' && v.state !== 'stopping') live.add(v.sound.id);
    for (const id of [...this.mix.keys()]) if (!live.has(id)) this.mix.delete(id);
  }

  /** Everything audible, for the Console: the deck's track, the sounds on top, and the effects (pads and
   *  effects played from the library). [{voice, role: 'deck' | 'top' | 'pad', id, where, lowpass}] */
  playingNow() {
    const out = [];
    const live = (v) => v && v.state !== 'stopped' && v.state !== 'stopping';
    const m = this.music;
    if (live(m.voice)) out.push({ voice: m.voice, role: 'deck', id: m.voice.sound.id, where: m.playlist()?.name || 'on its own', lowpass: this.lowpass.deck });
    for (const [id, l] of this.layers) if (live(l.voice)) out.push({ voice: l.voice, role: 'top', id, where: 'on top', lowpass: l.lowpass, loop: l.voice.repeat === 0 });
    for (const [key, set] of this.pads) {
      for (const v of set) {
        if (!live(v)) continue;
        out.push({ voice: v, role: 'pad', id: v.sound.id, where: key.startsWith('lib:') ? 'from the library' : `pad ${key.split(':').pop()}`, lowpass: this.lowpass.pads, loop: v.repeat === 0 });
      }
    }
    return out;
  }
  /** Pause or resume one playing sound (a playingNow() entry): the track, a sound on top or a pad. */
  togglePauseItem(item) {
    if (item.role === 'deck') { this.togglePlay(); return; }
    const v = item.voice;
    if (v.state === 'playing') v.pause();
    else if (v.state === 'paused') v.resume();
  }
  /** Loop a sound on top or a pad (a playingNow() entry), or let it finish. */
  setLooping(item, on) {
    if (item.role === 'deck') return;                 // the deck loops with its repeat (Repeat track)
    item.voice.setLooping(on);
    this.changed();
  }
  /** Move a playing sound (a playingNow() entry) to a position, in seconds from its start. */
  seekItem(item, pos) {
    if (item.role === 'deck') this.seek(pos); else item.voice.seek(pos);
  }

  // ---- low-pass ---------------------------------------------------------------------------
  // One sweep for the sounds switched into it: the deck's track, each sound on top (its own switch) and,
  // if asked, the pads. The cutoff glides (a 30 ms time constant), so dragging it sounds like a knob.
  lowpassHz(amount = this.lowpass.amount) { return LP_OPEN * (LP_MIN / LP_OPEN) ** clamp(amount, 0, 1); }
  filtered(v) {
    if (v.slot === 'deck') return this.lowpass.deck;
    if (v.slot === 'pad') return this.lowpass.pads;
    if (v.slot === 'top') return this.layers.get(v.sound.id)?.lowpass ?? true;
    return false;                                     // previews are never filtered
  }
  cutoffFor(v) { return this.filtered(v) ? this.lowpassHz() : LP_OPEN; }
  applyLowpass() {
    if (ctx) {
      const t = ctx.currentTime;
      for (const v of this.voices) {
        const f = v.filter.frequency;
        f.cancelScheduledValues(t);
        f.setTargetAtTime(this.cutoffFor(v), t, 0.03);
      }
    }
    bus.emit('audio:lowpass');
  }
  setLowpass(amount) {
    this.lowpass.amount = clamp(amount, 0, 1);
    this.applyLowpass();
  }
  /** Switch a playing sound (a playingNow() entry) into the low-pass and speed, or out of them. */
  setFiltered(item, on) {
    if (item.role === 'deck') this.lowpass.deck = on;
    else if (item.role === 'pad') this.lowpass.pads = on;
    else { const l = this.layers.get(item.id); if (l) l.lowpass = on; }
    this.applyLowpass();
    this.applySpeed();
    this.changed();
  }

  // ---- speed ----------------------------------------------------------------------------
  // Faster or slower, pitch following, for the sounds switched into the low-pass (previews never). New
  // sounds start at it. Not kept: a reload plays at normal speed.
  rateFor(v) { return this.filtered(v) ? this.speed : 1; }
  applySpeed() {
    for (const v of this.voices) v.setRate(this.rateFor(v));
    bus.emit('audio:speed');
  }
  setSpeed(r) {
    this.speed = clamp(r, SPEED_MIN, SPEED_MAX);
    this.applySpeed();
  }

  // ---- everything ---------------------------------------------------------------
  fadeAll(seconds = state.get('settings').fadeAll) {
    if (this.music.voice) { this.music.voice.stop(seconds); this.music.voice = null; }
    this.music.queued = null;
    for (const id of [...this.layers.keys()]) this.stopLayer(id, seconds);
    this.stopEffects(Math.min(seconds, 0.8));
    if (this.previewRoute !== 'device') this.stopPreview();     // a preview in your headphones isn't the table's
    this.changed();
  }
  anythingPlaying() { return [...this.voices].some((v) => v.state === 'playing'); }

  // ---- auditioning from the library / editor --------------------------------------
  /** One preview at a time; it doesn't touch the deck, layers or pads. */
  previewSound(sound, { from, to, at = 0, loop = false, onEnd } = {}) {
    this.stopPreview(0.04);
    if (this.previewRoute === 'missing') { this.missingOutput(); return null; }
    if (this.previewRoute === 'device') this.cue.el.play().catch(() => {});
    const v = this.voice(sound, 'preview', { from, to, repeat: loop ? 0 : 1, fadeIn: 0.01, fadeOut: 0, loopFade: 0, onEnd: () => { if (this.preview === v) this.preview = null; onEnd?.(); this.changed(); } });
    this.preview = v;
    this.startVoice(v, at);
    return v;
  }
  stopPreview(fade = 0.08) {
    if (this.preview) { this.preview.stop(fade); this.preview = null; this.changed(); }
  }
  /** Is this sound the one being previewed? */
  previewing(id) {
    return this.preview?.sound.id === id && ['loading', 'playing', 'paused'].includes(this.preview.state);
  }
  /** Preview the sound if it isn't already, stop it if it is. */
  togglePreview(sound) {
    if (this.previewing(sound.id)) this.stopPreview();
    else { this.previewSound(sound); this.changed(); }
  }

  // ---- the preview output ----------------------------------------------------------------
  // With an output chosen, the preview bus leaves the master and goes, as a MediaStream, to an <audio>
  // element sent to that device, so only the DM hears it. If the device isn't there, previews go
  // silent rather than out of the table's speakers. Safari (and so every iPad) can't choose a device.
  get canRoutePreview() {
    return !!navigator.mediaDevices?.enumerateDevices && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  }
  async routePreview() {
    if (!ctx) return;
    const want = state.get('settings').previewOutput;
    const turn = (this._routeTurn = (this._routeTurn || 0) + 1);
    let route = 'main';
    if (want?.id && this.canRoutePreview) {
      if (!this.cue) {
        const out = ctx.createMediaStreamDestination();
        const el = new Audio();
        el.srcObject = out.stream;
        this.cue = { out, el };
      }
      try {
        const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        if (outs.some((d) => d.deviceId) && !outs.some((d) => d.deviceId === want.id)) throw new Error('not connected');
        await this.cue.el.setSinkId(want.id);
        route = 'device';
      } catch {
        route = 'missing';
      }
    }
    if (turn !== this._routeTurn) return;          // a newer choice is on its way
    const b = this.buses.preview;
    b.disconnect();
    if (route === 'device') { b.connect(this.cue.out); this.cue.el.play().catch(() => {}); }
    else if (route === 'main') b.connect(this.master);
    if (route !== 'device') this.cue?.el.pause();
    const was = this.previewRoute;
    this.previewRoute = route;
    if (route === 'missing') this.stopPreview(0);
    if (route !== was) bus.emit('audio:route', route);
  }
  /** Send previews to this output ({id, label}), or back to the main output (null). */
  setPreviewOutput(device) {
    state.update('settings', (s) => { s.previewOutput = device ? { id: device.deviceId ?? device.id, label: device.label || 'the chosen output' } : null; }, { silent: true });
    return this.routePreview();
  }
  missingOutput() {
    const label = state.get('settings').previewOutput?.label || 'the chosen output';
    bus.emit('toast', { message: `Previews are set to play on ${label}, which isn't connected. Plug it in, or choose another output in Settings, Audio.`, type: 'error' });
  }
  /** Two soft notes on the preview output, to hear where it plays. */
  testPreview() {
    this.init();
    if (this.previewRoute === 'missing') { this.missingOutput(); return; }
    if (this.previewRoute === 'device') this.cue.el.play().catch(() => {});
    const t = ctx.currentTime + 0.03;
    [[660, 0], [880, 0.2]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.3, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.4);
      o.connect(g).connect(this.buses.preview);
      o.start(t + d);
      o.stop(t + d + 0.45);
    });
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
  const deck = engine.music;
  deck.queue = deck.queue.map(map);
  deck.order = deck.order.map(map);
  if (deck.queued) deck.queued = map(deck.queued);
  if (deck.playlistId) deck.playlistId = map(deck.playlistId);
  for (const [id, l] of [...engine.layers]) {
    if (map(id) === id) continue;
    engine.layers.delete(id);
    engine.layers.set(map(id), l);
  }
  for (const [id, m] of [...engine.mix]) if (map(id) !== id) { engine.mix.delete(id); engine.mix.set(map(id), m); }
  for (const [id, b] of [...engine.buffers]) if (map(id) !== id) engine.buffers.set(map(id), b);
  for (const v of engine.voices) {
    const s = library.get(map(v.sound.id));
    if (s) v.sound = s;
  }
  engine.changed();
});

// A sound's settings changed (its volume, say): what is playing hears it at once. The library hands out
// fresh copies of every sound when it reloads (a sound was added, GitHub was checked), so playing voices
// are pointed at the current copy first; before, a volume change missed sounds started before a reload.
// A new saved volume replaces the Console's level for this play.
bus.on('library:sound', (s) => {
  const m = engine.mix.get(s.id);
  if (m && (s.volume ?? 1) !== m.base) engine.mix.delete(s.id);
  for (const v of engine.voices) if (v.sound.id === s.id) { v.sound = s; v.setVolume(v.volume); }
});
bus.on('library', () => {
  for (const v of engine.voices) { const s = library.get(v.sound.id); if (s) v.sound = s; }
});

// Keep the deck honest when a sound is deleted or edited.
bus.on('library:removed', (id) => {
  if (engine.music.voice?.sound.id === id) engine.music.stop(0.3);
  if (engine.music.queued === id) engine.music.clearNext();
  if (engine.layers.has(id)) engine.stopLayer(id, 0.3);
});
