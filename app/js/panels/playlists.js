// Playlists: for each scene, the music (in order or shuffled) and the ambience that plays under it,
// started with its number key. Drag sounds in from the library; drag tracks to reorder.
// On the website each playlist is a folder in sounds/Music: its tracks are the files in it, in
// file-name order, and adding music opens GitHub's upload page for that folder.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { library } from '../core/library.js';
import { pickSound, confirmDialog, showMenu, toast } from '../core/ui.js';
import { fmtTime, fmtDuration } from '../core/util.js';
import { engine } from '../audio/engine.js';
import { playlists, REPEAT } from '../audio/playlists.js';
import { SITE } from '../core/mode.js';
import { newFolder, folderItems, soundItems, addButton, explainFailure } from '../dialogs/files.js';

export default function createPlaylists({ el, getState, setState }) {
  let selected = getState().selected || null;
  const listEl = h('div', { class: 'pl-list', role: 'listbox', 'aria-label': 'Playlists' });
  const editor = h('div', { class: 'pl-editor' });
  const root = h('div', { class: 'pl' },
    h('aside', { class: 'pl-side' },
      h('div', { class: 'pl-sidehead' }, h('h2', { class: 'pl-h' }, 'Playlists'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          if (SITE) { const dir = await newFolder('Music'); if (dir) select(dir); return; }
          const pl = playlists.create();
          select(pl.id);
          requestAnimationFrame(() => editor.querySelector('.pl-name')?.select());
        } }, icon('plus'), 'New')),
      listEl),
    editor);
  el.append(root);

  function select(id) {
    selected = id;
    setState({ selected: id });
    renderList();
    renderEditor();
  }

  function renderList() {
    clear(listEl);
    const list = playlists.list();
    if (!selected || !playlists.get(selected)) selected = list[0]?.id || null;
    if (!list.length) {
      listEl.append(h('p', { class: 'meta pl-none' }, 'No playlists yet.'));
      return;
    }
    for (const pl of list) {
      const playing = engine.music.playlistId === pl.id && engine.music.voice;
      const row = h('button', {
        class: `pl-row ${pl.id === selected ? 'is-selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(pl.id === selected),
        onclick: () => select(pl.id),
        ondblclick: () => playlists.play(pl.id),
      },
      h('span', { class: 'pl-key' }, pl.key ? h('kbd', { class: 'kbd' }, String(pl.key)) : h('span', { class: 'faint' }, '–')),
      h('span', { class: 'pl-rowtext' },
        h('span', { class: `pl-rowname truncate ${playing ? 'is-live' : ''}` }, pl.name),
        h('span', { class: 'meta' }, `${pl.tracks.length} ${pl.tracks.length === 1 ? 'track' : 'tracks'} · ${fmtDuration(playlists.duration(pl))}${pl.ambience.length ? ` · ${pl.ambience.length} ambience` : ''}`)));
      listEl.append(row);
    }
  }

  function renderEditor() {
    clear(editor);
    const pl = selected && playlists.get(selected);
    if (!pl) {
      editor.append(h('div', { class: 'empty' },
        h('strong', null, 'Make a playlist for each kind of scene'),
        h('span', null, SITE
          ? 'Each folder in sounds/Music on GitHub is a playlist: a tavern, the road, a fight, a boss. Its MP3s are the tracks, ambience of the same name plays under it, and it gets a number key: Alt+1 starts the first.'
          : 'A tavern, the road, a fight, a boss. Each gets music, the ambience under it, and a number key: Alt+1 starts the first.'),
        h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          if (SITE) { const dir = await newFolder('Music'); if (dir) select(dir); return; }
          select(playlists.create('Tavern').id);
        } }, icon('plus'), 'New playlist'))));
      return;
    }
    const playing = engine.music.playlistId === pl.id && engine.music.voice;
    const name = h('input', { class: 'input pl-name', value: pl.name, 'aria-label': 'Playlist name', maxlength: 60 });
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
    const playBtn = h('button', { class: `btn ${playing ? '' : 'btn-primary'}`, type: 'button', onclick: () => playlists.play(pl.id) }, icon('play'), playing ? 'Playing · restart' : 'Play');
    const more = h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'More', title: 'More', onclick: (e) => showMenu(e.currentTarget, SITE ? folderItems(pl.dir) : [
      { label: 'Duplicate', icon: 'plus', onClick: () => {
        const copy = playlists.create(`${pl.name} (copy)`);
        playlists.update(copy.id, { tracks: pl.tracks.slice(), ambience: structuredClone(pl.ambience), shuffle: pl.shuffle, repeat: pl.repeat, crossfade: pl.crossfade });
        select(copy.id);
      } },
      { label: 'Delete this playlist', icon: 'trash', onClick: async () => {
        if (await confirmDialog(`Delete “${pl.name}”? Its sounds stay in the library.`, { okLabel: 'Delete', danger: true })) { playlists.remove(pl.id); select(null); }
      } },
    ], { align: 'end' }) }, icon('more'));
    editor.append(h('header', { class: 'pl-head' }, name, h('label', { class: 'pl-keylabel' }, h('span', { class: 'meta' }, 'Key'), keySel), playBtn, more));

    // music
    const total = playlists.duration(pl);
    const tracks = h('ol', { class: 'pl-tracks', role: 'list' });
    pl.tracks.forEach((id, i) => tracks.append(trackRow(pl, id, i)));
    if (!pl.tracks.length) tracks.append(h('li', { class: 'pl-drop-empty' }, SITE ? 'No music in this folder yet. Add MP3s to it on GitHub.' : 'Drag music here from the library, or add it with the button.'));
    if (!SITE) wireDrop(tracks, pl, 'tracks');
    editor.append(h('section', { class: 'pl-section' },
      h('div', { class: 'pl-sechead' },
        h('h3', { class: 'pl-h' }, 'Music'),
        h('span', { class: 'meta num' }, `${pl.tracks.length} ${pl.tracks.length === 1 ? 'track' : 'tracks'} · ${fmtDuration(total)}`),
        h('span', { class: 'pl-spacer' }),
        SITE ? addButton(pl.dir, 'Add music') : h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          const ids = await pickSound({ library, title: `Add music to ${pl.name}`, kind: 'music', multi: true });
          if (ids) playlists.addTracks(pl.id, ids);
        } }, icon('plus'), 'Add music')),
      tracks,
      SITE && pl.tracks.length > 1 ? h('p', { class: 'meta pl-order' }, 'Tracks play in file-name order. Rename them to start with 01, 02… to change it.') : null,
      options(pl)));

    // ambience
    const amb = h('ul', { class: 'pl-amb', role: 'list' });
    for (const a of pl.ambience) amb.append(ambRow(pl, a));
    if (!pl.ambience.length) amb.append(h('li', { class: 'pl-drop-empty' }, 'No ambience: whatever is already playing keeps going when this playlist starts.'));
    wireDrop(amb, pl, 'ambience');
    editor.append(h('section', { class: 'pl-section' },
      h('div', { class: 'pl-sechead' },
        h('h3', { class: 'pl-h' }, 'Ambience'),
        h('span', { class: 'meta' }, 'loops under the music while this playlist plays'),
        h('span', { class: 'pl-spacer' }),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          const ids = await pickSound({ library, title: `Ambience for ${pl.name}`, kind: 'ambience', multi: true });
          if (ids) playlists.addAmbience(pl.id, ids);
        } }, icon('plus'), 'Add ambience')),
      amb));
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
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Play the playlist from here', 'aria-label': `Play from ${s?.name}`, onclick: () => playlists.play(pl.id, { index: i }) }, icon('play')),
      SITE ? h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Rename, move or delete', 'aria-label': `More for ${s?.name}`, disabled: !s, onclick: (e) => showMenu(e.currentTarget, soundItems(s), { align: 'end' }) }, icon('more'))
        : h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove from the playlist', 'aria-label': `Remove ${s?.name}`, onclick: () => {
          const tracks = pl.tracks.slice();
          tracks.splice(i, 1);
          playlists.update(pl.id, { tracks });
        } }, icon('close')));
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-dm-track', String(i)); e.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dblclick', () => playlists.play(pl.id, { index: i }));
    return row;
  }

  function ambRow(pl, a) {
    const s = library.get(a.id);
    const vol = h('input', { class: 'range', type: 'range', min: 0, max: 100, step: 1, value: Math.round((a.volume ?? 1) * 100), 'aria-label': `${s?.name} level` });
    const num = h('span', { class: 'num meta pl-ambnum' }, vol.value);
    const sync = () => { vol.style.setProperty('--fill', `${vol.value}%`); num.textContent = vol.value; };
    vol.addEventListener('input', () => {
      sync();
      a.volume = vol.value / 100;
      playlists.update(pl.id, {});
      if (engine.music.playlistId === pl.id) engine.setLayerVolume(a.id, a.volume);
    });
    sync();
    const on = engine.layerOn(a.id);
    return h('li', { class: `pl-ambrow ${on ? 'is-live' : ''}` },
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: on ? 'Stop this layer' : 'Start this layer now', 'aria-label': on ? 'Stop layer' : 'Start layer', onclick: () => engine.toggleLayer(a.id, { volume: a.volume }) }, icon(on ? 'stop' : 'play')),
      h('span', { class: 'pl-tname truncate' }, s ? s.name : 'Missing sound'),
      vol, num,
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Remove', 'aria-label': `Remove ${s?.name}`, onclick: () => playlists.update(pl.id, { ambience: pl.ambience.filter((x) => x.id !== a.id) }) }, icon('close')));
  }

  function options(pl) {
    const shuffle = h('input', { type: 'checkbox', checked: !!pl.shuffle });
    shuffle.addEventListener('change', () => { playlists.update(pl.id, { shuffle: shuffle.checked }); if (engine.music.playlistId === pl.id) engine.setShuffle(shuffle.checked); });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Repeat' });
    for (const [mode, label] of [['off', 'Once'], ['all', 'Repeat all'], ['one', 'Repeat track']]) {
      seg.append(h('button', { type: 'button', 'aria-pressed': String((pl.repeat || 'all') === mode), title: REPEAT[mode], onclick: () => {
        playlists.update(pl.id, { repeat: mode });
        if (engine.music.playlistId === pl.id) engine.setRepeat(mode);
        renderEditor();
      } }, label));
    }
    const xf = h('input', { class: 'range', type: 'range', min: 0, max: 10, step: 0.5, value: pl.crossfade ?? 3, 'aria-label': 'Crossfade seconds' });
    const xfNum = h('span', { class: 'num meta' });
    const sync = () => { xf.style.setProperty('--fill', `${(xf.value / 10) * 100}%`); xfNum.textContent = `${Number(xf.value).toFixed(1)} s`; };
    xf.addEventListener('input', () => { sync(); playlists.update(pl.id, { crossfade: Number(xf.value) }); if (engine.music.playlistId === pl.id) engine.music.crossfade = Number(xf.value); });
    sync();
    return h('div', { class: 'pl-opts' },
      h('label', { class: 'switch' }, shuffle, h('span', null, 'Shuffle')),
      seg,
      h('label', { class: 'pl-xf' }, h('span', { class: 'muted' }, 'Crossfade'), xf, xfNum));
  }

  function wireDrop(list, pl, field) {
    list.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('application/x-dm-sound') || (field === 'tracks' && t.includes('application/x-dm-track'))) {
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
        if (field === 'tracks') playlists.addTracks(pl.id, [sid], at);
        else playlists.addAmbience(pl.id, [sid]);
        toast(`Added ${library.get(sid)?.name} to ${pl.name}.`, { type: 'ok' });
      } else if (from !== '' && field === 'tracks') {
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
    bus.on('audio', () => {
      const key = `${engine.music.playlistId}|${engine.music.voice?.sound.id}|${[...engine.layers.keys()].join(',')}`;
      if (key !== liveKey) { liveKey = key; renderList(); if (!editor.contains(document.activeElement)) renderEditor(); }
    }),
  ];
  return { destroy() { offs.forEach((off) => off()); } };
}
