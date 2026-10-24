// Sound library: everything you have, filterable by kind; drop files in, paste a link, or send a
// YouTube find here. Choosing a sound opens it in the editor beside the list (or in place of it when
// the pane is narrow). Drag a row onto a pad or a playlist.
// On the website the list is the repo's folders, each with an Add button that opens GitHub's upload
// page for it; renaming and moving are commits (dialogs/files.js).
import { h, icon, clear, setIcon } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { library, KIND_LABEL } from '../core/library.js';
import { openDialog, showMenu, toast } from '../core/ui.js';
import { fmtTime, parseTime, hostOf } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { previewButton, onTopButton, queueButton, syncPreviewButtons } from '../audio/cue.js';
import { volumeDialog } from '../dialogs/volume.js';
import { board, ROWS } from '../audio/board.js';
import { playlists } from '../audio/playlists.js';
import { createEditor } from './editor.js';
import { SITE } from '../core/mode.js';
import * as site from '../core/site.js';
import { addSoundsMenu, addButton, folderItems, soundItems, folderLabel } from '../dialogs/files.js';

const STATUS = {
  queued: 'Waiting', starting: 'Starting', downloading: 'Downloading', converting: 'Converting to MP3',
  analyzing: 'Reading the waveform', done: 'Added to the library', error: 'Failed', cancelled: 'Cancelled',
};

