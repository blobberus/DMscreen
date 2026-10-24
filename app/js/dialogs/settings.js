// Settings: one view per area, every control saves itself.
// The website swaps the PC-only areas (YouTube downloads, the vault folder) for GitHub, this device's
// offline copy, and notes kept in the browser.
import { h, icon, clear } from '../core/dom.js';
import { SITE, REPO, IOS } from '../core/mode.js';
import { gate } from '../core/gate.js';
import { github } from '../core/github.js';
import * as site from '../core/site.js';
import { vault } from '../core/vault.js';
import { zipText } from '../core/zip.js';
import { library } from '../core/library.js';
import { api, upload } from '../core/api.js';
import { bus } from '../core/bus.js';
import { state, SEARCH_ENGINES } from '../core/state.js';
import { keys, keyFromCode, GROUPS } from '../core/keys.js';
import { kbd } from '../core/kbd.js';
import { openDialog, confirmDialog, toast } from '../core/ui.js';
import { engine } from '../audio/engine.js';

const AREAS = SITE
  ? [['general', 'General'], ['github', 'GitHub'], ['keys', 'Keys'], ['sites', 'Sites'], ['notes', 'Notes'], ['audio', 'Audio'], ['device', 'This device']]
  : [['general', 'General'], ['keys', 'Keys'], ['sites', 'Sites'], ['youtube', 'YouTube'], ['notes', 'Notes'], ['audio', 'Audio']];

export function openSettings(area = 'general') {
  const nav = h('nav', { class: 'st-nav', role: 'tablist' });
  const view = h('div', { class: 'st-view' });
  const stamp = h('span', { class: 'st-stamp meta', 'aria-live': 'polite' });
  let current = area;
  const savedStamp = () => { stamp.textContent = 'Saved'; clearTimeout(savedStamp.t); savedStamp.t = setTimeout(() => { stamp.textContent = ''; }, 1600); };

  function show(a) {
    current = a;
    clear(nav);
    for (const [id, label] of AREAS) {
      nav.append(h('button', { class: 'st-tab', type: 'button', role: 'tab', 'aria-selected': String(id === a), onclick: () => show(id) }, label));
    }
    clear(view);
    ({ general, keys: keysView, sites, youtube, notes: SITE ? siteNotes : notes, audio, github: githubView, device })[a](view, savedStamp);
  }

  const d = openDialog({ title: 'Settings', body: h('div', { class: 'st' }, nav, h('div', { class: 'st-main' }, view, stamp)), wide: true, className: 'st-dialog' });
  show(current);
  return d;
}

function section(title, desc, ...controls) {
  return h('section', { class: 'st-sec' },
    h('div', { class: 'st-label' }, h('h3', { class: 'st-h' }, title), desc ? h('p', { class: 'muted' }, desc) : null),
    h('div', { class: 'st-panel' }, ...controls));
}

function switchRow(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch st-switch' }, input, h('span', null, label, hint ? h('span', { class: 'field-hint st-hint' }, hint) : null));
}

// ---- General -------------------------------------------------------------------------
function general(view, saved) {
  const s = state.get('settings');
  const seg = h('div', { class: 'seg' });
  for (const [t, label] of [['dark', 'Night basalt'], ['light', 'Day vellum']]) {
    seg.append(h('button', { type: 'button', 'aria-pressed': String(s.theme === t), onclick: (e) => {
      state.update('settings', (x) => { x.theme = t; });
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      e.currentTarget.setAttribute('aria-pressed', 'true');
      saved();
    } }, label));
  }
  view.append(
    section('Look', 'Night basalt for the table, day vellum for prep in daylight.', seg),
    section('Keyboard', 'Shortcuts always work with Alt held, even while typing.',
      switchRow('Keys work without Alt when I\u2019m not typing', s.singleKeys, (v) => { state.update('settings', (x) => { x.singleKeys = v; }); saved(); }, 'Press Q to fire pad Q, Space to play or pause.'),
      switchRow('Give the keyboard back when I move away from a site', s.returnFocus, (v) => { state.update('settings', (x) => { x.returnFocus = v; }); saved(); }, 'A site pane keeps the keyboard after you click in it. With this on, moving the pointer off it hands the keys back to the screen.')),
    section('Lock', 'Sign out of this device. The password is needed to come back in.',
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (SITE) { state.flush(); gate.lock(); location.replace('login.html'); return; }
        await fetch('/api/logout', { method: 'POST' });
        location.replace('/login');
      } }, icon('lock'), 'Lock the screen now')),
  );
}

