// Flags from outside the editor: drop one on a playing sound where it is now (Alt+Shift+F, the
// Console's Flag button), and rename, move or delete one (the Console's flag menu, the toast after a drop).
import { engine } from '../audio/engine.js';
import { library } from '../core/library.js';
import { toast, promptDialog, showMenu } from '../core/ui.js';
import { fmtTime } from '../core/util.js';
import { flagVoice, flagNear, voiceTime, withLabel, withTime, withoutFlag, saveFlags } from '../core/flags.js';

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
