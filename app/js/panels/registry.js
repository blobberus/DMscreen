// Every kind of panel a pane can show. Panels load on first use.
export const KINDS = {
  console: { title: 'Console', icon: 'console', hint: 'What is playing, flags and the mixer', load: () => import('./console.js') },
  pads: { title: 'Soundboard', icon: 'keyboard', hint: 'Effect pads laid out like your keyboard', load: () => import('./pads.js') },
  playlists: { title: 'Playlists', icon: 'playlist', hint: 'Music and ambience for each scene', load: () => import('./playlists.js') },
  library: { title: 'Sound library', icon: 'wave', hint: 'Add, trim, flag and clip sounds', load: () => import('./library.js') },
  youtube: { title: 'YouTube', icon: 'youtube', hint: 'Search, preview and download audio', load: () => import('./youtube.js') },
  wardens: { title: 'Stone Wardens', icon: 'emblem', hint: 'The campaign site; searches, addresses and links open here too', ownZoom: true, load: () => import('./web.js') },
  notes: { title: 'Notes', icon: 'journal', hint: 'Session notes in your Obsidian vault', load: () => import('./notes.js') },
  merchants: { title: 'Merchants', icon: 'coins', hint: 'Shops by kind of place, what they sell and for how much', load: () => import('./merchants.js') },
};

// The website has no server to search or download with: its YouTube pane only plays links.
if (document.querySelector('meta[name="dm-mode"]')?.content === 'site') KINDS.youtube.hint = 'Play a YouTube video in a pane';

export const KIND_ORDER = ['console', 'pads', 'playlists', 'library', 'youtube', 'notes', 'merchants', 'wardens'];

// Older layouts may hold panels that are gone (Combat Ring, separate web panes "web-1"…); they have no kind.
export function kindOf(panelId) {
  return String(panelId).startsWith('web-') ? 'web' : panelId;
}