// ---- Keys --------------------------------------------------------------------------------
function keysView(view, saved) {
  const table = h('div', { class: 'st-keys' });
  let capturing = null;
  function draw() {
    clear(table);
    for (const [g, label] of Object.entries(GROUPS)) {
      const list = keys.list().filter((a) => a.group === g);
      if (!list.length) continue;
      table.append(h('h4', { class: 'st-keygroup' }, label));
      for (const a of list) {
        const combo = keys.combo(a.id);
        const custom = Object.prototype.hasOwnProperty.call(state.get('keymap'), a.id);
        const row = h('div', { class: `st-keyrow ${capturing === a.id ? 'is-capturing' : ''}` },
          h('span', { class: 'st-keylabel' }, a.label),
          capturing === a.id ? h('span', { class: 'st-capture' }, 'Press Alt and a key… (Esc cancels, Backspace clears)') : (kbd(combo) || h('span', { class: 'faint' }, 'none')),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { capturing = a.id; draw(); } }, 'Change'),
          custom ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { keys.reset(a.id); saved(); draw(); } }, 'Reset') : h('span'));
        table.append(row);
      }
    }
  }
  const onKey = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; draw(); return; }
    if (e.key === 'Backspace' && !e.altKey) { keys.setCombo(capturing, null); capturing = null; saved(); draw(); return; }
    if (['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return;
    const k = keyFromCode(e.code);
    if (!k) return;
    if (!e.altKey) { toast('Hold Alt with the key, so it works even while you type.'); return; }
    if (e.ctrlKey || e.metaKey) { toast('Ctrl combinations belong to the browser. Use Alt.'); return; }
    const combo = `${e.shiftKey ? 'Alt+Shift+' : 'Alt+'}${k}`;
    const owner = keys.actionFor(combo);
    keys.setCombo(capturing, combo);
    if (owner && owner.id !== capturing) toast(`${combo} moved from “${owner.label}”, which now has no key.`);
    capturing = null;
    saved();
    draw();
  };
  window.addEventListener('keydown', onKey, true);
  const obs = new MutationObserver(() => { if (!view.isConnected) { window.removeEventListener('keydown', onKey, true); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
  draw();
  view.append(
    section('Keys', 'Letters with no action here fire their pad in the Soundboard. Give an action a letter and that pad steps aside.', table,
      h('div', { class: 'st-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await confirmDialog('Put every key back to its default?', { okLabel: 'Reset all' })) { keys.resetAll(); saved(); draw(); } } }, 'Reset all keys'))),
  );
}

// ---- Sites --------------------------------------------------------------------------------
function sites(view, saved) {
  const s = state.get('settings');
  const urlField = (label, key) => {
    const input = h('input', { class: 'input', type: 'url', value: s.sites[key] });
    const err = h('span', { class: 'field-error', hidden: true });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!/^https?:\/\//i.test(v)) { err.textContent = 'Use a full address starting with https://'; err.hidden = false; return; }
      err.hidden = true;
      state.update('settings', (x) => { x.sites[key] = v; });
      saved();
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, err);
  };
  const engineSel = h('select', { class: 'select' }, Object.entries(SEARCH_ENGINES).map(([k, e]) => h('option', { value: k, selected: s.search === k }, e.name)));
  engineSel.addEventListener('change', () => { state.update('settings', (x) => { x.search = engineSel.value; }); saved(); });

  const installed = document.documentElement.dataset.frameHelper === '1';
  const helper = h('div', { class: 'st-helper' },
    h('p', { class: `st-helperstate ${installed ? 'is-on' : ''}` }, icon(installed ? 'check' : 'info', 'icon-sm'), installed ? 'The frame helper is installed. Sites like 5e.tools open inside panes.' : 'The frame helper is not installed in this browser.'));
  const steps = h('ol', { class: 'st-steps' },
    h('li', null, 'In Chrome or Edge, open ', h('code', null, 'chrome://extensions'), ' (Edge: ', h('code', null, 'edge://extensions'), ') and turn on Developer mode.'),
    h('li', null, 'Choose Load unpacked and pick this folder: ', h('code', { class: 'st-path' }, '…'), ' ', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { navigator.clipboard?.writeText(steps.querySelector('.st-path').textContent); toast('Copied the folder path.', { type: 'ok' }); } }, icon('copy'), 'Copy')),
    h('li', null, 'Reload this page.'));
  if (SITE) steps.querySelector('.st-path').textContent = 'the extension folder in your copy of DMscreen';
  else api.get('/api/config').then((c) => { steps.querySelector('.st-path').textContent = c.extensionPath; }).catch(() => {});
  if (!installed) helper.append(steps);
  if (SITE && !installed) helper.append(h('p', { class: 'field-hint' }, 'On an iPad there is no helper: those sites open in a new tab instead. ', h('a', { href: `${site.links.repo}/tree/main/extension`, target: '_blank', rel: 'noopener' }, 'The extension on GitHub')));
  helper.append(h('p', { class: 'field-hint' }, 'The helper removes the "don\u2019t frame me" header only for frames inside this screen\u2019s tab. Everywhere else the web behaves as normal.'));

  view.append(
    section('Campaign site', 'Where the Stone Wardens tab starts. Searches, addresses and links open in that tab too.', urlField('Stone Wardens', 'wardens')),
    section('Search', 'What the Stone Wardens tab uses when you type words instead of an address.', engineSel),
    section('Sites that refuse frames', '5e.tools, YouTube, wikis and some others forbid being shown inside another page. Without the helper they open in a window over the pane instead.', helper),
  );
}

// ---- YouTube ------------------------------------------------------------------------------
function youtube(view, saved) {
  const body = h('div', { class: 'stack' }, h('span', { class: 'spinner' }));
  const toolsBox = h('div', { class: 'st-tools' });
  view.append(
    section('Sign-in for downloads', 'Searching always works. Downloading sometimes makes YouTube ask for proof you\u2019re not a bot, especially on school and office networks. The downloader can borrow the YouTube sign-in from a browser on this computer.', body),
    section('The downloader', 'YouTube changes often. If downloads start failing, update the downloader.', toolsBox),
  );
  api.get('/api/config').then((cfg) => {
    clear(body);
    const opts = [
      ['none', 'Don\u2019t use a sign-in'],
      ['firefox', 'Firefox (works best on Windows)'],
      ['edge', 'Microsoft Edge'],
      ['chrome', 'Google Chrome (often blocked by Chrome\u2019s own encryption)'],
      ['brave', 'Brave'],
      ['file', `A cookies.txt file${cfg.hasCookieFile ? ' (uploaded)' : ''}`],
    ];
    const group = h('div', { class: 'st-radios', role: 'radiogroup' });
    for (const [v, label] of opts) {
      const input = h('input', { type: 'radio', name: 'ytc', value: v, checked: cfg.ytCookies === v });
      input.addEventListener('change', async () => {
        if (v === 'file' && !cfg.hasCookieFile) { file.click(); return; }
        try { await api.put('/api/config', { ytCookies: v }); saved(); } catch (e) { toast(e.message, { type: 'error' }); }
      });
      group.append(h('label', { class: 'check' }, input, h('span', null, label)));
    }
    const file = h('input', { type: 'file', accept: '.txt,text/plain', hidden: true });
    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      const fd = new FormData();
      fd.append('file', file.files[0]);
      try { await upload('/api/config/cookies', fd); saved(); toast('Cookies saved. Downloads will use them.', { type: 'ok' }); youtubeRefresh(); } catch (e) { toast(e.message, { type: 'error' }); }
    });
    const result = h('p', { class: 'st-result', 'aria-live': 'polite' });
    const test = h('button', { class: 'btn', type: 'button', onclick: async () => {
      test.disabled = true;
      result.textContent = 'Asking YouTube for a 19-second video…';
      result.className = 'st-result';
      try {
        const r = await api.post('/api/tools/test-youtube');
        result.textContent = r.message;
        result.className = `st-result ${r.ok ? 'is-ok' : 'is-error'}`;
      } catch (e) { result.textContent = e.message; result.className = 'st-result is-error'; }
      test.disabled = false;
    } }, icon('youtube'), 'Test a download');
    body.append(group, file,
      h('div', { class: 'st-actions' }, test, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => file.click() }, icon('upload'), 'Upload cookies.txt')),
      result,
      h('p', { class: 'field-hint' }, 'Sign in to YouTube in the browser you pick, then test. A cookies.txt comes from a browser extension such as "Get cookies.txt LOCALLY" while you are on youtube.com. It stays in this screen\u2019s data folder.'));
  });
  function youtubeRefresh() { clear(view); youtube(view, saved); }
  api.get('/api/tools').then((t) => {
    const ver = h('p', null, `yt-dlp ${t.ytdlp || 'not found'} · ffmpeg ${t.ffmpeg ? 'ready' : 'missing'} · Deno ${t.deno ? 'ready' : 'missing'}`);
    const res = h('p', { class: 'st-result' });
    const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      btn.disabled = true;
      res.textContent = 'Updating… this can take a minute.';
      try { const r = await api.post('/api/tools/update'); res.textContent = `Updated to ${r.version}.`; res.className = 'st-result is-ok'; ver.textContent = `yt-dlp ${r.version} · ffmpeg ${t.ffmpeg ? 'ready' : 'missing'} · Deno ${t.deno ? 'ready' : 'missing'}`; } catch (e) { res.textContent = e.message; res.className = 'st-result is-error'; }
      btn.disabled = false;
    } }, icon('refresh'), 'Update the downloader');
    toolsBox.append(ver, h('div', { class: 'st-actions' }, btn), res);
  }).catch(() => {});
}

