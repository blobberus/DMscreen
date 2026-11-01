// The website version (GitHub Pages). There is no server:
// - sounds are the audio files in the repo's sounds/ folder. The Pages workflow lists them in
//   library.json with their length and waveform, and serves each one as media/<content id>.
// - the folders are the screen: sounds/Music/<name> is a playlist, sounds/Ambience/<name> an ambience
//   playlist (listed apart), sounds/Effects/<name> a bank of soundboard pads.
// - the setup (flags, trims, pads, playlist keys, shortcuts, bookmarks, custom merchants) is screen/setup.json. Every
//   change is kept in this browser at once and, when this device is connected to GitHub, committed a few
//   seconds later. Layouts and settings belong to each device and stay in it.
// - renames, moves, new folders and deletions (of sounds and whole folders) are commits. GitHub needs a minute to publish them, so
//   until library.json catches up they are applied here from a pending list.
// - With a sounds repo (SOUNDS_REPO, private), the sounds are that repo's sounds/ instead: its own
//   library.json and peaks/ (written by its "Index the sounds" workflow) are read through the API with
//   this device's token, the offline worker (sw.js) fetches each sound by its blob id with the same
//   token, and the commits above go to that repo, rewriting its library.json as they go.
import { bus } from './bus.js';
import { github, blobSha } from './github.js';
import { REPO, BRANCH, GITHUB_WEB, SOUNDS_REPO } from './mode.js';
import { natural } from './util.js';

export const SOUNDS = 'sounds';
export const SETUP_PATH = 'screen/setup.json';

export const CATEGORIES = [
  { dir: 'Music', kind: 'music', label: 'Music', one: 'playlist' },
  { dir: 'Ambience', kind: 'ambience', label: 'Ambience', one: 'ambience playlist' },
  { dir: 'Effects', kind: 'effect', label: 'Effects', one: 'pad bank' },
];
const CATEGORY_NAMES = { music: 'music', ambience: 'ambience', ambiance: 'ambience', ambient: 'ambience', effects: 'effect', effect: 'effect', sfx: 'effect', soundboard: 'effect' };
const LOCAL_DOCS = new Set(['settings', 'layouts']);
const SYNCED_DOCS = ['playlists', 'boards', 'keymap', 'bookmarks', 'merchants'];
const META_FIELDS = ['trimStart', 'trimEnd', 'flags', 'repeat', 'volume', 'fadeIn', 'fadeOut', 'loopFade', 'tags'];
const SETUP_KEY = 'dm:setup';
const PENDING_KEY = 'dm:pending';
const PRIVATE = !!SOUNDS_REPO;
const STORE = SOUNDS_REPO || REPO;           // the repo the sound files are in
const LIST_PATH = 'library.json';             // the sounds repo's own sound list
const LIST_KEY = 'dm:sound-list';             // its last copy, for opening the screen offline

// ---- names and paths -------------------------------------------------------------------
export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (file) => file.match(/\.[^.]+$/)?.[0] || '';
const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);
/** "01 " or "02 - " at the start of a name sets the order and isn't shown. */
const orderPrefix = (name) => name.match(/^\d{2}[\s._-]+/)?.[0] || '';
const stripOrder = (name) => name.slice(orderPrefix(name).length) || name;

export const folderName = (dir) => stripOrder(baseOf(dir)).replace(/_/g, ' ');
export function soundName(path) {
  const file = baseOf(path);
  return stripOrder(file.slice(0, file.length - extOf(file).length)).replace(/_/g, ' ').trim() || file;
}
export function kindOfDir(dir) {
  return CATEGORY_NAMES[String(dir).split('/')[0].toLowerCase()] || null;
}
/** The playlist, ambience folder or pad bank a sound belongs to: its category plus the first folder in it. */
export function groupOf(path) {
  const seg = path.split('/');
  return seg.length >= 3 ? `${seg[0]}/${seg[1]}` : seg.length === 2 ? seg[0] : '';
}
function guessKind(duration) {
  if (!duration) return 'music';
  if (duration < 30) return 'effect';
  if (duration > 15 * 60) return 'ambience';
  return 'music';
}
/** Folder and file names GitHub and every computer accept. */
export function cleanName(text) {
  return String(text || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120);
}

