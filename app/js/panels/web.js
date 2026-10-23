// Web panes: Stone Wardens, Combat Ring, and any number of general panes for 5e.tools, D&D Beyond,
// a search, or any address. Sites that forbid being shown inside another page (5e.tools, YouTube,
// wikis) are detected first and offered beside the screen instead, unless the frame helper is installed.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { api, q } from '../core/api.js';
import { state, SEARCH_ENGINES } from '../core/state.js';
import { showMenu, promptDialog, toast } from '../core/ui.js';
import { normalizeUrl, hostOf, clamp } from '../core/util.js';

const FIXED = { wardens: 'Stone Wardens', combat: 'Combat Ring' };
// Behind Cloudflare: they frame fine until Cloudflare decides to check the visitor, and its check page
// refuses frames. Without the helper, offer the window over the pane right away.
const PICKY = /(^|\.)(5e\.tools|dndbeyond\.com)$/;
const ZOOMS = [0.5, 0.6, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-storage-access-by-user-activation';

export const helperInstalled = () => document.documentElement.dataset.frameHelper === '1';

export default function createWeb({ id, kind, el, getState, setState, workspace }) {
  const fixed = FIXED[kind] || null;
  const homeUrl = () => (fixed ? state.get('settings').sites[kind] : getState().home || 'https://www.google.com/webhp?igu=1');
  let url = getState().url || homeUrl();
  let zoom = getState().zoom || 1;
  let back = [];

  const address = h('input', { class: 'input input-sm wb-address', type: 'text', spellcheck: false, 'aria-label': 'Address or search', placeholder: `Search ${SEARCH_ENGINES[state.get('settings').search]?.name || 'the web'} or type an address` });
  const zoomLabel = h('button', { class: 'btn btn-sm wb-zoomval num', type: 'button', title: 'Reset to 100%', onclick: () => setZoom(1) });
  const backBtn = h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Back', 'aria-label': 'Back', disabled: true, onclick: () => { const prev = back.pop(); if (prev) load(prev, { push: false }); } }, icon('back'));
  const bar = h('form', { class: 'wb-bar', onsubmit: (e) => { e.preventDefault(); const u = normalizeUrl(address.value, SEARCH_ENGINES[state.get('settings').search]?.url || SEARCH_ENGINES.google.url); if (u) load(u); } },
    backBtn,
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: fixed ? `${fixed} home` : 'Home', 'aria-label': 'Home', onclick: () => load(homeUrl()) }, icon('home')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Reload', 'aria-label': 'Reload', onclick: () => reload() }, icon('refresh')),
    address,
    h('div', { class: 'wb-zoom' },
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Smaller', 'aria-label': 'Zoom out', onclick: () => step(-1) }, icon('minus')),
      zoomLabel,
      h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Larger', 'aria-label': 'Zoom in', onclick: () => step(1) }, icon('plus'))),
    fixed ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => bookmarksMenu(e.currentTarget) }, icon('book'), 'Sites', icon('chevron-down', 'icon-sm')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Open beside the screen, over this pane', 'aria-label': 'Open in a window over this pane', onclick: () => popout(url) }, icon('popout')),
    h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Open in a new browser tab', 'aria-label': 'Open in a new tab', onclick: () => window.open(url, '_blank', 'noopener') }, icon('external')));
  const loading = h('div', { class: 'wb-loading', hidden: true });
  const frame = h('iframe', {
    class: 'wb-frame', title: fixed || 'Web page',
    allow: 'autoplay; clipboard-read; clipboard-write; fullscreen; encrypted-media',
    referrerpolicy: 'strict-origin-when-cross-origin',
  });
  if (!fixed) frame.setAttribute('sandbox', SANDBOX);
  const scaler = h('div', { class: 'wb-scaler' }, frame);
  const notice = h('div', { class: 'wb-notice', hidden: true });
  const hint = h('div', { class: 'wb-hint', hidden: true });
  const body = h('div', { class: 'wb-body' }, scaler, notice, loading);
  el.append(h('div', { class: 'wb' }, bar, hint, body));

  frame.addEventListener('load', () => { loading.hidden = true; });

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
    if (fixed) return fixed;
    const bm = state.get('bookmarks').list.find((b) => b.url === u);
    if (bm) return bm.name;
    if (/google\.[^/]+\/search/.test(u)) {
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
    address.value = u.replace(/[?&]igu=1/, '').replace(/\?$/, '');
    setState({ url: u, title: titleFor(u) });
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
      hint.hidden = false;
      hint.append(
        h('span', null, `If ${hostOf(u)} shows a broken page, it is checking visitors and won’t load in a frame.`),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => popout(u) }, icon('popout'), 'Open over this pane'),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Hide', 'aria-label': 'Hide this note', onclick: () => { hint.hidden = true; } }, icon('close')));
    }
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
        h('button', { class: 'btn', type: 'button', onclick: () => window.open(u, '_blank', 'noopener') }, icon('external'), 'Open in a new tab')),
      h('p', { class: 'meta' }, 'To show sites like this inside the pane, add the DM Screen frame helper to Chrome or Edge. It takes a minute and only works on this screen. ',
        h('button', { class: 'wb-link', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('sites')) }, 'How to add it'))));
    notice.hidden = false;
  }
  function showMissing(u) {
    hint.hidden = true;
    scaler.hidden = true;
    loading.hidden = true;
    clear(notice);
    notice.append(h('div', { class: 'wb-card' },
      h('h3', { class: 'wb-h' }, `${fixed || hostOf(u)} isn't online at this address yet`),
      h('p', null, `Nothing is published at ${u}. Once the site is live it shows up here by itself.`),
      h('div', { class: 'wb-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => load(u, { push: false }) }, icon('refresh'), 'Try again'),
        h('button', { class: 'btn', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('sites')) }, icon('settings'), 'Change the address'))));
    notice.hidden = false;
  }

  /** A separate window sized and placed exactly over this pane. */
  function popout(u) {
    const r = el.getBoundingClientRect();
    const sideBorder = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const topChrome = Math.max(0, window.outerHeight - window.innerHeight - sideBorder);
    const left = Math.round(window.screenX + sideBorder + r.left);
    const top = Math.round(window.screenY + topChrome + r.top);
    const w = window.open(u, `dm-${id}`, `popup=yes,left=${left},top=${top},width=${Math.round(r.width)},height=${Math.round(r.height)}`);
    if (!w) toast('The browser blocked the window. Allow pop-ups for this screen, or use a new tab.', { type: 'error' });
  }

  function bookmarksMenu(anchor) {
    const list = state.get('bookmarks').list;
    showMenu(anchor, [
      ...list.map((b) => ({ label: b.name, hint: hostOf(b.url), onClick: () => load(b.url) })),
      { sep: true },
      { label: 'Add this page', icon: 'plus', onClick: async () => {
        const name = await promptDialog('Add this page to Sites', { label: 'Name', value: titleFor(url), okLabel: 'Add' });
        if (name) state.update('bookmarks', (d) => { d.list.push({ name, url }); });
      } },
      list.length ? { label: 'Remove a site', icon: 'trash', submenu: list.map((b, i) => ({ label: b.name, onClick: () => state.update('bookmarks', (d) => { d.list.splice(i, 1); }) })) } : null,
      { label: 'Make this page the home page', icon: 'home', onClick: () => { setState({ home: url }); toast('This pane now starts here.', { type: 'ok' }); } },
    ], { align: 'end', minWidth: 260 });
  }

  applyZoom();
  load(url, { push: false });
  const offs = [
    bus.on('state:settings', () => {
      // a new address for Stone Wardens or Combat Ring in Settings reloads the pane there
      if (fixed && state.get('settings').sites[kind] !== getState().lastHome) {
        setState({ lastHome: state.get('settings').sites[kind] });
        load(homeUrl(), { push: false });
      }
    }),
  ];
  if (fixed && !getState().lastHome) setState({ lastHome: homeUrl() });

  return {
    title: () => fixed || getState().title || 'Web',
    menuItems: () => [
      { label: 'Reload', icon: 'refresh', onClick: reload },
      { label: 'Open over this pane', icon: 'popout', onClick: () => popout(url) },
      { label: 'Open in a new tab', icon: 'external', onClick: () => window.open(url, '_blank', 'noopener') },
    ],
    destroy() { offs.forEach((off) => off()); frame.src = 'about:blank'; },
  };
}