// ---- Notes --------------------------------------------------------------------------------
function notes(view, saved) {
  const input = h('input', { class: 'input', placeholder: 'C:\\Users\\you\\Documents\\Obsidian\\Campaign' });
  const result = h('p', { class: 'st-result' });
  const apply = h('button', { class: 'btn', type: 'button', onclick: async () => {
    try {
      const c = await api.put('/api/config', { vaultPath: input.value });
      input.value = c.vaultPath;
      result.textContent = `Using ${c.vaultPath}: ${c.vaultNotes} ${c.vaultNotes === 1 ? 'note' : 'notes'}.`;
      result.className = 'st-result is-ok';
      saved();
      bus.emit('notes:vault');
    } catch (e) { result.textContent = e.message; result.className = 'st-result is-error'; }
  } }, 'Use this folder');
  api.get('/api/config').then((c) => {
    input.value = c.vaultPath;
    result.textContent = `${c.vaultNotes ?? 0} ${c.vaultNotes === 1 ? 'note' : 'notes'} in this folder.`;
  });
  view.append(section('Vault folder', 'Notes are plain Markdown files in this folder. Point it at an Obsidian vault and the same notes appear in both; links, tags and frontmatter work the same.',
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Folder on this computer'), input),
    h('div', { class: 'st-actions' }, apply), result,
    h('p', { class: 'field-hint' }, 'Tonight\u2019s session uses Templates/Session.md if the vault has one ({{session}}, {{date}} and {{time}} fill in). People and places use Templates/NPC.md and Templates/Location.md.')));
}

