// YouTube: search, preview in the embedded player, and download the audio (all of it, or just the
// stretch you mark with the player's time) straight into the library as an MP3.
// The website can't search or download (that takes the PC version's server): it plays a pasted link.
import { h, icon, clear } from '../core/dom.js';
import { bus } from '../core/bus.js';
import { api, q } from '../core/api.js';
import { library } from '../core/library.js';
import { toast } from '../core/ui.js';
import { fmtTime, parseTime, hostOf } from '../core/util.js';
import { SITE } from '../core/mode.js';
import { addSoundsMenu } from '../dialogs/files.js';

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;

function guessKind(seconds) {
  if (!seconds) return 'music';
  if (seconds < 30) return 'effect';
  if (seconds > 15 * 60) return 'ambience';
  return 'music';
}
const fmtViews = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M views` : n >= 1e3 ? `${Math.round(n / 1e3)}k views` : `${n} views`);

export default function createYouTube({ el, getState, setState, workspace }) {
  const saved = getState();
  let results = saved.results || [];
  let chosen = saved.chosen || null;     // {id?, url, title, duration, channel}
  let jobId = null;
  let playerTime = 0;
  let searching = false;

  const input = h('input', { class: 'input', type: 'search', placeholder: SITE ? 'Paste a YouTube link, or search on YouTube' : 'Search YouTube, or paste a link', value: saved.query || '', 'aria-label': 'Search YouTube or paste a link' });
  const go = h('button', { class: 'btn', type: 'submit' }, icon(SITE ? 'play' : 'search'), SITE ? 'Play' : 'Search');
  const form = h('form', { class: 'yt-bar' }, h('label', { class: 'search yt-search' }, icon('youtube'), input), go);
  const resultsEl = h('div', { class: 'yt-results', role: 'list' });
  const side = h('div', { class: 'yt-side' });
  const root = h('div', { class: 'yt' }, form, h('div', { class: 'yt-main' }, side, resultsEl));
  el.append(root);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (/^https?:\/\//i.test(text)) { openUrl(text); return; }
    if (SITE) {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`, '_blank', 'noopener');
      toast('YouTube opened in a new tab. Copy the link of the video you want and paste it here.', { timeout: 7000 });
      return;
    }
    runSearch(text);
  });

  async function runSearch(text) {
    searching = true;
    setState({ query: text });
    renderResults();
    try {
      const res = await library.searchYouTube(text);
      results = res.results || [];
      setState({ results: results.slice(0, 30) });
    } catch (e) {
      results = [];
      resultsEl.dataset.error = e.message;
    } finally {
      searching = false;
      renderResults();
    }
  }

  async function openUrl(url) {
    const m = YT_ID.exec(url);
    chosen = { id: m ? m[1] : null, url, title: m ? 'YouTube video' : `Audio from ${hostOf(url)}`, duration: null, channel: '' };
    setState({ chosen });
    renderSide();
    if (m) {
      try {
        const info = await api.get(`/api/yt/oembed?url=${q(url)}`);
        if (chosen?.url === url) { chosen.title = info.title || chosen.title; chosen.channel = info.channel || ''; setState({ chosen }); renderSide(); }
      } catch { /* keep the generic title */ }
    }
  }

  function choose(r) {
    chosen = { id: r.id, url: r.url, title: r.title, duration: r.duration, channel: r.channel };
    setState({ chosen });
    renderSide();
    renderResults();
  }

  function renderResults() {
    clear(resultsEl);
    if (searching) {
      for (let i = 0; i < 5; i++) resultsEl.append(h('div', { class: 'yt-row is-loading' }, h('span', { class: 'yt-thumb' }), h('span', { class: 'yt-text' }, h('i'), h('i'))));
      return;
    }
    if (resultsEl.dataset.error) {
      resultsEl.append(h('div', { class: 'empty' }, h('strong', null, "Couldn't search YouTube"), h('span', null, resultsEl.dataset.error)));
      delete resultsEl.dataset.error;
      return;
    }
    if (!results.length && SITE) {
      resultsEl.append(h('div', { class: 'yt-tips' },
        h('p', null, 'Paste a video’s link above to play it in this pane. Type words instead and YouTube’s own search opens in a new tab.'),
        h('p', { class: 'meta' }, 'A video plays outside the mixer: no fades, ducking or flags. To use it as a sound on the screen, save its audio as an MP3 (the PC version downloads it for you) and upload it to a folder.'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => addSoundsMenu(e.currentTarget) }, icon('upload'), 'Add sounds on GitHub')));
      return;
    }
    if (!results.length) {
      resultsEl.append(h('div', { class: 'yt-tips' },
        h('p', null, 'Try searches like these:'),
        ...['tavern ambience', 'sword clash sound effect', 'rain and thunder 1 hour', 'epic battle music no copyright', 'dragon roar'].map((t) =>
          h('button', { class: 'yt-tip', type: 'button', onclick: () => { input.value = t; runSearch(t); } }, icon('search', 'icon-sm'), t)),
        h('p', { class: 'meta' }, 'Downloads land in the Sound library as MP3s you can trim, flag and put on pads.')));
      return;
    }
    for (const r of results) {
      const row = h('div', { class: `yt-row ${chosen?.id === r.id ? 'is-selected' : ''}`, role: 'listitem', tabindex: 0, onclick: () => choose(r), onkeydown: (e) => { if (e.key === 'Enter') choose(r); } },
        h('img', { class: 'yt-thumb', src: r.thumb, alt: '', loading: 'lazy', width: 120, height: 68 }),
        h('span', { class: 'yt-text' },
          h('span', { class: 'yt-title' }, r.title),
          h('span', { class: 'meta truncate' }, [r.channel, r.duration ? fmtTime(r.duration) : null, fmtViews(r.views)].filter(Boolean).join(' · '))),
        h('button', { class: 'btn-icon btn-sm', type: 'button', title: 'Download the audio now', 'aria-label': `Download ${r.title}`, onclick: (e) => { e.stopPropagation(); quickDownload(r); } }, icon('download')));
      resultsEl.append(row);
    }
  }

  async function quickDownload(r) {
    try {
      const job = await library.download({ url: r.url, name: r.title, kind: guessKind(r.duration) });
      jobId = job.id;
      toast(`Downloading “${r.title}”.`);
    } catch (e) { toast(e.message, { type: 'error' }); }
  }

  // ---- the chosen video: player + download form --------------------------------------
  let frame = null;
  function renderSide() {
    clear(side);
    root.classList.toggle('has-video', !!chosen);
    if (!chosen) return;
    if (chosen.id) {
      const origin = encodeURIComponent(location.origin);
      frame = h('iframe', {
        class: 'yt-player', title: `YouTube: ${chosen.title}`,
        src: `https://www.youtube-nocookie.com/embed/${chosen.id}?enablejsapi=1&rel=0&modestbranding=1&origin=${origin}`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      });
      frame.addEventListener('load', () => listen());
      side.append(h('div', { class: 'yt-playerbox' }, frame));
    } else frame = null;

    if (SITE) {
      side.append(h('div', { class: 'yt-form' },
        h('div', { class: 'yt-formhead' },
          h('h2', { class: 'yt-h truncate', title: chosen.title }, chosen.title),
          h('p', { class: 'meta truncate' }, [chosen.channel, chosen.duration ? fmtTime(chosen.duration) : null].filter(Boolean).join(' · '))),
        h('p', { class: 'meta' }, 'Playing from YouTube, outside the mixer. Its volume is the player’s own.'),
        h('div', { class: 'yt-actions' },
          h('a', { class: 'btn btn-sm', href: chosen.url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open on YouTube'))));
      return;
    }
    const name = h('input', { class: 'input', value: chosen.title, 'aria-label': 'Name in the library' });
    let kind = guessKind(chosen.duration);
    const seg = h('div', { class: 'seg' });
    for (const [k, l] of [['music', 'Music'], ['ambience', 'Ambience'], ['effect', 'Effect']]) {
      seg.append(h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: (e) => {
        kind = k;
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        e.currentTarget.setAttribute('aria-pressed', 'true');
      } }, l));
    }
    const from = h('input', { class: 'input input-sm num', placeholder: '0:00', 'aria-label': 'From' });
    const to = h('input', { class: 'input input-sm num', placeholder: chosen.duration ? fmtTime(chosen.duration) : 'end', 'aria-label': 'To' });
    const useBtn = (target) => h('button', { class: 'btn btn-sm', type: 'button', disabled: !chosen.id, title: "Set to where the player is now", onclick: () => { target.value = fmtTime(playerTime, { tenths: true }); } }, icon('clock'), 'Player time');
    const status = h('div', { class: 'yt-status' });
    const err = h('p', { class: 'field-error', hidden: true });
    const dl = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      err.hidden = true;
      const start = from.value.trim() ? parseTime(from.value) : null;
      const end = to.value.trim() ? parseTime(to.value) : null;
      if ((from.value.trim() && start == null) || (to.value.trim() && end == null)) { err.textContent = 'Write times like 1:30 or 1:02:45.'; err.hidden = false; return; }
      if (start != null && end != null && end <= start) { err.textContent = 'The end has to come after the start.'; err.hidden = false; return; }
      try {
        const job = await library.download({ url: chosen.url, name: name.value.trim() || chosen.title, kind, start, end });
        jobId = job.id;
        renderStatus();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    } }, icon('download'), 'Download audio');

    side.append(h('div', { class: 'yt-form' },
      h('div', { class: 'yt-formhead' },
        h('h2', { class: 'yt-h truncate', title: chosen.title }, chosen.title),
        h('p', { class: 'meta truncate' }, [chosen.channel, chosen.duration ? fmtTime(chosen.duration) : null, chosen.id ? null : hostOf(chosen.url)].filter(Boolean).join(' · '))),
      h('div', { class: 'yt-pair' },
        h('label', { class: 'field yt-name' }, h('span', { class: 'field-label' }, 'Name in the library'), name),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), seg)),
      h('div', { class: 'field' },
        h('span', { class: 'field-label', title: 'Leave both empty for the whole thing. Play the video, then press Player time to mark each end.' }, 'Only part of it (optional)'),
        h('div', { class: 'yt-range' }, h('span', { class: 'muted' }, 'From'), from, useBtn(from), h('span', { class: 'muted' }, 'to'), to, useBtn(to))),
      err,
      h('div', { class: 'yt-actions' }, dl, status)));
    renderStatus();

    function renderStatus() {
      clear(status);
      const job = jobId && library.jobs().find((j) => j.id === jobId);
      if (!job) return;
      if (job.status === 'done') {
        status.append(h('span', { class: 'yt-done' }, icon('check', 'icon-sm'), 'In the library'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openInLibrary(job.soundId) }, 'Open in the editor'));
      } else if (job.status === 'error') {
        status.append(h('span', { class: 'field-error' }, job.error));
        if (job.errorCode === 'bot-check' || job.errorCode === 'cookies' || job.errorCode === 'age') {
          status.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => import('../dialogs/settings.js').then((m) => m.openSettings('youtube')) }, 'Open YouTube settings'));
        }
      } else {
        const pct = Math.round((job.progress || 0) * 100);
        status.append(h('span', { class: 'meta' }, job.status === 'downloading' ? `Downloading ${pct}%` : job.status === 'converting' ? 'Converting to MP3' : job.status === 'analyzing' ? 'Reading the waveform' : 'Starting'),
          h('div', { class: `progress ${job.status === 'downloading' && pct ? '' : 'is-indeterminate'}`, style: { '--p': `${pct}%` } }, h('i')));
      }
    }
    side._renderStatus = renderStatus;
  }

  function openInLibrary(id) {
    workspace.L.panelState.library = { ...(workspace.L.panelState.library || {}), selected: id };
    workspace.openKind('library');
    bus.emit('library:open', id);
  }

  // The embedded player reports its time over postMessage once we say we're listening.
  function listen() {
    if (!frame) return;
    const send = (msg) => frame.contentWindow?.postMessage(JSON.stringify(msg), '*');
    send({ event: 'listening', id: 1, channel: 'widget' });
    send({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' });
  }
  const onMessage = (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    let data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return; } }
    const t = data?.info?.currentTime;
    if (typeof t === 'number') playerTime = t;
    const d = data?.info?.duration;
    if (typeof d === 'number' && d > 0 && chosen && !chosen.duration) chosen.duration = d;
  };
  window.addEventListener('message', onMessage);

  renderResults();
  renderSide();
  const offs = [bus.on('jobs', () => side._renderStatus?.())];
  return {
    hide() {
      // pause the preview when the tab is put away
      frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [], id: 1, channel: 'widget' }), '*');
    },
    destroy() { offs.forEach((off) => off()); window.removeEventListener('message', onMessage); },
  };
}
