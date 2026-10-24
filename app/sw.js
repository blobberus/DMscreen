// The website's offline copy, and what keeps a page on one version of the screen.
// - Sounds and waveforms are named by their content, so once fetched they never change: they come from
//   the cache first, and a sound kept whole answers the byte ranges an <audio> element asks for.
// - The screen's code and styles carry the build's version in their address (?v=, put there by
//   tools/build_site.py). Such a file never changes either, so it comes from the cache by its exact
//   address first: a page always runs one build's files, even on a slow network. (GitHub Pages lets
//   browsers keep files for ten minutes; a page that mixed two builds once broke the screen.)
// - Everything else (the page itself, the sound list) is asked of GitHub every time, falling back to the
//   last copy when there is no network, so the screen opens offline with what it last saw.
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
  if (/\/(media|peaks)\//.test(url.pathname)) e.respondWith(media(req, url));
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