// ---- GitHub (website) -------------------------------------------------------------------------
const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new?name=DM%20Screen&description=Lets%20the%20DM%20Screen%20rename%20sounds%20and%20save%20its%20setup&target_name=blobberus&expires_in=365&contents=write';

function when(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
}

function githubView(view, saved) {
  const pub = site.published();
  const folders = h('div', { class: 'st-actions' },
    h('a', { class: 'btn', href: site.links.folder(''), target: '_blank', rel: 'noopener' }, icon('folder'), 'The sounds folder'),
    h('a', { class: 'btn btn-ghost', href: site.links.howTo, target: '_blank', rel: 'noopener' }, icon('help'), 'How adding sounds works'));
  const connectBox = h('div', { class: 'st-panel' });
  view.append(
    section('Sounds on GitHub', `The screen plays the audio files in ${REPO}/sounds. Each folder in Music is a playlist, in Ambience an ambience playlist, in Effects a bank of pads.`,
      folders,
      h('p', { class: 'field-hint' }, `${library.list().length} sounds published${pub.built ? `, last ${when(pub.built * 1000)}` : ''}. A new upload takes about a minute to appear.`)),
    section('Connect this device', 'Once per device. It lets the screen rename and move sounds, make folders, and keep flags, pads and playlist keys the same on every device. Without it everything still plays, and changes stay on this device.', connectBox),
  );
  const draw = () => {
    clear(connectBox);
    if (github.connected()) {
      const info = site.syncInfo();
      const line = info.error ? `Couldn't save: ${info.error}` : info.syncing ? 'Saving the setup…' : info.dirty ? 'Changes waiting to be saved.' : info.savedAt ? `Setup saved to GitHub ${when(info.savedAt)}.` : 'Setup up to date.';
      connectBox.append(
        h('p', { class: 'st-helperstate is-on' }, icon('check', 'icon-sm'), `Connected to ${REPO}.`),
        h('p', { class: `st-result ${info.error ? 'is-error' : ''}` }, line),
        h('div', { class: 'st-actions' },
          h('button', { class: 'btn', type: 'button', disabled: !info.dirty, onclick: async () => { await site.sync(); draw(); } }, icon('refresh'), 'Save now'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog('Disconnect this device? Renaming and moving sounds stop working here until you connect again. To cancel the token everywhere, delete it on GitHub too.', { okLabel: 'Disconnect' }))) return;
            github.forget();
            draw();
          } }, 'Disconnect')),
        h('p', { class: 'field-hint' }, 'The token is kept only in this browser on this device.'));
      return;
    }
    const input = h('input', { class: 'input', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'GitHub token' });
    const result = h('p', { class: 'st-result', 'aria-live': 'polite' });
    const connect = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      const token = input.value.trim();
      if (!token) { input.focus(); return; }
      connect.disabled = true;
      result.className = 'st-result';
      result.textContent = 'Checking with GitHub…';
      try {
        const r = await github.check(token);
        if (r.canPush === false) throw new Error(`Your GitHub account can't change ${REPO}.`);
        github.setToken(token);
        saved();
        toast(`Connected${r.login ? ` as ${r.login}` : ''}. Renames and your setup now go to GitHub.`, { type: 'ok' });
        site.sync();
        draw();
      } catch (e) {
        result.className = 'st-result is-error';
        result.textContent = e.status === 401 ? "GitHub didn't accept that token. Copy it again from GitHub." : e.status === 404 ? `That token can't see ${REPO}. Under Repository access, choose Only select repositories and pick DMscreen.` : e.message;
        connect.disabled = false;
      }
    } }, 'Connect');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect.click(); });
    connectBox.append(
      h('ol', { class: 'st-steps' },
        h('li', null, h('a', { href: TOKEN_PAGE, target: '_blank', rel: 'noopener' }, 'Open GitHub’s new token page'), ' (sign in if it asks).'),
        h('li', null, 'Name it DM Screen. Under Repository access choose Only select repositories, then DMscreen.'),
        h('li', null, 'Under Permissions, Repository, set Contents to Read and write.'),
        h('li', null, 'Press Generate token, copy it, and paste it here.')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Token'), input),
      h('div', { class: 'st-actions' }, connect), result,
      h('p', { class: 'field-hint' }, 'The token can only change the files of this one repository. It is kept only in this browser; Disconnect removes it, and deleting it on GitHub cancels it everywhere.'));
  };
  draw();
}

