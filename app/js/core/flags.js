// A sound's flags: named moments to jump to, or to start a pad at. Each is {id, t, label}, t in seconds
// into the file (not into the trimmed part). The editor, the Console and the Flags dialog all change them
// through these helpers, which return a new sorted list and never touch the one they are given; save the
// result with saveFlags().
import { uid } from './util.js';
import { library } from './library.js';

/** Two flags closer than this (seconds) are the same moment. */
export const NEAR = 0.05;
/** The same, for a flag dropped live as a sound plays: a double tap on the Flag button is one flag. */
export const LIVE_NEAR = 0.4;

export const roundTime = (t) => Math.round(t * 1000) / 1000;
export const sortFlags = (flags) => (flags || []).slice().sort((a, b) => a.t - b.t);

/** The flag within NEAR of t, if any. */
export function flagNear(flags, t, within = NEAR) {
  return (flags || []).find((f) => Math.abs(f.t - t) < within) || null;
}

/** "Flag N" for a new flag: one past the count, skipping names already used. */
export function nextLabel(flags) {
  const used = new Set((flags || []).map((f) => f.label));
  let n = (flags || []).length + 1;
  while (used.has(`Flag ${n}`)) n++;
  return `Flag ${n}`;
}

/** Add a flag at t. -> {flags, flag}, or {flags, flag: null, near} when one is already within `within`. */
export function withFlag(flags, t, label, within = NEAR) {
  const list = flags || [];
  const near = flagNear(list, t, within);
  if (near) return { flags: sortFlags(list), flag: null, near };
  const flag = { id: uid('f'), t: roundTime(Math.max(0, t)), label: String(label || '').trim() || nextLabel(list) };
  return { flags: sortFlags([...list, flag]), flag };
}

export function withoutFlag(flags, id) {
  return sortFlags((flags || []).filter((f) => f.id !== id));
}

export function withLabel(flags, id, label) {
  const text = String(label || '').trim();
  return sortFlags((flags || []).map((f) => (f.id === id && text ? { ...f, label: text } : f)));
}

export function withTime(flags, id, t) {
  return sortFlags((flags || []).map((f) => (f.id === id ? { ...f, t: roundTime(Math.max(0, t)) } : f)));
}

/** Where a playing voice is now, in seconds into its file (flags are kept in file time). */
export const voiceTime = (voice) => (voice.from || 0) + (voice.position || 0);

/** Drop a flag where a playing voice is now and save it.
 *  -> {sound, t, flags, flag} ({flag: null, near} when one is already there), or null with no sound. */
export function flagVoice(voice, label) {
  const sound = voice && library.get(voice.sound.id);
  if (!sound) return null;
  const t = voiceTime(voice);
  const r = withFlag(sound.flags, t, label, LIVE_NEAR);
  if (r.flag) saveFlags(sound.id, r.flags);
  return { sound, t, ...r };
}

/** Save a sound's flags (copies, sorted). */
export function saveFlags(id, flags) {
  library.update(id, { flags: sortFlags(flags).map((f) => ({ ...f })) });
}
