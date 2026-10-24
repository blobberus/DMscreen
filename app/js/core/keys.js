// Keyboard shortcuts. Every action has an Alt combo that works anywhere, even while typing;
// when you're not typing (and "single keys" is on) the same keys work without Alt.
// Keys are read by physical position (event.code), so they don't change with the keyboard layout.
// Letters that no action uses belong to the soundboard's pads.
import { state } from './state.js';
import { bus } from './bus.js';
import { isTyping } from './util.js';
import { dialogOpen } from './ui.js';

const NAMED = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter',
  Backspace: 'Backspace', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  PageUp: 'PageUp', PageDown: 'PageDown', NumpadAdd: '=', NumpadSubtract: '-',
};
const SHOW = { Backspace: '⌫', Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: 'Enter', Space: 'Space', Shift: '⇧' };

export function keyFromCode(code) {
  if (!code) return null;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED[code] || null;
}

/** "Alt+Shift+1" -> ["Alt", "Shift", "1"] for drawing keycaps. */
export function comboParts(combo) {
  if (!combo) return [];
  return combo.split('+').map((p) => SHOW[p] || p);
}
export const comboLabel = (combo) => comboParts(combo).join('+');

const actions = new Map();
let padHandler = null;
let altUsed = false;

function digitActions(prefix, label, comboFn) {
  for (let n = 1; n <= 9; n++) actions.set(`${prefix}.${n}`, { id: `${prefix}.${n}`, label: label(n), combo: comboFn(n), group: prefix });
}

export const keys = {
  paused: null,       // the iframe that has the keyboard, if any

  define(id, def) {
    actions.set(id, { ...(actions.get(id) || {}), id, ...def });
  },
  on(id, run) {
    const a = actions.get(id);
    if (a) a.run = run;
  },
  list: () => [...actions.values()],
  get: (id) => actions.get(id),
  combo(id) {
    const km = state.get('keymap') || {};
    return Object.prototype.hasOwnProperty.call(km, id) ? km[id] : actions.get(id)?.combo || null;
  },
  setCombo(id, combo) {
    state.update('keymap', (km) => {
      for (const [other, c] of Object.entries(km)) if (c === combo && other !== id) km[other] = null;
      for (const a of actions.values()) if (a.id !== id && a.combo === combo && km[a.id] === undefined) km[a.id] = null;
      km[id] = combo;
    });
  },
  reset(id) {
    state.update('keymap', (km) => { delete km[id]; });
  },
  resetAll() { state.set('keymap', {}); },
  /** Which action, if any, owns this combo. */
  actionFor(combo) {
    for (const a of actions.values()) if (this.combo(a.id) === combo) return a;
    return null;
  },
  /** The pad handler receives a key like "Q" and returns true if a pad fired. */
  onPad(fn) { padHandler = fn; },
  /** Give the keyboard back to the screen (from a site's frame). */
  reclaim() {
    const sink = document.getElementById('focus-sink');
    sink?.focus({ preventScroll: true });
  },
};

// ---- the default map ---------------------------------------------------------
keys.define('music.toggle', { label: 'Play or pause the music', combo: 'Alt+P', alias: 'Space', group: 'music' });
keys.define('music.prev', { label: 'Previous track', combo: 'Alt+,', group: 'music' });
keys.define('music.next', { label: 'Next track', combo: 'Alt+.', group: 'music' });
keys.define('flag.prev', { label: 'Back to the previous flag', combo: 'Alt+[', group: 'music' });
keys.define('flag.next', { label: 'Skip to the next flag', combo: 'Alt+]', group: 'music' });
keys.define('music.down', { label: 'Music quieter', combo: 'Alt+-', group: 'music', repeat: true });
keys.define('music.up', { label: 'Music louder', combo: 'Alt+=', group: 'music', repeat: true });
keys.define('duck', { label: 'Duck music and ambience (talk over)', combo: 'Alt+\\', group: 'music' });
keys.define('fade.all', { label: 'Fade everything out', combo: 'Alt+0', group: 'music' });
keys.define('effects.stop', { label: 'Stop all effects', combo: 'Alt+Backspace', group: 'board' });
keys.define('bank.prev', { label: 'Previous pad bank', combo: 'Alt+Up', group: 'board' });
keys.define('bank.next', { label: 'Next pad bank', combo: 'Alt+Down', group: 'board' });
keys.define('pane.max', { label: 'Maximise or restore the focused pane', combo: 'Alt+Enter', group: 'screen' });
keys.define('pane.hide', { label: 'Hide the focused pane (the others take its space)', combo: 'Alt+Shift+H', group: 'screen' });
keys.define('pane.show', { label: 'Show every hidden pane again', combo: 'Alt+Shift+S', group: 'screen' });
keys.define('help', { label: 'Show the shortcuts', combo: 'Alt+/', group: 'screen' });
digitActions('playlist', (n) => `Start playlist ${n}`, (n) => `Alt+${n}`);
digitActions('flag', (n) => `Jump to flag ${n} of the playing track`, (n) => `Alt+Shift+${n}`);

export const GROUPS = { music: 'Music', playlist: 'Playlists', flag: 'Flags', board: 'Soundboard', screen: 'Screen' };

