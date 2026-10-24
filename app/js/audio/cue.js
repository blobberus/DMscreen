// The preview (headphones) button the sound library and the playlists share, and the words for where
// a preview plays: on the output chosen in Settings, Audio, or through the main output with everything else.
import { h, icon, setIcon } from '../core/dom.js';
import { state } from '../core/state.js';
import { engine } from './engine.js';

export function previewWhere() {
  const label = state.get('settings').previewOutput?.label || 'the chosen output';
  if (engine.previewRoute === 'device') return `on ${label} only`;
  if (engine.previewRoute === 'missing') return `on ${label}, which isn't connected`;
  return 'through the main output, so the table hears it too';
}

function dress(btn, on) {
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Stop the preview' : `Preview ${previewWhere()}`;
  setIcon(btn.querySelector('svg'), on ? 'stop' : 'headphones');
}

export function previewButton(sound) {
  const btn = h('button', { class: 'btn-icon btn-sm cue-btn', type: 'button', 'data-cue': sound.id, 'aria-label': `Preview ${sound.name}`, onclick: () => engine.togglePreview(sound) }, icon('headphones'));
  dress(btn, engine.previewing(sound.id));
  return btn;
}

/** Bring the preview buttons under root up to date (on 'audio' and 'audio:route'). */
export function syncPreviewButtons(root) {
  for (const btn of root.querySelectorAll('.cue-btn')) dress(btn, engine.previewing(btn.dataset.cue));
}
