// The small per-sound buttons the sound library and the playlists share: preview (headphones), on top
// (play just this sound over whatever is playing) and play next (the one queued sound). Also the words
// for where a preview plays: on the output chosen in Settings, Audio, or through the main output with
// everything else.
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

function dressOnTop(btn, sound, on) {
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? `Stop ${sound.name} (playing on top)` : 'Play on top of what is playing';
  btn.setAttribute('aria-label', on ? `Stop ${sound.name} on top` : `Play ${sound.name} on top`);
  setIcon(btn.querySelector('svg'), on ? 'stop' : 'layers');
}

/** Play the sound over whatever is playing, or stop it if it is already on top. */
export function onTopButton(sound) {
  const btn = h('button', { class: 'btn-icon btn-sm ontop-btn', type: 'button', 'data-ontop': sound.id, 'data-name': sound.name, onclick: () => engine.toggleLayer(sound.id) }, icon('layers'));
  dressOnTop(btn, sound, engine.layerOn(sound.id));
  return btn;
}

function dressQueue(btn, name, on) {
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? `${name} plays next. Press to take it off.` : 'Play next, after the current track';
  btn.setAttribute('aria-label', on ? `Take ${name} off the queue` : `Play ${name} next`);
}

/** Queue the sound to play when the current track ends (one at a time), or take it off the queue. */
export function queueButton(sound) {
  const btn = h('button', { class: 'btn-icon btn-sm queue-btn', type: 'button', 'data-queue': sound.id, 'data-name': sound.name, onclick: () => (engine.music.queued === sound.id ? engine.clearNext() : engine.queueNext(sound)) }, icon('next'));
  dressQueue(btn, sound.name, engine.music.queued === sound.id);
  return btn;
}

/** Bring the preview, on-top and play-next buttons under root up to date (on 'audio' and 'audio:route'). */
export function syncPreviewButtons(root) {
  for (const btn of root.querySelectorAll('.cue-btn')) dress(btn, engine.previewing(btn.dataset.cue));
  for (const btn of root.querySelectorAll('.ontop-btn')) dressOnTop(btn, { name: btn.dataset.name || 'it' }, engine.layerOn(btn.dataset.ontop));
  for (const btn of root.querySelectorAll('.queue-btn')) dressQueue(btn, btn.dataset.name || 'it', engine.music.queued === btn.dataset.queue);
}
