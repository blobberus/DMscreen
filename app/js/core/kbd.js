// A keycap for a combo ("Alt+P"), or null when the action has no key.
import { h } from './dom.js';
import { comboParts } from './keys.js';

export function kbd(combo, cls = '') {
  const parts = comboParts(combo);
  return parts.length ? h('kbd', { class: `kbd ${cls}`.trim() }, parts.join('+')) : null;
}
