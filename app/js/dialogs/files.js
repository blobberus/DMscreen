// The repo's sound folders, from the website. Adding sounds opens GitHub's upload page for the folder;
// making and renaming folders, and renaming, moving or deleting sounds, are commits made from here, so
// they need this device connected to GitHub (Settings, GitHub).
import { h, icon } from '../core/dom.js';
import { library } from '../core/library.js';
import * as site from '../core/site.js';
import { openDialog, promptDialog, confirmDialog, showMenu, toast } from '../core/ui.js';
import { openSettings } from './settings.js';

const CATS = site.CATEGORIES;
const ICON = { music: 'playlist', ambience: 'wave', effect: 'keyboard' };

/** "Music › Tavern" */
export function folderLabel(dir) {
  return dir.split('/').map((seg, i) => (i === 0 ? seg : site.folderName(seg))).join(' › ');
}

/** Open GitHub's upload page for a folder in a new tab, and watch for the files to arrive. */
export function uploadTo(dir) {
  window.open(site.links.upload(dir), '_blank', 'noopener');
  site.watch('upload');
  toast(`GitHub opened in a new tab at ${folderLabel(dir)}. Drop your MP3s there and press Commit changes; they appear here about a minute later.`, { timeout: 9000 });
}

/** Every folder sounds can go in, for an "Add sounds" button. With kind, just that category's. */
export function addSoundsMenu(anchor, { kind = null } = {}) {
  const items = [];
  for (const c of CATS) {
    if (kind && c.kind !== kind) continue;
    const groups = library.groups(c.kind).filter((d) => d.includes('/'));
    const sub = [
      ...groups.map((d) => ({ label: site.folderName(d), icon: 'upload', onClick: () => uploadTo(d) })),
      groups.length ? { sep: true } : null,
      { label: `New ${c.one}…`, icon: 'folder-plus', onClick: () => newFolder(c.dir) },
    ];
    if (kind) items.push(...sub);
    else items.push({ label: c.label, icon: ICON[c.kind], submenu: sub });
  }
  items.push({ sep: true }, { label: 'How adding sounds works', icon: 'help', onClick: () => window.open(site.links.howTo, '_blank', 'noopener') });
  showMenu(anchor, items, { minWidth: 230 });
}

/** A commit failed. Not connected: say why and offer the way. Anything else: say what GitHub said. */
export function explainFailure(e) {
  if (e?.code !== 'github') { toast(e?.message || 'That didn’t work.', { type: 'error' }); return; }
  openDialog({
    title: 'Connect this device to GitHub',
    body: h('div', { class: 'stack' },
      h('p', null, 'Renaming and moving sounds changes the files in the repo, so the screen needs permission to commit there. It takes a minute, once per device.'),
      h('p', { class: 'muted' }, 'Until then everything still plays, and adding sounds works through GitHub’s upload page.')),
    actions: [
      { label: 'Not now' },
      { label: 'Connect GitHub', kind: 'primary', onClick: () => { setTimeout(() => openSettings('github'), 0); } },
    ],
  });
}

async function run(work, done) {
  try {
    const r = await work();
    if (done) toast(done(r), { type: 'ok', timeout: 5000 });
    return r;
  } catch (e) {
    explainFailure(e);
    return null;
  }
}

export async function newFolder(category) {
  const c = CATS.find((x) => x.dir === category);
  const name = await promptDialog(`New ${c?.one || 'folder'}`, {
    label: 'Name', okLabel: 'Make it',
    placeholder: { music: 'Tavern, The road, Boss fight…', ambience: 'Tavern, Forest, Storm…', effect: 'Combat, Magic, Creatures…' }[c?.kind] || '',
    hint: `A folder in sounds/${category} on GitHub. Start the name with 01, 02… to set its place in the list.`,
  });
  if (!name) return null;
  return run(() => library.createFolder(category, name), (dir) => `Made ${folderLabel(dir)}. Add sounds to it from its Add button.`);
}

export async function renameFolder(dir) {
  const name = await promptDialog('Rename the folder', { label: 'Name', value: site.folderName(dir), okLabel: 'Rename', hint: `Renames ${folderLabel(dir)} on GitHub. Pads, keys and flags come along.` });
  if (!name) return null;
  return run(() => library.renameFolder(dir, name), (to) => `Renamed to ${site.folderName(to)}.`);
}

export async function renameSound(s) {
  const name = await promptDialog('Rename the sound', { label: 'Name', value: s.name, okLabel: 'Rename', hint: 'Renames the file on GitHub. In a playlist, names that start with 01, 02… set the order.' });
  if (!name || name === s.name) return null;
  return run(() => library.rename(s.id, name), () => `Renamed to ${name}.`);
}

export function moveTo(s, dir) {
  if (dir === s.folder) return null;
  return run(() => library.move(s.id, dir), () => `Moved “${s.name}” to ${folderLabel(dir)}.`);
}

/** Menu items for moving a sound to another folder, grouped by category. */
export function moveItems(s) {
  return CATS.map((c) => {
    const dirs = library.folders().filter((d) => d.split('/')[0] === c.dir && d.split('/').length === 2);
    return {
      label: c.label, icon: ICON[c.kind],
      submenu: dirs.length ? dirs.map((d) => ({ label: site.folderName(d), checked: s.folder === d, onClick: () => moveTo(s, d) })) : [{ label: `No ${c.one} folders yet`, disabled: true }],
    };
  });
}

export async function deleteSound(s) {
  if (!(await confirmDialog(`Delete “${s.name}” from the repo? It comes off every playlist and pad. GitHub keeps it in the history, so it can be brought back there.`, { okLabel: 'Delete', danger: true }))) return false;
  return !!(await run(async () => { await library.remove(s.id); return true; }, () => `Deleted “${s.name}”.`));
}

/** The website's items for a sound's menu. */
export function soundItems(s) {
  return [
    { label: 'Rename…', icon: 'edit', onClick: () => renameSound(s) },
    { label: 'Move to', icon: 'folder', submenu: moveItems(s) },
    { label: 'Open on GitHub', icon: 'external', onClick: () => window.open(site.links.file(s.path), '_blank', 'noopener') },
    { label: 'Download the file', icon: 'download', onClick: () => download(s) },
    { sep: true },
    { label: 'Delete from the repo…', icon: 'trash', onClick: () => deleteSound(s) },
  ];
}

/** The website's items for a folder (playlist, ambience folder or pad bank). */
export function folderItems(dir) {
  return [
    { label: 'Add sounds on GitHub', icon: 'upload', onClick: () => uploadTo(dir) },
    dir.includes('/') ? { label: 'Rename the folder…', icon: 'edit', onClick: () => renameFolder(dir) } : null,
    { label: 'Open the folder on GitHub', icon: 'external', onClick: () => window.open(site.links.folder(dir), '_blank', 'noopener') },
  ];
}

export function download(s) {
  const a = h('a', { href: library.mediaUrl(s.id), download: s.file });
  document.body.append(a);
  a.click();
  a.remove();
}

/** A small "Add" button that opens the folder's upload page. */
export function addButton(dir, label = 'Add') {
  return h('button', { class: 'btn btn-sm', type: 'button', title: `Upload sounds to ${folderLabel(dir)} on GitHub`, onclick: () => uploadTo(dir) }, icon('upload'), label);
}
