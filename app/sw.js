// The website's offline copy, and what keeps a page on one version of the screen.
// - Sounds and waveforms are named by their content, so once fetched they never change: they come from
//   the cache first, and a sound kept whole answers the byte ranges an <audio> element asks for.
// - The screen's code and styles carry the build's version in their address (?v=, put there by
//   tools/build_site.py). Such a file never changes either, so it comes from the cache by its exact
//   address first: a page always runs one build's files, even on a slow network. (GitHub Pages lets
//   browsers keep files for ten minutes; a page that mixed two builds once broke the screen.)
// - Everything else (the page itself, the sound list) is asked of GitHub every time, falling back to the
//   last copy when there is no network, so the screen opens offline with what it last saw.
// - Private sounds (pmedia/<blob id>.<ext>, ppeaks/<blob id>.json) come from the sounds repo through the
//   GitHub API, with the token the page left in IndexedDB (core/github.js). The API sends a whole file
//   and no byte ranges, so a sound streams: playback starts on the first bytes, each range the <audio>
//   element asks for is answered as the download reaches it, and the finished file is kept, so it plays
//   from here after that (and offline).
// Each publish changes BUILD, so browsers install the new worker; the page reloads onto it (main.js).
const BUILD = 'dev';
const SHELL = 'dm-shell-v2';
const MEDIA = 'dm-media-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const stale = (await caches.keys()).filter((n) => n.startsWith('dm-shell') && n !== SHELL);
  for (const name of stale) await caches.delete(name);
  await self.clients.claim();
  // Pages opened under the first worker (before versions) may be running old or mixed files and don't
  // know how to reload themselves: load them again, once.
  if (stale.length) for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/pmedia\//.test(url.pathname)) e.respondWith(privateMedia(e, req, url));
  else if (/\/ppeaks\//.test(url.pathname)) e.respondWith(privatePeaks(url));
  else if (/\/(media|peaks)\//.test(url.pathname)) e.respondWith(media(req, url));
  else if (url.searchParams.has('v')) e.respondWith(versioned(req));
  else e.respondWith(shell(req));
});

async function versioned(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);                   // this exact version
  if (hit) return hit;
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok) {
    await cache.delete(req, { ignoreSearch: true });    // older versions of the file
    await cache.put(req, res.clone());
  }
  return res;
}

async function media(req, url) {
  const cache = await caches.open(MEDIA);
  const key = url.origin + url.pathname;
  const range = req.headers.get('range');
  const hit = await cache.match(key);
  if (hit) return range ? slice(hit, range) : hit;
  if (range) return fetch(req);              // streaming a long sound: let it stream, don't keep half of it
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(key, res.clone());
  return res;
}

async function slice(res, range) {
  const blob = await res.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : blob.size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, blob.size - Number(m[2])); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// ---- private sounds ------------------------------------------------------------------------------------
const TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };
const downloads = new Map();       // address -> a download in progress, shared by every request for it

/** {token, api, repo, branch} as the page left them, or null when this device isn't connected. */
function github() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('dm', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const get = open.result.transaction('kv').objectStore('kv').get('github');
        get.onsuccess = () => { resolve(get.result?.token && get.result.repo ? get.result : null); open.result.close(); };
        get.onerror = () => { resolve(null); open.result.close(); };
      };
    } catch { resolve(null); }
  });
}

