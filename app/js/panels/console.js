// Console: the screen's answer to "what is playing, and what can I fire next?"
// Now playing with its flag strip (click a flag or press Alt+Shift+1..9), the transport, a list of
// everything playing (the track, sounds on top, pads), each with its own scrub bar, loop, low-pass switch,
// pause and stop, the low-pass sweep, the playlist keys, and the mixer with a fader for every sound playing.
import { h, icon, clear, setIcon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { keys } from '../core/keys.js';
import { kbd } from '../core/kbd.js';
import { library, MAX_VOLUME } from '../core/library.js';
import { fader } from '../core/fader.js';
import { fmtTime, fmtDuration, clamp } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { playlists, REPEAT } from '../audio/playlists.js';
import { board } from '../audio/board.js';
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
  const playingList = h('div', { class: 'cn-playing', role: 'list', 'aria-label': 'Everything playing' });
  // the low-pass sweep: 0 open .. 1 muffled, for the sounds switched into it (each row's wave button)
  const lpVal = h('span', { class: 'num meta cn-lpval' });
  const lpSlider = h('input', { class: 'range cn-lp', type: 'range', min: 0, max: 1, step: 0.001, value: engine.lowpass.amount, 'aria-label': 'Low-pass filter' });
  lpSlider.addEventListener('input', () => { engine.setLowpass(Number(lpSlider.value)); syncLowpass(); });
  lpSlider.addEventListener('dblclick', () => { engine.setLowpass(0); syncLowpass(); });
  const lpPads = h('input', { type: 'checkbox' });
  lpPads.addEventListener('change', () => engine.setFiltered({ role: 'pad' }, lpPads.checked));
  const playingHead = h('div', { class: 'cn-playhd' },
    h('h3', { class: 'cn-h' }, 'Playing'),
    h('span', { class: 'cn-spacer' }),
    h('label', { class: 'cn-lpwrap', title: 'Low-pass: slide right to muffle the sounds switched into it (their wave button). Double-click to open it again.' },
      h('span', { class: 'meta' }, 'Low-pass'), lpSlider, lpVal),
    h('label', { class: 'switch cn-lppads', title: 'Pads go through the low-pass too' }, lpPads, h('span', { class: 'meta' }, 'Pads too')));
  function syncLowpass() {
    const a = engine.lowpass.amount;
    lpSlider.value = a;
    const hz = engine.lowpassHz();
    lpVal.textContent = a < 0.002 ? 'Open' : hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
    lpPads.checked = engine.lowpass.pads;
  }
  syncLowpass();
  const plRow = h('div', { class: 'cn-playlists' });
  const ambRow = h('div', { class: 'cn-playlists' });
  const fxRow = h('div', { class: 'cn-playlists' });
  const now = h('section', { class: 'cn-now', 'aria-label': 'Now playing' },
    h('div', { class: 'cn-head' }, h('div', { class: 'cn-titles' }, context, track), h('div', { class: 'cn-clock' }, pos, len)),
    strip, transport,
    h('div', { class: 'cn-plwrap cn-playwrap' }, playingHead, playingList),
    flagList,
    h('div', { class: 'cn-plwrap' }, h('h3', { class: 'cn-h' }, 'Playlists'), plRow),
    h('div', { class: 'cn-plwrap' }, h('h3', { class: 'cn-h' }, 'Ambience'), ambRow),
    h('div', { class: 'cn-plwrap' }, h('h3', { class: 'cn-h' }, 'Effects'), fxRow));

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
  // The waveform's size is measured when it changes (ResizeObserver), not every frame, and it is
  // redrawn only when the played part reaches the next bar; the playhead glides as a transform.
  let waveW = 0;
  let waveH = 0;
  let lastCol = -1;
  let lastX = -1;
  new ResizeObserver(() => {
    waveW = canvas.clientWidth;
    waveH = canvas.clientHeight;
    cache.key = null;
    drawWave();
  }).observe(canvas);
  function drawWave() {
    const v = engine.music.voice;
    if (!v || !canvas.isConnected || waveW === 0) return;
    const col = Math.floor((v.progress * waveW) / 3);
    if (col !== lastCol || !cache.key) {
      lastCol = col;
      const { w, h: hh } = drawBars(canvas, peaks, { t0: v.from, t1: v.to, played: v.from + v.position, step: 3, gap: 1, cache, colors, size: [waveW, waveH] });
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = colors.played;
      for (const f of engine.flags()) ctx.fillRect(Math.round(timeToX(f.t, v.from, v.to, w)), 0, 1, hh);
    }
    const x = Math.round(v.progress * waveW);
    if (x !== lastX) { lastX = x; playhead.style.transform = `translateX(${x}px)`; }
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
    // no flags, no room kept for their labels: the Playing list moves up instead
    strip.style.paddingTop = `${!flagLayer.children.length ? 4 : two ? 46 : 24}px`;
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
    renderEffects();
    renderPlaying();
    strip.hidden = !s;
    if (!s) {
      now.classList.add('is-stopped');
      track.textContent = pl ? `${pl.name} is stopped` : engine.layers.size ? 'Only sounds on top' : 'Nothing playing';
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
    upNext.replaceChildren(nxt ? h('span', null, h('span', { class: 'faint' }, m.queued ? 'Queued next  ' : 'Up next  '), nxt.name,
      m.queued ? h('button', { class: 'btn-icon btn-sm cn-unq', type: 'button', title: `Take ${nxt.name} off the queue`, 'aria-label': `Take ${nxt.name} off the queue`, onclick: () => engine.clearNext() }, icon('close', 'icon-sm')) : null)
      : h('span', { class: 'faint' }, m.repeat === 'off' && m.index === m.queue.length - 1 ? 'Last track' : ''));
    len.textContent = ` / ${fmtTime(v.length)}`;
    loadPeaks(s);
    const key = `${s.id}|${v.from}|${v.to}|${JSON.stringify(s.flags || [])}`;
    if (key !== flagsKey) {
      flagsKey = key;
      lastFlag = -2;
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
  let lastPos = '';
  let lastFlag = -2;
  function tick() {
    tickPlaying();
    const v = engine.music.voice;
    if (!v) return;
    const p = fmtTime(v.position);
    if (p !== lastPos) { lastPos = p; pos.textContent = p; }
    drawWave();
    const now = v.from + v.position;
    const flags = engine.flags();
    let current = -1;
    flags.forEach((f, i) => { if (f.t <= now + 0.05) current = i; });
    if (current !== lastFlag) {
      lastFlag = current;
      [...flagList.querySelectorAll('.cn-flagbtn')].forEach((b, i) => b.classList.toggle('is-current', i === current));
    }
  }
  // ---- everything playing ------------------------------------------------------------
  // A row per sound, each with a scrub bar: click or drag it (or use the arrow keys) to move that sound.
  // Rows are rebuilt only when what plays changes, so a drag isn't cut short by its own seek.
  const KIND = { music: 'Music', ambience: 'Ambience', effect: 'Effect' };
  // the bars move in whole pixels: a pad's bar redrawn in thousandths changed on every frame for nothing
  let barW = 0;
  new ResizeObserver(() => { if (playingList.clientWidth) barW = playingList.clientWidth; }).observe(playingList);
  let playingRows = [];
  let playingKey = null;
  function renderPlaying() {
    const items = engine.playingNow();
    const key = items.map((it) => `${it.role}:${it.voice.serial}:${it.voice.state === 'paused'}:${it.lowpass}:${it.loop}`).join('|');
    if (key === playingKey) { tickPlaying(); return; }
    playingKey = key;
    clear(playingList);
    playingRows = [];
    if (!items.length) {
      playingList.append(h('p', { class: 'meta cn-pnone' }, 'Nothing is playing. Start a playlist below, or put a sound on top with a track’s layers button in the Playlists pane.'));
      return;
    }
    for (const it of items) {
      const v = it.voice;
      const name = v.sound.name;
      const time = h('span', { class: 'cn-ptime time' });
      const stop = () => (it.role === 'deck' ? engine.stopMusic(1) : it.role === 'top' ? engine.stopLayer(it.id) : engine.stopPadVoice(v));
      const paused = v.state === 'paused';
      const bar = scrubber(it);
      playingList.append(h('div', { class: `cn-prow is-${it.role} ${paused ? 'is-paused' : ''}`, role: 'listitem' },
        h('span', { class: 'cn-ptitle' },
          h('span', { class: 'cn-pname truncate', title: name }, name),
          h('span', { class: 'cn-pwhere meta truncate' }, `${KIND[v.sound.kind] || 'Sound'} · ${paused ? `${it.where} · paused` : it.where}`)),
        time,
        h('span', { class: 'cn-pbtns' },
          // sounds on top and pads loop or play once (the track loops with the transport's Repeat track)
          it.role === 'deck' ? null : h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-pressed': String(!!it.loop), title: it.loop ? 'Looping. Press to let it finish this pass.' : 'Plays once. Press to loop it.', 'aria-label': `Loop ${name}`, onclick: () => engine.setLooping(it, !it.loop) }, icon('loop', 'icon-sm')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-pressed': String(!!it.lowpass), title: it.lowpass ? 'Goes through the low-pass. Press to keep it clear.' : 'Kept clear of the low-pass. Press to send it through.', 'aria-label': `Low-pass for ${name}`, onclick: () => engine.setFiltered(it, !it.lowpass) }, icon('wave', 'icon-sm')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: paused ? 'Resume' : 'Pause', 'aria-label': `${paused ? 'Resume' : 'Pause'} ${name}`, onclick: () => engine.togglePauseItem(it) }, icon(paused ? 'play' : 'pause', 'icon-sm')),
          h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Stop ${name}`, 'aria-label': `Stop ${name}`, onclick: stop }, icon('stop', 'icon-sm'))),
        bar.el));
      playingRows.push({ v, time, bar });
    }
    tickPlaying();
  }
  function tickPlaying() {
    for (const row of playingRows) {
      const { v, time, bar } = row;
      const t = v.repeat === 0 ? `${fmtTime(v.position)} · loops` : `${fmtTime(v.position)} / ${fmtTime(v.length)}`;
      if (t !== row.t) { row.t = t; time.textContent = t; }
      bar.sync();
    }
  }
  /** A progress bar that moves its sound: drag along it, click a spot, or use the arrow keys. */
  function scrubber(it) {
    const v = it.voice;
    const fill = h('i');
    const el = h('div', { class: 'cn-pbar', role: 'slider', tabindex: 0, 'aria-label': `Position in ${v.sound.name}`, 'aria-valuemin': 0 }, fill);
    let dragging = false;
    let shown = -1;
    let said = -1;
    const at = (e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * v.length; };
    const show = (pos) => {
      const px = barW || 1000;
      const f = v.length > 0 ? Math.round((pos / v.length) * px) / px : 0;
      if (f === shown) return;
      shown = f;
      fill.style.transform = `scaleX(${f})`;
      // a short sound's bar moves every frame; the whole second it reads out changes once a second
      const s = Math.round(pos);
      if (s !== said) { said = s; el.setAttribute('aria-valuenow', s); }
    };
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.classList.add('is-dragging');
      try { el.setPointerCapture(e.pointerId); } catch { /* no capture: the drag still works over the bar */ }
      const p = at(e);
      show(p);
      engine.seekItem(it, p);
    });
    el.addEventListener('pointermove', (e) => { if (!dragging) return; const p = at(e); show(p); engine.seekItem(it, p); });
    const end = () => { dragging = false; el.classList.remove('is-dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      engine.seekItem(it, clamp(v.position + step, 0, v.length));
    });
    el.setAttribute('aria-valuemax', Math.round(v.length));
    return { el, sync: () => { if (!dragging) show(v.position); } };
  }

  let plKey = '';
  function renderPlaylists() {
    const key = `${engine.music.playlistId}|${engine.music.voice ? 1 : 0}|${playlists.list().map((p) => `${p.id}:${p.name}:${p.key}:${p.kind || ''}`).join(',')}`;
    if (key === plKey) return;
    plKey = key;
    clear(ambRow);
    const amb = playlists.ofKind('ambience').sort((a, b) => (a.key || 99) - (b.key || 99));
    if (!amb.length) ambRow.append(h('p', { class: 'meta' }, 'No ambience playlists yet. Make one in the Playlists pane.'));
    for (const pl of amb) {
      ambRow.append(h('button', {
        class: `cn-pl ${playlists.playing(pl) ? 'is-selected' : ''}`, type: 'button', title: `Start ${pl.name}, ending what is playing${pl.key ? ` (Alt+${pl.key})` : ''}`,
        onclick: () => playlists.play(pl.id),
      }, pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : null, h('span', { class: 'truncate' }, pl.name)));
    }
    clear(plRow);
    const list = playlists.ofKind('music');
    if (!list.length) {
      plRow.append(h('p', { class: 'meta' }, 'No playlists yet. Make one in the Playlists pane and give it a number key.'));
      return;
    }
    const sorted = list.slice().sort((a, b) => (a.key || 99) - (b.key || 99));
    for (const pl of sorted) {
      const playing = engine.music.playlistId === pl.id && engine.music.voice;
      plRow.append(h('button', {
        class: `cn-pl ${playing ? 'is-selected' : ''}`, type: 'button', title: `Start ${pl.name}${pl.key ? ` (Alt+${pl.key})` : ''}`,
        onclick: () => playlists.play(pl.id),
      }, pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : null, h('span', { class: 'truncate' }, pl.name)));
    }
  }

  // The pads of every bank that has any, in keyboard order: tap one to fire it, as on the soundboard.
  const KEY_ORDER = '1234567890QWERTYUIOPASDFGHJKLZXCVBNM';
  let fxKey = '';
  function renderEffects() {
    const banks = board.banks().map((b) => ({ b, pads: Object.entries(b.pads || {}).filter(([, p]) => p && library.has(p.sound)) })).filter((x) => x.pads.length);
    const key = banks.map(({ b, pads }) => `${b.id}:${pads.map(([k, p]) => `${k}=${p.label || p.sound}${board.live(k, b).playing ? '*' : ''}`).join(',')}`).join('|');
    if (key === fxKey) return;
    fxKey = key;
    clear(fxRow);
    if (!banks.length) { fxRow.append(h('p', { class: 'meta' }, 'No pads yet. Each sound in sounds/Effects becomes a pad.')); return; }
    for (const { b, pads } of banks) {
      if (banks.length > 1) fxRow.append(h('span', { class: 'meta cn-fxbank' }, b.name));
      pads.sort(([a], [c]) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(c));
      for (const [k, p] of pads) {
        const label = p.label || library.get(p.sound)?.name || k;
        fxRow.append(h('button', {
          class: `cn-pl ${board.live(k, b).playing ? 'is-selected' : ''}`, type: 'button', title: `Fire ${label}${b.id === board.active().id ? ` (Alt+${k})` : ` (in ${b.name})`}`,
          onclick: () => board.fire(k, b),
        }, h('kbd', { class: 'kbd' }, k), h('span', { class: 'truncate' }, label)));
      }
    }
  }

  // ---- mixer strips ----------------------------------------------------------------
  const busFaders = {};
  let mode = '';
  let chanHost = null;
  const chans = new Map();           // sound id -> {el, f, val}: a fader per sound playing
  // Wide: the mixer stands beside "now playing". Tall: below it, with upright faders.
  // Otherwise: a compact grid of level sliders, so a quarter of the screen shows everything.
  const pickMode = () => (root.clientWidth >= 1000 ? 'side' : root.clientHeight >= 660 ? 'stack' : 'compact');
  function buildStrips() {
    mode = pickMode();
    root.dataset.mode = mode;
    const vertical = mode !== 'compact';
    clear(strips);
    chans.clear();
    chanHost = h('div', { class: 'cn-layers' });
    if (!vertical) {
      strips.append(busStrip('music', 'Music', false, vertical), busStrip('ambience', 'Ambience', false, vertical),
        busStrip('effects', 'Effects', false, vertical), busStrip('master', 'Master', true, vertical), chanHost);
    } else {
      for (const [name, label] of [['music', 'Music'], ['ambience', 'Ambience'], ['effects', 'Effects']]) strips.append(busStrip(name, label, false, vertical));
      strips.append(chanHost, busStrip('master', 'Master', true, vertical));
    }
    syncChannels();
  }
  // A fader for every sound that is playing (the track, sounds on top, pads), from silent to 300%. It
  // sets how loud the sound plays this time only (engine.setMix); its saved volume (Volume…, the editor)
  // stays as it was, and comes back the next time it plays. Double-click goes back to the saved volume.
  // Strips are added and removed one by one, so a pad going off never interrupts a fader being dragged.
  const pct = (x) => `${Math.round(x * MAX_VOLUME * 100)}%`;
  const faderAt = (volume) => clamp((volume ?? 1) / MAX_VOLUME, 0, 1);
  function syncChannels() {
    if (!chanHost) return;
    const vertical = mode !== 'compact';
    const items = engine.playingNow();
    const ids = new Set(items.map((it) => it.id));
    for (const [id, c] of chans) if (!ids.has(id)) { c.el.remove(); chans.delete(id); }
    for (const it of items) {
      if (chans.has(it.id)) continue;
      const s = library.get(it.id) || it.voice.sound;
      const start = faderAt(engine.mixLevel(it.id));
      const val = h('span', { class: 'cn-val num' }, pct(start));
      const f = fader({
        value: start, vertical, label: `${s.name} volume, this play only`, format: (x) => Math.round(x * MAX_VOLUME * 100),
        home: () => faderAt(library.get(it.id)?.volume),
        onInput: (x) => { engine.setMix(it.id, x * MAX_VOLUME); val.textContent = pct(x); },
      });
      const stop = () => {
        for (const p of engine.playingNow().filter((q) => q.id === it.id)) {
          if (p.role === 'deck') engine.stopMusic(1); else if (p.role === 'top') engine.stopLayer(p.id); else engine.stopPadVoice(p.voice);
        }
      };
      const el = h('div', { class: 'cn-strip-ch is-layer', title: `${s.name} (${it.where}). The fader sets this play only; Volume… in its ⋯ menu sets the saved volume` },
        h('span', { class: 'cn-chname truncate' }, s.name),
        f.el, val,
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Stop ${s.name}`, 'aria-label': `Stop ${s.name}`, onclick: stop }, icon('close')));
      chans.set(it.id, { el, f, val });
      chanHost.append(el);
    }
    let none = chanHost.querySelector('.cn-nolayers');
    if (!chans.size && !none) chanHost.append(h('p', { class: 'meta cn-nolayers' }, 'Nothing is playing. Every sound that plays gets a fader here that sets its volume for that play only (Volume… in its ⋯ menu sets the saved one).'));
    else if (chans.size && none) none.remove();
  }
  // its saved volume changed (Volume…, the editor): that is what plays now, and its fader follows
  function followVolume(s) {
    const c = chans.get(s.id);
    if (!c) return;
    if (c.f.el.classList.contains('is-dragging')) return;         // its own drag: already shown
    c.f.value = faderAt(engine.mixLevel(s.id));
    c.val.textContent = pct(c.f.value);
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

  // Rows come and go above what you may be looking at: a sound starts or ends and the Playing list grows
  // or shrinks, the next track has more flags. The browser's own scroll anchoring is off (.cn) and this
  // keeps the view still instead, on every browser: Safari before 27 has none, so on the iPad the mixer
  // jumped a row each time something started. A fader being dragged stays under the finger.
  function steady(change) {
    const box = mode === 'side' ? now : root;
    if (box.scrollTop <= 0) { change(); return; }
    const top = box.getBoundingClientRect().top;
    const held = box.querySelector('.fader.is-dragging, .cn-pbar.is-dragging');
    const blocks = [...now.children, ...(mode === 'side' ? [] : [mixer.firstElementChild, ...strips.children, ...(chanHost?.children || [])])]
      .filter((b) => b.getClientRects().length);                    // not the hidden ones (no track: no waveform)
    const anchor = held || blocks.find((b) => b.getBoundingClientRect().top >= top) || blocks.find((b) => b.getBoundingClientRect().bottom > top);
    if (!anchor) { change(); return; }
    const before = anchor.getBoundingClientRect().top;
    change();
    if (!anchor.isConnected) return;
    const moved = anchor.getBoundingClientRect().top - before;
    if (Math.abs(moved) >= 1) box.scrollTop += moved;
  }

  buildStrips();
  render();
  const offs = [
    bus.on('audio', () => steady(() => { render(); syncChannels(); })),
    bus.on('library:sound', followVolume),
    bus.on('audio:tick', () => { if (!el.closest('.panel')?.hidden) tick(); }),
    bus.on('audio:levels', syncLevels),
    bus.on('audio:lowpass', syncLowpass),
    // the track's flags or trim may have changed (render() rebuilds them only if so); not its volume
    bus.on('library:sound', (s) => { if (engine.music.voice?.sound.id === s.id) steady(render); }),
    bus.on('state:playlists', () => steady(renderPlaylists)),
    bus.on('state:boards', () => steady(renderEffects)),
    bus.on('library', () => { fxKey = ''; steady(renderEffects); }),
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