// ---- Notes (website) ----------------------------------------------------------------------------
function siteNotes(view) {
  const count = h('p', { class: 'st-result' });
  const recount = () => { const n = vault.all().filter((f) => !f.path.startsWith('Templates/')).length; count.textContent = `${n} ${n === 1 ? 'note' : 'notes'} on this device.`; };
  const file = h('input', { type: 'file', multiple: true, accept: '.md,text/markdown,text/plain', hidden: true });
  file.addEventListener('change', async () => {
    const list = await Promise.all([...file.files].map(async (f) => ({ path: `Imported/${f.name.replace(/\.(md|txt|markdown)$/i, '')}.md`, text: await f.text() })));
    try {
      vault.add(list);
      toast(`Added ${list.length} ${list.length === 1 ? 'note' : 'notes'} to Imported.`, { type: 'ok' });
      bus.emit('notes:vault');
    } catch (e) { toast(e.message, { type: 'error' }); }
    file.value = '';
    recount();
  });
  const download = h('button', { class: 'btn', type: 'button', onclick: () => {
    const blob = zipText(vault.all());
    const a = h('a', { href: URL.createObjectURL(blob), download: `DM Screen notes ${new Date().toISOString().slice(0, 10)}.zip` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } }, icon('download'), 'Download all notes (.zip)');
  recount();
  view.append(section('Notes on this device', 'Notes are kept in this browser, on this device only: the repo is public, so they never go to GitHub. To take them into Obsidian, download the zip and unzip it into your vault.',
    count,
    h('div', { class: 'st-actions' }, download, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => file.click() }, icon('upload'), 'Import Markdown files'), file),
    h('p', { class: 'field-hint' }, 'Tonight\u2019s session uses Templates/Session.md ({{session}}, {{date}} and {{time}} fill in). People and places use Templates/NPC.md and Templates/Location.md.')));
}

