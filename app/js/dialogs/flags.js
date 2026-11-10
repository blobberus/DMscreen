// Flags from outside the editor: drop one on a playing sound where it is now (Alt+Shift+F, the
// Console's Flag button), rename, move or delete one (the Console's flag menu, the toast after a drop),
// and the Flags dialog, which lists every flag of one sound to name, retime, delete or add by time.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { engine } from '../audio/engine.js';
import { library, KIND_LABEL } from '../core/library.js';
import { toast, promptDialog, showMenu, openDialog } from '../core/ui.js';
import { fmtTime, parseTime } from '../core/util.js';
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

// ---- the Flags dialog: every flag of one sound ------------------------------------------------
/** Name, move, delete and add a sound's flags without the editor. With a voice of that sound playing,
 *  the new flag's time starts where it is. */
export function openFlags(soundId, { voice = null } = {}) {
  const s0 = library.get(soundId);
  if (!s0) return null;
  const dur = () => library.get(soundId)?.duration || 0;
  const list = h('div', { class: 'fg-list', role: 'list', 'aria-label': 'Flags' });
  const count = h('span', { class: 'meta num fg-count' });
  const addTime = h('input', { class: 'input input-sm num fg-addtime', placeholder: '1:23.5', inputmode: 'decimal', 'aria-label': 'Time of the new flag' });
  const addLabel = h('input', { class: 'input input-sm fg-addlabel', placeholder: 'Name (optional)', maxlength: 60, 'aria-label': 'Name of the new flag' });
  const addErr = h('p', { class: 'field-hint fg-err', role: 'alert', hidden: true });
  const playing = () => voice && ['playing', 'paused', 'loading'].includes(voice.state) && voice.sound.id === soundId;
  if (playing()) addTime.value = at(voiceTime(voice));
  const fail = (text) => { addErr.textContent = text; addErr.hidden = !text; };

  function add() {
    const s = library.get(soundId);
    if (!s) return;
    const typed = addTime.value.trim();
    const t = typed ? parseTime(typed) : playing() ? voiceTime(voice) : null;
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
  addTime.addEventListener('input', () => fail(''));

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
    if (!flags.length) list.append(h('p', { class: 'meta fg-none' }, 'No flags yet. Type a time below and press Add flag, or drop one while it plays.'));
    flags.forEach((f, i) => list.append(row(f, i)));
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
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: `Delete ${f.label}`, 'aria-label': `Delete ${f.label}`, onclick: () => { deleteFlag(soundId, f.id); render(); } }, icon('close')));
  }
  list.addEventListener('focusout', () => requestAnimationFrame(() => { if (stale && !list.contains(document.activeElement)) render(); }));
  const off = bus.on('library:sound', (s) => {
    if (s.id !== soundId || JSON.stringify(s.flags || []) === shown) return;
    if (list.contains(document.activeElement)) { stale = true; return; }
    render();
  });
  const [from, to] = library.region(s0);
  const trimmed = from > 0.01 || to < (s0.duration || 0) - 0.01;
  const body = h('div', { class: 'fg' },
    h('div', { class: 'fg-head' },
      h('span', { class: 'meta' }, [KIND_LABEL[s0.kind], at(s0.duration), trimmed ? `plays ${at(from)} to ${at(to)}` : null].filter(Boolean).join(' · ')),
      count),
    list,
    h('div', { class: 'fg-add' },
      h('span', { class: 'fg-addcap meta' }, 'New flag'),
      addTime, addLabel,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: add }, icon('flag-add', 'icon-sm'), 'Add flag')),
    addErr);
  render();
  return openDialog({
    title: `Flags: ${s0.name}`, body, className: 'fg-dialog', initialFocus: '.fg-addtime',
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => off(),
  });
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
