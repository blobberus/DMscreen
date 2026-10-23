// Console: the screen's answer to "what is playing, and what can I fire next?"
// Now playing with its flag strip (click a flag or press Alt+Shift+1..9), the transport, the playlist
// keys, and the mixer with a strip for every ambience layer that is running.
import { h, icon, clear, setIcon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { keys } from '../core/keys.js';
import { kbd } from '../core/kbd.js';
import { library } from '../core/library.js';
import { fader } from '../core/fader.js';
import { fmtTime, fmtDuration, clamp } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { playlists, REPEAT } from '../audio/playlists.js';
import { drawBars, themeColors, timeToX } from '../audio/wave.js';

export default function createConsole({ el }) {
  const root = h('div', { class: 'cn' });
  el.append(root);

  // ---- now playing ----------------------------------------------------------
  const context = h('p', { class: 'cn-context' });
  const track = h('h2', { class: 'cn-track truncate' });
  const pos = h('span', { class: 'cn-pos time' });
  const len = h('span', { class: 'cn-len time' });
  const canvas = h('canvas', { class: 'cn-wave', 'aria-label': 'Waveform of the playing track. Click to jump.' });
  const playhead = h('i', { class: 'cn-playhead' });
  const flagLayer = h('div', { class: 'cn-flaglayer' });
  const strip = h('div', { class: 'cn-strip' }, flagLayer, h('div', { class: 'cn-wavebox' }, canvas, playhead));
  const playIcon = icon('play', 'icon-lg');
  const shuffleBtn = h('button', { class: 'btn-icon', type: 'button', title: 'Shuffle', 'aria-label': 'Shuffle', 'aria-pressed': 'false', onclick: () => engine.setShuffle(!engine.music.shuffle) }, icon('shuffle'));
  const repeatIcon = icon('repeat');
  const repeatBtn = h('button', { class: 'btn-icon', type: 'button', title: 'Repeat', 'aria-label': 'Repeat', onclick: () => {
    const order = ['all', 'one', 'off'];
    engine.setRepeat(order[(order.indexOf(engine.music.repeat) + 1) % order.length]);
  } }, repeatIcon);
  const upNext = h('p', { class: 'cn-upnext truncate' });
  const transport = h('div', { class: 'cn-transport' },
    h('div', { class: 'cn-tbtns' },
      tbtn('prev', 'Previous track', 'music.prev', () => engine.prev()),
      h('button', { class: 'btn-icon cn-play', type: 'button', title: 'Play or pause (Alt+P)', 'aria-label': 'Play or pause', onclick: () => engine.togglePlay() }, playIcon),
      tbtn('next', 'Next track', 'music.next', () => engine.next()),
      h('span', { class: 'cn-tsep' }),
      tbtn('flag-prev', 'Back to the previous flag', 'flag.prev', () => engine.prevFlag()),
      tbtn('flag-next', 'Skip to the next flag', 'flag.next', () => engine.nextFlag()),
      h('span', { class: 'cn-tsep' }),
      shuffleBtn, repeatBtn),
    upNext);
  const flagList = h('div', { class: 'cn-flags', role: 'list' });
  const plRow = h('div', { class: 'cn-playlists' });
  const now = h('section', { class: 'cn-now', 'aria-label': 'Now playing' },
    h('div', { class: 'cn-head' }, h('div', { class: 'cn-titles' }, context, track), h('div', { class: 'cn-clock' }, pos, len)),
    strip, transport, flagList,
    h('div', { class: 'cn-plwrap' }, h('h3', { class: 'cn-h' }, 'Playlists'), plRow));

  // ---- mixer ------------------------------------------------------------------
  const strips = h('div', { class: 'cn-strips' });
  const duckBtn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': 'false', title: 'Lower music and ambience while you talk (Alt+\\)', onclick: () => engine.toggleDuck() }, icon('duck'), 'Duck');
  const mixer = h('section', { class: 'cn-mixer', 'aria-label': 'Mixer' },
    h('div', { class: 'cn-mixhead' },
      h('h3', { class: 'cn-h' }, 'Mixer'),
      h('span', { class: 'cn-spacer' }),
      duckBtn,
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Fade everything out (Alt+0)', onclick: () => engine.fadeAll() }, icon('fade'), 'Fade all', kbd(keys.combo('fade.all')))),
    strips);

  root.append(now, mixer);

  function tbtn(name, label, action, run) {
    const combo = keys.combo(action);
    return h('button', { class: 'btn-icon', type: 'button', title: combo ? `${label} (${combo})` : label, 'aria-label': label, onclick: run }, icon(name));
  }

  // ---- waveform + flags ---------------------------------------------------------
  let peaks = null;
  let peaksFor = null;
  const cache = {};
  let colors = themeColors();
  async function loadPeaks(s) {
    if (peaksFor === s.id) return;
    peaksFor = s.id;
    peaks = null;
    try {
      const p = await library.peaks(s.id);
      if (peaksFor === s.id) { peaks = p; cache.key = null; drawWave(); }
    } catch { /* drawn flat */ }
  }
  function drawWave() {
    const v = engine.music.voice;
    if (!v || !canvas.isConnected || canvas.clientWidth === 0) return;
    const { w, h: hh } = drawBars(canvas, peaks, { t0: v.from, t1: v.to, played: v.from + v.position, step: 3, gap: 1, cache, colors });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colors.played;
    for (const f of engine.flags()) ctx.fillRect(Math.round(timeToX(f.t, v.from, v.to, w)), 0, 1, hh);
    playhead.style.left = `${(v.progress * 100).toFixed(2)}%`;
  }
  function placeFlags() {
    clear(flagLayer);
    const v = engine.music.voice;
    if (!v) return;
    const w = strip.clientWidth || 1;
    const rows = [-1e9, -1e9];
    for (const [i, f] of engine.flags().entries()) {
      const x = timeToX(f.t, v.from, v.to, w);
      const label = `${i < 9 ? `${i + 1}  ` : ''}${f.label}`;
      const approx = Math.min(180, 14 + label.length * 6.6);
      const row = x - rows[0] > 8 ? 0 : x - rows[1] > 8 ? 1 : 0;
      rows[row] = x + approx;
      const btn = h('button', {
        class: 'cn-flag', type: 'button', style: { left: `${x}px`, top: `${row * 22}px` }, 'data-row': row, title: `Jump to ${f.label} (${fmtTime(f.t)})`,
        onclick: () => engine.jumpTo(f.t),
      }, h('span', { class: 'truncate' }, label));
      flagLayer.append(btn);
    }
    const two = rows[1] > -1e9;
    flagLayer.classList.toggle('has-two-rows', two);
    strip.style.paddingTop = `${two ? 46 : 24}px`;
    // each label's leader drops to the top of the waveform, where the canvas draws the rest of the line
    for (const b of flagLayer.children) b.style.setProperty('--drop', `${(two ? 46 : 24) - 20 - Number(b.dataset.row) * 22}px`);
  }
  canvas.addEventListener('click', (e) => {
    const v = engine.music.voice;
    if (!v) return;
    const r = canvas.getBoundingClientRect();
    engine.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * v.length);
  });

  // ---- rendering ------------------------------------------------------------------
  let flagsKey = '';
  function render() {
    const v = engine.music.voice;
    const s = v?.sound;
    const pl = engine.playlist();
    setIcon(playIcon, v && v.state === 'playing' ? 'pause' : 'play');
    shuffleBtn.setAttribute('aria-pressed', String(!!engine.music.shuffle));
    setIcon(repeatIcon, engine.music.repeat === 'one' ? 'repeat-one' : 'repeat');
    repeatBtn.setAttribute('aria-pressed', String(engine.music.repeat !== 'off'));
    repeatBtn.title = REPEAT[engine.music.repeat] || 'Repeat';
    renderPlaylists();
    strip.hidden = !s;
    if (!s) {
      now.classList.add('is-stopped');
      track.textContent = pl ? `${pl.name} is stopped` : 'Nothing playing';
      context.textContent = pl ? 'Alt+P plays it again from this track.' : 'Start a playlist below or with Alt+1 to 9.';
      pos.textContent = '';
      len.textContent = '';
      clear(flagList);
      clear(flagLayer);
      upNext.textContent = '';
      peaksFor = null;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      playhead.hidden = true;
      flagsKey = '';
      return;
    }
    now.classList.remove('is-stopped');
    playhead.hidden = false;
    const m = engine.music;
    track.textContent = s.name;
    context.textContent = pl ? `${pl.name} · track ${m.index + 1} of ${m.queue.length}` : 'Playing on its own';
    const nxt = engine.upNext();
    upNext.replaceChildren(nxt ? h('span', null, h('span', { class: 'faint' }, 'Up next  '), nxt.name) : h('span', { class: 'faint' }, m.repeat === 'off' && m.index === m.queue.length - 1 ? 'Last track' : ''));
    len.textContent = ` / ${fmtTime(v.length)}`;
    loadPeaks(s);
    const key = `${s.id}|${v.from}|${v.to}|${JSON.stringify(s.flags || [])}`;
    if (key !== flagsKey) {
      flagsKey = key;
      renderFlagList();
      placeFlags();
      cache.key = null;
    }
    tick();
  }
  function renderFlagList() {
    clear(flagList);
    const flags = engine.flags();
    if (!flags.length) {
      flagList.append(h('p', { class: 'meta cn-noflags' }, 'No flags in this track. Add them in the Sound library to skip straight to a moment.'));
      return;
    }
    flags.forEach((f, i) => {
      flagList.append(h('button', { class: 'cn-flagbtn', type: 'button', role: 'listitem', title: `Jump to ${f.label}`, onclick: () => engine.jumpTo(f.t) },
        i < 9 ? kbd(keys.combo(`flag.${i + 1}`)) : null,
        h('span', { class: 'truncate' }, f.label),
        h('span', { class: 'time faint' }, fmtTime(f.t))));
    });
  }
  function tick() {
    const v = engine.music.voice;
    if (!v) return;
    pos.textContent = fmtTime(v.position);
    drawWave();
    const now = v.from + v.position;
    const flags = engine.flags();
    let current = -1;
    flags.forEach((f, i) => { if (f.t <= now + 0.05) current = i; });
    [...flagList.querySelectorAll('.cn-flagbtn')].forEach((b, i) => b.classList.toggle('is-current', i === current));
  }
  function renderPlaylists() {
    clear(plRow);
    const list = playlists.list();
    if (!list.length) {
      plRow.append(h('p', { class: 'meta' }, 'No playlists yet. Make one in the Playlists pane and give it a number key.'));
      return;
    }
    const sorted = list.slice().sort((a, b) => (a.key || 99) - (b.key || 99));
    // Idle: the playlists are the next thing to fire, so they get a row each with what's in them.
    const idle = !engine.music.voice;
    plRow.classList.toggle('is-list', idle);
    if (idle) {
      for (const pl of sorted) {
        const amb = pl.ambience.map((a) => library.get(a.id)?.name).filter(Boolean);
        plRow.append(h('button', { class: 'cn-plrow', type: 'button', title: `Start ${pl.name}${pl.key ? ` (Alt+${pl.key})` : ''}`, onclick: () => playlists.play(pl.id) },
          pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : h('span', { class: 'kbd is-blank' }, '–'),
          h('span', { class: 'cn-plname truncate' }, pl.name),
          h('span', { class: 'meta truncate' }, [`${pl.tracks.length} ${pl.tracks.length === 1 ? 'track' : 'tracks'}`, fmtDuration(playlists.duration(pl)), amb.length ? `with ${amb.join(', ')}` : null].filter(Boolean).join(' · ')),
          icon('play', 'icon-sm')));
      }
      return;
    }
    for (const pl of sorted) {
      const playing = engine.music.playlistId === pl.id && engine.music.voice;
      plRow.append(h('button', {
        class: `cn-pl ${playing ? 'is-selected' : ''}`, type: 'button', title: `Start ${pl.name}${pl.key ? ` (Alt+${pl.key})` : ''}`,
        onclick: () => playlists.play(pl.id),
      }, pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : null, h('span', { class: 'truncate' }, pl.name)));
    }
  }

  // ---- mixer strips ----------------------------------------------------------------
  const busFaders = {};
  let layerKey = '';
  let mode = '';
  // Wide: the mixer stands beside "now playing". Tall: below it, with upright faders.
  // Otherwise: a compact grid of level sliders, so a quarter of the screen shows everything.
  const pickMode = () => (root.clientWidth >= 1000 ? 'side' : root.clientHeight >= 660 ? 'stack' : 'compact');
  function buildStrips() {
    mode = pickMode();
    root.dataset.mode = mode;
    const vertical = mode !== 'compact';
    clear(strips);
    const layers = [...engine.layers.entries()];
    const layerStrips = layers.map(([id, l]) => {
      const s = library.get(id);
      const val = h('span', { class: 'cn-val num' }, Math.round(l.volume * 100));
      const f = fader({ value: l.volume, vertical, label: `${s?.name || 'Layer'} level`, onInput: (v) => { engine.setLayerVolume(id, v); val.textContent = Math.round(v * 100); } });
      return h('div', { class: 'cn-strip-ch is-layer' },
        h('span', { class: 'cn-chname truncate', title: s?.name }, s?.name || 'Layer'),
        f.el, val,
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Stop ${s?.name || 'this layer'}`, 'aria-label': `Stop ${s?.name || 'layer'}`, onclick: () => engine.stopLayer(id) }, icon('close')));
    });
    const none = h('p', { class: 'meta cn-nolayers' }, 'No ambience layers running. Start one from a playlist or the library.');
    if (!vertical) {
      strips.append(busStrip('music', 'Music', false, vertical), busStrip('ambience', 'Ambience', false, vertical),
        busStrip('effects', 'Effects', false, vertical), busStrip('master', 'Master', true, vertical), ...layerStrips);
      return;
    }
    for (const [name, label] of [['music', 'Music'], ['ambience', 'Ambience'], ['effects', 'Effects']]) strips.append(busStrip(name, label, false, vertical));
    strips.append(h('div', { class: 'cn-layers' }, layers.length ? layerStrips : none));
    strips.append(busStrip('master', 'Master', true, vertical));
  }
  function busStrip(name, label, isMaster = false, vertical = true) {
    const val = h('span', { class: 'cn-val num' });
    const f = fader({
      value: engine.levels()[name], label: `${label} level`, vertical,
      onInput: (v) => { engine.setLevel(name, v); val.textContent = Math.round(v * 100); },
    });
    busFaders[name] = { f, val };
    val.textContent = Math.round(engine.levels()[name] * 100);
    return h('div', { class: `cn-strip-ch ${isMaster ? 'is-master' : ''}` }, h('span', { class: 'cn-chname' }, label), f.el, val);
  }
  function syncLevels() {
    for (const [name, { f, val }] of Object.entries(busFaders)) {
      const v = engine.levels()[name];
      f.value = v;
      val.textContent = Math.round(v * 100);
    }
    duckBtn.setAttribute('aria-pressed', String(engine.ducked));
    duckBtn.classList.toggle('is-active', engine.ducked);
  }
  function syncLayers() {
    const key = [...engine.layers.keys()].join('|');
    if (key !== layerKey) { layerKey = key; buildStrips(); }
  }

  buildStrips();
  render();
  const offs = [
    bus.on('audio', () => { render(); syncLayers(); }),
    bus.on('audio:tick', () => { if (!el.closest('.panel')?.hidden) tick(); }),
    bus.on('audio:levels', syncLevels),
    bus.on('library:sound', (s) => { if (engine.music.voice?.sound.id === s.id) { flagsKey = ''; render(); } }),
    bus.on('state:playlists', renderPlaylists),
    bus.on('state:settings', () => { colors = themeColors(); cache.key = null; drawWave(); }),
  ];

  return {
    show() { colors = themeColors(); cache.key = null; render(); },
    resize() {
      cache.key = null;
      placeFlags();
      drawWave();
      if (pickMode() !== mode) buildStrips();
    },
    destroy() { offs.forEach((off) => off()); },
  };
}
