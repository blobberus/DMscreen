// The shortcut sheet (Alt+/): every action and its keys, grouped, plus how single keys work.
import { h } from '../core/dom.js';
import { keys, GROUPS } from '../core/keys.js';
import { kbd } from '../core/kbd.js';
import { state } from '../core/state.js';
import { openDialog } from '../core/ui.js';

let open = null;

export function openShortcuts() {
  if (open) { open.close(); return; }
  const single = state.get('settings').singleKeys;
  const groups = {};
  for (const a of keys.list()) (groups[a.group] ||= []).push(a);
  const body = h('div', { class: 'sc' },
    h('p', { class: 'muted' }, single
      ? 'Alt plus a key works everywhere, even while you type. When you are not typing, the key alone does the same thing. Letters without an action fire that key’s pad in the Soundboard.'
      : 'Alt plus a key works everywhere, even while you type. Letters without an action fire that key’s pad in the Soundboard.'),
    h('div', { class: 'sc-cols' }, Object.entries(GROUPS).map(([g, label]) => {
      const list = groups[g] || [];
      if (g === 'playlist' || g === 'flag') {
        const first = list[0];
        const last = list[list.length - 1];
        return h('section', { class: 'sc-group' }, h('h3', { class: 'sc-h' }, label),
          h('div', { class: 'sc-row' }, h('span', null, g === 'playlist' ? 'Start playlist 1 to 9' : 'Jump to flag 1 to 9 of the playing track'),
            h('span', { class: 'sc-keys' }, kbd(keys.combo(first.id)), h('span', { class: 'faint' }, 'to'), kbd(keys.combo(last.id)))));
      }
      return h('section', { class: 'sc-group' }, h('h3', { class: 'sc-h' }, label),
        list.map((a) => h('div', { class: 'sc-row' }, h('span', null, a.label), h('span', { class: 'sc-keys' }, kbd(keys.combo(a.id)) || h('span', { class: 'faint' }, 'none'), a.alias && single ? h('span', { class: 'faint' }, 'or') : null, a.alias && single ? kbd(a.alias) : null))));
    })),
    h('p', { class: 'meta' }, 'In the sound editor: Space plays, F drops a flag, I and O trim, [ and ] step between flags. Change any key in Settings, Keys.'));
  open = openDialog({ title: 'Shortcuts', body, wide: true, onClose: () => { open = null; } });
}