// ---- This device (website) ------------------------------------------------------------------------
const MEDIA_CACHE = 'dm-media-v1';
const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

function device(view) {
  const offline = h('p', { class: 'st-result' });
  const storage = h('p', { class: 'field-hint' });
  const keepBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('download'), 'Keep every sound on this device');
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Remove the kept sounds');
  let busy = false;
  async function measure() {
    const sounds = library.list();
    const total = sounds.reduce((n, s) => n + (s.size || 0), 0);
    let kept = 0;
    let keptBytes = 0;
    if ('caches' in window) {
      const cache = await caches.open(MEDIA_CACHE);
      for (const s of sounds) if (await cache.match(new URL(s.media, location.href).href)) { kept++; keptBytes += s.size || 0; }
    }
    if (!busy) offline.textContent = `${kept} of ${sounds.length} sounds kept on this device (${mb(keptBytes)} of ${mb(total)}).`;
    keepBtn.disabled = busy || kept === sounds.length;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    storage.textContent = est ? `This site uses ${mb(est.usage || 0)} of the ${mb(est.quota || 0)} the browser allows it.${persisted ? ' The browser has agreed to keep it.' : ''}` : '';
  }
  keepBtn.addEventListener('click', async () => {
    busy = true;
    keepBtn.disabled = true;
    navigator.storage?.persist?.().catch(() => {});
    const cache = await caches.open(MEDIA_CACHE);
    const sounds = library.list();
    let done = 0;
    let failed = 0;
    for (const s of sounds) {
      const url = new URL(s.media, location.href).href;
      if (!(await cache.match(url))) {
        try { await cache.add(url); } catch { failed++; }
      }
      done++;
      offline.textContent = `Keeping sounds on this device: ${done} of ${sounds.length}…`;
    }
    busy = false;
    if (failed) toast(`${failed} ${failed === 1 ? 'sound' : 'sounds'} didn't download. Try again on a better connection.`, { type: 'error' });
    else toast('Every sound is on this device now. The screen works without the internet.', { type: 'ok' });
    measure();
  });
  clearBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove the sounds kept on this device? They play from the internet again, and download again as they play.', { okLabel: 'Remove' }))) return;
    await caches.delete(MEDIA_CACHE);
    measure();
  });
  measure();
  view.append(
    section('Without the internet', 'Sounds you have played stay on this device. Keep all of them here before a session somewhere with poor Wi-Fi, and the whole screen works offline.',
      offline, h('div', { class: 'st-actions' }, keepBtn, clearBtn), storage),
    section('On an iPad', 'Add the screen to the Home Screen: it opens full-screen like an app, and Safari won’t clear its sounds and setup.',
      h('ol', { class: 'st-steps' },
        h('li', null, 'In Safari, press the Share button.'),
        h('li', null, 'Choose Add to Home Screen, then Add.'),
        h('li', null, 'Open the DM Screen from its icon. A keyboard works too: Option is Alt.'))),
  );
}

