// Small shared helpers.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function uid(prefix = 'x') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

/** 83.4 -> "1:23", 3725 -> "1:02:05"; tenths with {tenths: true}. */
export function fmtTime(sec, { tenths = false } = {}) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const neg = sec < 0;
  let s = Math.abs(sec);
  if (tenths) s = Math.round(s * 10) / 10; else s = Math.floor(s + 0.0001);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const secs = tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0');
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${secs}` : `${m}:${secs}`);
}

/** "1:23.5" | "83.5" | "1:02:03" -> seconds, or null. */
export function parseTime(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Total duration in words: "24 min", "1 h 05 min", "42 s". */
export function fmtDuration(sec) {
  if (!sec) return '0 min';
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function clock(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugify(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');
}

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

export function baseName(path) {
  return String(path || '').split('/').pop().replace(/\.md$/i, '');
}

export function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Natural sort ("Session 9" before "Session 10"). */
export const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

export function isTyping(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(el.type);
  return false;
}

export function normalizeUrl(text, searchUrl) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return `https://${t}`;
  if (/^localhost(:\d+)?(\/\S*)?$/.test(t)) return `http://${t}`;
  return searchUrl.replace('%s', encodeURIComponent(t));
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
