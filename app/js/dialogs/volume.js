// A sound's own volume, from its menu: the level it plays at everywhere (playlists, on top, pads, the
// library). It changes as you drag, on the sound if it is playing, and is kept with the sound (on the
// website, in the synced setup) when you press Done. Up to 300%. The editor's Volume slider sets the same thing.
import { h } from '../core/dom.js';
import { library, MAX_VOLUME } from '../core/library.js';
import { openDialog } from '../core/ui.js';
import { engine } from '../audio/engine.js';
import { previewButton, syncPreviewButtons } from '../audio/cue.js';
import { bus } from '../core/bus.js';

export function volumeDialog(sound) {
  const before = Math.round(Math.min((library.get(sound.id) || sound).volume ?? 1, MAX_VOLUME) * 100);
  const range = h('input', { class: 'range', type: 'range', min: 0, max: MAX_VOLUME * 100, step: 1, value: before, 'aria-label': `Volume of ${sound.name}` });
  const num = h('span', { class: 'num vol-num' }, `${before}%`);
  const set = (pct) => {
    range.value = pct;
    range.style.setProperty('--fill', `${pct / MAX_VOLUME}%`);
    num.textContent = `${pct}%`;
    library.update(sound.id, { volume: pct / 100 });          // the engine applies it to what is playing
  };
  range.style.setProperty('--fill', `${before / MAX_VOLUME}%`);
  range.addEventListener('input', () => set(Number(range.value)));
  const body = h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'How loud this sound plays wherever it is used: in playlists, on top, on pads and in the library. 100% is the file as it is.'),
    h('div', { class: 'vol-row' }, range, num, previewButton(sound)));
  const off = bus.on('audio', () => syncPreviewButtons(body));
  let kept = false;
  openDialog({
    title: `Volume: ${sound.name}`,
    body,
    actions: [
      { label: 'Cancel' },
      { label: 'Reset to 100%', onClick: () => { set(100); return false; } },
      { label: 'Done', kind: 'primary', onClick: () => { kept = true; } },
    ],
    onClose: () => {
      off();
      if (engine.previewing(sound.id)) engine.stopPreview();
      if (!kept && Number(range.value) !== before) set(before);      // Cancel, Esc or the close button
    },
    initialFocus: '.range',
  });
}
