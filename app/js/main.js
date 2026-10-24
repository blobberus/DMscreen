// Boot: load state and the library, start the audio engine, build the rail and the top bar,
// mount the workspace and wire the keyboard. On the website the gate, the sound list and the setup
// come first (see core/site.js).
import { h, icon, setIcon } from './core/dom.js';
import { SITE } from './core/mode.js';
import { gate } from './core/gate.js';
import * as site from './core/site.js';
import { state } from './core/state.js';
import { library } from './core/library.js';
import { bus } from './core/bus.js';
import { keys } from './core/keys.js';
import { kbd } from './core/kbd.js';
import { toast } from './core/ui.js';
import { fmtTime, clamp } from './core/util.js';
import { engine } from './audio/engine.js';
import { board } from './audio/board.js';
import { workspace, layoutIcon } from './layout/workspace.js';
import { buildRail } from './layout/rail.js';
import { openSettings } from './dialogs/settings.js';
import { openShortcuts } from './dialogs/shortcuts.js';
import { startPlaylistKey, playlists } from './audio/playlists.js';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('dm:theme', theme); } catch { /* private mode */ }
}

export async function lock() {
  if (SITE) {
    state.flush();
    gate.lock();
  } else {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* going anyway */ }
  }
  engine.fadeAll(0.6);
  setTimeout(() => location.replace(SITE ? 'login.html' : '/login'), 400);
}

