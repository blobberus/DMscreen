// Flags from outside the editor: drop one on a playing sound where it is now (Alt+Shift+F, the
// Console's Flag button), and rename one from the toast that follows.
import { engine } from '../audio/engine.js';
import { library } from '../core/library.js';
import { toast, promptDialog } from '../core/ui.js';
import { fmtTime } from '../core/util.js';
import { flagVoice, withLabel, saveFlags } from '../core/flags.js';

/** Ask for a flag's new name and save it. */
export async function renameFlag(soundId, flagId) {
  const s = library.get(soundId);
  const f = s?.flags?.find((x) => x.id === flagId);
  if (!f) return;
  const label = await promptDialog('Rename this flag', { label: 'Label', value: f.label, okLabel: 'Rename', hint: `${s.name} · ${fmtTime(f.t, { tenths: true })}` });
  const now = library.get(soundId);
  if (label && now) saveFlags(now.id, withLabel(now.flags, flagId, label));
}

/** Drop a flag on a playing voice (the deck's track unless told) where it is now. */
export function dropFlag(voice = engine.music.voice) {
  if (!voice) { toast('Nothing is playing to flag. Start a track first.'); return null; }
  const r = flagVoice(voice);
  if (!r) return null;
  if (!r.flag) { toast(`${r.near.label} is already there.`); return r; }
  toast(`${r.flag.label} dropped at ${fmtTime(r.t, { tenths: true })} in ${r.sound.name}.`, {
    type: 'ok', timeout: 6000, action: { label: 'Rename', run: () => renameFlag(r.sound.id, r.flag.id) },
  });
  return r;
}
