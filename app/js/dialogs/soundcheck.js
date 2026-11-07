// The sound check (Settings, Audio): a sound down each road a sound takes to the speakers, a "Heard it?"
// for each, and what the answers mean. A page can't tell whether it is heard (iPadOS can drop a page's
// sound while the page thinks it plays), so the DM's ears are the test; the report says what the page saw.
import { h, icon, clear } from '../core/dom.js';
import { IOS, SITE, SOUNDS_REPO } from '../core/mode.js';
import { library } from '../core/library.js';
import * as site from '../core/site.js';
import { bus } from '../core/bus.js';
import { toast } from '../core/ui.js';
import { fmtTime } from '../core/util.js';
import { engine, CHIME } from '../audio/engine.js';
import { board } from '../audio/board.js';

let chimeUrl = null;
/** engine.testTone's chime as a WAV file, for a plain <audio> element that never touches Web Audio. */
function chimeFile() {
  if (chimeUrl) return chimeUrl;
  const rate = 22050;
  const n = rate;                                       // one second
  const wav = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (at, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const [f, d] of CHIME) {
      const x = t - d - 0.05;
      if (x < 0 || x > 0.7) continue;
      const env = x < 0.015 ? (x / 0.015) * 0.35 : 0.35 * (0.001 / 0.35) ** ((x - 0.015) / 0.685);
      v += env * Math.sin(2 * Math.PI * f * x);
    }
    wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true);
  }
  chimeUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  return chimeUrl;
}

/** A short sound (decoded whole, like the pads) and a long one (streamed, like tracks and ambience). */
function pickSounds() {
  const pads = Object.values(board.active()?.pads || {}).map((p) => library.get(p.sound)).filter(Boolean);
  const all = library.list();
  const short = pads.find((s) => engine.useBuffer(s)) || all.find((s) => s.kind === 'effect' && engine.useBuffer(s)) || all.find((s) => engine.useBuffer(s));
  const long = all.find((s) => s.kind !== 'effect' && !engine.useBuffer(s)) || all.find((s) => !engine.useBuffer(s));
  return { short, long };
}

const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

function deviceLine(f) {
  if (f.ios) return f.homeScreen ? 'iPad, opened from the Home Screen' : 'iPad, in a Safari tab';
  return f.homeScreen ? 'Installed app' : 'Browser tab';
}
function engineLine(f) {
  const st = { running: 'On', suspended: 'Asleep: tap anywhere to wake it', interrupted: 'Interrupted by iPadOS: tap anywhere', closed: 'Closed', 'not started': 'Not started' }[f.state] || f.state;
  return f.sampleRate ? `${st} (${(f.sampleRate / 1000).toFixed(1)} kHz)` : st;
}
function silentLine(f) {
  if (!f.ios) return null;
  if (f.session === 'playback') return 'Plays through it (the screen asks iPadOS to treat it as media playback)';
  if (f.session === null) return 'Mutes the screen on the built-in speaker (this iPadOS is older than 17): keep Silent mode off';
  return `Session is “${f.session}”: tap anywhere and look again`;
}

