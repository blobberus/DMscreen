// Notes: Markdown files in an Obsidian vault, built for writing during a session.
// "Tonight's session" makes the next numbered session note from Templates/Session.md. The quick inserts
// stamp the time, the scene that is playing, people and places (making their notes as you go), loot and
// open threads. [[ suggests notes to link. Everything saves as you type; if Obsidian changes the same
// note, you choose whose version wins.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { api, q } from '../core/api.js';
import { SITE } from '../core/mode.js';
import { confirmDialog, promptDialog, showMenu, toast } from '../core/ui.js';
import { debounce, clock, isoDate, natural, baseName } from '../core/util.js';
import { renderInto, setResolver, toggleTask } from '../core/markdown.js';
import { engine } from '../audio/engine.js';

const BAD_NAME = /[\\/:*?"<>|#^[\]]/;
const BUILTIN = {
  session: '---\nsession: {{session}}\ndate: {{date}}\ntags: [session]\n---\n# Session {{session}}\n\n## Recap\n- \n\n## Log\n**{{time}}** Start\n\n## People\n- \n\n## Loot\n- \n\n## Threads\n- [ ] \n\n## Next time\n- \n',
  person: '---\ntags: [npc]\n---\n# {{title}}\n\n**Role:** \n**Where:** \n**Wants:** \n**Voice:** \n\n## Met\n- {{date}}: \n',
  place: '---\ntags: [location]\n---\n# {{title}}\n\n**Region:** \n**Feel:** \n\n## People here\n- \n\n## Notes\n- \n',
};

export default function createNotes({ el, getState, setState, workspace }) {
  const saved = getState();
  let tree = { files: [], folders: [], name: 'Vault', root: '' };
  let current = null;           // {path, mtime}
  let dirty = false;
  let mode = saved.mode || 'write';
  let openFolders = new Set(saved.openFolders || ['Sessions', 'People', 'Places']);
  let sideOpen = saved.sideOpen ?? true;
  let searchTerm = '';

  // ---- skeleton --------------------------------------------------------------------
  const vaultName = h('span', { class: 'nt-vault truncate' });
  const searchIn = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search notes, or #tag', 'aria-label': 'Search notes' });
  const treeEl = h('div', { class: 'nt-tree', role: 'tree' });
  const side = h('aside', { class: 'nt-side' },
    h('div', { class: 'nt-sidehead' }, icon('journal', 'icon-sm'), vaultName,
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'New note', 'aria-label': 'New note', onclick: () => newNote() }, icon('file-plus')),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'New folder', 'aria-label': 'New folder', onclick: () => newFolder() }, icon('folder-plus'))),
    h('button', { class: 'btn btn-sm nt-session', type: 'button', onclick: () => newSession() }, icon('plus'), "Tonight's session"),
    h('label', { class: 'search nt-search' }, icon('search'), searchIn),
    treeEl);

  // In a narrow pane the list slides over the note and tucks away once a note opens.
  let narrowSide = false;
  const isNarrow = () => root.clientWidth > 0 && root.clientWidth < 640;
  const sideBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Show or hide the note list', 'aria-label': 'Show or hide the note list', onclick: () => {
    if (isNarrow()) narrowSide = !narrowSide;
    else { sideOpen = !sideOpen; setState({ sideOpen }); }
    layout();
  } }, icon('sidebar'));
  const titleIn = h('input', { class: 'nt-title', 'aria-label': 'Note title', spellcheck: false });
  const pathEl = h('span', { class: 'nt-path meta truncate' });
  const modeSeg = h('div', { class: 'seg nt-mode', role: 'group', 'aria-label': 'Mode' },
    h('button', { type: 'button', 'data-mode': 'write', onclick: () => setMode('write'), title: 'Write (Ctrl+E switches)' }, 'Write'),
    h('button', { type: 'button', 'data-mode': 'read', onclick: () => setMode('read'), title: 'Read (Ctrl+E switches)' }, 'Read'));
  const status = h('span', { class: 'nt-status meta' });
  const moreBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More', 'aria-label': 'More', onclick: (e) => noteMenu(e.currentTarget) }, icon('more'));
  const head = h('header', { class: 'nt-head' }, sideBtn, h('div', { class: 'nt-titlebox' }, titleIn, pathEl), modeSeg, status, moreBtn);

  const tools = h('div', { class: 'nt-tools', role: 'toolbar', 'aria-label': 'Quick inserts' },
    tool('clock', 'Time', 'Stamp the time on a new line', () => stampLine(`**${clock()}** `)),
    tool('scene', 'Scene', 'Log the scene that is playing', () => {
      const pl = engine.playlist();
      const tr = engine.track;
      stampLine(`**${clock()}** Scene: ${pl ? pl.name : ''}${tr ? ` (${tr.name})` : ''}${pl || tr ? ' ' : ''}`);
    }),
    tool('user', 'Person', 'Link a person, making their note if it is new', () => linkEntity('person')),
    tool('pin', 'Place', 'Link a place, making its note if it is new', () => linkEntity('place')),
    tool('coins', 'Loot', 'Add a loot line', () => stampLine('- Loot: ')),
    tool('thread', 'Thread', 'Add an open thread to follow up', () => stampLine('- [ ] ')),
    tool('link', 'Link', 'Link to another note: [[', () => insertAtCaret('[[', '')));
  const text = h('textarea', { class: 'nt-text', spellcheck: true, 'aria-label': 'Note text', placeholder: 'Write here. [[ links a note, - [ ] makes a thread to follow up.' });
  const read = h('div', { class: 'nt-read' });
  const suggest = h('div', { class: 'nt-suggest menu', hidden: true, role: 'listbox' });
  const conflict = h('div', { class: 'nt-conflict', hidden: true });
  const backlinks = h('footer', { class: 'nt-backlinks' });
  const empty = h('div', { class: 'nt-empty' });
  const editorBox = h('div', { class: 'nt-body' }, text, read, suggest);
  const main = h('section', { class: 'nt-main' }, head, conflict, tools, editorBox, backlinks, empty);
  const root = h('div', { class: 'nt' }, side, main);
  el.append(root);

  function tool(ic, label, title, run) {
    return h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: run }, icon(ic), label);
  }

  // ---- vault index ---------------------------------------------------------------------
  const byName = new Map();
  function index() {
    byName.clear();
    const files = tree.files.slice().sort((a, b) => a.path.length - b.path.length);
    for (const f of files) {
      const n = baseName(f.path).toLowerCase();
      if (!byName.has(n)) byName.set(n, f.path);
    }
  }
  setResolver((target) => {
    const t = String(target || '').replace(/\.md$/i, '');
    const p = byName.get(baseName(t).toLowerCase()) || tree.files.find((f) => f.path.toLowerCase() === `${t.toLowerCase()}.md`)?.path;
    return { exists: !!p, path: p || null };
  });

  async function loadTree() {
    try {
      tree = await api.get('/api/notes/tree');
      index();
      vaultName.textContent = tree.name;
      vaultName.title = tree.root;
      renderTree();
      renderBacklinks();
    } catch (e) {
      clear(treeEl);
      treeEl.append(h('p', { class: 'field-error nt-err' }, `Couldn't read the vault: ${e.message}`));
    }
  }

  // ---- tree ---------------------------------------------------------------------------------
  function renderTree() {
    clear(treeEl);
    if (searchTerm) { renderSearch(); return; }
    const folders = new Map([['', { name: '', path: '', folders: [], files: [] }]]);
    const ensure = (path) => {
      if (folders.has(path)) return folders.get(path);
      const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
      const node = { name: path.split('/').pop(), path, folders: [], files: [] };
      parent.folders.push(node);
      folders.set(path, node);
      return node;
    };
    for (const f of tree.folders) ensure(f);
    for (const f of tree.files) {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      ensure(dir).files.push(f);
    }
    const draw = (node, depth) => {
      node.folders.sort((a, b) => natural(a.name, b.name));
      const desc = /^sessions?$/i.test(node.name);
      node.files.sort((a, b) => (desc ? -1 : 1) * natural(baseName(a.path), baseName(b.path)));
      for (const sub of node.folders) {
        const open = openFolders.has(sub.path);
        treeEl.append(h('button', { class: 'nt-node is-folder', type: 'button', role: 'treeitem', 'aria-expanded': String(open), style: { paddingLeft: `${8 + depth * 14}px` },
          onclick: () => { open ? openFolders.delete(sub.path) : openFolders.add(sub.path); setState({ openFolders: [...openFolders] }); renderTree(); },
          oncontextmenu: (e) => { e.preventDefault(); folderMenu(sub, { x: e.clientX, y: e.clientY }); },
        }, icon(open ? 'chevron-down' : 'chevron-right', 'icon-sm'), h('span', { class: 'truncate' }, sub.name), h('span', { class: 'meta num' }, String(countFiles(sub)))));
        if (open) draw(sub, depth + 1);
      }
      for (const f of node.files) {
        treeEl.append(h('button', {
          class: `nt-node is-file ${current?.path === f.path ? 'is-selected' : ''}`, type: 'button', role: 'treeitem', style: { paddingLeft: `${8 + depth * 14 + 18}px` },
          title: f.path, onclick: () => open(f.path),
        }, h('span', { class: 'truncate' }, baseName(f.path))));
      }
    };
    draw(folders.get(''), 0);
    if (!tree.files.length) treeEl.append(h('p', { class: 'meta nt-err' }, 'No notes yet. Start with tonight’s session.'));
  }
  const countFiles = (node) => node.files.length + node.folders.reduce((s, f) => s + countFiles(f), 0);

  const runSearch = debounce(async () => {
    if (!searchTerm) { renderTree(); return; }
    if (searchTerm.startsWith('#')) { renderTree(); return; }
    try {
      const res = await api.get(`/api/notes/search?q=${q(searchTerm)}`);
      searchResults = res.results;
    } catch { searchResults = []; }
    renderTree();
  }, 220);
  let searchResults = [];
  function renderSearch() {
    if (searchTerm.startsWith('#')) {
      const tag = searchTerm.slice(1).toLowerCase();
      const files = tree.files.filter((f) => (f.tags || []).some((t) => t.toLowerCase().startsWith(tag)));
      if (!files.length) treeEl.append(h('p', { class: 'meta nt-err' }, `No notes tagged ${searchTerm}.`));
      for (const f of files) treeEl.append(h('button', { class: `nt-node is-file ${current?.path === f.path ? 'is-selected' : ''}`, type: 'button', onclick: () => open(f.path) }, h('span', { class: 'truncate' }, baseName(f.path)), h('span', { class: 'meta truncate' }, f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '')));
      return;
    }
    if (!searchResults.length) { treeEl.append(h('p', { class: 'meta nt-err' }, `Nothing matches “${searchTerm}”.`)); return; }
    for (const r of searchResults) {
      treeEl.append(h('button', { class: 'nt-hit', type: 'button', onclick: () => open(r.path, r.hits[0]?.line) },
        h('span', { class: 'nt-hitname truncate' }, baseName(r.path)),
        ...r.hits.slice(0, 2).map((x) => h('span', { class: 'nt-hitline meta' }, x.text))));
    }
  }
  searchIn.addEventListener('input', () => { searchTerm = searchIn.value.trim(); runSearch(); });

  // ---- open / save ---------------------------------------------------------------------------
  async function open(path, line = null) {
    if (dirty) await saveNow();
    try {
      const res = await api.get(`/api/notes/file?path=${q(path)}`);
      current = { path: res.path, mtime: res.mtime };
      text.value = res.content;
      dirty = false;
      narrowSide = false;
      setState({ path: res.path });
      conflict.hidden = true;
      showStatus('');
      layout();
      renderTree();
      renderBacklinks();
      if (mode === 'read') renderRead();
      if (line && mode === 'write') {
        const lines = text.value.split('\n');
        const pos = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
        text.focus();
        text.setSelectionRange(pos, pos);
        const lh = parseFloat(getComputedStyle(text).lineHeight) || 24;
        text.scrollTop = Math.max(0, (line - 4) * lh);
      }
    } catch (e) {
      toast(e.status === 404 ? 'That note no longer exists.' : e.message, { type: 'error' });
      if (e.status === 404) { current = null; setState({ path: null }); layout(); loadTree(); }
    }
  }

  const saveSoon = debounce(() => saveNow(), 700);
  async function saveNow(force = false) {
    saveSoon.cancel();
    if (!current || (!dirty && !force)) return;
    const content = text.value;
    const path = current.path;
    showStatus('Saving…');
    try {
      const res = await api.put('/api/notes/file', { path, content, baseMtime: current.mtime, force });
      if (current?.path === path) {
        current.mtime = res.mtime;
        if (text.value === content) dirty = false;
        showStatus(`Saved ${clock()}`);
      }
      refreshIndexSoon();
    } catch (e) {
      if (e.status === 409 && e.data?.conflict) showConflict(e.data);
      else showStatus(`Not saved: ${e.message}`, true);
    }
  }
  const refreshIndexSoon = debounce(() => loadTree(), 1500);
  function showStatus(msg, bad = false) {
    status.textContent = msg;
    status.classList.toggle('is-error', bad);
  }
  function showConflict(data) {
    clear(conflict);
    conflict.hidden = false;
    showStatus('Changed elsewhere', true);
    conflict.append(
      icon('warning', 'icon-sm'),
      h('span', null, SITE ? 'This note changed in another tab since you opened it.' : 'This note changed in another app (Obsidian?) since you opened it.'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { text.value = data.content; current.mtime = data.mtime; dirty = false; conflict.hidden = true; showStatus('Loaded their version'); if (mode === 'read') renderRead(); } }, 'Use theirs'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { conflict.hidden = true; saveNow(true); } }, 'Keep mine'));
  }
  text.addEventListener('input', () => { dirty = true; showStatus('Editing'); saveSoon(); onSuggestInput(); });
  text.addEventListener('blur', () => { if (dirty) saveNow(); setTimeout(() => { suggest.hidden = true; }, 150); });

  // A note changed on disk while it sat open and unedited: pick up the new text.
  async function checkExternal() {
    if (!current || dirty) return;
    try {
      const res = await api.get(`/api/notes/file?path=${q(current.path)}`);
      if (Math.abs(res.mtime - current.mtime) > 0.002 && !dirty) {
        const pos = text.selectionStart;
        text.value = res.content;
        current.mtime = res.mtime;
        text.setSelectionRange(pos, pos);
        if (mode === 'read') renderRead();
        showStatus('Updated from disk');
      }
    } catch { /* gone or offline */ }
  }
  window.addEventListener('focus', () => { checkExternal(); loadTree(); });

  // ---- modes -------------------------------------------------------------------------------------
  function setMode(m) {
    mode = m;
    setState({ mode });
    if (dirty) saveNow();
    layout();
    if (m === 'read') renderRead(); else text.focus();
  }
  function renderRead() {
    renderInto(read, text.value, {
      onLink: (target) => openByName(target),
      onTag: (tag) => { searchIn.value = `#${tag}`; searchTerm = `#${tag}`; sideOpen = true; layout(); renderTree(); },
      onTaskToggle: (i, checked) => { text.value = toggleTask(text.value, i, checked); dirty = true; saveNow(); },
    });
  }
  text.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode('read'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
    if (!suggest.hidden && onSuggestKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) continueList(e);
    if (e.key === 'Tab' && !e.altKey) indentList(e);
  });
  read.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode('write'); } });
  read.tabIndex = 0;
  // links to other sites open in the Stone Wardens tab rather than a new browser tab
  read.addEventListener('click', (e) => {
    const a = e.target.closest('a.external');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || !/^https?:/.test(a.href)) return;
    e.preventDefault();
    workspace.openSite(a.href);
  });

  // ---- editing helpers -------------------------------------------------------------------------------
  function insertAtCaret(before, after = '') {
    if (mode !== 'write') setMode('write');
    text.focus();
    const s = text.selectionStart;
    const e2 = text.selectionEnd;
    text.setRangeText(before + text.value.slice(s, e2) + after, s, e2, 'end');
    const caret = s + before.length + (e2 - s);
    text.setSelectionRange(caret, caret);
    text.dispatchEvent(new Event('input'));
  }
  /** Put text at the start of a fresh line (after the caret's line if it has words). */
  function stampLine(stamp) {
    if (!current) { toast('Open or start a note first.'); return; }
    if (mode !== 'write') setMode('write');
    text.focus();
    const v = text.value;
    const pos = text.selectionStart;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = v.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = v.length;
    const line = v.slice(lineStart, lineEnd);
    let insertAt;
    let chunk;
    if (!line.trim()) { insertAt = lineStart; chunk = stamp; text.setRangeText(chunk, lineStart, lineEnd, 'end'); }
    else { insertAt = lineEnd; chunk = `\n${stamp}`; text.setRangeText(chunk, lineEnd, lineEnd, 'end'); }
    const caret = insertAt + chunk.length;
    text.setSelectionRange(caret, caret);
    text.dispatchEvent(new Event('input'));
  }
  function continueList(e) {
    const v = text.value;
    const pos = text.selectionStart;
    if (pos !== text.selectionEnd) return;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const line = v.slice(lineStart, pos);
    const m = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[0].trim()) {
      text.setRangeText('', lineStart, pos, 'end');
    } else {
      const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
      text.setRangeText(`\n${m[1]}${marker}${m[5]}${m[6] ? '[ ] ' : ''}`, pos, pos, 'end');
    }
    text.dispatchEvent(new Event('input'));
  }
  function indentList(e) {
    const v = text.value;
    const pos = text.selectionStart;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = v.indexOf('\n', pos) < 0 ? v.length : v.indexOf('\n', pos);
    const line = v.slice(lineStart, lineEnd);
    if (!/^\s*([-*+]|\d+[.)])\s/.test(line)) return;
    e.preventDefault();
    if (e.shiftKey) {
      const cut = line.startsWith('  ') ? 2 : line.startsWith('\t') ? 1 : 0;
      if (!cut) return;
      text.setRangeText(line.slice(cut), lineStart, lineEnd, 'preserve');
      text.setSelectionRange(Math.max(lineStart, pos - cut), Math.max(lineStart, pos - cut));
    } else {
      text.setRangeText(`  ${line}`, lineStart, lineEnd, 'preserve');
      text.setSelectionRange(pos + 2, pos + 2);
    }
    text.dispatchEvent(new Event('input'));
  }

  // ---- [[ suggestions ----------------------------------------------------------------------------
  let sugItems = [];
  let sugIndex = 0;
  let sugQuery = null;
  function onSuggestInput() {
    const pos = text.selectionStart;
    const before = text.value.slice(Math.max(0, pos - 80), pos);
    const m = /\[\[([^\]\n|#]*)$/.exec(before);
    if (!m) { suggest.hidden = true; sugQuery = null; return; }
    sugQuery = m[1];
    const term = sugQuery.toLowerCase();
    const names = [...new Set(tree.files.map((f) => baseName(f.path)))];
    const starts = names.filter((n) => n.toLowerCase().startsWith(term));
    const contains = names.filter((n) => !n.toLowerCase().startsWith(term) && n.toLowerCase().includes(term));
    sugItems = [...starts.sort(natural), ...contains.sort(natural)].slice(0, 8).map((n) => ({ name: n }));
    if (sugQuery.trim() && !names.some((n) => n.toLowerCase() === term)) sugItems.push({ name: sugQuery.trim(), create: true });
    if (!sugItems.length) { suggest.hidden = true; return; }
    sugIndex = 0;
    drawSuggest();
    placeSuggest();
  }
  function drawSuggest() {
    clear(suggest);
    sugItems.forEach((it, i) => suggest.append(h('button', {
      class: `menu-item ${i === sugIndex ? 'is-active' : ''}`, type: 'button', role: 'option', 'aria-selected': String(i === sugIndex),
      onmousedown: (e) => { e.preventDefault(); acceptSuggest(i); },
    }, icon(it.create ? 'file-plus' : 'file'), h('span', { class: 'truncate' }, it.create ? `Link “${it.name}” (a new note)` : it.name))));
    suggest.hidden = false;
  }
  function onSuggestKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); sugIndex = (sugIndex + 1) % sugItems.length; drawSuggest(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sugIndex = (sugIndex - 1 + sugItems.length) % sugItems.length; drawSuggest(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggest(sugIndex); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); suggest.hidden = true; return true; }
    return false;
  }
  function acceptSuggest(i) {
    const it = sugItems[i];
    if (!it || sugQuery == null) return;
    const pos = text.selectionStart;
    const start = pos - sugQuery.length;
    const closes = text.value.slice(pos, pos + 2) === ']]';
    text.setRangeText(`${it.name}${closes ? '' : ']]'}`, start, pos, 'end');
    const caret = start + it.name.length + 2;
    text.setSelectionRange(caret, caret);
    suggest.hidden = true;
    sugQuery = null;
    text.dispatchEvent(new Event('input'));
  }
  function placeSuggest() {
    const c = caretPoint(text, text.selectionStart);
    const box = editorBox.getBoundingClientRect();
    const tr = text.getBoundingClientRect();
    let x = c.x + tr.left - box.left;
    let y = c.y + tr.top - box.top + 24;
    x = Math.min(x, box.width - 260);
    if (y + 240 > box.height) y = Math.max(4, y - 24 - Math.min(240, suggest.offsetHeight || 200) - 4);
    suggest.style.left = `${Math.max(4, x)}px`;
    suggest.style.top = `${y}px`;
  }

  // ---- people, places, new notes ----------------------------------------------------------------------
  async function template(kind, vars) {
    const file = { session: 'Templates/Session.md', person: 'Templates/NPC.md', place: 'Templates/Location.md' }[kind];
    let src = BUILTIN[kind];
    if (file && tree.files.some((f) => f.path.toLowerCase() === file.toLowerCase())) {
      try { src = (await api.get(`/api/notes/file?path=${q(file)}`)).content; } catch { /* builtin */ }
    }
    return src.replace(/\{\{\s*(\w+)(?::[^}]*)?\s*\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  async function create(path, content) {
    const res = await api.put('/api/notes/file', { path, content, create: true });
    await loadTree();
    return res.path;
  }
  function validName(name) {
    if (!name) return false;
    if (BAD_NAME.test(name)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]', { type: 'error' }); return false; }
    return true;
  }
  async function linkEntity(kind) {
    if (!current) { toast('Open or start a note first.'); return; }
    const name = await promptDialog(kind === 'person' ? 'Link a person' : 'Link a place', { label: 'Name', placeholder: kind === 'person' ? 'Brother Aldous' : 'The Sunken Bell', okLabel: 'Link' });
    if (!name || !validName(name)) return;
    if (!byName.has(name.toLowerCase())) {
      const folder = kind === 'person' ? 'People' : 'Places';
      try {
        await create(`${folder}/${name}.md`, await template(kind, { title: name, date: isoDate(), time: clock() }));
        toast(`Made a note for ${name} in ${folder}.`, { type: 'ok' });
      } catch (e) { if (!e.data?.exists) toast(e.message, { type: 'error' }); }
    }
    insertAtCaret(`[[${name}]]`);
  }
  async function newNote(folder = current?.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/')) : '') {
    const name = await promptDialog('New note', { label: 'Name', placeholder: 'The heist plan', okLabel: 'Create', hint: folder ? `In ${folder}` : 'At the top of the vault' });
    if (!name || !validName(name)) return;
    try {
      const path = await create(`${folder ? `${folder}/` : ''}${name}.md`, `# ${name}\n\n`);
      await open(path);
      setMode('write');
    } catch (e) { toast(e.message, { type: 'error' }); }
  }
  async function newFolder() {
    const name = await promptDialog('New folder', { label: 'Name', placeholder: 'Factions', okLabel: 'Create' });
    if (!name || !validName(name)) return;
    try {
      await api.post('/api/notes/folder', { path: name });
      openFolders.add(name);
      await loadTree();
    } catch (e) { toast(e.message, { type: 'error' }); }
  }
  async function newSession() {
    let max = 0;
    for (const f of tree.files) {
      const m = /session\s*(\d+)/i.exec(baseName(f.path));
      if (m) max = Math.max(max, Number(m[1]));
    }
    const n = max + 1;
    const date = isoDate();
    const today = tree.files.find((f) => /^sessions\//i.test(f.path) && baseName(f.path).includes(date));
    if (today) { await open(today.path); setMode('write'); toast('Tonight’s session note is already started.'); return; }
    try {
      const path = await create(`Sessions/Session ${n} - ${date}.md`, await template('session', { session: n, date, time: clock(), title: `Session ${n}` }));
      openFolders.add('Sessions');
      await open(path);
      setMode('write');
      // put the caret at the end of the log's first line
      const i = text.value.indexOf('Start');
      if (i >= 0) { text.focus(); text.setSelectionRange(i + 5, i + 5); }
    } catch (e) { toast(e.message, { type: 'error' }); }
  }
  async function openByName(target) {
    const r = byName.get(baseName(target).toLowerCase());
    if (r) { open(r); return; }
    if (!validName(target)) return;
    if (!(await confirmDialog(`There's no note called “${target}” yet. Make it?`, { title: 'New note', okLabel: 'Make it' }))) return;
    try {
      const path = await create(`${target}.md`, `# ${target}\n\n`);
      await open(path);
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  // ---- rename, delete, menus ------------------------------------------------------------------------
  titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleIn.blur(); } if (e.key === 'Escape') { titleIn.value = baseName(current?.path); titleIn.blur(); } });
  titleIn.addEventListener('change', async () => {
    if (!current) return;
    const name = titleIn.value.trim();
    if (!name || name === baseName(current.path)) { titleIn.value = baseName(current.path); return; }
    if (!validName(name)) { titleIn.value = baseName(current.path); return; }
    if (dirty) await saveNow();
    const dir = current.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/') + 1) : '';
    try {
      const res = await api.post('/api/notes/rename', { from: current.path, to: `${dir}${name}.md` });
      current = { path: res.path, mtime: res.mtime };
      setState({ path: res.path });
      if (res.linksUpdated) toast(`Renamed. Updated links in ${res.linksUpdated} ${res.linksUpdated === 1 ? 'note' : 'notes'}.`, { type: 'ok' });
      await loadTree();
      await checkExternal();
      layout();
    } catch (e) { toast(e.message, { type: 'error' }); titleIn.value = baseName(current.path); }
  });
  function noteMenu(anchor) {
    if (!current) return;
    showMenu(anchor, [
      { label: 'Copy a link to this note', icon: 'link', onClick: () => { navigator.clipboard?.writeText(`[[${baseName(current.path)}]]`); toast('Copied.', { type: 'ok' }); } },
      { label: 'New note in this folder', icon: 'file-plus', onClick: () => newNote() },
      { sep: true },
      { label: 'Move to the vault’s trash', icon: 'trash', onClick: async () => {
        if (!(await confirmDialog(`Move “${baseName(current.path)}” to the vault's .trash folder?`, { okLabel: 'Move to trash', danger: true }))) return;
        await api.del(`/api/notes/file?path=${q(current.path)}`);
        current = null;
        dirty = false;
        setState({ path: null });
        await loadTree();
        layout();
      } },
    ], { align: 'end' });
  }
  function folderMenu(node, at) {
    showMenu(at, [{ label: 'New note here', icon: 'file-plus', onClick: () => newNote(node.path) }]);
  }

  function renderBacklinks() {
    clear(backlinks);
    if (!current) return;
    const me = baseName(current.path).toLowerCase();
    const from = tree.files.filter((f) => f.path !== current.path && (f.links || []).some((l) => baseName(l).toLowerCase() === me));
    if (!from.length) { backlinks.hidden = true; return; }
    backlinks.hidden = false;
    backlinks.append(h('span', { class: 'meta' }, 'Linked from'), ...from.slice(0, 12).map((f) => h('button', { class: 'nt-backlink', type: 'button', onclick: () => open(f.path) }, baseName(f.path))));
  }

  // ---- layout ---------------------------------------------------------------------------------------------
  function layout() {
    const narrow = isNarrow();
    root.classList.toggle('is-narrow', narrow);
    root.classList.toggle('side-open', narrow ? narrowSide || !current : sideOpen);
    root.classList.toggle('has-note', !!current);
    modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const has = !!current;
    titleIn.disabled = !has;
    titleIn.value = has ? baseName(current.path) : '';
    pathEl.textContent = has ? (current.path.includes('/') ? current.path.slice(0, current.path.lastIndexOf('/')) : tree.name) : '';
    tools.hidden = !has || mode !== 'write';
    text.hidden = !has || mode !== 'write';
    read.hidden = !has || mode !== 'read';
    editorBox.hidden = !has;
    empty.hidden = has;
    if (!has) {
      clear(empty);
      empty.append(h('div', { class: 'empty' },
        h('strong', null, 'Notes for the table'),
        h('span', null, SITE
          ? 'Session notes, people and places, saved in this browser on this device (the repo is public, so notes never go to GitHub). Download them as Markdown for Obsidian from Settings, Notes.'
          : `Session notes, people and places, saved as Markdown in ${tree.root || 'your vault'}. Point Settings at your Obsidian vault and they appear in both.`),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newSession() }, icon('plus'), "Start tonight's session"),
          h('button', { class: 'btn', type: 'button', onclick: () => newNote('') }, icon('file-plus'), 'New note'))));
    }
  }

  loadTree().then(() => {
    layout();
    if (saved.path) open(saved.path);
  });
  layout();
  const offs = [bus.on('notes:vault', () => { current = null; loadTree().then(layout); })];
  return {
    show() { layout(); checkExternal(); },
    resize() { layout(); if (!suggest.hidden) placeSuggest(); },
    hide() { if (dirty) saveNow(); },
    destroy() { offs.forEach((off) => off()); },
  };
}

/** Caret position inside a textarea, in px from its top-left (a mirror div measures it). */
function caretPoint(ta, pos) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'whiteSpace', 'wordWrap', 'tabSize']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos) || '.';
  div.append(span);
  document.body.append(div);
  const x = span.offsetLeft;
  const y = span.offsetTop - ta.scrollTop;
  div.remove();
  return { x, y };
}