// ---- Audio --------------------------------------------------------------------------------
/** Speakers and headphones by name. Chrome and Edge only name them for a page that may use the
 *  microphone, so with ask they request it once and let go at once; Firefox shows its own list. */
async function listOutputs(ask) {
  const md = navigator.mediaDevices;
  const outputs = async () => (await md.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId);
  let list = await outputs();
  if (ask && md.selectAudioOutput) {
    const picked = await md.selectAudioOutput();
    return { list: [...list.filter((d) => d.deviceId !== picked.deviceId), picked], picked };
  }
  if (ask && !list.some((d) => d.label)) {
    const mic = await md.getUserMedia({ audio: true });
    mic.getTracks().forEach((t) => t.stop());
    list = await outputs();
  }
  return { list, picked: null };
}

function previewOutput(saved, levelSlider) {
  const title = 'Preview output';
  const desc = 'Previews are the headphones buttons on sounds and tracks, and the play button in the sound editor. Send them to your own headphones and only you hear them.';
  if (!engine.canRoutePreview) {
    const why = !window.isSecureContext
      ? 'Browsers only let a page choose an output when it is opened securely: use the website, or this computer at localhost.'
      : IOS
        ? 'An iPad sends all its sound to one place, the one iPadOS picks (its speaker, headphones or AirPlay), and won’t let a page split it, so previews play through the main output with everything else.'
        : 'This browser can’t send sound to a second output, so previews play through the main output. Chrome or Edge on a computer can.';
    return section(title, desc, h('p', { class: 'st-helperstate' }, icon('info', 'icon-sm'), why), levelSlider);
  }
  const select = h('select', { class: 'select', 'aria-label': 'Preview output' });
  const status = h('p', { class: 'st-helperstate' });
  const hint = h('p', { class: 'field-hint' }, 'Chrome and Edge only name your speakers and headphones once the page may use the microphone, so they ask for it once. Nothing is recorded: the screen lets go of the microphone straight away.');
  const listBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fill(true) }, icon('headphones'), navigator.mediaDevices.selectAudioOutput ? 'Choose an output…' : 'List my outputs');
  const testBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => engine.testPreview() }, icon('play'), 'Play a test sound');

  function drawStatus() {
    const cur = state.get('settings').previewOutput;
    const r = engine.previewRoute;
    status.classList.toggle('is-on', r === 'device');
    status.replaceChildren(icon(r === 'device' ? 'check' : r === 'missing' ? 'warning' : 'info', 'icon-sm'),
      r === 'device' ? `Previews play on ${cur.label} only.`
        : r === 'missing' ? `${cur.label} isn’t connected, so previews are silent. Plug it in, or choose another output.`
          : 'Previews play through the main output, so the table hears them too.');
  }
  async function fill(ask) {
    let list = [];
    let picked = null;
    try { ({ list, picked } = await listOutputs(ask)); } catch (e) {
      if (ask) toast(e.name === 'NotAllowedError' ? 'The browser wasn’t allowed to list your outputs. Allow it in the address bar’s site settings, then try again.' : `Couldn’t list your outputs: ${e.message}`, { type: 'error', timeout: 8000 });
    }
    if (picked) { await engine.setPreviewOutput(picked); saved(); }
    const cur = state.get('settings').previewOutput;
    const named = list.some((d) => d.label);
    clear(select);
    select.append(h('option', { value: '' }, 'The main output (the table hears previews)'));
    for (const d of list) if (d.label || named) select.append(h('option', { value: d.deviceId }, d.label || 'An unnamed output'));
    if (cur?.id && !list.some((d) => d.deviceId === cur.id)) select.append(h('option', { value: cur.id }, `${cur.label} (not found)`));
    select.value = cur?.id || '';
    hint.hidden = named || !!navigator.mediaDevices.selectAudioOutput;
    if (ask && !named && !picked && list.length <= 1) toast('This device doesn’t show its outputs to web pages, so previews stay on the main output.', { timeout: 7000 });
    drawStatus();
  }
  select.addEventListener('change', async () => {
    const opt = select.selectedOptions[0];
    await engine.setPreviewOutput(select.value ? { deviceId: select.value, label: opt.textContent.replace(/ \(not found\)$/, '') } : null);
    saved();
    drawStatus();
  });
  const off = bus.on('audio:route', () => { if (!status.isConnected) { off(); return; } drawStatus(); fill(false); });
  fill(false);
  return section(title, desc,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Previews play on'), select),
    h('div', { class: 'st-actions' }, listBtn, testBtn),
    hint, status, levelSlider);
}

