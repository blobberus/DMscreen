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
import { flagVoice, flagNear, voiceTime, withFlag, withLabel, withTime, withoutFlag, saveFlags, parseFlagList, flagListText } from '../core/flags.js';

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

/** Move a flag to t (seconds into the file); refused, with a toast, onto another flag (within `within`,
 *  LIVE_NEAR for a drag: a hand can't land 0.05 s from a flag on purpose). -> moved? */
export function moveFlag(soundId, flagId, t, { quiet = false, within } = {}) {
  const s = library.get(soundId);
  const f = flagOf(soundId, flagId);
  if (!f) return false;
  const clash = flagNear(s.flags.filter((x) => x.id !== flagId), t, within);
  if (clash) { toast(`${clash.label} is already there.`); return false; }
  saveFlags(s.id, withTime(s.flags, flagId, t));
  if (!quiet) toast(`${f.label} moved to ${at(t)}.`, { type: 'ok' });
  return true;
}

/** Move a flag to where a playing voice of its sound is now. */
export function moveFlagTo(voice, flagId) {
  return moveFlag(voice.sound.id, flagId, voiceTime(voice));
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

/** Many flags at once from pasted text: a video description's chapter list, notes, another sound's
 *  flags copied as text. Moments already flagged are left out. */
export function pasteFlags(soundId, { onClose = null } = {}) {
  const s = library.get(soundId);
  if (!s) return null;
  const area = h('textarea', { class: 'textarea fg-paste', rows: 8, spellcheck: false, placeholder: '0:00 Intro\n1:23 The battle begins\n4:05 Calm after the storm', 'aria-label': 'Times, one per line' });
  const note = h('p', { class: 'field-hint fg-pastenote', role: 'status' });
  const fresh = () => {
    const now = library.get(soundId);
    const { items, skipped } = parseFlagList(area.value, now?.duration ?? Infinity);
    const add = items.filter((x) => !flagNear(now?.flags, x.t));
    const left = skipped + items.length - add.length;
    note.textContent = !area.value.trim() ? 'Paste or type one moment per line: a time (1:23 or 1:02:03), then its name.'
      : `${add.length ? `Adds ${add.length} ${add.length === 1 ? 'flag' : 'flags'}` : 'Nothing to add'}${left ? ` (${left} ${left === 1 ? 'line' : 'lines'} left out: no time, past the end, or already flagged)` : ''}.`;
    return add;
  };
  area.addEventListener('input', fresh);
  fresh();
  return openDialog({
    title: `Paste times: ${s.name}`, className: 'fg-pastedialog', initialFocus: '.fg-paste',
    body: h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'A video’s chapter list works as it is: copy it from the description and paste it here.'), area, note),
    actions: [
      { label: 'Cancel' },
      { label: 'Add flags', kind: 'primary', onClick: () => {
        const add = fresh();
        if (!add.length) { area.focus(); return false; }
        let flags = library.get(soundId)?.flags || [];
        for (const x of add) flags = withFlag(flags, x.t, x.label).flags;
        saveFlags(soundId, flags);
        toast(`Added ${add.length} ${add.length === 1 ? 'flag' : 'flags'} to ${s.name}.`, { type: 'ok' });
        return undefined;
      } },
    ],
    onClose: () => onClose?.(),
  });
}

/** Copy a sound's flags as text; where the clipboard is refused, show the text to copy by hand. */
export async function copyFlags(soundId) {
  const s = library.get(soundId);
  const flags = s?.flags || [];
  if (!flags.length) { toast(`${s?.name || 'This sound'} has no flags to copy yet.`); return; }
  const text = flagListText(flags, at);
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${flags.length} ${flags.length === 1 ? 'flag' : 'flags'} of ${s.name}.`, { type: 'ok' });
  } catch {
    const area = h('textarea', { class: 'textarea fg-paste', rows: Math.min(12, flags.length + 1), readonly: true, 'aria-label': 'The flags as text' }, text);
    openDialog({ title: `Flags of ${s.name} as text`, body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Select it and copy.'), area), actions: [{ label: 'Done', kind: 'primary' }], initialFocus: '.fg-paste' });
    requestAnimationFrame(() => area.select());
  }
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
  // ↑ / ↓ in a time box move it by a tenth of a second (Shift: a second), within the sound
  function nudger(box, done) {
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      // an empty New flag box starts from where the sound is playing, or from the start
      const t = box.value.trim() ? parseTime(box.value) : box === addTime ? (live() ? voiceTime(live()) : 0) : null;
      if (t == null) return;
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
      box.value = at(clamp(Math.round((t + step) * 10) / 10, 0, dur()));
      done();
    });
  }
  nudger(addTime, () => { fail(''); drawMarks(); });
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
      const was = flagOf(soundId, f.id);
      if (!s || !was) return;
      const t = parseTime(time.value);
      const clash = t == null ? null : flagNear(s.flags.filter((x) => x.id !== f.id), t);
      if (t == null || t > dur() || clash) {
        toast(t == null ? 'Type a time like 1:23.5.' : clash ? `${clash.label} is already at ${at(clash.t)}.` : `That is past the end (${at(dur())}).`);
        time.value = at(was.t);
        return;
      }
      const next = withTime(s.flags, f.id, t);
      const reordered = next.map((x) => x.id).join() !== s.flags.map((x) => x.id).join();
      shown = JSON.stringify(next);
      saveFlags(soundId, next);
      time.value = at(t);
      drawMarks();
      // the rows are renumbered only when the order changed, and the box keeps the focus (↑ ↓ go on)
      if (reordered) {
        const focused = document.activeElement === time;
        render();
        if (focused) list.querySelector(`[data-flag="${CSS.escape(f.id)}"] .fg-time`)?.focus();
      }
    });
    for (const box of [label, time]) box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); } });
    nudger(time, () => time.dispatchEvent(new Event('change')));
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
  // the flags as "m:ss.t Name" lines, for notes or to paste onto another sound
  const copyBtn = h('button', {
    class: 'btn btn-sm fg-copybtn', type: 'button', title: 'Copy the flags as text, one "time name" per line',
    onclick: () => copyFlags(soundId),
  }, icon('copy', 'icon-sm'), 'Copy as text');
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
    addErr,
    h('div', { class: 'fg-tools' },
      h('button', { class: 'btn btn-sm fg-pastebtn', type: 'button', title: 'Add many flags from a list of times, like a video’s chapters', onclick: () => pasteFlags(soundId) }, icon('playlist', 'icon-sm'), 'Paste a list of times…'),
      copyBtn));
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
  const { id } = r.sound;
  toast(`${r.flag.label} dropped at ${at(r.t)} in ${r.sound.name}.`, {
    type: 'ok', timeout: 6000,
    actions: [
      { label: 'Rename', run: () => renameFlag(id, r.flag.id) },
      { label: 'Undo', run: () => { const s = library.get(id); if (s) saveFlags(id, withoutFlag(s.flags, r.flag.id)); } },
    ],
  });
  return r;
}
