// The website's offline copy. Sounds and waveforms are named by their content, so once fetched they
// never change: they come from the cache first, and a sound kept whole answers the byte ranges an
// <audio> element asks for. Everything else (the screen itself, the sound list) comes from the network
// first and from the cache when there is none, so the screen opens offline with what it last saw.
// "The network" means asking GitHub every time (no-cache): its ten-minute browser cache could otherwise
// hand back an old page after a publish. The build puts a version on every module's address.
const SHELL = 'dm-shell-v1';
const MEDIA = 'dm-media-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(media|peaks)\//.test(url.pathname)) e.respondWith(media(req, url));
  else e.respondWith(shell(req));
});

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
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 6000)),
    ]);
    if (res.ok) {
      await cache.delete(req, { ignoreSearch: true });     // the copy from an older version
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
