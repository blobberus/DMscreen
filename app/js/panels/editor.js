// The sound editor: a zoomable waveform with trim handles, flags and a selection.
//   click: move the playhead     drag: select     drag a handle: trim     drag a flag: move it
//   Space play/pause   F flag   I / O trim start / end   [ ] flags   arrows nudge   Ctrl+wheel zoom
// Changes save as you make them. "Save selection as a new sound" cuts a real clip file.
// On the website the name and the folder are the file's, so changing them renames or moves it on
// GitHub (dialogs/files.js); there is no clip cutting there.
import { h, icon, clear, setIcon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { library, KIND_LABEL } from '../core/library.js';
import { confirmDialog, promptDialog, showMenu, toast } from '../core/ui.js';
import { clamp, fmtTime, parseTime, uid, hostOf } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { drawBars, themeColors, fitCanvas, tickStep } from '../audio/wave.js';
import { SITE } from '../core/mode.js';
import * as site from '../core/site.js';
import { soundItems, folderLabel, moveTo, explainFailure } from '../dialogs/files.js';

const REPEATS = [[1, 'Once'], [2, '2 times'], [3, '3 times'], [4, '4 times'], [5, '5 times'], [10, '10 times'], [0, 'Forever']];
const HANDLE_PX = 7;

export function createEditor({ onDeleted, onSelectSound } = {}) {
  let sound = null;
  let peaks = null;
  let view = [0, 1];
  let cursor = 0;            // the playhead when not playing (seconds)
  let selection = null;      // [a, b]
  let loopSel = false;
  let activeFlag = null;
  const cache = {};
  let colors = themeColors();

  const root = h('div', { class: 'ed' });
  const nameIn = h('input', { class: 'input ed-name', 'aria-label': 'Sound name', maxlength: 160 });
  const kindSel = SITE
    ? h('select', { class: 'select ed-kind', 'aria-label': 'Folder', title: 'The folder on GitHub; choosing another moves the file' })
    : h('select', { class: 'select ed-kind', 'aria-label': 'Kind' }, Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k }, l)));
  const metaLine = h('p', { class: 'ed-meta meta' });
  const moreBtn = h('button', { class: 'btn-icon', type: 'button', title: 'More', 'aria-label': 'More', onclick: (e) => moreMenu(e.currentTarget) }, icon('more'));
  const head = h('header', { class: 'ed-head' }, h('div', { class: 'ed-namebox' }, nameIn, metaLine), kindSel, moreBtn);

  const ruler = h('canvas', { class: 'ed-ruler', 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'ed-canvas', 'aria-hidden': 'true' });
  const shadeL = h('div', { class: 'ed-shade' });
  const shadeR = h('div', { class: 'ed-shade' });
  const handleIn = h('div', { class: 'ed-handle is-in', title: 'Drag to trim the start (I sets it at the playhead)' });
  const handleOut = h('div', { class: 'ed-handle is-out', title: 'Drag to trim the end (O sets it at the playhead)' });
  const selEl = h('div', { class: 'ed-sel', hidden: true });
  const flagsEl = h('div', { class: 'ed-flags' });
  const head2 = h('div', { class: 'ed-playhead' });
  const stage = h('div', { class: 'ed-stage' }, canvas, shadeL, shadeR, selEl, flagsEl, handleIn, handleOut, head2);
  const overview = h('canvas', { class: 'ed-overview', title: 'The whole sound. Drag to move the view.' });
  const viewBox = h('div', { class: 'ed-viewbox' });
  const overBox = h('div', { class: 'ed-overbox' }, overview, viewBox);
  const waveBox = h('div', {
    class: 'ed-wave', tabindex: 0, 'data-keys': 'local', role: 'group',
    'aria-label': 'Waveform. Space plays, F drops a flag, I and O trim, arrow keys move the playhead.',
  }, ruler, stage, overBox);

  const playIcon = icon('play');
  const playBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Play from the playhead (Space)', onclick: () => togglePreview() }, playIcon, h('span', null, 'Play'));
  const loopBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Loop the selection while previewing', 'aria-label': 'Loop the selection', 'aria-pressed': 'false', onclick: () => { loopSel = !loopSel; loopBtn.setAttribute('aria-pressed', String(loopSel)); if (engine.preview) startPreview(); } }, icon('loop'));
  const timeOut = h('span', { class: 'ed-time time' });
  const tools = h('div', { class: 'ed-tools' },
    h('div', { class: 'ed-group' }, playBtn, loopBtn, timeOut),
    h('div', { class: 'ed-group' },
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Drop a flag at the playhead (F)', onclick: () => addFlag() }, icon('flag'), 'Flag', h('kbd', { class: 'kbd' }, 'F')),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Trim the start to the playhead (I)', onclick: () => setTrim('in', playhead()) }, icon('in'), 'Start', h('kbd', { class: 'kbd' }, 'I')),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Trim the end to the playhead (O)', onclick: () => setTrim('out', playhead()) }, icon('out'), 'End', h('kbd', { class: 'kbd' }, 'O'))),
    h('div', { class: 'ed-group ed-zoom' },
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoom(1.6) }, icon('zoom-out')),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Show the whole sound', onclick: () => fit() }, 'Fit'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Zoom in (Ctrl+wheel)', 'aria-label': 'Zoom in', onclick: () => zoom(1 / 1.6) }, icon('zoom-in'))));
  const selBar = h('div', { class: 'ed-selbar', hidden: true });

  const flagList = h('div', { class: 'ed-flaglist' });
  const flagCount = h('span', { class: 'meta num' });
  const settings = h('div', { class: 'ed-settings' });
  const cols = h('div', { class: 'ed-cols' },
    h('section', { class: 'ed-sec' }, h('div', { class: 'ed-sechead' }, h('h3', { class: 'ed-h' }, 'Flags'), flagCount), flagList),
    h('section', { class: 'ed-sec' }, h('div', { class: 'ed-sechead' }, h('h3', { class: 'ed-h' }, 'Playback')), settings));

  root.append(head, waveBox, tools, selBar, cols);

  // ---- fields ----------------------------------------------------------------
  nameIn.addEventListener('input', () => { if (sound && !SITE) library.update(sound.id, { name: nameIn.value }); });
  nameIn.addEventListener('change', async () => {
    if (!sound) return;
    if (!nameIn.value.trim()) { nameIn.value = sound.name; return; }
    if (!SITE || nameIn.value.trim() === sound.name) return;
    const name = nameIn.value.trim();
    nameIn.disabled = true;
    try {
      await library.rename(sound.id, name);
      toast(`Renamed to ${name}.`, { type: 'ok' });
    } catch (e) {
      nameIn.value = sound.name;
      explainFailure(e);
    } finally {
      nameIn.disabled = false;
    }
  });
  kindSel.addEventListener('change', () => {
    if (!sound) return;
    if (SITE) { const s = sound; const dir = kindSel.value; kindSel.value = s.folder; moveTo(s, dir); return; }
    const kind = kindSel.value;
    const patch = { kind };
    if (kind === 'ambience' && sound.repeat === 1) Object.assign(patch, { repeat: 0, loopFade: sound.loopFade || 1.5 });
    if (kind !== 'ambience' && sound.repeat === 0) patch.repeat = 1;
    library.update(sound.id, patch);
    renderSettings();
  });

  function moreMenu(anchor) {
    if (!sound) return;
    if (SITE) { showMenu(anchor, soundItems(sound), { align: 'end' }); return; }
    const [a, b] = library.region(sound);
    showMenu(anchor, [
      { label: 'Download as MP3 (trimmed)', icon: 'download', onClick: () => download(library.exportUrl(sound.id, { start: a, end: b })) },
      { label: 'Download as WAV (trimmed)', icon: 'download', onClick: () => download(library.exportUrl(sound.id, { start: a, end: b, fmt: 'wav' })) },
      sound.source ? { label: `Open the source (${hostOf(sound.source)})`, icon: 'external', onClick: () => window.open(sound.source, '_blank', 'noopener') } : null,
      sound.parent && library.get(sound.parent) ? { label: 'Open the sound this was cut from', icon: 'wave', onClick: () => onSelectSound?.(sound.parent) } : null,
      { sep: true },
      { label: 'Delete this sound', icon: 'trash', onClick: () => remove() },
    ], { align: 'end' });
  }
  function download(url) {
    const a = h('a', { href: url, download: '' });
    document.body.append(a);
    a.click();
    a.remove();
  }
  async function remove() {
    if (!sound) return;
    if (!(await confirmDialog(`Delete “${sound.name}”? It comes off every playlist and pad, and the file is removed.`, { okLabel: 'Delete', danger: true }))) return;
    const id = sound.id;
    engine.stopPreview();
    await library.remove(id);
    onDeleted?.(id);
  }

  // ---- geometry ----------------------------------------------------------------
  const dur = () => sound?.duration || 1;
  const width = () => stage.clientWidth || 1;
  const tx = (t) => ((t - view[0]) / (view[1] - view[0])) * width();
  const xt = (x) => view[0] + (x / width()) * (view[1] - view[0]);
  const region = () => library.region(sound);
  function playhead() {
    const v = engine.preview;
    if (v && v.sound.id === sound?.id && v.state !== 'stopped') return v.from + v.position;
    return cursor;
  }
  function setView(a, b) {
    const d = dur();
    const span = clamp(b - a, Math.min(d, 0.25), d);
    let start = clamp(a, 0, d - span);
    view = [start, start + span];
    cache.key = null;
    draw();
  }
  function zoom(factor, around = null) {
    const c = around ?? (playhead() >= view[0] && playhead() <= view[1] ? playhead() : (view[0] + view[1]) / 2);
    const span = (view[1] - view[0]) * factor;
    const frac = (c - view[0]) / (view[1] - view[0]);
    setView(c - span * frac, c - span * frac + span);
  }
  function fit() { setView(0, dur()); }

  // ---- drawing ----------------------------------------------------------------------
  function draw() {
    if (!sound || !stage.isConnected || stage.clientWidth === 0) return;
    const [a, b] = region();
    drawBars(canvas, peaks, { t0: view[0], t1: view[1], trim: [a, b], step: view[1] - view[0] > 60 ? 2 : 3, gap: 1, cache, colors });
    drawRuler();
    drawOverview();
    const w = width();
    const xa = clamp(tx(a), 0, w);
    const xb = clamp(tx(b), 0, w);
    shadeL.style.cssText = `left:0;width:${xa}px`;
    shadeR.style.cssText = `left:${xb}px;right:0`;
    handleIn.style.left = `${tx(a) - HANDLE_PX / 2}px`;
    handleOut.style.left = `${tx(b) - HANDLE_PX / 2}px`;
    handleIn.hidden = tx(a) < -HANDLE_PX || tx(a) > w + HANDLE_PX;
    handleOut.hidden = tx(b) < -HANDLE_PX || tx(b) > w + HANDLE_PX;
    if (selection) {
      selEl.hidden = false;
      selEl.style.left = `${tx(selection[0])}px`;
      selEl.style.width = `${Math.max(1, tx(selection[1]) - tx(selection[0]))}px`;
    } else selEl.hidden = true;
    drawFlags();
    drawHead();
  }
  function drawHead() {
    const t = playhead();
    const x = tx(t);
    head2.hidden = x < 0 || x > width();
    head2.style.left = `${x}px`;
    timeOut.textContent = `${fmtTime(t, { tenths: true })} / ${fmtTime(dur(), { tenths: true })}`;
    const playing = engine.preview && engine.preview.sound.id === sound?.id && engine.preview.state === 'playing';
    setIcon(playIcon, playing ? 'pause' : 'play');
    playBtn.querySelector('span').textContent = playing ? 'Pause' : 'Play';
  }
  function drawRuler() {
    const { ctx, w, h: hh } = fitCanvas(ruler);
    ctx.clearRect(0, 0, w, hh);
    const span = view[1] - view[0];
    const step = tickStep(span, Math.max(3, Math.floor(w / 90)));
    ctx.fillStyle = colors.faint;
    ctx.strokeStyle = colors.border;
    ctx.font = '12px "Alegreya Sans", sans-serif';
    ctx.textBaseline = 'top';
    const first = Math.ceil(view[0] / step) * step;
    for (let t = first; t <= view[1] + 1e-6; t += step) {
      const x = Math.round(tx(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, hh - 5);
      ctx.lineTo(x, hh);
      ctx.stroke();
      const label = fmtTime(t, { tenths: step < 1 });
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, clamp(x + 3, 0, w - lw), 2);
    }
  }
  const overCache = {};
  function drawOverview() {
    if (!overview.clientWidth) return;
    const [a, b] = region();
    drawBars(overview, peaks, { t0: 0, t1: dur(), trim: [a, b], step: 2, gap: 0.5, cache: overCache, colors });
    const w = overview.clientWidth;
    viewBox.style.left = `${(view[0] / dur()) * w}px`;
    viewBox.style.width = `${Math.max(3, ((view[1] - view[0]) / dur()) * w)}px`;
    overBox.classList.toggle('is-zoomed', view[1] - view[0] < dur() - 0.01);
  }
  function drawFlags() {
    clear(flagsEl);
    if (!sound) return;
    const w = width();
    let lastRight = -1e9;
    let row = 0;
    (sound.flags || []).forEach((f, i) => {
      const x = tx(f.t);
      if (x < -40 || x > w + 2) return;
      const label = `${i + 1} ${f.label}`;
      row = x < lastRight + 4 ? (row + 1) % 2 : 0;
      lastRight = x + Math.min(160, 12 + label.length * 6.4);
      const el = h('div', { class: `ed-flag ${activeFlag === f.id ? 'is-active' : ''}`, style: { left: `${x}px` }, 'data-flag': f.id },
        h('span', { class: 'ed-flaglabel truncate', style: { top: `${row * 20}px` }, title: `${f.label} · ${fmtTime(f.t, { tenths: true })}. Drag to move, double-click to rename.` }, label));
      flagsEl.append(el);
    });
  }

  // ---- pointer on the stage --------------------------------------------------------------
  stage.addEventListener('pointerdown', (e) => {
    if (!sound || e.button !== 0) return;
    waveBox.focus({ preventScroll: true });
    const r = stage.getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const t0 = xt(x0);
    const flagEl = e.target.closest('.ed-flag');
    const target = e.target === handleIn ? 'in' : e.target === handleOut ? 'out' : flagEl ? 'flag' : 'stage';
    stage.setPointerCapture(e.pointerId);
    let moved = false;
    const flag = flagEl ? sound.flags.find((f) => f.id === flagEl.dataset.flag) : null;
    if (flag) { activeFlag = flag.id; renderFlags(); }
    const move = (ev) => {
      const x = clamp(ev.clientX - r.left, 0, r.width);
      if (!moved && Math.abs(x - x0) < 3) return;
      moved = true;
      const t = clamp(xt(x), 0, dur());
      if (target === 'in') setTrim('in', snap(t), false);
      else if (target === 'out') setTrim('out', snap(t), false);
      else if (target === 'flag' && flag) { flag.t = Math.round(t * 1000) / 1000; draw(); }
      else { selection = [Math.min(t0, t), Math.max(t0, t)]; draw(); renderSelBar(); }
    };
    const up = (ev) => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      if (!moved) {
        if (target === 'flag' && flag) { seekTo(flag.t); }
        else if (target === 'stage') {
          selection = null;
          renderSelBar();
          seekTo(clamp(xt(ev.clientX - r.left), 0, dur()));
        }
      } else if (target === 'flag' && flag) {
        saveFlags();
      } else if (target === 'in' || target === 'out') {
        library.update(sound.id, { trimStart: sound.trimStart, trimEnd: sound.trimEnd });
        renderSettings();
      }
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  });
  stage.addEventListener('dblclick', async (e) => {
    const flagEl = e.target.closest('.ed-flag');
    if (!flagEl || !sound) return;
    const f = sound.flags.find((x) => x.id === flagEl.dataset.flag);
    if (!f) return;
    const label = await promptDialog('Rename this flag', { label: 'Label', value: f.label, okLabel: 'Rename' });
    if (label) { f.label = label; saveFlags(); }
  });
  function snap(t) {
    const px = (view[1] - view[0]) / width() * 6;
    for (const f of sound.flags || []) if (Math.abs(f.t - t) < px) return f.t;
    if (Math.abs(playhead() - t) < px) return playhead();
    return t;
  }
  stage.addEventListener('wheel', (e) => {
    if (!sound) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoom(e.deltaY > 0 ? 1.25 : 0.8, xt(e.clientX - r.left));
    } else if (view[1] - view[0] < dur() - 0.01) {
      // zoomed in: the wheel scrolls through the sound
      e.preventDefault();
      const span = view[1] - view[0];
      const d = (e.deltaX || e.deltaY) / width() * span;
      setView(view[0] + d, view[1] + d);
    }
  }, { passive: false });

  overBox.addEventListener('pointerdown', (e) => {
    if (!sound || e.button !== 0) return;
    overBox.setPointerCapture(e.pointerId);
    const r = overview.getBoundingClientRect();
    const span = view[1] - view[0];
    const go = (ev) => {
      const t = ((ev.clientX - r.left) / r.width) * dur();
      setView(t - span / 2, t + span / 2);
    };
    go(e);
    const up = () => { overBox.removeEventListener('pointermove', go); overBox.removeEventListener('pointerup', up); };
    overBox.addEventListener('pointermove', go);
    overBox.addEventListener('pointerup', up);
  });

  // ---- keyboard on the waveform ------------------------------------------------------------
  waveBox.addEventListener('keydown', (e) => {
    if (!sound || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const step = e.shiftKey ? 0.1 : 1;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { handled(); togglePreview(); }
    else if (k === 'f' || k === 'F') { handled(); addFlag(); }
    else if (k === 'i' || k === 'I') { handled(); setTrim('in', playhead()); }
    else if (k === 'o' || k === 'O') { handled(); setTrim('out', playhead()); }
    else if (k === 'ArrowLeft') { handled(); seekTo(playhead() - step); }
    else if (k === 'ArrowRight') { handled(); seekTo(playhead() + step); }
    else if (k === 'Home') { handled(); seekTo(region()[0]); }
    else if (k === 'End') { handled(); seekTo(Math.max(0, region()[1] - 2)); }
    else if (k === '[' || k === ']') {
      handled();
      const t = playhead();
      const fl = (sound.flags || []);
      const f = k === ']' ? fl.find((x) => x.t > t + 0.05) : [...fl].reverse().find((x) => x.t < t - 0.5);
      if (f) seekTo(f.t);
    }
    else if (k === '+' || k === '=') { handled(); zoom(1 / 1.6); }
    else if (k === '-') { handled(); zoom(1.6); }
    else if (k === 'Escape') { if (selection) { handled(); selection = null; draw(); renderSelBar(); } }
    else if ((k === 'Delete' || k === 'Backspace') && activeFlag) { handled(); removeFlag(activeFlag); }
  });

  // ---- preview -------------------------------------------------------------------------------
  function togglePreview() {
    const v = engine.preview;
    if (v && v.sound.id === sound?.id && v.state === 'playing') { cursor = playhead(); engine.stopPreview(); drawHead(); return; }
    startPreview();
  }
  function startPreview() {
    if (!sound) return;
    const [a, b] = region();
    let from = clamp(playhead(), 0, dur());
    let to = b;
    let loop = false;
    if (loopSel && selection && selection[1] - selection[0] > 0.05) {
      from = from >= selection[0] && from < selection[1] ? from : selection[0];
      to = selection[1];
      loop = true;
      engine.previewSound(sound, { from: selection[0], to, loop: true, at: from - selection[0], onEnd: () => drawHead() });
      return;
    }
    if (from >= b - 0.05 || from < a - 0.001) from = a;
    cursor = from;
    engine.previewSound(sound, { from, to, loop, onEnd: () => { cursor = to; drawHead(); } });
  }
  function seekTo(t) {
    t = clamp(t, 0, dur());
    const v = engine.preview;
    if (v && v.sound.id === sound?.id && v.state === 'playing') {
      if (t >= v.from && t < v.to) v.seek(t - v.from);
      else { cursor = t; startPreview(); }
    } else cursor = t;
    if (t < view[0] || t > view[1]) { const span = view[1] - view[0]; setView(t - span * 0.2, t + span * 0.8); }
    drawHead();
  }

  // ---- trims and flags --------------------------------------------------------------------------
  function setTrim(which, t, save = true) {
    if (!sound) return;
    const d = dur();
    let [a, b] = region();
    if (which === 'in') a = clamp(t, 0, b - 0.05);
    else b = clamp(t, a + 0.05, d);
    sound.trimStart = Math.round(a * 1000) / 1000;
    sound.trimEnd = Math.abs(b - d) < 0.01 ? null : Math.round(b * 1000) / 1000;
    draw();
    if (save) { library.update(sound.id, { trimStart: sound.trimStart, trimEnd: sound.trimEnd }); renderSettings(); }
  }
  function addFlag(t = playhead(), label) {
    if (!sound) return;
    const flags = (sound.flags || []).slice();
    if (flags.some((f) => Math.abs(f.t - t) < 0.05)) { toast('There is already a flag there.'); return; }
    const f = { id: uid('f'), t: Math.round(t * 1000) / 1000, label: label || `Flag ${flags.length + 1}` };
    flags.push(f);
    flags.sort((x, y) => x.t - y.t);
    sound.flags = flags;
    activeFlag = f.id;
    saveFlags();
    const input = flagList.querySelector(`[data-flag="${f.id}"] .ed-flabel`);
    if (input && !(engine.preview && engine.preview.state === 'playing')) { input.focus(); input.select(); }
  }
  function removeFlag(id) {
    sound.flags = sound.flags.filter((f) => f.id !== id);
    if (activeFlag === id) activeFlag = null;
    saveFlags();
  }
  function saveFlags() {
    sound.flags.sort((x, y) => x.t - y.t);
    library.update(sound.id, { flags: sound.flags.map((f) => ({ ...f })) });
    draw();
    renderFlags();
  }
  function renderFlags() {
    clear(flagList);
    const flags = sound?.flags || [];
    flagCount.textContent = flags.length ? String(flags.length) : '';
    if (!flags.length) {
      flagList.append(h('p', { class: 'meta ed-noflags' }, 'No flags yet. Play the sound and press F at each moment you want to jump to: the storm breaking, the chorus, the dragon’s roar.'));
      return;
    }
    flags.forEach((f, i) => {
      const label = h('input', { class: 'input input-sm ed-flabel', value: f.label, 'aria-label': `Flag ${i + 1} label`, maxlength: 60 });
      label.addEventListener('input', () => { f.label = label.value || `Flag ${i + 1}`; library.update(sound.id, { flags: sound.flags.map((x) => ({ ...x })) }); drawFlags(); });
      label.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); waveBox.focus(); } });
      const time = h('input', { class: 'input input-sm ed-ftime num', value: fmtTime(f.t, { tenths: true }), 'aria-label': `Flag ${i + 1} time` });
      time.addEventListener('change', () => {
        const t = parseTime(time.value);
        if (t == null || t > dur()) { time.value = fmtTime(f.t, { tenths: true }); return; }
        f.t = t;
        saveFlags();
      });
      flagList.append(h('div', { class: `ed-frow ${activeFlag === f.id ? 'is-selected' : ''}`, 'data-flag': f.id },
        h('span', { class: 'ed-fnum num faint' }, String(i + 1)),
        label, time,
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Play from this flag', 'aria-label': `Play from ${f.label}`, onclick: () => { cursor = f.t; activeFlag = f.id; startPreview(); renderFlags(); } }, icon('play')),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Delete this flag', 'aria-label': `Delete ${f.label}`, onclick: () => removeFlag(f.id) }, icon('close'))));
    });
  }

  // ---- selection bar ------------------------------------------------------------------------------
  function renderSelBar() {
    clear(selBar);
    if (!selection || selection[1] - selection[0] < 0.05) { selBar.hidden = true; return; }
    const [a, b] = selection;
    selBar.hidden = false;
    selBar.append(
      h('span', { class: 'ed-selinfo num' }, `Selected ${fmtTime(a, { tenths: true })} to ${fmtTime(b, { tenths: true })}`, h('span', { class: 'faint' }, ` (${(b - a).toFixed(1)} s)`)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { cursor = a; startPreview(); } }, icon('play'), 'Play it'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Make the selection the part that plays', onclick: () => { setTrim('in', a); setTrim('out', b); selection = null; draw(); renderSelBar(); } }, icon('scissors'), 'Trim to it'),
      SITE ? null : h('button', { class: 'btn btn-sm btn-primary', type: 'button', title: 'Cut the selection into a new sound of its own', onclick: () => makeClip(a, b) }, icon('plus'), 'Save as a new sound'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Clear the selection (Esc)', 'aria-label': 'Clear the selection', onclick: () => { selection = null; draw(); renderSelBar(); } }, icon('close')));
  }
  async function makeClip(a, b) {
    const n = library.list().filter((s) => s.parent === sound.id).length + 1;
    const name = await promptDialog('Save the selection as a new sound', { label: 'Name', value: `${sound.name} – part ${n}`, okLabel: 'Save' });
    if (!name) return;
    try {
      const clip = await library.clip(sound.id, { start: a, end: b, name, kind: b - a < 30 ? 'effect' : sound.kind });
      toast(`Saved “${clip.name}”.`, { type: 'ok', action: { label: 'Open it', run: () => onSelectSound?.(clip.id) } });
      selection = null;
      draw();
      renderSelBar();
    } catch (e) {
      toast(e.message, { type: 'error' });
    }
  }

  // ---- playback settings --------------------------------------------------------------------------------
  function renderSettings() {
    clear(settings);
    if (!sound) return;
    const s = sound;
    const vol = h('input', { class: 'range', type: 'range', min: 0, max: 150, step: 1, value: Math.round((s.volume ?? 1) * 100), 'aria-label': 'Volume' });
    const volNum = h('span', { class: 'num ed-num' });
    const syncVol = () => { vol.style.setProperty('--fill', `${(vol.value / 150) * 100}%`); volNum.textContent = `${vol.value}%`; };
    vol.addEventListener('input', () => { syncVol(); library.update(s.id, { volume: vol.value / 100 }); for (const v of engine.voices) if (v.sound.id === s.id) v.setVolume(v.volume); });
    syncVol();
    const rep = h('select', { class: 'select' }, REPEATS.map(([n, l]) => h('option', { value: String(n), selected: (s.repeat ?? 1) === n }, l)));
    rep.addEventListener('change', () => { library.update(s.id, { repeat: Number(rep.value) }); renderSettings(); });
    const num = (key, label, max = 30) => {
      const input = h('input', { class: 'input input-sm num', type: 'number', min: 0, max, step: 0.1, value: s[key] || 0, 'aria-label': label });
      input.addEventListener('change', () => { const v = clamp(Number(input.value) || 0, 0, max); input.value = v; library.update(s.id, { [key]: v }); });
      return h('label', { class: 'ed-field' }, h('span', { class: 'muted' }, label), h('span', { class: 'ed-numwrap' }, input, h('span', { class: 'faint' }, 's')));
    };
    const [a, b] = region();
    const tIn = h('input', { class: 'input input-sm num', value: fmtTime(a, { tenths: true }), 'aria-label': 'Trim start' });
    const tOut = h('input', { class: 'input input-sm num', value: fmtTime(b, { tenths: true }), 'aria-label': 'Trim end' });
    tIn.addEventListener('change', () => { const t = parseTime(tIn.value); if (t != null) setTrim('in', t); else tIn.value = fmtTime(a, { tenths: true }); });
    tOut.addEventListener('change', () => { const t = parseTime(tOut.value); if (t != null) setTrim('out', t); else tOut.value = fmtTime(b, { tenths: true }); });
    const tags = h('input', { class: 'input input-sm', value: (s.tags || []).join(', '), placeholder: 'forest, night, tense', 'aria-label': 'Tags' });
    tags.addEventListener('change', () => library.update(s.id, { tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }));
    settings.append(
      h('label', { class: 'ed-field' }, h('span', { class: 'muted' }, 'Volume'), h('span', { class: 'ed-volrow' }, vol, volNum)),
      h('label', { class: 'ed-field' }, h('span', { class: 'muted' }, 'Repeat'), rep),
      h('div', { class: 'ed-field' }, h('span', { class: 'muted' }, 'Plays'), h('span', { class: 'ed-trims' }, tIn, h('span', { class: 'faint' }, 'to'), tOut, h('span', { class: 'faint num' }, `(${fmtTime(b - a, { tenths: true })})`))),
      num('fadeIn', 'Fade in'),
      num('fadeOut', 'Fade out'),
      (s.repeat ?? 1) !== 1 ? num('loopFade', 'Loop blend', 10) : null,
      h('label', { class: 'ed-field' }, h('span', { class: 'muted' }, 'Tags'), tags),
    );
    if ((s.repeat ?? 1) !== 1) settings.append(h('p', { class: 'field-hint' }, 'Loop blend crossfades the end of each pass into the start of the next, so ambience never clicks or gaps.'));
  }

  /** Website: the folder picker lists every folder a sound can live in, by category. */
  function fillFolders() {
    clear(kindSel);
    const dirs = library.folders();
    for (const c of site.CATEGORIES) {
      const group = h('optgroup', { label: c.label });
      for (const d of dirs.filter((x) => x.split('/')[0] === c.dir && x.split('/').length <= 2)) {
        group.append(h('option', { value: d, 'data-dir': d }, d.includes('/') ? site.folderName(d) : `${c.label} (no folder)`));
      }
      if (group.children.length) kindSel.append(group);
    }
    if (![...kindSel.options].some((o) => o.value === sound.folder)) kindSel.append(h('option', { value: sound.folder, 'data-dir': sound.folder }, folderLabel(sound.folder || '') || 'sounds'));
    kindSel.value = sound.folder;
  }

  // ---- open ----------------------------------------------------------------------------------------------
  async function open(id) {
    if (sound?.id !== id) engine.stopPreview();
    sound = library.get(id);
    selection = null;
    activeFlag = null;
    peaks = null;
    cache.key = null;
    overCache.key = null;
    if (!sound) return;
    nameIn.value = sound.name;
    if (SITE) fillFolders(); else kindSel.value = sound.kind;
    const bits = [fmtTime(sound.duration, { tenths: true })];
    if (SITE) bits.unshift(folderLabel(sound.folder || '') || 'sounds'), bits.push(`${(sound.size / 1048576).toFixed(1)} MB`);
    if (sound.source) bits.push(`from ${hostOf(sound.source)}`);
    if (sound.parent && library.get(sound.parent)) bits.push(`cut from ${library.get(sound.parent).name}`);
    if (sound.status === 'analyzing') bits.push('reading the waveform…');
    metaLine.textContent = bits.join(' · ');
    view = [0, sound.duration || 1];
    cursor = region()[0];
    renderFlags();
    renderSettings();
    renderSelBar();
    draw();
    try {
      const p = await library.peaks(id);
      if (sound?.id === id) { peaks = p; cache.key = null; overCache.key = null; draw(); }
    } catch { /* flat */ }
  }

  const offs = [
    bus.on('audio:tick', () => { if (sound && engine.preview?.sound.id === sound.id) drawHead(); }),
    bus.on('audio', () => sound && drawHead()),
    bus.on('state:settings', () => { colors = themeColors(); cache.key = null; overCache.key = null; draw(); }),
  ];

  return {
    el: root,
    open,
    get soundId() { return sound?.id || null; },
    refresh() {
      if (!sound) return;
      const fresh = library.get(sound.id);
      if (!fresh) { sound = null; return; }
      const wasAnalyzing = metaLine.textContent.includes('reading');
      sound = fresh;
      if (wasAnalyzing && fresh.status === 'ready') open(fresh.id);
    },
    resize() { cache.key = null; overCache.key = null; draw(); },
    destroy() { offs.forEach((off) => off()); engine.stopPreview(); },
  };
}