function audio(view, saved) {
  const s = state.get('settings');
  const slider = (label, key, min, max, stepv, fmt, onSet) => {
    const r = h('input', { class: 'range', type: 'range', min, max, step: stepv, value: s[key] });
    const out = h('span', { class: 'num st-num' });
    const sync = () => { r.style.setProperty('--fill', `${((r.value - min) / (max - min)) * 100}%`); out.textContent = fmt(Number(r.value)); };
    r.addEventListener('input', () => { sync(); state.update('settings', (x) => { x[key] = Number(r.value); }, { silent: true }); onSet?.(Number(r.value)); });
    r.addEventListener('change', saved);
    sync();
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'st-slider' }, r, out));
  };
  view.append(
    previewOutput(saved, slider('Preview level', 'previewLevel', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, () => engine.applyLevels())),
    section('Fades', 'How music moves from one track or playlist to the next.',
      slider('Crossfade for new playlists', 'crossfade', 0, 10, 0.5, (v) => `${v.toFixed(1)} s`),
      slider('Fade all (Alt+0) takes', 'fadeAll', 0.5, 10, 0.5, (v) => `${v.toFixed(1)} s`)),
    section('Duck', 'Duck lowers music and ambience while you talk over them (Alt+\\). Effects stay full.',
      slider('Ducked level', 'duckAmount', 0.05, 0.8, 0.05, (v) => `${Math.round(v * 100)}%`, () => { if (engine.ducked) engine.toggleDuck(true); })),
  );
}