export default function createLibrary({ el, getState, setState, workspace }) {
  let kind = getState().kind || 'all';
  let selectedId = getState().selected || null;
  let narrowView = 'list';
  // Folders (website) or kinds (PC) fold away to keep the list short; a search opens them all while it lasts.
  const collapsed = new Set(getState().collapsed || []);
  let groupKeys = [];
  const foldBtn = h('button', { class: 'btn btn-sm lb-fold', type: 'button', onclick: () => foldAll() }, 'Collapse all');
  const search = h('input', { class: 'input input-sm', type: 'search', placeholder: 'Search sounds', 'aria-label': 'Search sounds' });
  const kinds = h('div', { class: 'tabs lb-kinds', role: 'tablist' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac,.opus,.webm', hidden: true });
  const refreshBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Look for sounds just added on GitHub', 'aria-label': 'Look for new sounds', onclick: async () => {
    refreshBtn.disabled = true;
    const { added } = await site.refresh();
    refreshBtn.disabled = false;
    if (!added.length) toast('Nothing new on GitHub yet. A new upload takes about a minute to show up.');
  } }, icon('refresh'));
  const bar = SITE
    ? h('div', { class: 'lb-bar' },
      h('label', { class: 'search lb-search' }, icon('search'), search),
      h('span', { class: 'lb-spacer' }),
      foldBtn,
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Upload sounds to a folder on GitHub', onclick: (e) => addSoundsMenu(e.currentTarget, { kind: kind === 'all' ? null : kind }) }, icon('upload'), 'Add sounds', icon('chevron-down', 'icon-sm')),
      refreshBtn)
    : h('div', { class: 'lb-bar' },
      h('label', { class: 'search lb-search' }, icon('search'), search),
      h('span', { class: 'lb-spacer' }),
      foldBtn,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fileIn.click() }, icon('upload'), 'Add files'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => linkDialog() }, icon('link'), 'From a link'),
      h('button', { class: 'btn btn-sm', type: 'button', title: 'Search YouTube in its own pane', onclick: () => workspace.openKind('youtube') }, icon('youtube'), 'YouTube'),
      fileIn);
  const jobsEl = h('div', { class: 'lb-jobs' });
  const listEl = h('div', { class: 'lb-list', role: 'listbox', 'aria-label': 'Sounds' });
  const editor = createEditor({
    onDeleted: () => { selectedId = null; setState({ selected: null }); narrowView = 'list'; render(); },
    onSelectSound: (id) => select(id),
  });
  const back = h('button', { class: 'btn btn-sm lb-back', type: 'button', onclick: () => { narrowView = 'list'; layout(); } }, icon('back'), 'All sounds');
  const detailEmpty = h('div', { class: 'lb-detail-empty' },
    h('div', { class: 'empty' },
      h('strong', null, 'Choose a sound to work on it'),
      h('span', null, 'Trim where it starts and ends, drop flags on the moments you want to jump to, set it to repeat, or cut part of it into a sound of its own.')));
  const detail = h('div', { class: 'lb-detail' }, back, detailEmpty, editor.el);
  const main = h('div', { class: 'lb-main' }, h('div', { class: 'lb-left' }, kinds, listEl), detail);
  const drop = h('div', { class: 'lb-drop' }, icon('upload', 'icon-lg'), h('span', null, 'Drop audio files to add them'));
  const root = h('div', { class: 'lb' }, bar, jobsEl, main, drop);
  el.append(root);

  // ---- files ---------------------------------------------------------------------
  let uploading = null;
  async function addFiles(files) {
    const list = [...files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(f.name));
    if (!list.length) { toast("Those aren't audio files this screen can play.", { type: 'error' }); return; }
    uploading = { count: list.length, progress: 0 };
    renderJobs();
    try {
      const res = await library.upload(list, { onProgress: (p) => { uploading.progress = p; renderJobs(); } });
      const made = res?.sounds || [];
      if (made.length === 1) select(made[0].id);
      toast(`Added ${made.length} ${made.length === 1 ? 'sound' : 'sounds'}.`, { type: 'ok' });
      for (const err of res?.errors || []) toast(err, { type: 'error' });
    } catch (e) {
      toast(e.message, { type: 'error' });
    } finally {
      uploading = null;
      renderJobs();
    }
  }
  fileIn.addEventListener('change', () => { if (fileIn.files.length) addFiles(fileIn.files); fileIn.value = ''; });
  let dragDepth = 0;
  if (!SITE) root.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; root.classList.add('is-dropping'); } });
  root.addEventListener('dragleave', (e) => { if (e.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; root.classList.remove('is-dropping'); } });
  root.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  root.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('is-dropping');
    addFiles(e.dataTransfer.files);
  });

  // ---- list ------------------------------------------------------------------------
  function counts() {
    const c = { all: 0, music: 0, ambience: 0, effect: 0 };
    for (const s of library.list()) { c.all++; c[s.kind]++; }
    return c;
  }
  function renderKinds() {
    clear(kinds);
    const c = counts();
    for (const [k, label] of [['all', 'All'], ['music', 'Music'], ['ambience', 'Ambience'], ['effect', 'Effects']]) {
      kinds.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(kind === k), onclick: () => { kind = k; setState({ kind }); render(); } },
        label, h('span', { class: 'count' }, String(c[k]))));
    }
  }
  // Music and ambience play on the deck, ending what was playing (the on-top button plays one over it);
  // an effect is a one-shot over everything, like a pad.
  function playState(s) {
    if (s.kind === 'effect') return [...engine.pads.values()].some((set) => [...set].some((v) => v.sound.id === s.id));
    return engine.music.voice?.sound.id === s.id && engine.music.voice.state === 'playing';
  }
  function playForTable(s) {
    if (s.kind === 'effect') engine.firePad(`lib:${s.id}`, { sound: s.id, mode: 'once' });
    else if (engine.music.voice?.sound.id === s.id) engine.togglePlay();
    else engine.playSingle(s);
  }
  const PLAY_HINT = { music: 'Play, ending what is playing', ambience: 'Play, ending what is playing', effect: 'Play once, over everything' };

  const matches = (s, term) => !term || s.name.toLowerCase().includes(term) || (s.tags || []).some((t) => t.toLowerCase().includes(term));

  /** A folder's (or kind's) heading: click it to fold its sounds away or open them. True if open. */
  function groupHead(key, label, count, extra = []) {
    const open = !collapsed.has(key) || !!search.value.trim();
    groupKeys.push(key);
    listEl.append(h('div', {
      class: `lb-group ${open ? '' : 'is-closed'}`, role: 'button', tabindex: 0, 'aria-expanded': String(open), title: open ? `Fold ${label} away` : `Show what is in ${label}`,
      onclick: (e) => { if (!e.target.closest('button')) toggleGroup(key); },
      onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleGroup(key); } },
    },
    icon(open ? 'chevron-down' : 'chevron-right', 'icon-sm lb-chev'),
    h('span', { class: 'lb-groupname truncate', title: label }, label),
    h('span', { class: 'meta num' }, String(count)),
    h('span', { class: 'lb-spacer' }),
    ...extra));
    return open;
  }
  function toggleGroup(key) {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    setState({ collapsed: [...collapsed] });
    renderList();
  }
  function foldAll() {
    const close = groupKeys.some((k) => !collapsed.has(k));
    for (const k of groupKeys) { if (close) collapsed.add(k); else collapsed.delete(k); }
    setState({ collapsed: [...collapsed] });
    renderList();
  }
  function syncFold() {
    foldBtn.hidden = groupKeys.length < 2;
    const anyOpen = groupKeys.some((k) => !collapsed.has(k));
    foldBtn.textContent = anyOpen ? 'Collapse all' : 'Expand all';
    foldBtn.title = anyOpen ? 'Fold every folder away, to see them all at once' : 'Open every folder';
  }

  /** Website: the folders of each category, each with its sounds and an Add button. */
  function renderFolders() {
    clear(listEl);
    const term = search.value.trim().toLowerCase();
    const all = library.list();
    let shown = 0;
    const section = (g, label, items) => {
      const open = groupHead(g, label, items.length, [
        addButton(g),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'More', 'aria-label': `More for ${label}`, onclick: (e) => showMenu(e.currentTarget, folderItems(g), { align: 'end' }) }, icon('more'))]);
      shown += items.length;
      if (!open) return;
      if (!items.length) listEl.append(h('p', { class: 'meta lb-groupnone' }, 'No sounds here yet.'));
      for (const s of items) listEl.append(makeRow(s));
    };
    for (const c of site.CATEGORIES) {
      if (kind !== 'all' && c.kind !== kind) continue;
      for (const g of library.groups(c.kind)) {
        const items = all.filter((s) => s.group === g && matches(s, term));
        if (term && !items.length) continue;
        const name = g.includes('/') ? site.folderName(g) : c.label;
        section(g, kind === 'all' && g.includes('/') ? `${c.label} › ${name}` : name, items);
      }
    }
    const loose = all.filter((s) => !site.kindOfDir(s.group || '') && (kind === 'all' || s.kind === kind) && matches(s, term));
    if (loose.length) {
      if (groupHead('(loose)', 'Outside the three folders', loose.length)) for (const s of loose) listEl.append(makeRow(s));
      shown += loose.length;
    }
    if (!all.length && !term) {
      listEl.prepend(h('div', { class: 'empty lb-siteempty' },
        h('strong', null, 'No sounds on GitHub yet'),
        h('span', null, 'Each folder below is a playlist, an ambience playlist or a bank of pads. Press its Add button, drop MP3s on GitHub’s upload page and commit; they appear here a minute later.')));
    } else if (term && !shown) {
      listEl.append(h('p', { class: 'meta lb-none' }, `No sounds match “${search.value}”.`));
    }
  }

  function renderList() {
    groupKeys = [];
    if (SITE) renderFolders(); else renderSounds();
    syncFold();
  }

  function renderSounds() {
    clear(listEl);
    const term = search.value.trim().toLowerCase();
    const all = library.list();
    const items = all.filter((s) => (kind === 'all' || s.kind === kind) && matches(s, term));
    if (!all.length) {
      listEl.append(h('div', { class: 'empty' },
        h('strong', null, 'Your library is empty'),
        h('span', null, 'Drop audio files here, paste a link to a video or an MP3, or search YouTube. Everything you add can be trimmed, flagged and put on pads.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => fileIn.click() }, icon('upload'), 'Add files'),
          h('button', { class: 'btn', type: 'button', onclick: () => linkDialog() }, icon('link'), 'From a link'))));
      return;
    }
    if (!items.length) {
      listEl.append(h('p', { class: 'meta lb-none' }, term ? `No sounds match “${search.value}”.` : `No ${KIND_LABEL[kind]?.toLowerCase() || ''} sounds yet.`));
      return;
    }
    // grouped by kind, each group folding away like the website's folders
    for (const [k, label] of [['music', 'Music'], ['ambience', 'Ambience'], ['effect', 'Effects'], [null, 'Other']]) {
      const group = items.filter((s) => (k ? s.kind === k : !KIND_LABEL[s.kind]));
      if (!group.length) continue;
      if (groupHead(`kind:${k || 'other'}`, label, group.length)) for (const s of group) listEl.append(makeRow(s));
    }
  }

  function makeRow(s) {
    {
      const playing = playState(s);
      const row = h('div', {
        class: `lb-row ${s.id === selectedId ? 'is-selected' : ''}`, role: 'option', 'aria-selected': String(s.id === selectedId), tabindex: 0, draggable: true, 'data-id': s.id,
        onclick: (e) => { if (!e.target.closest('button')) select(s.id); },
        onkeydown: (e) => { if (e.key === 'Enter') select(s.id); },
        oncontextmenu: (e) => { e.preventDefault(); rowMenu(s, { x: e.clientX, y: e.clientY }); },
        ondragstart: (e) => { e.dataTransfer.setData('application/x-dm-sound', s.id); e.dataTransfer.setData('text/plain', s.name); e.dataTransfer.effectAllowed = 'copy'; },
      },
      h('button', { class: `btn-icon btn-sm lb-play ${playing ? 'is-on' : ''}`, type: 'button', title: PLAY_HINT[s.kind], 'aria-label': `${PLAY_HINT[s.kind]}: ${s.name}`, onclick: () => playForTable(s) }, icon(playing ? 'stop' : 'play')),
      h('span', { class: 'lb-name' },
        h('span', { class: 'truncate' }, s.name),
        h('span', { class: 'meta truncate' }, [KIND_LABEL[s.kind], s.flags?.length ? `${s.flags.length} ${s.flags.length === 1 ? 'flag' : 'flags'}` : null, s.repeat === 0 ? 'loops' : s.repeat > 1 ? `plays ${s.repeat}×` : null, s.status === 'analyzing' ? 'reading…' : null].filter(Boolean).join(' · '))),
      h('span', { class: 'lb-dur num' }, fmtTime(s.duration)),
      s.kind === 'effect' ? null : queueButton(s),
      s.kind === 'effect' ? null : onTopButton(s),
      previewButton(s));
      return row;
    }
  }

  function rowMenu(s, at) {
    const bank = board.active();
    const empty = ROWS.slice(1).flatMap((r) => r.keys).filter((k) => !board.reserved(k) && !bank.pads[k]).slice(0, 14);
    // on the website a playlist's tracks are its folder's files (move the sound there instead)
    const lists = SITE ? [] : playlists.list().filter((pl) => (pl.kind === 'ambience') === (s.kind === 'ambience')).map((pl) => ({ label: pl.name, onClick: () => {
      playlists.addTracks(pl.id, [s.id]);
      toast(`Added to ${pl.name}.`, { type: 'ok' });
    } }));
    showMenu(at, [
      { label: PLAY_HINT[s.kind], icon: 'play', onClick: () => playForTable(s) },
      s.kind === 'effect' ? null : { label: engine.music.queued === s.id ? 'Take it off the queue' : 'Play next', icon: 'next', onClick: () => (engine.music.queued === s.id ? engine.clearNext() : engine.queueNext(s)) },
      s.kind === 'effect' ? null : { label: engine.layerOn(s.id) ? 'Stop it on top' : 'Play on top of what is playing', icon: engine.layerOn(s.id) ? 'stop' : 'layers', onClick: () => engine.toggleLayer(s.id) },
      { label: engine.previewing(s.id) ? 'Stop the preview' : 'Preview', icon: 'headphones', hint: engine.previewRoute === 'device' ? 'only you' : '', onClick: () => engine.togglePreview(s) },
      { label: 'Open in the editor', icon: 'edit', onClick: () => select(s.id) },
      SITE ? null : { label: 'Volume…', icon: 'volume', hint: `${Math.round((s.volume ?? 1) * 100)}%`, onClick: () => volumeDialog(s) },
      lists.length ? { label: 'Add to a playlist', icon: 'playlist', submenu: lists } : null,
      empty.length ? { label: `Put on a pad (${bank.name})`, icon: 'keyboard', submenu: empty.map((k) => ({ label: `Key ${k}`, onClick: () => {
        board.setPad(k, { sound: s.id, label: s.name, mode: s.repeat === 0 ? 'toggle' : 'once', volume: 1 });
        toast(`${s.name} is on ${k}. Alt+${k} fires it.`, { type: 'ok' });
      } })) } : null,
      ...(SITE ? [{ sep: true }, ...soundItems(s)] : []),
      SITE ? null : { label: 'Kind', icon: 'wave', submenu: Object.entries(KIND_LABEL).map(([k, l]) => ({ label: l, checked: s.kind === k, onClick: () => library.update(s.id, { kind: k, ...(k === 'ambience' && s.repeat === 1 ? { repeat: 0, loopFade: 1.5 } : {}), ...(k !== 'ambience' && s.repeat === 0 ? { repeat: 1 } : {}) }) })) },
      SITE ? null : { label: 'Download as MP3', icon: 'download', onClick: () => { const [a, b] = library.region(s); location.href = library.exportUrl(s.id, { start: a, end: b }); } },
    ]);
  }

  function select(id) {
    selectedId = id;
    setState({ selected: id });
    narrowView = 'edit';
    if (!library.get(id)) { selectedId = null; narrowView = 'list'; }
    render();
    if (selectedId) {
      editor.open(id);
      const row = listEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }
  }

  function layout() {
    const narrow = root.clientWidth < 820;
    root.classList.toggle('is-narrow', narrow);
    root.classList.toggle('show-edit', narrow && narrowView === 'edit' && !!selectedId);
    detailEmpty.hidden = !!selectedId;
    editor.el.hidden = !selectedId;
    editor.resize();
  }

  function render() {
    renderKinds();
    renderList();
    layout();
  }

  // ---- downloads ----------------------------------------------------------------------
  function renderJobs() {
    clear(jobsEl);
    if (SITE) {
      const p = site.publishState();
      if (p.state !== 'idle') {
        const text = { waiting: 'Watching GitHub for your upload', publishing: 'GitHub is publishing your changes (about a minute)', failed: 'GitHub couldn’t publish the last change' }[p.state];
        jobsEl.append(h('div', { class: `lb-job ${p.state === 'failed' ? 'is-error' : ''}` },
          icon(p.state === 'failed' ? 'warning' : 'refresh', 'icon-sm'),
          h('span', { class: 'lb-jobtitle truncate' }, text),
          p.run?.html_url ? h('a', { class: 'btn btn-sm', href: p.run.html_url, target: '_blank', rel: 'noopener' }, icon('external'), 'On GitHub') : h('span'),
          h('span'),
          h('span'),
          p.state === 'failed' ? null : h('div', { class: 'progress is-indeterminate' }, h('i'))));
      }
      jobsEl.hidden = !jobsEl.childElementCount;
      return;
    }
    const jobs = library.jobs().filter((j) => j.status !== 'cancelled');
    if (uploading) {
      jobsEl.append(h('div', { class: 'lb-job' },
        icon('upload', 'icon-sm'),
        h('span', { class: 'lb-jobtitle truncate' }, `Uploading ${uploading.count} ${uploading.count === 1 ? 'file' : 'files'}`),
        h('span', { class: 'meta num' }, `${Math.round(uploading.progress * 100)}%`),
        h('div', { class: 'progress', style: { '--p': `${uploading.progress * 100}%` } }, h('i'))));
    }
    for (const j of jobs.slice(0, 4)) {
      const active = !['done', 'error'].includes(j.status);
      const pct = j.status === 'downloading' ? ` ${Math.round(j.progress * 100)}%` : '';
      jobsEl.append(h('div', { class: `lb-job is-${j.status}` },
        icon(j.status === 'error' ? 'warning' : j.status === 'done' ? 'check' : 'download', 'icon-sm'),
        h('span', { class: 'lb-jobtitle truncate', title: j.url }, j.title || j.url),
        h('span', { class: `meta lb-jobstatus ${j.status === 'error' ? 'is-error' : ''}`, title: j.error || '' }, j.status === 'error' ? (j.errorCode === 'bot-check' ? 'YouTube wants a sign-in' : 'Failed') : `${STATUS[j.status] || j.status}${pct}`),
        active ? h('div', { class: `progress ${j.status === 'downloading' && j.progress > 0 ? '' : 'is-indeterminate'}`, style: { '--p': `${j.progress * 100}%` } }, h('i')) : null,
        j.status === 'done' && j.soundId ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => select(j.soundId) }, 'Open') : null,
        j.status === 'error' && j.errorCode === 'bot-check' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('youtube')) }, 'Fix in Settings') : null,
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: active ? 'Cancel' : 'Dismiss', 'aria-label': active ? 'Cancel the download' : 'Dismiss', onclick: () => library.cancelJob(j.id).catch(() => {}) }, icon('close'))));
      if (j.status === 'error' && j.error) jobsEl.append(h('p', { class: 'lb-joberror' }, j.error));
    }
    jobsEl.hidden = !jobsEl.childElementCount;
  }

  // ---- add from a link -------------------------------------------------------------------
  function linkDialog(prefill = '') {
    const url = h('input', { class: 'input', type: 'url', placeholder: 'https://www.youtube.com/watch?v=… or a link to an MP3', value: prefill });
    const name = h('input', { class: 'input', placeholder: 'Leave empty to use its title' });
    let chosenKind = null;
    const seg = h('div', { class: 'seg' });
    for (const [k, l] of [[null, 'Guess'], ['music', 'Music'], ['ambience', 'Ambience'], ['effect', 'Effect']]) {
      seg.append(h('button', { type: 'button', 'aria-pressed': String(chosenKind === k), onclick: (e) => {
        chosenKind = k;
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
      } }, l));
    }
    const from = h('input', { class: 'input input-sm num', placeholder: '0:00', 'aria-label': 'From' });
    const to = h('input', { class: 'input input-sm num', placeholder: 'end', 'aria-label': 'To' });
    const err = h('p', { class: 'field-error', hidden: true });
    openDialog({
      title: 'Add a sound from a link',
      body: [
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Link'), url, h('span', { class: 'field-hint' }, 'YouTube, SoundCloud, Bandcamp, archive.org, a direct MP3 or WAV, and hundreds of other sites.')),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), seg),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Only part of it (optional)'), h('div', { class: 'lb-range' }, h('span', { class: 'muted' }, 'From'), from, h('span', { class: 'muted' }, 'to'), to),
          h('span', { class: 'field-hint' }, 'For a ten-hour ambience video, take just the first twenty minutes: from 0:00 to 20:00.')),
        err,
      ],
      actions: [
        { label: 'Cancel' },
        { label: 'Download', kind: 'primary', onClick: async () => {
          const u = url.value.trim();
          if (!/^https?:\/\//i.test(u)) { err.textContent = 'Paste a full link that starts with https://'; err.hidden = false; return false; }
          const start = from.value.trim() ? parseTime(from.value) : null;
          const end = to.value.trim() ? parseTime(to.value) : null;
          if ((from.value.trim() && start == null) || (to.value.trim() && end == null)) { err.textContent = 'Write times like 1:30 or 0:00:45.'; err.hidden = false; return false; }
          try {
            await library.download({ url: u, name: name.value.trim(), kind: chosenKind, start, end });
            toast(`Downloading from ${hostOf(u)}. It appears in the library when it's ready.`);
          } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
        } },
      ],
    });
  }

  render();
  renderJobs();
  if (selectedId && library.get(selectedId)) editor.open(selectedId);
  search.addEventListener('input', renderList);
  let liveKey = '';
  const offs = [
    bus.on('library', () => { render(); editor.refresh(); }),
    bus.on('library:sound', (s) => {
      const row = listEl.querySelector(`[data-id="${CSS.escape(s.id)}"] .lb-name .truncate`);
      if (row && row.textContent !== s.name) row.textContent = s.name;
    }),
    bus.on('jobs', renderJobs),
    bus.on('audio', () => {
      syncPreviewButtons(listEl);
      const key = `${engine.music.voice?.sound.id}|${engine.music.voice?.state}|${[...engine.layers.keys()].join(',')}|${engine.effectCount()}`;
      if (key !== liveKey) {
        liveKey = key;
        for (const row of listEl.querySelectorAll('.lb-row')) {
          const s = library.get(row.dataset.id);
          const btn = row.querySelector('.lb-play');
          if (!s || !btn) continue;
          const on = playState(s);
          btn.classList.toggle('is-on', on);
          setIcon(btn.querySelector('svg'), on ? 'stop' : 'play');
        }
      }
    }),
    bus.on('audio:route', () => syncPreviewButtons(listEl)),
    bus.on('library:open', (id) => select(id)),
    bus.on('site:publish', renderJobs),
    bus.on('library:moved', ({ from, to }) => {
      if (selectedId && (selectedId === from || selectedId.startsWith(`${from}/`))) select(to + selectedId.slice(from.length));
    }),
    bus.on('library:link', (u) => linkDialog(u)),
  ];
  return {
    show() { layout(); },
    resize() { layout(); },
    destroy() { offs.forEach((off) => off()); editor.destroy(); },
  };
}