// ---- links into the repo -----------------------------------------------------------------
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
export const links = {
  repo: `${GITHUB_WEB}/${STORE}`,
  folder: (dir) => `${GITHUB_WEB}/${STORE}/tree/${BRANCH}/${enc(dir ? `${SOUNDS}/${dir}` : SOUNDS)}`,
  upload: (dir) => `${GITHUB_WEB}/${STORE}/upload/${BRANCH}/${enc(dir ? `${SOUNDS}/${dir}` : SOUNDS)}`,
  file: (path) => `${GITHUB_WEB}/${STORE}/blob/${BRANCH}/${enc(`${SOUNDS}/${path}`)}`,
  newFolder: (parent, name) => `${GITHUB_WEB}/${STORE}/new/${BRANCH}/${enc(parent ? `${SOUNDS}/${parent}` : SOUNDS)}?filename=${encodeURIComponent(`${name}/README.md`)}&value=${encodeURIComponent(folderReadme(joinPath(parent, name)))}`,
  howTo: PRIVATE ? `${GITHUB_WEB}/${STORE}#readme` : `${GITHUB_WEB}/${STORE}/blob/${BRANCH}/${SOUNDS}/README.md`,
  actions: `${GITHUB_WEB}/${STORE}/actions`,
};

/** The note GitHub shows when you open a folder: what it is on the screen and how to add to it. */
export function folderReadme(dir) {
  const kind = kindOfDir(dir);
  const name = folderName(dir);
  const what = {
    music: `The **${name}** playlist. Every audio file in this folder is one of its tracks, played in file-name order. Its number key is set on the screen.`,
    ambience: `The **${name}** ambience playlist. Its files play one after another in file-name order, like any playlist: starting it ends what was playing. To play one of its sounds over something else, use that sound's on-top button in the Playlists pane. Its number key is set on the screen.`,
    effect: `The **${name}** bank of soundboard pads. Each sound here gets the next free letter key; change keys, labels and how pads play on the screen.`,
  }[kind] || `Sounds in **${name}**. They appear in the Sound library.`;
  return `# ${name}\n\n${what}\n\n**To add sounds:** choose **Add file**, then **Upload files**, drop in your MP3s (up to 25 MB each) and press **Commit changes**. They show up on the DM screen about a minute later.\n\nNaming rules and the rest of the folders: [sounds/README.md](${'../'.repeat(Math.max(1, dir.split('/').length))}README.md)\n`;
}

// ---- storage helpers -------------------------------------------------------------------------
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
    bus.emit('toast', { message: `This browser is out of room to save the screen: ${e.message}`, type: 'error' });
  }
}

// ---- the library ------------------------------------------------------------------------------
let manifest = { commit: null, built: 0, files: [], folders: [] };
let view = { files: [], folders: [] };
let access = 'ok';

/** Can this device play the sounds? 'ok'; with private sounds also 'connect' (not connected to GitHub),
 *  'denied' (its token can't read the sounds repo), 'expired' (GitHub turned the token down) or
 *  'indexing' (the repo has no library.json yet). */
export const soundAccess = () => access;

const listOf = (data) => ({ commit: data.commit || null, built: data.built || 0, files: data.files || [], folders: data.folders || [] });

