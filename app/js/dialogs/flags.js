// Flags from outside the editor: drop one on a playing sound where it is now (Alt+Shift+F, the
// Console's Flag button), rename, move or delete one (the Console's flag menu, the toast after a drop),
// and the Flags dialog, which lists every flag of one sound to name, retime, delete or add by time.
import { h, icon, clear, setIcon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { engine } from '../audio/engine.js';
import { library, KIND_LABEL } from '../core/library.js';
import { toast, promptDialog, showMenu, openDialog } from '../core/ui.js';
import { fmtTime, parseTime, clamp } from '../core/util.js';
import { drawBars } from '../audio/wave.js';
import { flagVoice, flagNear, voiceTime, withFlag, withLabel, withTime, withoutFlag, saveFlags } from '../core/flags.js';

const at = (t) => fmtTime(t, { tenths: true });
const flagOf = (soundId, flagId) => library.get(soundId)?.flags?.find((x) => x.id === flagId) || null;

/** Ask for a flag's new name and save it. */
export async function renameFlag(soundId, flagId) {
  const s = library.get(soundId);
  const f = flagOf(soundId, flagId);
  if (!f) return;
  const label = await promptDialog('Rename this flag', { label: 'Label', value: f.label, okLabel: 'Rename', hint: `${s.name} · ${at(f.t)}` });
  const now = library.get(soundId);
  if (label && now) saveFlags(now.id, withLabel(now.flags, flagId, label));
}

/** Delete a flag; the toast can bring it back. */
export function deleteFlag(soundId, flagId) {
  const s = library.get(soundId);
  const f = flagOf(soundId, flagId);
  if (!f) return;
  saveFlags(s.id, withoutFlag(s.flags, flagId));
  toast(`Deleted ${f.label} (${at(f.t)}).`, {
    timeout: 6000,
    action: { label: 'Undo', run: () => { const now = library.get(soundId); if (now && !now.flags?.some((x) => x.id === flagId)) saveFlags(soundId, [...(now.flags || []), f]); } },
  });
}

/** Move a flag to where a playing voice of its sound is now. */
export function moveFlagTo(voice, flagId) {
  const s = library.get(voice.sound.id);
  const f = flagOf(voice.sound.id, flagId);
  if (!f) return;
  const t = voiceTime(voice);
  const clash = flagNear(s.flags.filter((x) => x.id !== flagId), t);
  if (clash) { toast(`${clash.label} is already there.`); return; }
  saveFlags(s.id, withTime(s.flags, flagId, t));
  toast(`${f.label} moved to ${at(t)}.`, { type: 'ok' });
}

/** The menu for one flag of a playing voice (the deck's track unless told). */
export function flagMenu(anchor, flag, voice = engine.music.voice) {
  if (!voice) return;
  const id = voice.sound.id;
  showMenu(anchor, [
    { header: `${flag.label} · ${at(flag.t)}` },
    { label: 'Jump to it', icon: 'flag-next', onClick: () => (voice === engine.music.voice ? engine.jumpTo(flag.t) : voice.seek(flag.t - voice.from)) },
    { label: 'Rename…', icon: 'edit', onClick: () => renameFlag(id, flag.id) },
    { label: `Move it here (${at(voiceTime(voice))})`, icon: 'flag-add', onClick: () => moveFlagTo(voice, flag.id) },
    { sep: true },
    { label: 'Delete', icon: 'trash', onClick: () => deleteFlag(id, flag.id) },
  ]);
}

/** The menu for a playing sound (a row of the Console's Playing list): flag it here, or open its flags. */
export function soundFlagsMenu(anchor, voice) {
  const s = library.get(voice.sound.id);
  if (!s) return;
  const n = s.flags?.length || 0;
  showMenu(anchor, [
    { header: s.name },
    { label: `Drop a flag here (${at(voiceTime(voice))})`, icon: 'flag-add', onClick: () => dropFlag(voice) },
    { label: 'Flags…', icon: 'flag', hint: n ? String(n) : '', onClick: () => openFlags(s.id, { voice }) },
  ]);
}

// ---- the Flags dialog: every flag of one sound ------------------------------------------------
/** Name, move, delete and add a sound's flags without the editor. With a voice of that sound playing,
 *  the new flag's time starts where it is. */
export function openFlags(soundId, { voice = null, onClose = null } = {}) {
  const s0 = library.get(soundId);
  if (!s0) return null;
  const dur = () => library.get(soundId)?.duration || 0;
  const list = h('div', { class: 'fg-list', role: 'list', 'aria-label': 'Flags' });
  const count = h('span', { class: 'meta num fg-count' });
  const addTime = h('input', { class: 'input input-sm num fg-addtime', placeholder: '1:23.5', inputmode: 'decimal', 'aria-label': 'Time of the new flag' });
  const addLabel = h('input', { class: 'input input-sm fg-addlabel', placeholder: 'Name (optional)', maxlength: 60, 'aria-label': 'Name of the new flag' });
  const addErr = h('p', { class: 'field-hint fg-err', role: 'alert', hidden: true });
  // the voice of this sound playing at the table: the one it was opened for, or any (track, on top, pad)
  const alive = (v) => v && v.sound.id === soundId && ['playing', 'paused', 'loading'].includes(v.state);
  const live = () => (alive(voice) ? voice : engine.playingNow().find((it) => it.id === soundId)?.voice || null);
  if (live()) addTime.value = at(voiceTime(live()));
  const fail = (text) => { addErr.textContent = text; addErr.hidden = !text; };

  function add() {
    const s = library.get(soundId);
    if (!s) return;
    const typed = addTime.value.trim();
    const t = typed ? parseTime(typed) : live() ? voiceTime(live()) : null;
    if (t == null) { fail('Type when it is, like 1:23.5 or 83.5 (minutes:seconds).'); addTime.focus(); return; }
    if (t > dur()) { fail(`That is past the end: ${s.name} is ${at(dur())} long.`); addTime.focus(); return; }
    const r = withFlag(s.flags, t, addLabel.value);
    if (!r.flag) { fail(`${r.near.label} is already at ${at(r.near.t)}.`); addTime.focus(); return; }
    fail('');
    shown = JSON.stringify(r.flags);
    saveFlags(soundId, r.flags);
    addTime.value = '';
    addLabel.value = '';
    render();
    addTime.focus();
  }
  for (const box of [addTime, addLabel]) box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  addTime.addEventListener('input', () => { fail(''); drawMarks(); });

  // The whole sound's waveform (the trimmed-off ends dimmed) with its flags marked; a click puts the new
  // flag's time there. Marks are placed in percent, so only the bars need the canvas.
  const wave = h('canvas', { class: 'fg-wave', 'aria-hidden': 'true' });
  const marks = h('div', { class: 'fg-marks', 'aria-hidden': 'true' });
  const pickMark = h('i', { class: 'fg-pick', hidden: true });
  const playhead = h('i', { class: 'fg-playhead', hidden: true });
  const waveBox = h('div', { class: 'fg-wavebox', title: 'Click to put the new flag here' }, wave, marks, pickMark, playhead);
  // where the sound is while it plays at the table or in a preview: moved with a transform, in whole
  // pixels, from a width the ResizeObserver keeps (nothing measured per frame)
  let waveW = 0;
  let headX = -1;
  let headVoice = null;
  const findHead = () => { headVoice = engine.preview?.sound.id === soundId && alive(engine.preview) ? engine.preview : live(); };
  // while it plays (at the table or in a preview), a flag where it is now, as the editor's F does
  const nowBtn = h('button', {
    class: 'btn btn-sm fg-now', type: 'button', hidden: true, title: 'Drop a flag where the sound is now',
    onclick: () => {
      if (!alive(headVoice)) return;
      const r = flagVoice(headVoice);
      fail(r && !r.flag ? `${r.near.label} is already at ${at(r.near.t)}.` : '');
    },
  }, icon('flag-add', 'icon-sm'), 'Drop a flag now');
  function tickHead() {
    const v = headVoice;
    const on = !!v && alive(v);
    if (nowBtn.hidden === on) nowBtn.hidden = !on;
    const show = on && waveW > 0;
    if (playhead.hidden === show) playhead.hidden = !show;
    if (!show) { headX = -1; return; }
    const x = Math.round(clamp(voiceTime(v) / (dur() || 1), 0, 1) * waveW);
    if (x !== headX) { headX = x; playhead.style.transform = `translateX(${x}px)`; }
  }
  let peaks = null;
  const pct = (t) => `${(clamp(t / (dur() || 1), 0, 1) * 100).toFixed(3)}%`;
  function drawWave() {
    const s = library.get(soundId);
    if (!s || !wave.isConnected || !wave.clientWidth) return;
    drawBars(wave, peaks, { t0: 0, t1: dur() || 1, trim: library.region(s), step: 3, gap: 1 });
  }
  function drawMarks() {
    const s = library.get(soundId);
    clear(marks);
    (s?.flags || []).forEach((f, i) => marks.append(h('span', { class: 'fg-mark', style: { left: pct(f.t) } }, h('b', null, String(i + 1)))));
    const t = parseTime(addTime.value);
    pickMark.hidden = t == null || t > dur();
    if (!pickMark.hidden) pickMark.style.left = pct(t);
  }
  waveBox.addEventListener('click', (e) => {
    const r = waveBox.getBoundingClientRect();
    addTime.value = at(clamp((e.clientX - r.left) / r.width, 0, 1) * dur());
    fail('');
    drawMarks();
    addLabel.focus();
  });
  const ro = new ResizeObserver(() => { waveW = wave.clientWidth; headX = -1; drawWave(); tickHead(); });
  library.peaks(soundId).then((p) => { peaks = p; drawWave(); }).catch(() => { /* drawn flat */ });

  // The rows follow changes made elsewhere (a flag dropped with Alt+Shift+F while this is open), but are
  // never rebuilt under the typing: they catch up when the focus leaves the list.
  let shown = '';
  let stale = false;
  function render() {
    const s = library.get(soundId);
    const flags = s?.flags || [];
    shown = JSON.stringify(flags);
    stale = false;
    count.textContent = flags.length ? `${flags.length} ${flags.length === 1 ? 'flag' : 'flags'}` : '';
    clear(list);
    if (!flags.length) list.append(h('p', { class: 'meta fg-none' }, 'No flags yet. Click the waveform or type a time below and press Add flag, or drop one while it plays.'));
    flags.forEach((f, i) => list.append(row(f, i)));
    drawMarks();
    syncPlay();
  }
  function row(f, i) {
    const label = h('input', { class: 'input input-sm fg-label', value: f.label, maxlength: 60, 'aria-label': `Flag ${i + 1} name` });
    label.addEventListener('input', () => {
      const s = library.get(soundId);
      const next = withLabel(s.flags, f.id, label.value || `Flag ${i + 1}`);
      shown = JSON.stringify(next);
      saveFlags(soundId, next);
    });
    const time = h('input', { class: 'input input-sm num fg-time', value: at(f.t), inputmode: 'decimal', 'aria-label': `Flag ${i + 1} time` });
    time.addEventListener('change', () => {
      const s = library.get(soundId);
      const t = parseTime(time.value);
      const clash = t == null ? null : flagNear(s.flags.filter((x) => x.id !== f.id), t);
      if (t == null || t > dur() || clash) {
        toast(t == null ? 'Type a time like 1:23.5.' : clash ? `${clash.label} is already at ${at(clash.t)}.` : `That is past the end (${at(dur())}).`);
        time.value = at(f.t);
        return;
      }
      saveFlags(soundId, withTime(s.flags, f.id, t));
      render();
    });
    for (const box of [label, time]) box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } });
    return h('div', { class: 'fg-row', role: 'listitem', 'data-flag': f.id },
      h('span', { class: 'fg-num num faint' }, String(i + 1)),
      label, time,
      h('button', { class: 'btn-icon btn-sm fg-play', type: 'button', title: `Play from ${f.label}`, 'aria-label': `Play from ${f.label}`, onclick: () => playFrom(f.id) }, icon('play')),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Delete ${f.label}`, 'aria-label': `Delete ${f.label}`, onclick: () => { deleteFlag(soundId, f.id); render(); } }, icon('close')));
  }
  // Play from a flag: the sound playing at the table jumps there; otherwise it is previewed from there
  // (the preview output, so with a headphone output set only the DM hears it). Again to stop the preview.
  let previewFlag = null;
  function playFrom(flagId) {
    const s = library.get(soundId);
    const f = flagOf(soundId, flagId);
    if (!s || !f) return;
    const v = live();
    if (v) {
      if (v === engine.music.voice) engine.jumpTo(f.t);
      else { if (v.state === 'paused') v.resume(); v.seek(Math.max(0, f.t - v.from)); }
      return;
    }
    if (engine.previewing(soundId) && previewFlag === flagId) { engine.stopPreview(); return; }
    const [a, b] = library.region(s);
    const from = Math.min(a, f.t);
    previewFlag = flagId;
    engine.previewSound(s, { from, to: f.t < b ? b : dur(), at: f.t - from });
  }
  function syncPlay() {
    const on = engine.previewing(soundId) ? previewFlag : null;
    for (const b of list.querySelectorAll('.fg-row')) {
      const btn = b.querySelector('.fg-play');
      const want = b.dataset.flag === on ? 'stop' : 'play';
      if (btn && btn.dataset.icon !== want) { btn.dataset.icon = want; setIcon(btn.querySelector('svg'), want); }
    }
  }
  const offAudio = bus.on('audio', () => { syncPlay(); findHead(); tickHead(); });
  const offTick = bus.on('audio:tick', tickHead);
  findHead();
  list.addEventListener('focusout', () => requestAnimationFrame(() => { if (stale && !list.contains(document.activeElement)) render(); }));
  const off = bus.on('library:sound', (s) => {
    if (s.id !== soundId) return;
    drawMarks();
    if (JSON.stringify(s.flags || []) === shown) return;
    if (list.contains(document.activeElement)) { stale = true; return; }
    render();
  });
  const [from, to] = library.region(s0);
  const trimmed = from > 0.01 || to < (s0.duration || 0) - 0.01;
  const body = h('div', { class: 'fg' },
    h('div', { class: 'fg-head' },
      h('span', { class: 'meta fg-what' }, [KIND_LABEL[s0.kind], at(s0.duration), trimmed ? `plays ${at(from)} to ${at(to)}` : null].filter(Boolean).join(' · ')),
      nowBtn, count),
    waveBox,
    list,
    h('div', { class: 'fg-add' },
      h('span', { class: 'fg-addcap meta' }, 'New flag'),
      addTime, addLabel,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, icon('flag-add', 'icon-sm'), 'Add flag')),
    addErr);
  render();
  const d = openDialog({
    title: `Flags: ${s0.name}`, body, className: 'fg-dialog', initialFocus: '.fg-addtime',
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => { off(); offAudio(); offTick(); ro.disconnect(); if (engine.previewing(soundId)) engine.stopPreview(); onClose?.(); },
  });
  ro.observe(wave);
  return d;
}

/** Drop a flag on a playing voice (the deck's track unless told) where it is now. */
export function dropFlag(voice = engine.music.voice) {
  if (!voice) { toast('Nothing is playing to flag. Start a track first.'); return null; }
  const r = flagVoice(voice);
  if (!r) return null;
  if (!r.flag) { toast(`${r.near.label} is already there.`); return r; }
  toast(`${r.flag.label} dropped at ${at(r.t)} in ${r.sound.name}.`, {
    type: 'ok', timeout: 6000, action: { label: 'Rename', run: () => renameFlag(r.sound.id, r.flag.id) },
  });
  return r;
}
