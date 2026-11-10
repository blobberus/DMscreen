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

// A list of moments as text, one per line, the way a video's description gives its chapters:
// "0:00 Intro", "1:23 - The battle", "[1:02:03] Night", "4. 12:05 Dawn", "The storm (3:15)".
const STAMP = /(?:^|[\s([])((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)(?=$|[\s)\],.:;!?–—-])/;
const toSeconds = (s) => s.split(':').map(Number).reduce((a, p) => a * 60 + p, 0);
/** -> {items: [{t, label}], skipped: lines with no time or past `duration`} (sorted, one per moment). */
export function parseFlagList(text, duration = Infinity) {
  const items = [];
  let skipped = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = STAMP.exec(line);
    const t = m ? toSeconds(m[1]) : null;
    if (t == null || t > duration) { skipped++; continue; }
    // punctuation stuck to the time ("at 12:00!") goes with it; a name's own ("Charge! 1:00") stays
    const label = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length).replace(/^[!?;,.]+/, ''))
      .replace(/^\s*\d+[.)]\s+/, '')                 // a list number: "4. "
      .replace(/[()[\]]/g, ' ')
      .replace(/^[\s:–—|-]+|[\s:–—|-]+$/g, '')       // the dash or colon between time and name
      .replace(/\s+/g, ' ')
      .trim();
    if (items.some((x) => Math.abs(x.t - t) < NEAR)) { skipped++; continue; }
    items.push({ t, label: label.slice(0, 60) });
  }
  return { items: items.sort((a, b) => a.t - b.t), skipped };
}

/** The flags as text, one "m:ss.t Name" per line (the same form parseFlagList reads back). */
export function flagListText(flags, fmt) {
  return sortFlags(flags).map((f) => `${fmt(f.t)} ${f.label}`).join('\n');
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
