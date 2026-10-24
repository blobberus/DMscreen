// The Stone Wardens tab: the campaign site, and the screen's one place for the rest of the web. Searches,
// typed addresses, the Sites list, links in notes and links Stone Wardens opens in a new tab all load
// here. Sites that forbid being shown inside another page (5e.tools, YouTube, wikis) are detected first
// and offered beside the screen instead, unless the frame helper is installed.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { api, q } from '../core/api.js';
import { state, SEARCH_ENGINES } from '../core/state.js';
import { showMenu, promptDialog, toast } from '../core/ui.js';
import { normalizeUrl, hostOf, clamp } from '../core/util.js';

const NAME = 'Stone Wardens';
// Behind Cloudflare: they frame fine until Cloudflare decides to check the visitor, and its check page
// refuses frames. Without the helper, offer the window over the pane right away.
const PICKY = /(^|\.)(5e\.tools|dndbeyond\.com)$/;
// Inside another page the browser keeps Google's own cookies from it, and parts of a search that Google
// only serves to a visitor it recognises (the AI Overview) can fail to load. Its own window always works.
const GOOGLE_SEARCH = /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i;
const ZOOMS = [0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
// Any site can load here, so none may send the screen itself to another address (no allow-top-navigation).
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-storage-access-by-user-activation';

export const helperInstalled = () => document.documentElement.dataset.frameHelper === '1';

/** An address as a person would type it: Google's "may be framed" switch taken off. */
const plain = (u) => u.replace(/([?&])igu=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/\?$/, '');

export default function createWeb({ id, el, getState, setState }) {
  const homeUrl = () => state.get('settings').sites.wardens;
  let url = getState().url || homeUrl();
  let zoom = getState().zoom || 1;
  let back = [];

  const address = h('input', { class: 'input input-sm wb-address', type: 'text', spellcheck: false, 'aria-label': 'Address or search', placeholder: `Search ${SEARCH_ENGINES[state.get('settings').search]?.name || 'the web'} or type an address` });
  const zoomLabel = h('button', { class: 'btn btn-sm wb-zoomval num', type: 'button', title: 'Reset to 100%', onclick: () => setZoom(1) });
  const backBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Back', 'aria-label': 'Back', disabled: true, onclick: () => { const prev = back.pop(); if (prev) load(prev, { push: false }); } }, icon('back'));
  const bar = h('form', { class: 'wb-bar', onsubmit: (e) => { e.preventDefault(); const u = normalizeUrl(address.value, SEARCH_ENGINES[state.get('settings').search]?.url || SEARCH_ENGINES.google.url); if (u) load(u); } },
    backBtn,
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: `${NAME} home`, 'aria-label': `${NAME} home`, onclick: () => load(homeUrl()) }, icon('home')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Reload', 'aria-label': 'Reload', onclick: () => reload() }, icon('refresh')),
    address,
    h('div', { class: 'wb-zoom' },
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Smaller', 'aria-label': 'Zoom out', onclick: () => step(-1) }, icon('minus')),
      zoomLabel,
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Larger', 'aria-label': 'Zoom in', onclick: () => step(1) }, icon('plus'))),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => bookmarksMenu(e.currentTarget) }, icon('book'), 'Sites', icon('chevron-down', 'icon-sm')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Open beside the screen, over this pane', 'aria-label': 'Open in a window over this pane', onclick: () => popout(url) }, icon('popout')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Open in a new browser tab', 'aria-label': 'Open in a new tab', onclick: () => window.open(plain(url), '_blank', 'noopener') }, icon('external')));
  const loading = h('div', { class: 'wb-loading', hidden: true });
  const frame = h('iframe', {
    class: 'wb-frame', title: NAME, sandbox: SANDBOX,
    allow: 'autoplay; clipboard-read; clipboard-write; fullscreen; encrypted-media',
    referrerpolicy: 'strict-origin-when-cross-origin',
  });
  const scaler = h('div', { class: 'wb-scaler' }, frame);
  const notice = h('div', { class: 'wb-notice', hidden: true });
  const hint = h('div', { class: 'wb-hint', hidden: true });
  const body = h('div', { class: 'wb-body' }, scaler, notice, loading);
  el.append(h('div', { class: 'wb' }, bar, hint, body));

  frame.addEventListener('load', () => { loading.hidden = true; watch(); });

  /** The address bar follows the page, so a reload or "open in a new tab" takes you where you are. */
  function follow(here) {
    if (!here || here === 'about:blank' || here === url) return;
    url = here;
    address.value = plain(here);
    setState({ url: here });
  }
  // Pages from the screen's own address (Stone Wardens on the website) can be reached from here: their
  // links that would open a new tab load in this one instead. Other sites keep their new tabs.
  function watch() {
    let win, doc;
    try { win = frame.contentWindow; doc = frame.contentDocument; } catch { return; }
    if (!doc || doc.location.href === 'about:blank') return;
    follow(doc.location.href);
    win.addEventListener('hashchange', () => follow(win.location.href));
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.hasAttribute('download')) return;
      const target = (a.target || doc.querySelector('base[target]')?.target || '').toLowerCase();
      if (!target || target === '_self' || !/^https?:/.test(a.href)) return;
      e.preventDefault();
      load(a.href);
    });
  }

  function applyZoom() {
    scaler.style.width = `${100 / zoom}%`;
    scaler.style.height = `${100 / zoom}%`;
    scaler.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  function setZoom(z) {
    zoom = clamp(z, 0.4, 2);
    setState({ zoom });
    applyZoom();
  }
  function step(dir) {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + dir, 0, ZOOMS.length - 1)]);
  }

  function titleFor(u) {
    if (u === homeUrl()) return NAME;
    const bm = state.get('bookmarks').list.find((b) => b.url === u);
    if (bm) return bm.name;
    if (GOOGLE_SEARCH.test(u)) {
      try { return `Search: ${new URL(u).searchParams.get('q')}`; } catch { /* fall through */ }
    }
    return hostOf(u) || 'Web';
  }

  let token = 0;
  async function load(u, { push = true } = {}) {
    if (!u) return;
    if (push && url && url !== u) { back.push(url); back = back.slice(-30); }
    backBtn.disabled = !back.length;
    url = u;
    address.value = plain(u);
    setState({ url: u });
    const mine = ++token;
    if (!helperInstalled()) {
      loading.hidden = false;
      let check = null;
      try { check = await api.get(`/api/frame-check?url=${q(u)}`); } catch { /* try anyway */ }
      if (mine !== token) return;
      if (check?.blocked) { showBlocked(u); return; }
      if (check?.reason === 'missing') { showMissing(u); return; }
    }
    showFrame(u);
  }
  function showFrame(u) {
    notice.hidden = true;
    scaler.hidden = false;
    loading.hidden = false;
    frame.src = u;
    clear(hint);
    hint.hidden = true;
    if (!helperInstalled() && PICKY.test(hostOf(u))) {
      note(`If ${hostOf(u)} shows a broken page, it is checking visitors and won’t load in a frame.`, u);
    } else if (GOOGLE_SEARCH.test(u) && !getState().quietGoogle) {
      note('If Google’s AI Overview doesn’t load, it needs Google in its own window.', u, () => setState({ quietGoogle: true }));
    }
  }
  /** A line over the page with a way out to a real window. Closing it for good is optional. */
  function note(text, u, forGood = null) {
    hint.hidden = false;
    hint.append(
      h('span', null, text),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => popout(u) }, icon('popout'), 'Open over this pane'),
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: forGood ? 'Hide, and don’t show this again' : 'Hide', 'aria-label': 'Hide this note', onclick: () => { hint.hidden = true; forGood?.(); } }, icon('close')));
  }
  function reload() {
    if (!notice.hidden) { load(url, { push: false }); return; }
    loading.hidden = false;
    const u = frame.src;
    frame.src = 'about:blank';
    setTimeout(() => { frame.src = u || url; }, 30);
  }

  function showBlocked(u) {
    hint.hidden = true;
    scaler.hidden = true;
    loading.hidden = true;
    frame.src = 'about:blank';
    clear(notice);
    const host = hostOf(u);
    notice.append(h('div', { class: 'wb-card' },
      h('h3', { class: 'wb-h' }, `${host} won't open inside another page`),
      h('p', null, 'The site forbids being shown in a frame, so the screen can’t draw it here. You can still use it right beside the screen:'),
      h('div', { class: 'wb-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => popout(u) }, icon('popout'), 'Open over this pane'),
        h('button', { class: 'btn', type: 'button', onclick: () => window.open(plain(u), '_blank', 'noopener') }, icon('external'), 'Open in a new tab')),
      h('p', { class: 'meta' }, 'To show sites like this inside the pane, add the DM Screen frame helper to Chrome or Edge. It takes a minute and only works on this screen. ',
        h('button', { class: 'wb-link', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('sites')) }, 'How to add it'))));
    notice.hidden = false;
  }
  function showMissing(u) {
    const home = u === homeUrl();
    hint.hidden = true;
    scaler.hidden = true;
    loading.hidden = true;
    clear(notice);
    notice.append(h('div', { class: 'wb-card' },
      h('h3', { class: 'wb-h' }, `${home ? NAME : hostOf(u)} isn't online at this address yet`),
      h('p', null, `Nothing is published at ${u}.${home ? ' Once the site is live it shows up here by itself.' : ''}`),
      h('div', { class: 'wb-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => load(u, { push: false }) }, icon('refresh'), 'Try again'),
        home ? h('button', { class: 'btn', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('sites')) }, icon('settings'), 'Change the address')
          : h('button', { class: 'btn', type: 'button', onclick: () => load(homeUrl()) }, icon('home'), `Back to ${NAME}`))));
    notice.hidden = false;
  }

  /** A separate window sized and placed exactly over this pane. */
  function popout(u) {
    const r = el.getBoundingClientRect();
    const sideBorder = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const topChrome = Math.max(0, window.outerHeight - window.innerHeight - sideBorder);
    const left = Math.round(window.screenX + sideBorder + r.left);
    const top = Math.round(window.screenY + topChrome + r.top);
    const w = window.open(plain(u), `dm-${id}`, `popup=yes,left=${left},top=${top},width=${Math.round(r.width)},height=${Math.round(r.height)}`);
    if (!w) toast('The browser blocked the window. Allow pop-ups for this screen, or use a new tab.', { type: 'error' });
  }

  function bookmarksMenu(anchor) {
    const list = state.get('bookmarks').list;
    showMenu(anchor, [
      { label: NAME, icon: 'home', hint: hostOf(homeUrl()), onClick: () => load(homeUrl()) },
      ...list.map((b) => ({ label: b.name, hint: hostOf(b.url), onClick: () => load(b.url) })),
      { sep: true },
      { label: 'Add this page', icon: 'plus', onClick: async () => {
        const name = await promptDialog('Add this page to Sites', { label: 'Name', value: titleFor(url), okLabel: 'Add' });
        if (name) state.update('bookmarks', (d) => { d.list.push({ name, url }); });
      } },
      list.length ? { label: 'Remove a site', icon: 'trash', submenu: list.map((b, i) => ({ label: b.name, onClick: () => state.update('bookmarks', (d) => { d.list.splice(i, 1); }) })) } : null,
    ], { align: 'end', minWidth: 260 });
  }

  applyZoom();
  load(url, { push: false });
  const offs = [
    bus.on('state:settings', () => {
      // a new address for Stone Wardens in Settings reloads the pane there
      if (homeUrl() !== getState().lastHome) {
        setState({ lastHome: homeUrl() });
        load(homeUrl(), { push: false });
      }
    }),
  ];
  if (!getState().lastHome) setState({ lastHome: homeUrl() });

  return {
    title: () => NAME,
    /** Show an address here (a link from notes, a search). */
    open: (u) => load(u),
    menuItems: () => [
      { label: `${NAME} home`, icon: 'home', onClick: () => load(homeUrl()) },
      { label: 'Reload', icon: 'refresh', onClick: reload },
      { label: 'Open over this pane', icon: 'popout', onClick: () => popout(url) },
      { label: 'Open in a new tab', icon: 'external', onClick: () => window.open(plain(url), '_blank', 'noopener') },
    ],
    destroy() { offs.forEach((off) => off()); frame.src = 'about:blank'; },
  };
}