function apiFetch(gh, path, accept) {
  return fetch(`${gh.api}/repos/${gh.repo}/${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${gh.token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
}

const failed = (status, text) => new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });

// Copies of the sounds from when they were published with the site (media/, peaks/) are of no use once
// they come from the private repo: they go the first time a private sound is asked for (an iPad that
// kept every sound would otherwise hold them twice).
let purged = false;
async function purgePublic() {
  purged = true;
  const cache = await caches.open(MEDIA);
  for (const req of await cache.keys()) if (/\/(media|peaks)\//.test(new URL(req.url).pathname)) await cache.delete(req);
}

async function privateMedia(e, req, url) {
  if (!purged) e.waitUntil(purgePublic().catch(() => {}));
  const key = url.origin + url.pathname;
  const range = req.headers.get('range');
  const hit = await (await caches.open(MEDIA)).match(key);
  if (hit) return range ? slice(hit, range) : hit;
  const d = download(key, url.pathname);
  e.waitUntil(d.finished.catch(() => {}));     // keep the worker alive until the file is kept
  try { await d.started; } catch (err) { return failed(err.status || 502, err.message); }
  const total = d.total;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (!m || total == null) {
    return new Response(stream(d, 0, Infinity), { status: 200, headers: { 'Content-Type': d.type, ...(total != null ? { 'Content-Length': String(total) } : {}), 'Accept-Ranges': 'bytes' } });
  }
  let start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  if (!m[1] && m[2]) { start = Math.max(0, total - Number(m[2])); end = total - 1; }
  if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  return new Response(stream(d, start, end), {
    status: 206,
    headers: { 'Content-Type': d.type, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}

/** Fetch a private sound once, whoever asks: its bytes collect in memory as they arrive, then the whole
 *  file goes in the cache. started: the size is known; finished: it is kept. */
function download(key, pathname) {
  if (downloads.has(key)) return downloads.get(key);
  const file = pathname.slice(pathname.lastIndexOf('/') + 1);
  const d = { chunks: [], ends: [], have: 0, total: null, done: false, error: null, wake: new Set(), type: TYPES[file.split('.').pop().toLowerCase()] || 'application/octet-stream' };
  const tell = () => { const w = [...d.wake]; d.wake.clear(); for (const f of w) f(); };
  downloads.set(key, d);
  let begun;
  d.started = new Promise((resolve, reject) => { begun = { resolve, reject }; });
  d.finished = (async () => {
    try {
      const gh = await github();
      if (!gh) throw Object.assign(new Error('Connect this device to GitHub to play the private sounds.'), { status: 401 });
      const res = await apiFetch(gh, `git/blobs/${file.replace(/\..*$/, '')}`, 'application/vnd.github.raw');
      if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}.`), { status: res.status });
      d.total = Number(res.headers.get('content-length')) || null;
      begun.resolve();
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        d.chunks.push(value);
        d.have += value.length;
        d.ends.push(d.have);
        tell();
      }
      d.total ??= d.have;
      d.done = true;
      tell();
      const blob = new Blob(d.chunks, { type: d.type });
      await (await caches.open(MEDIA)).put(key, new Response(blob, { headers: { 'Content-Type': d.type, 'Content-Length': String(blob.size) } }));
    } catch (err) {
      d.error = err;
      begun.reject(err);
      tell();
      throw err;
    } finally {
      downloads.delete(key);       // kept (later requests find it in the cache), or failed (the next one tries again)
    }
  })();
  return d;
}

/** Bytes start..end (inclusive) of a download, as they arrive. */
function stream(d, start, end) {
  let pos = start;
  return new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        if (pos > end || (d.done && pos >= d.have)) { ctrl.close(); return; }
        if (pos < d.have) {
          let i = 0;
          while (d.ends[i] <= pos) i++;
          const chunk = d.chunks[i];
          const from = pos - (d.ends[i] - chunk.length);
          const piece = chunk.subarray(from, Math.min(chunk.length, from + (end - pos) + 1));
          pos += piece.length;
          ctrl.enqueue(piece);
          return;
        }
        if (d.error) { ctrl.error(d.error); return; }
        await new Promise((wake) => d.wake.add(wake));
      }
    },
  });
}

async function privatePeaks(url) {
  const cache = await caches.open(MEDIA);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  if (hit) return hit;
  const gh = await github();
  if (!gh) return failed(401, 'not connected');
  const res = await apiFetch(gh, `contents/peaks/${url.pathname.slice(url.pathname.lastIndexOf('/') + 1)}?ref=${encodeURIComponent(gh.branch || 'main')}`, 'application/vnd.github.raw').catch(() => null);
  if (!res?.ok) return failed(res?.status || 502, 'no waveform');
  const out = new Response(await res.blob(), { headers: { 'Content-Type': 'application/json' } });
  cache.put(key, out.clone());
  return out;
}

async function shell(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      // a page load (navigate) can't be re-made with options, so it is fetched by its address
      fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 8000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