// ---- dispatch ----------------------------------------------------------------
function fire(action, e) {
  if (!action.run) return false;
  if (e.repeat && !action.repeat) return true;
  action.run(e);
  bus.emit('keys:fired', { action });
  return true;
}

function onKeyDown(e) {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.ctrlKey || e.metaKey) return;               // Ctrl shortcuts and AltGr belong to the browser and editors
  const k = keyFromCode(e.code);
  if (!k) return;
  let combo;
  if (e.altKey) {
    combo = (e.shiftKey ? 'Alt+Shift+' : 'Alt+') + k;
  } else {
    const t = e.target;
    if (isTyping(t) || t.closest?.('[data-keys="local"]') || dialogOpen()) return;
    if (!state.get('settings')?.singleKeys) return;
    if (['Enter', 'Backspace', 'Up', 'Down', 'Left', 'Right', 'PageUp', 'PageDown'].includes(k)) return;
    if (k === 'Space') {
      if (t.closest?.('button, a, [role="button"], summary, input')) return;
      const a = keys.actionFor('Space') || [...actions.values()].find((x) => x.alias === 'Space' && keys.combo(x.id));
      if (a && fire(a, e)) e.preventDefault();
      return;
    }
    combo = (e.shiftKey ? 'Alt+Shift+' : 'Alt+') + k;
  }
  const action = keys.actionFor(combo);
  if (action) {
    if (fire(action, e)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) altUsed = true;
    }
    return;
  }
  if (!e.shiftKey && padHandler && !e.repeat) {
    if (padHandler(k, e)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) altUsed = true;
    }
  } else if (e.altKey && padHandler && e.repeat) {
    e.preventDefault();
  }
}

window.addEventListener('keydown', onKeyDown, true);
// Releasing Alt after a combo would focus the browser's menu in some browsers.
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt' && altUsed) { e.preventDefault(); altUsed = false; }
}, true);

// When a site's frame takes the keyboard, the screen can't hear keys until you click back.
// A frame that grabs focus on its own (an autofocused password box) gets it taken back once; a frame you
// are pointing at, clicked, tapped or tabbed into keeps it. Sites from another address show the screen
// no pointer events at all, so "pointing at" means the pointer was last seen at the frame's edge or
// inside it. A frame that takes the focus straight back is left with it rather than fought: that
// tug-of-war ran hundreds of times a second and froze the screen. With "give the keyboard back" on,
// pointing back at the screen for a moment returns the keys.
const NEAR = 24;                        // px around a frame that still count as pointing at it
const pointer = { x: -1, y: -1, type: 'mouse', downAt: 0 };
const frameUsed = new WeakMap();        // same-address frame -> when it last had a tap or a key
let tabAt = 0;
let taken = { frame: null, at: 0 };     // the last frame the keys were taken back from
let leaveTimer = null;

function near(frame, pad = NEAR) {
  const r = frame.getBoundingClientRect();
  return pointer.x >= r.left - pad && pointer.x <= r.right + pad && pointer.y >= r.top - pad && pointer.y <= r.bottom + pad;
}
function frameDoc(frame) {
  try { return frame.contentDocument; } catch { return null; }
}
/** Did you put the keys in this frame, rather than the frame taking them? */
function chosen(frame) {
  const now = performance.now();
  if (now - tabAt < 400) return true;
  if (frameDoc(frame)) return now - (frameUsed.get(frame) || 0) < 1000;
  if (pointer.type === 'mouse') return near(frame);
  // a tap in another site's frame: the page has a fresh tap that didn't land on the screen itself
  return !!navigator.userActivation?.isActive && now - pointer.downAt > 400;
}

const seen = (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.type = e.pointerType || 'mouse';
};
document.addEventListener('pointermove', (e) => {
  seen(e);
  const f = keys.paused;
  if (!f || e.target === f || near(f) || leaveTimer) return;
  leaveTimer = setTimeout(() => {
    leaveTimer = null;
    if (keys.paused === f && !near(f) && state.get('settings')?.returnFocus) {
      keys.reclaim();
      window.focus();
    }
  }, 700);
}, { capture: true, passive: true });
document.addEventListener('pointerover', seen, { capture: true, passive: true });
document.addEventListener('pointerdown', (e) => { seen(e); pointer.downAt = performance.now(); }, { capture: true, passive: true });
document.addEventListener('keydown', (e) => { if (e.key === 'Tab') tabAt = performance.now(); }, true);
// Frames from the screen's own address (Stone Wardens on the website) can be watched from inside.
document.addEventListener('load', (e) => {
  const frame = e.target;
  const doc = frame.tagName === 'IFRAME' && frameDoc(frame);
  if (!doc) return;
  const used = () => frameUsed.set(frame, performance.now());
  for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, used, { capture: true, passive: true });
}, true);

window.addEventListener('blur', () => {
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || a.tagName !== 'IFRAME') return;
    const now = performance.now();
    const again = taken.frame === a && now - taken.at < 2000;
    if (!again && !chosen(a)) {
      taken = { frame: a, at: now };
      keys.reclaim();
      return;
    }
    keys.paused = a;
    bus.emit('keys:paused', a);
  }, 0);
});
window.addEventListener('focus', () => {
  clearTimeout(leaveTimer);
  leaveTimer = null;
  if (keys.paused) {
    keys.paused = null;
    bus.emit('keys:resumed');
  }
});