export function soundCheckPanel() {
  const { short, long } = pickSounds();
  const answers = {};          // test id -> true (heard) / false (not heard)
  const seen = {};             // test id -> what the page saw: {ok, text}
  const facts = h('dl', { class: 'ck-facts' });
  const rows = h('div', { class: 'ck-tests' });
  const verdictEl = h('p', { class: 'ck-verdict', hidden: true, 'aria-live': 'polite' });
  const report = h('pre', { class: 'ck-report' });
  const reportBox = h('details', { class: 'ck-details' }, h('summary', null, 'The report'), report);

  function drawFacts() {
    const f = engine.facts();
    const items = [
      ['This device', deviceLine(f)],
      ['Sound engine', engineLine(f)],
      ['Silent mode', silentLine(f)],
      ['Volumes', `Master ${pct(f.levels.master)} · music ${pct(f.levels.music)} · ambience ${pct(f.levels.ambience)} · effects ${pct(f.levels.effects)} · previews ${pct(f.levels.preview)}${f.ducked ? ' · ducked' : ''}`],
      SITE && SOUNDS_REPO ? ['Private sounds', { ok: 'Connected', connect: 'Not connected on this device (Settings, GitHub)', denied: 'GitHub refused this device’s token', expired: 'This device’s GitHub token has expired', indexing: 'Being indexed on GitHub' }[site.soundAccess()] || site.soundAccess()] : null,
    ].filter((x) => x && x[1]);
    clear(facts);
    for (const [k, v] of items) facts.append(h('dt', null, k), h('dd', null, v));
    const low = f.levels.master < 0.1;
    facts.classList.toggle('is-low', low);
  }

  const TESTS = [
    { id: 'engine', label: 'The sound engine', hint: 'A chime through the engine every sound plays through, past all the volumes.',
      run: () => { engine.testTone(); setTimeout(() => saw('engine', engine.facts().state === 'running', `the engine is ${engine.facts().state}`), 700); } },
    { id: 'plain', label: 'A plain audio player', hint: 'The same chime played the way a web page plays a song, without the engine.',
      run: () => {
        const a = new Audio(chimeFile());
        a.play().then(() => saw('plain', true, 'it played'), (e) => saw('plain', false, `it didn’t play (${e.name})`));
      } },
    short ? { id: 'short', label: `A short sound: ${short.name}`, hint: 'Decoded whole, the way pads and effects play. Through the master volume.', sound: short } : null,
    long ? { id: 'long', label: `A long sound: ${long.name}`, hint: 'Streamed while it plays, the way tracks and ambience play. Through the master volume.', sound: long } : null,
  ].filter(Boolean);

  /** Play a library sound as a preview for a few seconds and watch it move. */
  function playSound(t) {
    const s = t.sound;
    const [from, to] = library.region(s);
    const v = engine.previewSound(s, { from, to: Math.min(to, from + 6) });
    if (!v) { saw(t.id, false, engine.previewRoute === 'missing' ? 'previews go to an output that isn’t connected' : 'it didn’t start'); return; }
    const errorsBefore = (engine.errors || []).length;
    setTimeout(() => {
      const err = (engine.errors || []).slice(errorsBefore).pop();
      if (err) saw(t.id, false, `it didn’t play: ${err.error}`);
      else if (v.state === 'loading') saw(t.id, false, 'still loading after 3 s (slow connection?)');
      else if (v.position > 0.2 || v.state === 'stopped') saw(t.id, true, `it played (${fmtTime(v.state === 'stopped' ? v.length : v.position)})`);
      else saw(t.id, false, `it didn’t move (${v.state})`);
    }, 3000);
  }

  function saw(id, ok, text) {
    seen[id] = { ok, text };
    draw();
  }

  function draw() {
    clear(rows);
    for (const t of TESTS) {
      const a = answers[t.id];
      const s = seen[t.id];
      const ask = h('span', { class: 'ck-ask' },
        a === undefined ? h('span', { class: 'meta' }, 'Heard it?') : null,
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(a === true), onclick: () => { answers[t.id] = true; draw(); } }, icon('check', 'icon-sm'), 'Yes'),
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(a === false), onclick: () => { answers[t.id] = false; draw(); } }, icon('close', 'icon-sm'), 'No'));
      rows.append(h('div', { class: 'ck-test' },
        h('button', { class: 'btn btn-sm ck-play', type: 'button', 'aria-label': `Play: ${t.label}`, onclick: () => { delete seen[t.id]; (t.run || (() => playSound(t)))(); draw(); } }, icon('play')),
        h('div', { class: 'ck-what' },
          h('span', { class: 'ck-name truncate' }, t.label),
          h('span', { class: 'field-hint' }, t.hint),
          s ? h('span', { class: `ck-seen${s.ok ? '' : ' is-bad'}` }, `The page saw: ${s.text}.`) : null),
        ask));
    }
    const v = verdict();
    verdictEl.hidden = !v;
    verdictEl.textContent = v || '';
    report.textContent = reportText();
    drawFacts();
  }

  function verdict() {
    const a = answers;
    const f = engine.facts();
    const where = f.ios ? 'the iPad' : 'this device';
    if (a.engine === undefined && a.plain === undefined) return null;
    if (a.engine === false && a.plain === false) {
      return f.ios
        ? 'Nothing from this page reaches you. Turn the iPad up with its volume buttons. In Control Center, check where the sound goes (the AirPlay button on the music tile: the iPad, headphones or a speaker) and that Silent mode is off. Then try again.'
        : 'Nothing from this page reaches you. Check this computer’s volume and which output it plays on, then try again.';
    }
    if (a.engine === false && a.plain === true) {
      if (f.ios && f.session === null) return 'Silent mode is muting the screen: on this iPadOS (older than 17) a page’s sound engine obeys it and plain players don’t. Turn Silent mode off in Control Center, or update iPadOS.';
      return `${f.ios ? 'iPadOS' : 'The browser'} is holding the screen’s sound engine quiet while plain players get through. Press Restart the sound engine below and play the chime again.${f.ios ? ' If it stays quiet, close the DM Screen (swipe it up in the app switcher) and open it again: this is an iPadOS fault with Home Screen apps, and restarting the iPad clears it when nothing else does.' : ''}`;
    }
    if (a.engine === false) return 'The engine’s chime didn’t reach you. Play the plain player too: the two answers together say where the fault is.';
    if (a.engine !== true) return 'Play the sound engine’s chime too: every sound on the screen goes through it.';
    if (a.short === false || a.long === false) {
      const bad = a.short === false ? 'short' : 'long';
      const s = seen[bad];
      if (s && !s.ok) return `The speakers work, but the ${bad} sound didn’t play: ${s.text}.`;
      if (f.levels.master < 0.1) return `The speakers work, but the Master volume (top right) is at ${pct(f.levels.master)}. Turn it up.`;
      if ((f.levels.preview ?? 1) < 0.1) return 'The speakers work, but the preview level (below) is almost off, and this check plays its sounds as previews.';
      return `The speakers work and the ${bad} sound played, yet you didn’t hear it. Check that sound’s own volume (its ⋯ menu) and the Console’s faders, then send the report.`;
    }
    if (TESTS.some((t) => t.sound) && TESTS.some((t) => t.sound && a[t.id] === undefined)) {
      return 'The sound engine reaches the speakers. Play the library sounds too, to check the whole way.';
    }
    return `Everything here reaches ${where}’s speakers.`;
  }

  function reportText() {
    const f = engine.facts();
    const line = (k, v) => (v ? `${k}: ${v}\n` : '');
    const tests = TESTS.map((t) => `  ${t.label}: ${answers[t.id] === true ? 'heard' : answers[t.id] === false ? 'NOT heard' : 'not tried'}${seen[t.id] ? `; the page saw ${seen[t.id].text}` : ''}`).join('\n');
    const when = (x) => new Date(x.at).toLocaleTimeString();
    return `DM Screen sound check, ${new Date().toLocaleString()}\n`
      + line('Device', `${deviceLine(f)}; ${navigator.userAgent}`)
      + line('Engine', `${f.state}, ${f.sampleRate || '?'} Hz, latency ${f.latency ? f.latency.map((x) => (x == null ? '?' : `${x} ms`)).join(' / ') : '?'}; audio session ${f.session ?? 'none (no audioSession)'}; ${f.spares} spare players; previews to ${f.previewRoute}`)
      + line('Volumes', `master ${pct(f.levels.master)}, music ${pct(f.levels.music)}, ambience ${pct(f.levels.ambience)}, effects ${pct(f.levels.effects)}, previews ${pct(f.levels.preview)}${f.ducked ? ', ducked' : ''}`)
      + line('Private sounds', SITE && SOUNDS_REPO ? site.soundAccess() : '')
      + `Tests:\n${tests}\n`
      + line('Recent problems', f.errors.map((e) => `${when(e)} ${e.sound}: ${e.error}`).join('; '))
      + line('Recoveries', f.recoveries.map((r) => `${when(r)} ${r.what}${r.why ? ` (${r.why})` : ''}${r.sound ? ` ${r.sound}` : ''}`).join('; '));
  }

  const restartBtn = h('button', { class: 'btn', type: 'button', title: 'A new sound engine from nothing. Everything playing stops; press Play to carry on.', onclick: () => {
    engine.restart();
    for (const k of Object.keys(seen)) delete seen[k];
    toast('The sound engine started again. Play the chime to check it.', { type: 'ok' });
    draw();
  } }, icon('refresh'), 'Restart the sound engine');
  const copyBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(reportText()); toast('The report is copied. Paste it into a message.', { type: 'ok' }); } catch {
      reportBox.open = true;
      const r = document.createRange();
      r.selectNodeContents(report);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      toast('Couldn’t copy by itself: the report is selected below, copy it from there.', { timeout: 7000 });
    }
  } }, icon('copy'), 'Copy the report');

  const off = bus.on('audio:state', () => { if (!facts.isConnected) { off(); return; } drawFacts(); report.textContent = reportText(); });
  draw();
  return [facts, rows, verdictEl, h('div', { class: 'st-actions' }, restartBtn, copyBtn), reportBox];
}