// ---------- top bar: the deck and the master section ------------------------------
function buildTop() {
  const deck = document.getElementById('deck');
  const playIcon = icon('play');
  const playBtn = h('button', { class: 'btn-icon deck-play', type: 'button', title: 'Play or pause (Alt+P)', 'aria-label': 'Play or pause', onclick: () => engine.togglePlay() }, playIcon);
  const title = h('div', { class: 'deck-title truncate' });
  const time = h('div', { class: 'deck-time time' });
  const bar = h('div', { class: 'deck-bar', title: 'Click to jump' }, h('i'));
  const info = h('div', { class: 'deck-info' }, title, time, bar);
  deck.append(
    h('div', { class: 'deck-buttons' },
      h('button', { class: 'btn-icon', type: 'button', title: 'Previous track (Alt+,)', 'aria-label': 'Previous track', onclick: () => engine.prev() }, icon('prev')),
      playBtn,
      h('button', { class: 'btn-icon', type: 'button', title: 'Next track (Alt+.)', 'aria-label': 'Next track', onclick: () => engine.next() }, icon('next'))),
    info,
  );
  bar.addEventListener('click', (e) => {
    const v = engine.music.voice;
    if (!v) return;
    const r = bar.getBoundingClientRect();
    engine.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * v.length);
  });
  let flagsKey = '';
  const render = () => {
    const v = engine.music.voice;
    const s = v?.sound;
    setIcon(playIcon, v && v.state === 'playing' ? 'pause' : 'play');
    if (!s) {
      const pl = engine.playlist();
      const top = engine.layers.size;
      title.replaceChildren(h('span', { class: 'deck-idle' }, pl ? `${pl.name}: stopped. Alt+P to play.` : top ? `${top} ${top === 1 ? 'sound' : 'sounds'} on top. Alt+1 to 9 starts a playlist.` : 'Nothing playing. Alt+1 to 9 starts a playlist.'));
      time.textContent = '';
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const pl = engine.playlist();
    const top = engine.layers.size;
    title.replaceChildren(pl ? h('span', { class: 'deck-pl' }, `${pl.name} · `) : '', s.name, top ? h('span', { class: 'deck-pl' }, `  + ${top} on top`) : '');
    const key = `${s.id}|${v.from}|${v.to}|${(s.flags || []).map((f) => f.t).join(',')}`;
    if (key !== flagsKey) {
      flagsKey = key;
      bar.querySelectorAll('b').forEach((b) => b.remove());
      for (const f of engine.flags()) bar.append(h('b', { style: { left: `${((f.t - v.from) / v.length) * 100}%` }, title: f.label }));
    }
    tick();
  };
  const tick = () => {
    const v = engine.music.voice;
    if (!v) return;
    time.textContent = `${fmtTime(v.position)} / ${fmtTime(v.length)}`;
    bar.style.setProperty('--p', `${(v.progress * 100).toFixed(2)}%`);
  };
  bus.on('audio', render);
  bus.on('audio:tick', tick);
  bus.on('library:sound', render);
  render();

  // master section
  const right = document.getElementById('top-right');
  const duck = h('button', { class: 'btn btn-ghost top-btn', type: 'button', title: 'Duck music and ambience while you talk (Alt+\\)', 'aria-pressed': 'false', onclick: () => engine.toggleDuck() },
    icon('duck'), h('span', { class: 'label' }, 'Duck'), kbd(keys.combo('duck')));
  const fade = h('button', { class: 'btn btn-ghost top-btn', type: 'button', title: 'Fade everything out (Alt+0)', onclick: () => engine.fadeAll() },
    icon('fade'), h('span', { class: 'label' }, 'Fade all'), kbd(keys.combo('fade.all')));
  const master = h('input', { class: 'range', type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Master volume' });
  const masterNum = h('span', { class: 'num' });
  const syncLevels = () => {
    const v = Math.round(engine.levels().master * 100);
    master.value = v;
    master.style.setProperty('--fill', `${v}%`);
    masterNum.textContent = v;
    duck.setAttribute('aria-pressed', String(engine.ducked));
    duck.classList.toggle('is-active', engine.ducked);
  };
  master.addEventListener('input', () => { engine.setLevel('master', master.value / 100); syncLevels(); });
  bus.on('audio:levels', syncLevels);
  syncLevels();
  const level = h('label', { class: 'top-level', title: 'Master volume' }, icon('volume', 'icon-sm'), master, masterNum);

  const status = h('button', { class: 'keys-status', type: 'button', title: 'Keyboard shortcuts' }, h('span', { class: 'dot' }), h('span', { class: 'label truncate' }, 'Keys ready'));
  const statusLabel = status.querySelector('.label');
  let firedTimer = null;
  const showReady = () => {
    status.classList.remove('is-paused', 'is-fired');
    statusLabel.textContent = engine.suspended && engine.ready ? 'Click once for sound' : 'Keys ready';
    status.classList.toggle('audio-asleep', engine.suspended && engine.ready);
  };
  status.addEventListener('click', () => {
    if (keys.paused) { keys.reclaim(); window.focus(); showReady(); return; }
    openShortcuts();
  });
  bus.on('keys:paused', (frame) => {
    const pane = frame.closest('[data-panel]');
    const name = pane ? workspace.panelTitle(pane.dataset.panel) : 'a site';
    status.classList.add('is-paused');
    status.classList.remove('is-fired');
    statusLabel.textContent = `Keys paused in ${name}`;
    status.title = 'A site pane has the keyboard. Click here (or anywhere outside it) to get shortcuts back.';
  });
  bus.on('keys:resumed', showReady);
  bus.on('audio:state', showReady);
  const fired = (text) => {
    if (keys.paused) return;
    clearTimeout(firedTimer);
    status.classList.add('is-fired');
    statusLabel.textContent = text;
    firedTimer = setTimeout(showReady, 1600);
  };
  bus.on('pad:fired', ({ key, pad }) => fired(`${key} · ${pad.label || library.get(pad.sound)?.name || 'Pad'}`));
  bus.on('keys:fired', ({ action }) => {
    if (action.id.startsWith('music.') && action.id !== 'music.toggle') return;
    fired(action.label);
  });
  showReady();

  // its icon is the arrangement on screen now
  let layoutGlyph = icon('layout');
  const layoutBtn = h('button', { class: 'btn btn-ghost top-btn', type: 'button', title: 'Arrange the panes', onclick: (e) => workspace.layoutMenu(e.currentTarget) },
    layoutGlyph, h('span', { class: 'label' }, 'Layout'), icon('chevron-down', 'icon-sm'));
  bus.on('layout:changed', () => {
    const g = layoutIcon(workspace.arrangement().areas);
    layoutGlyph.replaceWith(g);
    layoutGlyph = g;
  });

  // panes taken off the screen, one click from coming back
  const hiddenCount = h('span', { class: 'top-count' });
  const hiddenBtn = h('button', { class: 'btn btn-ghost top-btn', type: 'button', hidden: true, onclick: (e) => workspace.hiddenMenu(e.currentTarget) },
    icon('eye-off'), hiddenCount, h('span', { class: 'label' }, 'hidden'));
  const markHidden = () => {
    const gone = workspace.compact ? [] : workspace.hiddenPanes();
    hiddenBtn.hidden = !gone.length;
    hiddenCount.textContent = String(gone.length);
    hiddenBtn.title = `Hidden: ${gone.map((p) => workspace.paneLabel(p)).join('; ')}. Choose one to show it again.`;
  };
  bus.on('layout:changed', markHidden);

  right.append(duck, fade, level, status, hiddenBtn, layoutBtn);
}

// ---------- keyboard actions -------------------------------------------------------------
function wireKeys() {
  keys.on('music.toggle', () => engine.togglePlay());
  keys.on('music.next', () => engine.next());
  keys.on('music.prev', () => engine.prev());
  keys.on('flag.next', () => engine.nextFlag());
  keys.on('flag.prev', () => engine.prevFlag());
  keys.on('music.down', () => engine.nudge('music', -0.05));
  keys.on('music.up', () => engine.nudge('music', 0.05));
  keys.on('duck', () => engine.toggleDuck());
  keys.on('fade.all', () => engine.fadeAll());
  keys.on('help', () => openShortcuts());
  for (let n = 1; n <= 9; n++) {
    keys.on(`flag.${n}`, () => engine.jumpFlag(n - 1));
    keys.on(`playlist.${n}`, () => startPlaylistKey(n));
  }
}

// Touch screens have no right-click: holding a finger still for a moment opens the same menu.
function longPress() {
  let timer = null;
  let start = null;
  let swallow = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  document.addEventListener('pointerdown', (e) => {
    cancel();
    if (e.pointerType !== 'touch' || e.target.closest('input, textarea, select, iframe, .ed-wave, .fader, .splitter')) return;
    start = { x: e.clientX, y: e.clientY, target: e.target };
    timer = setTimeout(() => {
      timer = null;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y });
      if (!start.target.dispatchEvent(ev)) swallow = true;
    }, 520);
  }, { passive: true });
  document.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); }, { passive: true });
  document.addEventListener('pointerup', cancel, { passive: true });
  document.addEventListener('pointercancel', cancel, { passive: true });
  // the finger lifting after the menu opened is not a tap on what was under it
  document.addEventListener('click', (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
}

// The website keeps working without the internet once its files are on the device (sw.js), and moves
// to a new publish by itself: at once when nothing is playing, otherwise when the DM chooses to.
function offline() {
  if (!SITE || !('serviceWorker' in navigator)) return;
  const updating = !!navigator.serviceWorker.controller;      // the first install isn't an update
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const look = () => reg.update().catch(() => {});
    setInterval(look, 15 * 60 * 1000);                          // a long session still hears of a publish
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    if (!engine.anythingPlaying()) { location.reload(); return; }
    toast('The screen was updated. Reload it between scenes to use the new version.', { timeout: 10 * 60 * 1000, action: { label: 'Reload', run: () => location.reload() } });
  });
  navigator.storage?.persist?.().catch(() => {});
}