async function fetchManifest() {
  if (PRIVATE) return fetchPrivateList();
  const res = await fetch('library.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`The sound list didn't load (${res.status}).`);
  return listOf(await res.json());
}

/** The sounds repo's library.json. Its sounds and waveforms are fetched by blob id through the offline
 *  worker (pmedia/, ppeaks/), which adds this device's token. */
async function fetchPrivateList() {
  if (!github.connected()) { access = 'connect'; return listOf({}); }
  let data;
  try {
    const text = await github.readRaw(LIST_PATH, { repo: SOUNDS_REPO });
    if (!text) { access = 'indexing'; return listOf({}); }     // its workflow hasn't listed the sounds yet
    data = JSON.parse(text);
    writeJSON(LIST_KEY, data);
  } catch (e) {
    if (e.status === 401) { access = 'expired'; return listOf({}); }
    if (e.status === 403 || e.status === 404) { access = 'denied'; return listOf({}); }
    data = readJSON(LIST_KEY);                 // no network: the list this device saw last
    if (!data) throw e;
  }
  access = 'ok';
  const list = listOf(data);
  list.files = list.files.map((f) => ({ ...f, media: `pmedia/${f.sha}${extOf(f.path).toLowerCase()}`, peaks: f.peaks ? `ppeaks/${f.sha}.json` : undefined }));
  return list;
}

function pending() { return readJSON(PENDING_KEY) || []; }
function addPending(op) { writeJSON(PENDING_KEY, [...pending(), { ...op, at: Date.now() }]); }
const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
/** A deletion. Something deleted before its own move or new folder was published goes from where the
 *  published list still has it (else that change, never landing, brought it back for an hour). */
function addDeletion(op) {
  const left = [];
  for (const p of pending()) {
    if (p.op === 'mkdir' && under(p.path, op.path)) continue;
    if (p.op === 'move' && under(p.to, op.path)) left.push({ ...p, op: 'delete', path: p.from });
    else if (p.op === 'movedir' && under(p.to, op.path)) left.push({ ...p, op: 'rmdir', path: p.from });
    else left.push(p);
  }
  writeJSON(PENDING_KEY, [...left, { ...op, at: Date.now() }]);
}
const moveUnder = (p, from, to) => (under(p, from) ? to + p.slice(from.length) : p);
function withParents(set, dir) {
  const seg = dir.split('/');
  for (let i = 1; i <= seg.length; i++) if (seg[i - 1]) set.add(seg.slice(0, i).join('/'));
}

/** A sound list with one change applied: a pending change, or the change a commit makes. */
function editList(list, op) {
  let files = list.files.map((f) => ({ ...f }));
  const folders = new Set(list.folders);
  if (op.op === 'move') {
    const f = files.find((x) => x.path === op.from);
    if (f) f.path = op.to;
    withParents(folders, dirOf(op.to));
  } else if (op.op === 'delete') {
    files = files.filter((x) => x.path !== op.path);
  } else if (op.op === 'rmdir') {
    files = files.filter((x) => !under(x.path, op.path));
    for (const d of [...folders]) if (under(d, op.path)) folders.delete(d);
  } else if (op.op === 'mkdir') {
    withParents(folders, op.path);
  } else if (op.op === 'movedir') {
    for (const f of files) f.path = moveUnder(f.path, op.from, op.to);
    for (const d of [...folders]) if (under(d, op.from)) { folders.delete(d); folders.add(moveUnder(d, op.from, op.to)); }
  }
  return { ...list, files, folders: [...folders] };
}

/** The published list with our own unpublished changes on top. Drops changes that have landed. */
function settle(raw) {
  const has = new Set(raw.files.map((f) => f.path));
  const dirs = new Set(raw.folders);
  const landed = (op) => ({
    move: () => has.has(op.to) && !has.has(op.from),
    delete: () => !has.has(op.path),
    rmdir: () => !dirs.has(op.path) && !raw.files.some((f) => under(f.path, op.path)),
    mkdir: () => dirs.has(op.path),
    movedir: () => dirs.has(op.to) && !dirs.has(op.from),
  }[op.op]?.() ?? true);
  const left = pending().filter((op) => Date.now() - op.at < 3600e3 && !landed(op));
  writeJSON(PENDING_KEY, left);
  let list = { files: raw.files, folders: raw.folders };
  for (const op of left) list = editList(list, op);
  return { files: list.files.map((f) => ({ ...f })).sort((a, b) => natural(a.path, b.path)), folders: [...list.folders].sort(natural) };
}

function toSound(f) {
  const kind = kindOfDir(f.path.includes('/') ? f.path : '') || guessKind(f.duration);
  const m = setup.doc.sounds[f.path] || {};
  return {
    id: f.path, path: f.path, folder: dirOf(f.path), group: groupOf(f.path), name: soundName(f.path), kind,
    file: baseOf(f.path), size: f.size || 0, duration: f.duration || 0, sha: f.sha, media: f.media, peaks: f.peaks, status: 'ready',
    trimStart: 0, trimEnd: null, flags: [], repeat: kind === 'ambience' ? 0 : 1, volume: 1, fadeIn: 0, fadeOut: 0,
    loopFade: kind === 'ambience' ? 1.5 : 0, tags: [],
    ...clone(m),
  };
}

export function library() {
  return { sounds: view.files.map(toSound), folders: view.folders.slice() };
}

/** Playlists (music), ambience folders or pad banks (effect): the first folders inside the category,
 *  plus the category itself when sounds sit in it directly. */
export function groupsOf(kind) {
  const out = new Set();
  for (const d of view.folders) {
    const seg = d.split('/');
    if (seg.length >= 2 && kindOfDir(d) === kind) out.add(`${seg[0]}/${seg[1]}`);
  }
  for (const f of view.files) {
    const seg = f.path.split('/');
    if (seg.length === 2 && kindOfDir(seg[0]) === kind) out.add(seg[0]);
  }
  return [...out].sort(natural);
}

export function folders() { return view.folders.slice(); }
export const published = () => ({ commit: manifest.commit, built: manifest.built });

// ---- the setup ------------------------------------------------------------------------------------
const fresh = () => ({ version: 1, sounds: {}, playlists: { list: [] }, boards: { banks: [], active: null }, keymap: {}, bookmarks: undefined, merchants: undefined });
function normal(doc) {
  const d = { ...(doc && typeof doc === 'object' ? doc : {}) };
  const blank = fresh();
  for (const k of ['version', 'sounds', 'playlists', 'boards', 'keymap']) if (!d[k] || typeof d[k] !== typeof blank[k]) d[k] = blank[k];
  return d;
}
function parse(text) {
  try { return normal(JSON.parse(text)); } catch { return fresh(); }
}
const setupText = (doc) => `${JSON.stringify(doc, null, 1)}\n`;

let setup = { doc: fresh(), base: fresh(), sha: null, dirty: false };
let syncTimer = null;
let syncing = null;
let syncError = null;
let savedAt = 0;
let toldLocal = false;
let quietUntil = 0;           // the folders fill in pads and keys as the screen starts: that's not a change of yours

function keep() { writeJSON(SETUP_KEY, setup); }

/** Merge two edits of the setup: entries changed here win, everything else comes from GitHub. */
function merge3(base, mine, theirs) {
  const out = normal(clone(theirs));
  base = normal(base);
  mine = normal(mine);
  for (const k of new Set([...Object.keys(mine.sounds), ...Object.keys(base.sounds)])) {
    if (same(mine.sounds[k], base.sounds[k])) continue;
    if (mine.sounds[k] === undefined) delete out.sounds[k]; else out.sounds[k] = clone(mine.sounds[k]);
  }
  const mergeList = (get, put) => {
    const b = new Map((get(base) || []).map((x) => [x.id, x]));
    const m = new Map((get(mine) || []).map((x) => [x.id, x]));
    const list = [];
    for (const t of get(out) || []) {
      if (!m.has(t.id)) { if (!b.has(t.id)) list.push(t); continue; }   // gone here: drop it unless it's new there
      list.push(same(m.get(t.id), b.get(t.id)) ? t : clone(m.get(t.id)));
    }
    for (const [id, x] of m) if (!b.has(id) && !list.some((y) => y.id === id)) list.push(clone(x));
    put(out, list);
  };
  mergeList((d) => d.playlists?.list, (d, list) => { d.playlists = { ...(d.playlists || {}), list }; });
  mergeList((d) => d.boards?.banks, (d, banks) => { d.boards = { ...(d.boards || {}), banks }; });
  if (!same(mine.boards?.active, base.boards?.active)) out.boards.active = mine.boards?.active ?? null;
  // custom merchants: categories, shops and items merge one by one, so two devices can add at once
  if (mine.merchants || base.merchants || out.merchants) {
    for (const part of ['categories', 'shops', 'items']) mergeList((d) => d.merchants?.[part], (d, list) => { d.merchants = { ...(d.merchants || {}), [part]: list }; });
  }
  for (const k of ['keymap', 'bookmarks']) if (!same(mine[k], base[k])) out[k] = clone(mine[k]);
  return out;
}

export async function load() {
  const [raw, remote] = await Promise.all([fetchManifest(), github.readText(SETUP_PATH).catch(() => undefined)]);
  const local = readJSON(SETUP_KEY);
  if (local?.dirty) {
    setup = { ...local, doc: normal(local.doc), base: normal(local.base) };
    if (remote && remote.sha !== local.sha) {
      const theirs = parse(remote.text);
      setup.doc = merge3(setup.base, setup.doc, theirs);
      setup.base = theirs;
      setup.sha = remote.sha;
    }
    keep();
    schedule(1500);
  } else if (remote) {
    const doc = parse(remote.text);
    setup = { doc, base: clone(doc), sha: remote.sha, dirty: false };
    keep();
  } else if (local) {
    setup = { ...local, doc: normal(local.doc), base: normal(local.base) };
  }
  manifest = raw;
  view = settle(raw);
  quietUntil = Date.now() + 4000;
}

/** The documents the screen keeps, as state.load() wants them. */
export function loadDocs() {
  const out = {};
  for (const name of LOCAL_DOCS) out[name] = readJSON(`dm:doc:${name}`) ?? undefined;
  for (const name of SYNCED_DOCS) out[name] = clone(setup.doc[name]);
  // tracks aren't kept (they are the folder's files); reconcile() fills them in
  if (out.playlists?.list) for (const pl of out.playlists.list) pl.tracks = pl.tracks || [];
  return out;
}

export function saveDoc(name, doc) {
  if (LOCAL_DOCS.has(name)) { writeJSON(`dm:doc:${name}`, doc); return; }
  if (!SYNCED_DOCS.includes(name)) return;
  // playlist tracks come from the folders, so they aren't kept
  const value = name === 'playlists' ? { ...doc, list: doc.list.map(({ tracks, ...rest }) => rest) } : clone(doc);
  if (same(setup.doc[name], value)) return;
  setup.doc[name] = value;
  changed();
}

export function patchSound(id, patch) {
  const m = { ...(setup.doc.sounds[id] || {}) };
  for (const k of META_FIELDS) if (k in patch) m[k] = clone(patch[k]);
  if (same(m, setup.doc.sounds[id] || {})) return;
  setup.doc.sounds[id] = m;
  changed();
}

function changed() {
  setup.dirty = true;
  keep();
  schedule();
}

function schedule(ms = 6000) {
  clearTimeout(syncTimer);
  if (!github.connected()) {
    if (!toldLocal && Date.now() > quietUntil) {
      toldLocal = true;
      bus.emit('site:sync', syncInfo());
    }
    return;
  }
  syncTimer = setTimeout(sync, ms);
}

export function syncInfo() {
  return { connected: github.connected(), dirty: setup.dirty, syncing: !!syncing, error: syncError, savedAt };
}

/** Send the setup to GitHub now (merging if another device saved in between). */
export function sync() {
  clearTimeout(syncTimer);
  if (!github.connected() || !setup.dirty) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    bus.emit('site:sync', syncInfo());
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = clone(setup.doc);
      const text = setupText(snapshot);
      try {
        setup.sha = await github.putText(SETUP_PATH, text, setup.sha, 'Save the DM screen setup');
        setup.base = snapshot;
        if (same(setup.doc, snapshot)) setup.dirty = false;
        keep();
        syncError = null;
        savedAt = Date.now();
        return;
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 2) {
          const remote = await github.readText(SETUP_PATH);
          const theirs = remote ? parse(remote.text) : fresh();
          setup.doc = merge3(setup.base, setup.doc, theirs);
          setup.base = theirs;
          setup.sha = remote?.sha || null;
          keep();
          bus.emit('site:docs', loadDocs());
          continue;
        }
        syncError = e.message;
        syncTimer = setTimeout(sync, 30000);
        return;
      }
    }
  })().finally(() => {
    syncing = null;
    bus.emit('site:sync', syncInfo());
    if (setup.dirty && !syncError) schedule();
  });
  return syncing;
}

/** Pick up a setup saved on another device (only when nothing here is waiting to go up). */
async function refreshSetup() {
  if (syncing || setup.dirty) return false;
  const remote = await github.readText(SETUP_PATH).catch(() => null);
  if (!remote || remote.sha === setup.sha) return false;
  const doc = parse(remote.text);
  setup = { doc, base: clone(doc), sha: remote.sha, dirty: false };
  keep();
  bus.emit('site:docs', loadDocs());
  bus.emit('site:library', { added: [] });
  return true;
}

/** Look for a newer published sound list (after an upload, or coming back to the tab). */
export async function refresh() {
  let raw;
  const was = access;
  try { raw = await fetchManifest(); } catch { return { changed: false, added: [] }; }
  const before = new Set(view.files.map((f) => f.sha));     // by content: a moved sound isn't a new one
  const prev = view;
  manifest = raw;
  view = settle(raw);
  // sounds that appear because this device just got access aren't news
  const added = was === access ? view.files.filter((f) => !before.has(f.sha)).map((f) => f.path) : [];
  const changedNow = !same(prev, view) || was !== access;
  if (changedNow) bus.emit('site:library', { added });
  return { changed: changedNow, added };
}

// ---- watching GitHub publish an upload -------------------------------------------------------------
let watchUntil = 0;
let watchTimer = null;
let publish = { state: 'idle', run: null };
export const publishState = () => publish;

function setPublish(next) {
  if (same(next, publish)) return;
  publish = next;
  bus.emit('site:publish', publish);
}

/**
 * Check for a newer sound list every so often for the next few minutes: after sending you to GitHub to
 * upload ('upload'), or after a commit from here ('commit', done once nothing is pending any more).
 */
export function watch(reason = 'commit', minutes = 8) {
  watchUntil = Math.max(watchUntil, Date.now() + minutes * 60e3);
  watchReason = reason === 'upload' || watchReason === 'upload' ? 'upload' : 'commit';
  if (publish.state === 'idle') setPublish({ state: reason === 'upload' ? 'waiting' : 'publishing', run: null });
  clearTimeout(watchTimer);
  watchTimer = setTimeout(poll, 4000);
}
let watchReason = 'commit';

async function poll() {
  clearTimeout(watchTimer);
  const { added } = await refresh();
  const run = github.connected() ? await github.latestRun({ repo: STORE }).catch(() => null) : null;
  const busy = !!run && run.status !== 'completed';
  const done = !busy && (watchReason === 'upload' ? added.length > 0 : !pending().length);
  const failed = !busy && run?.conclusion === 'failure' && Date.parse(run.created_at) > (manifest.built || 0) * 1000;
  if (done || failed || Date.now() >= watchUntil) {
    watchUntil = 0;
    watchReason = 'commit';
    setPublish(failed ? { state: 'failed', run } : { state: 'idle', run: null });
    return;
  }
  setPublish({ state: busy || watchReason === 'commit' ? 'publishing' : 'waiting', run: busy ? run : null });
  watchTimer = setTimeout(poll, busy ? 8000 : 15000);
}

let lastLook = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { sync(); return; }
  if (Date.now() - lastLook < 10000) return;
  lastLook = Date.now();
  refresh();
  refreshSetup();
});

// ---- changes to the files (commits) ------------------------------------------------------------------
function needGitHub() {
  if (github.connected()) return;
  const e = new Error('Connect this device to GitHub first (Settings, GitHub).');
  e.code = 'github';
  throw e;
}

/** Rewrite every reference to a sound or folder in a copy of the setup. */
function remapDoc(doc, map) {
  const d = normal(clone(doc));
  const sounds = {};
  for (const [k, v] of Object.entries(d.sounds)) sounds[map(k)] = v;
  d.sounds = sounds;
  for (const pl of d.playlists?.list || []) {
    if (pl.dir) { pl.dir = map(pl.dir); pl.id = pl.dir; }
    for (const a of pl.ambience || []) a.id = map(a.id);
  }
  for (const b of d.boards?.banks || []) {
    if (b.dir) { b.dir = map(b.dir); b.id = b.dir; }
    for (const p of Object.values(b.pads || {})) if (p?.sound) p.sound = map(p.sound);
    b.seen = (b.seen || []).map(map);
  }
  if (d.boards?.active) d.boards.active = map(d.boards.active);
  return d;
}

/** A sound left its folder: that folder's pad bank lets go of it, so the new folder's picks it up. */
function leaveGroup(d, id, oldGroup) {
  for (const b of d.boards?.banks || []) {
    if (b.dir !== oldGroup) continue;
    for (const [k, p] of Object.entries(b.pads || {})) if (p?.sound === id) delete b.pads[k];
    b.seen = (b.seen || []).filter((x) => x !== id);
  }
}

function forget(d, id) {
  delete d.sounds[id];
  for (const pl of d.playlists?.list || []) pl.ambience = (pl.ambience || []).filter((a) => a.id !== id);
  for (const b of d.boards?.banks || []) {
    for (const [k, p] of Object.entries(b.pads || {})) if (p?.sound === id) delete b.pads[k];
    b.seen = (b.seen || []).filter((x) => x !== id);
  }
}

async function committed(doc, text) {
  setup = { doc, base: clone(doc), sha: await blobSha(text), dirty: false };
  keep();
  savedAt = Date.now();
  view = settle(manifest);
  bus.emit('site:docs', loadDocs());
  watch();
}

/** Pending list for a change made by a commit (a deletion turns earlier changes into deletions). */
function pend(op) {
  if (op.op === 'delete' || op.op === 'rmdir') addDeletion(op); else addPending(op);
}

/**
 * Change the sound files, in one commit. files: [{path, sha}] as github.commit takes them (or a function
 * of listTree); op: the same change as a pending-list entry; doc: the setup with its references changed
 * (or null). Public sounds: the setup goes in the same commit, and the change waits in the pending list
 * until the site is published. Private sounds: the commit in the sounds repo also rewrites its
 * library.json (read from the branch), so the list never lags; the setup saves to this repo on its own.
 */
async function apply(message, files, op, doc) {
  const listed = (listTree) => (typeof files === 'function' ? files(listTree) : files);
  if (PRIVATE) {
    await github.commit(message, async (listTree) => {
      const changes = await listed(listTree);
      const entry = (await listTree()).find((e) => e.path === LIST_PATH);
      const data = entry ? JSON.parse(await github.blobText(entry.sha, { repo: SOUNDS_REPO })) : { version: 1 };
      const next = editList({ ...data, files: data.files || [], folders: data.folders || [] }, op);
      next.folders.sort();                 // as the index script sorts them
      return [...changes, { path: LIST_PATH, content: `${JSON.stringify(next, null, 1)}\n` }];
    }, { repo: SOUNDS_REPO });
    pend(op);
    if (doc) { setup.doc = doc; changed(); sync(); }
    manifest = await fetchManifest().catch(() => manifest);
    view = settle(manifest);
    bus.emit('site:docs', loadDocs());
    return;
  }
  const text = doc ? setupText(doc) : null;
  await github.commit(message, async (listTree) => [...await listed(listTree), ...(doc ? [{ path: SETUP_PATH, content: text }] : [])]);
  pend(op);
  if (doc) { await committed(doc, text); return; }
  view = settle(manifest);
  watch();
}

const taken = (path, except) => view.files.some((f) => f.path !== except && f.path.toLowerCase() === path.toLowerCase());

async function moveFile(from, to, message) {
  needGitHub();
  const f = view.files.find((x) => x.path === from);
  if (!f) throw new Error("That sound isn't in the library any more.");
  if (to === from) return { from, to };
  if (taken(to, from)) throw new Error(`There is already a sound called “${soundName(to)}” in ${folderName(dirOf(to)) || 'that folder'}.`);
  const doc = remapDoc(setup.doc, (id) => (id === from ? to : id));
  if (groupOf(from) !== groupOf(to)) leaveGroup(doc, to, groupOf(from));
  const oldName = soundName(from);
  for (const b of doc.boards?.banks || []) for (const p of Object.values(b.pads || {})) if (p?.sound === to && p.label === oldName) delete p.label;
  await apply(message, [
    { path: `${SOUNDS}/${to}`, sha: f.sha },
    { path: `${SOUNDS}/${from}`, sha: null },
  ], { op: 'move', from, to }, doc);
  return { from, to };
}

export function renameSound(id, newName) {
  const name = cleanName(newName);
  if (!name) return Promise.reject(new Error('Give the sound a name.'));
  const file = baseOf(id);
  const to = joinPath(dirOf(id), `${orderPrefix(file)}${name}${extOf(file)}`);
  return moveFile(id, to, `Rename ${file} to ${baseOf(to)}`);
}

export function moveSound(id, dir) {
  let to = joinPath(dir, baseOf(id));
  const file = baseOf(id);
  for (let n = 2; taken(to, id) && n < 50; n++) to = joinPath(dir, `${file.slice(0, file.length - extOf(file).length)} ${n}${extOf(file)}`);
  return moveFile(id, to, `Move ${file} to ${dir}`);
}

export async function deleteSound(id) {
  needGitHub();
  const doc = normal(clone(setup.doc));
  forget(doc, id);
  await apply(`Delete ${baseOf(id)}`, [{ path: `${SOUNDS}/${id}`, sha: null }], { op: 'delete', path: id }, doc);
}

/** Delete a folder (a playlist, an ambience playlist or a pad bank) and every file in it. Resolves to
 *  the ids of the sounds that went. The three category folders stay. */
export async function deleteFolder(dir) {
  needGitHub();
  if (!dir.includes('/')) throw new Error(`The ${dir} folder stays. Delete the folders in it instead.`);
  const ids = view.files.filter((f) => under(f.path, dir)).map((f) => f.path);
  const doc = normal(clone(setup.doc));
  for (const id of ids) forget(doc, id);
  for (const k of Object.keys(doc.sounds)) if (under(k, dir)) delete doc.sounds[k];
  if (doc.playlists.list) doc.playlists.list = doc.playlists.list.filter((pl) => !pl.dir || !under(pl.dir, dir));
  if (doc.boards.banks) doc.boards.banks = doc.boards.banks.filter((b) => !b.dir || !under(b.dir, dir));
  if (doc.boards.active && under(doc.boards.active, dir)) doc.boards.active = null;
  const prefix = `${SOUNDS}/${dir}/`;
  await apply(`Delete the folder ${dir}`, async (listTree) => {
    const gone = (await listTree()).filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => ({ path: e.path, sha: null, mode: e.mode }));
    if (!gone.length) throw new Error("GitHub doesn't have that folder yet. Give it a minute and try again.");
    return gone;
  }, { op: 'rmdir', path: dir }, doc);
  return ids;
}

export async function createFolder(parent, name) {
  needGitHub();
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the folder a name.');
  const dir = joinPath(parent, clean);
  if (view.folders.some((d) => d.toLowerCase() === dir.toLowerCase())) throw new Error(`There is already a folder called ${clean}.`);
  await apply(`Add the folder ${dir}`, [{ path: `${SOUNDS}/${dir}/README.md`, content: folderReadme(dir) }], { op: 'mkdir', path: dir }, null);
  return dir;
}

/** Rename a folder, or with parent, move it there (a playlist to Ambience and back). */
export async function renameFolder(dir, newName, parent = dirOf(dir)) {
  needGitHub();
  const clean = cleanName(newName);
  if (!clean) throw new Error('Give the folder a name.');
  const to = joinPath(parent, `${orderPrefix(baseOf(dir))}${clean}`);
  if (to === dir) return { from: dir, to };
  if (view.folders.some((d) => d !== dir && d.toLowerCase() === to.toLowerCase())) throw new Error(`There is already a folder called ${clean}${parent === dirOf(dir) ? '' : ` in ${parent}`}.`);
  const doc = remapDoc(setup.doc, (id) => moveUnder(id, dir, to));
  const prefix = `${SOUNDS}/${dir}/`;
  await apply(parent === dirOf(dir) ? `Rename the folder ${dir} to ${baseOf(to)}` : `Move the folder ${dir} to ${parent}`, async (listTree) => {
    const moves = [];
    for (const e of await listTree()) {
      if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
      moves.push({ path: `${SOUNDS}/${to}/${e.path.slice(prefix.length)}`, sha: e.sha, mode: e.mode }, { path: e.path, sha: null, mode: e.mode });
    }
    if (!moves.length) throw new Error("GitHub doesn't have that folder yet. Give it a minute and try again.");
    return moves;
  }, { op: 'movedir', from: dir, to }, doc);
  return { from: dir, to };
}

// ---- pages that refuse frames ------------------------------------------------------------------------
// The PC version asks the site itself; a web page can't read another site's headers, so this is a list.
const REFUSES = /(^|\.)(wikidot\.com|github\.com|reddit\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|discord\.com)$/i;
export function frameCheck(url) {
  let u;
  try { u = new URL(url); } catch { return { blocked: false }; }
  if (/(^|\.)youtube\.com$/i.test(u.hostname) && !u.pathname.startsWith('/embed/')) return { blocked: true, reason: 'x-frame-options' };
  if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && !u.searchParams.has('igu')) return { blocked: true, reason: 'x-frame-options' };
  return { blocked: REFUSES.test(u.hostname), reason: REFUSES.test(u.hostname) ? 'x-frame-options' : null };
}
