// Fetch wrappers for the local server. A 401 means the session ended: back to the gate.
// The website version has no server: notes come from this browser, frame checks from a list, and the
// calls only the PC version can answer (downloads, YouTube search, its config) say so.
import { SITE } from './mode.js';
import { vault } from './vault.js';
import { frameCheck } from './site.js';

async function siteRequest(method, path, body) {
  const u = new URL(path, location.href);
  if (u.pathname.startsWith('/api/notes/')) return vault.handle(method, path, body);
  if (u.pathname === '/api/frame-check') return frameCheck(u.searchParams.get('url'));
  if (u.pathname === '/api/jobs') return { jobs: [] };
  if (u.pathname === '/api/yt/oembed') {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.searchParams.get('url'))}`);
    if (!res.ok) throw new Error('No title for that video.');
    const d = await res.json();
    return { title: d.title, channel: d.author_name };
  }
  const err = new Error('That needs the PC version of the DM Screen.');
  err.status = 501;
  throw err;
}

async function request(method, path, body) {
  if (SITE) return siteRequest(method, path, body);
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body != null && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: body == null ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Signed out');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok && res.status !== 202) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 202) return { ...(data || {}), pending: true };
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

/** Multipart upload with progress (0..1). */
export function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status === 401) { location.href = '/login'; return reject(new Error('Signed out')); }
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Can't reach the DM Screen server."));
    xhr.send(formData);
  });
}

export const q = (s) => encodeURIComponent(s);
