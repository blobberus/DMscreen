// Playlists: finding and starting tracks. Music and ambience playlists are listed apart; each playlist's
// tracks have a play button (start the playlist from there, ending what was playing) and an on-top
// button (play just that sound over whatever is playing). What is playing is shown in the Console.
// Drag sounds in from the library; drag tracks to reorder.
// On the website each playlist is a folder in sounds/Music or sounds/Ambience: its tracks are the files
// in it, in file-name order, and adding sounds opens GitHub's upload page for that folder.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { library } from '../core/library.js';
import { pickSound, confirmDialog, showMenu, toast } from '../core/ui.js';
import { fmtTime, fmtDuration } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { previewButton, onTopButton, syncPreviewButtons } from '../audio/cue.js';
import { playlists, REPEAT } from '../audio/playlists.js';
import { SITE } from '../core/mode.js';
import { newFolder, folderItems, soundItems, addButton, explainFailure } from '../dialogs/files.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function createPlaylists({ el, getState, setState }) {
  let selected = getState().selected || null;
  const lists = {
    music: h('div', { class: 'pl-list', role: 'listbox', 'aria-label': 'Music playlists' }),
    ambience: h('div', { class: 'pl-list', role: 'listbox', 'aria-label': 'Ambience playlists' }),
  };
  const editor = h('div', { class: 'pl-editor' });
  const sideHead = (kind) => h('div', { class: 'pl-sidehead' },
    h('h2', { class: 'pl-h' }, kind === 'ambience' ? 'Ambience' : 'Music'),
    h('button', { class: 'btn btn-sm', type: 'button', title: kind === 'ambience' ? 'New ambience playlist' : 'New playlist', onclick: () => newPlaylist(kind) }, icon('plus'), 'New'));
  const root = h('div', { class: 'pl' },
    h('aside', { class: 'pl-side' }, sideHead('music'), lists.music, sideHead('ambience'), lists.ambience),
    editor);
  el.append(root);

  async function newPlaylist(kind, name = null) {
    if (SITE) { const dir = await newFolder(kind === 'ambience' ? 'Ambience' : 'Music'); if (dir) select(dir); return; }
    const pl = playlists.create(name || (kind === 'ambience' ? 'New ambience' : 'New playlist'), kind);
    select(pl.id);
    if (!name) requestAnimationFrame(() => editor.querySelector('.pl-name')?.select());
  }

  function select(id) {
    selected = id;
    setState({ selected: id });
    renderList();
    renderEditor();
  }

  function renderList() {
    if (!selected || !playlists.get(selected)) selected = playlists.list()[0]?.id || null;
    for (const kind of ['music', 'ambience']) {
      const box = lists[kind];
      clear(box);
      const group = playlists.ofKind(kind);
      if (!group.length) {
        box.append(h('p', { class: 'meta pl-none' }, kind === 'ambience' ? 'No ambience playlists yet.' : 'No playlists yet.'));
        continue;
      }
      for (const pl of group) box.append(listRow(pl));
    }
  }

  function listRow(pl) {
    return h('button', {
      class: `pl-row ${pl.id === selected ? 'is-selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(pl.id === selected),
      onclick: () => select(pl.id),
      ondblclick: () => playlists.play(pl.id),
    },
    h('span', { class: 'pl-key' }, pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : h('span', { class: 'faint' }, '–')),
    h('span', { class: 'pl-rowtext' },
      h('span', { class: `pl-rowname truncate ${playlists.playing(pl) ? 'is-live' : ''}` }, pl.name),
      h('span', { class: 'meta' }, `${plural(pl.tracks.length, 'track')} · ${fmtDuration(playlists.duration(pl))}`)));
  }

  function renderEditor() {
    clear(editor);
    const pl = selected && playlists.get(selected);
    if (!pl) {
      editor.append(h('div', { class: 'empty' },
        h('strong', null, 'Make a playlist for each kind of scene'),
        h('span', null, SITE
          ? 'Each folder in sounds/Music on GitHub is a playlist: a tavern, the road, a fight, a boss. Its MP3s are the tracks and it gets a number key: Alt+1 starts the first. Folders in sounds/Ambience are ambience playlists.'
          : 'A tavern, the road, a fight, a boss. Each gets its tracks and a number key: Alt+1 starts the first. Ambience playlists are kept apart from the music.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newPlaylist('music', SITE ? null : 'Tavern') }, icon('plus'), 'New playlist'),
          h('button', { class: 'btn', type: 'button', onclick: () => newPlaylist('ambience', SITE ? null : 'Tavern') }, icon('plus'), 'New ambience playlist'))));
      return;
    }
    const isAmb = pl.kind === 'ambience';
    const kind = isAmb ? 'ambience' : 'music';
    const playing = playlists.playing(pl);
    const name = h('input', { class: 'input pl-name', value: pl.name, 'aria-label': isAmb ? 'Ambience playlist name' : 'Playlist name', maxlength: 60 });
    if (SITE) {
      // the name is the folder's: renaming it renames the folder on GitHub
      name.title = 'Rename the folder on GitHub';
      name.addEventListener('change', async () => {
        const next = name.value.trim();
        if (!next || next === pl.name) { name.value = pl.name; return; }
        name.disabled = true;
        try {
          select(await library.renameFolder(pl.dir, next));
          toast(`Renamed to ${next}.`, { type: 'ok' });
        } catch (e) { name.value = pl.name; name.disabled = false; explainFailure(e); }
      });
    } else {
      name.addEventListener('input', () => playlists.update(pl.id, { name: name.value.trim() || 'Untitled' }));
      name.addEventListener('change', renderList);
    }
    const keySel = h('select', { class: 'select pl-keysel', 'aria-label': 'Number key' },
      h('option', { value: '' }, 'No key'),
      Array.from({ length: 9 }, (_, i) => i + 1).map((n) => {
        const owner = playlists.byKey(n);
        return h('option', { value: String(n), selected: pl.key === n }, `Alt+${n}${owner && owner.id !== pl.id ? ` (from ${owner.name})` : ''}`);
      }));
    keySel.addEventListener('change', () => { playlists.update(pl.id, { key: keySel.value ? Number(keySel.value) : null }); renderList(); });
    const playBtn = h('button', { class: `btn ${playing ? '' : 'btn-primary'}`, type: 'button', title: playing ? 'Start it again from the first track' : 'Start it, ending what is playing', onclick: () => playlists.play(pl.id) }, icon('play'), playing ? 'Playing · restart' : 'Play');
    const more = h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'More', title: 'More', onclick: (e) => showMenu(e.currentTarget, SITE ? folderItems(pl.dir, { onMoved: select }) : [
      { label: 'Duplicate', icon: 'plus', onClick: () => {
        const copy = playlists.create(`${pl.name} (copy)`, kind);
        playlists.update(copy.id, { tracks: pl.tracks.slice(), shuffle: pl.shuffle, repeat: pl.repeat, crossfade: pl.crossfade });
        select(copy.id);
      } },
      { label: isAmb ? 'Make it a music playlist' : 'Make it an ambience playlist', icon: isAmb ? 'playlist' : 'wave', onClick: () => {
        playlists.update(pl.id, { kind: isAmb ? undefined : 'ambience' });
        renderList();
        renderEditor();
      } },
      { label: 'Delete this playlist', icon: 'trash', onClick: async () => {
        if (await confirmDialog(`Delete “${pl.name}”? Its sounds stay in the library.`, { okLabel: 'Delete', danger: true })) { playlists.remove(pl.id); select(null); }
      } },
    ], { align: 'end' }) }, icon('more'));
    editor.append(h('header', { class: 'pl-head' }, name, h('label', { class: 'pl-keylabel' }, h('span', { class: 'meta' }, 'Key'), keySel), playBtn, more));

    const tracks = h('ol', { class: 'pl-tracks', role: 'list' });
    pl.tracks.forEach((id, i) => tracks.append(trackRow(pl, id, i)));
    if (!pl.tracks.length) {
      tracks.append(h('li', { class: 'pl-drop-empty' }, SITE
        ? `No ${kind} in this folder yet. Add MP3s to it on GitHub.`
        : `Drag ${kind} here from the library, or add it with the button.`));
    }
    if (!SITE) wireDrop(tracks, pl);
    editor.append(h('section', { class: 'pl-section' },
      h('div', { class: 'pl-sechead' },
        h('h3', { class: 'pl-h' }, isAmb ? 'Ambience' : 'Music'),
        h('span', { class: 'meta num' }, `${plural(pl.tracks.length, 'track')} · ${fmtDuration(playlists.duration(pl))}`),
        h('span', { class: 'pl-spacer' }),
        SITE ? addButton(pl.dir, isAmb ? 'Add ambience' : 'Add music') : h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          const ids = await pickSound({ library, title: `Add ${kind} to ${pl.name}`, kind, multi: true });
          if (ids) playlists.addTracks(pl.id, ids);
        } }, icon('plus'), isAmb ? 'Add ambience' : 'Add music')),
      tracks,
      pl.tracks.length ? h('p', { class: 'meta pl-legend' },
        icon('play', 'icon-sm'), h('span', null, 'plays the playlist from that track, ending what is playing.'),
        icon('layers', 'icon-sm'), h('span', null, 'plays just that sound on top. The Console lists everything playing.')) : null,
      SITE && pl.tracks.length > 1 ? h('p', { class: 'meta pl-order' }, 'Tracks play in file-name order. Rename them to start with 01, 02… to change it.') : null,
      options(pl)));
  }

  function trackRow(pl, id, i) {
    const s = library.get(id);
    const current = engine.music.playlistId === pl.id && engine.music.voice?.sound.id === id;
    const [a, b] = s ? library.region(s) : [0, 0];
    const row = h('li', { class: `pl-track ${current ? 'is-live' : ''}`, draggable: !SITE, 'data-index': i },
      SITE ? h('span') : h('span', { class: 'pl-grip', 'aria-hidden': 'true' }, icon('grip', 'icon-sm')),
      h('span', { class: 'pl-n num faint' }, String(i + 1)),
      h('span', { class: 'pl-tname truncate' }, s ? s.name : 'Missing sound'),
      s?.flags?.length ? h('span', { class: 'meta pl-flagcount', title: `${s.flags.length} flags` }, icon('flag', 'icon-sm'), String(s.flags.length)) : h('span'),
      h('span', { class: 'pl-dur num meta' }, s ? fmtTime(b - a) : '–'),
      s ? previewButton(s) : h('span'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Play from here, ending what is playing', 'aria-label': `Play from ${s?.name}`, disabled: !s, onclick: () => playlists.play(pl.id, { index: i }) }, icon('play')),
      s ? onTopButton(s) : h('span'),
      SITE ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Rename, move or delete', 'aria-label': `More for ${s?.name}`, disabled: !s, onclick: (e) => showMenu(e.currentTarget, soundItems(s), { align: 'end' }) }, icon('more'))
        : h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove from the playlist', 'aria-label': `Remove ${s?.name}`, onclick: () => {
          const tracks = pl.tracks.slice();
          tracks.splice(i, 1);
          playlists.update(pl.id, { tracks });
        } }, icon('close')));
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-dm-track', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) playlists.play(pl.id, { index: i }); });
    return row;
  }

  function options(pl) {
    const deck = engine.music;
    const mine = () => deck.playlistId === pl.id;
    const shuffle = h('input', { type: 'checkbox', checked: !!pl.shuffle });
    shuffle.addEventListener('change', () => { playlists.update(pl.id, { shuffle: shuffle.checked }); if (mine()) deck.setShuffle(shuffle.checked); });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Repeat' });
    for (const [mode, label] of [['off', 'Once'], ['all', 'Repeat all'], ['one', 'Repeat track']]) {
      seg.append(h('button', { type: 'button', 'aria-pressed': String((pl.repeat || 'all') === mode), title: REPEAT[mode], onclick: () => {
        playlists.update(pl.id, { repeat: mode });
        if (mine()) deck.setRepeat(mode);
        renderEditor();
      } }, label));
    }
    const xf = h('input', { class: 'range', type: 'range', min: 0, max: 10, step: 0.5, value: pl.crossfade ?? 3, 'aria-label': 'Crossfade seconds' });
    const xfNum = h('span', { class: 'num meta' });
    const sync = () => { xf.style.setProperty('--fill', `${(xf.value / 10) * 100}%`); xfNum.textContent = `${Number(xf.value).toFixed(1)} s`; };
    xf.addEventListener('input', () => { sync(); playlists.update(pl.id, { crossfade: Number(xf.value) }); if (mine()) deck.crossfade = Number(xf.value); });
    sync();
    return h('div', { class: 'pl-opts' },
      h('label', { class: 'switch' }, shuffle, h('span', null, 'Shuffle')),
      seg,
      h('label', { class: 'pl-xf' }, h('span', { class: 'muted' }, 'Crossfade'), xf, xfNum));
  }

  function wireDrop(list, pl) {
    list.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('application/x-dm-sound') || t.includes('application/x-dm-track')) {
        e.preventDefault();
        list.classList.add('is-over');
      }
    });
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) list.classList.remove('is-over'); });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('is-over');
      const target = e.target.closest('[data-index]');
      const at = target ? Number(target.dataset.index) : null;
      const sid = e.dataTransfer.getData('application/x-dm-sound');
      const from = e.dataTransfer.getData('application/x-dm-track');
      if (sid) {
        playlists.addTracks(pl.id, [sid], at);
        toast(`Added ${library.get(sid)?.name} to ${pl.name}.`, { type: 'ok' });
      } else if (from !== '') {
        const tracks = pl.tracks.slice();
        const [moved] = tracks.splice(Number(from), 1);
        tracks.splice(at == null ? tracks.length : at, 0, moved);
        playlists.update(pl.id, { tracks });
      }
    });
  }

  renderList();
  renderEditor();
  let liveKey = '';
  const offs = [
    bus.on('state:playlists', () => { renderList(); if (!editor.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') renderEditor(); }),
    bus.on('library', () => { renderList(); renderEditor(); }),
    bus.on('audio:route', () => syncPreviewButtons(el)),
    bus.on('audio', () => {
      syncPreviewButtons(el);
      const key = `${engine.music.playlistId}|${engine.music.voice?.sound.id}|${[...engine.layers.keys()].join(',')}`;
      if (key !== liveKey) { liveKey = key; renderList(); if (!editor.contains(document.activeElement)) renderEditor(); }
    }),
  ];
  return { destroy() { offs.forEach((off) => off()); } };
}