function siteNotices() {
  bus.on('site:library', ({ added }) => {
    if (!added?.length) return;
    const names = added.map((id) => library.get(id)?.name).filter(Boolean);
    toast(names.length === 1 ? `“${names[0]}” is on the screen now.` : `${names.length} new sounds are on the screen now.`, { type: 'ok' });
  });
  bus.on('site:publish', (p) => {
    if (p.state === 'failed') toast('GitHub couldn’t publish the latest change.', { type: 'error', timeout: 9000, action: { label: 'See why', run: () => window.open(p.run?.html_url || site.links.actions, '_blank', 'noopener') } });
  });
  let lastError = null;
  bus.on('site:sync', (info) => {
    if (!info.connected && info.dirty) {
      toast('Saved on this device. Connect GitHub in Settings to keep your setup on every device.', { timeout: 7000, action: { label: 'Settings', run: () => openSettings('github') } });
    } else if (info.error && info.error !== lastError) {
      toast(`Couldn't save the setup to GitHub: ${info.error}`, { type: 'error', timeout: 9000 });
    }
    lastError = info.error;
  });
}

// Files dropped anywhere but a drop zone must not navigate away from the screen.
function guardDrops() {
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
}

async function boot() {
  if (SITE && !gate.unlocked()) { location.replace('login.html'); return; }
  guardDrops();
  longPress();
  try {
    if (SITE) {
      await site.load();
      await state.load();
      await library.load();
      board.reconcile();
      playlists.reconcile();
    } else await Promise.all([state.load(), library.load()]);
  } catch (e) {
    document.getElementById('workspace').append(h('div', { class: 'empty' }, h('strong', null, SITE ? "Couldn't load the sound list." : "Couldn't reach the DM Screen server."), h('span', null, e.message)));
    return;
  }
  if (SITE) { offline(); siteNotices(); }
  applyTheme(state.get('settings').theme);
  bus.on('state:settings', (s) => applyTheme(s.theme));
  engine.init();
  buildRail({
    utilities: [
      { label: 'Shortcuts', icon: 'help', title: 'Shortcuts (Alt+/)', onClick: () => openShortcuts() },
      { label: 'Settings', icon: 'settings', onClick: () => openSettings() },
      { label: 'Lock the screen', icon: 'lock', title: 'Lock the screen (sign out)', onClick: lock },
    ],
  });
  buildTop();
  wireKeys();
  workspace.mount(document.getElementById('workspace'));
  engine.preload(Object.values(board.active().pads).map((p) => p.sound));
  library.refreshJobs().then((jobs) => { if (jobs.some((j) => !['done', 'error', 'cancelled'].includes(j.status))) library.pollJobs(); }).catch(() => {});
  bus.on('state:saved', ({ ok, error }) => { if (!ok) toast(`Couldn't save your changes: ${error}. Retrying.`, { type: 'error' }); });
  bus.on('job:finished', (j) => {
    if (j.status === 'done') toast(`Downloaded “${j.title}” into the library.`, { type: 'ok' });
    else if (j.status === 'error') toast(j.error || 'A download failed.', { type: 'error' });
  });
}

boot();
