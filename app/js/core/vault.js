// Notes for the website version: the same vault the PC server keeps on disk, kept in this browser
// instead (the repo is public, so notes never go to GitHub). It answers the /api/notes/* calls the
// Notes pane makes. Download them as Markdown from Settings, Notes, to put them in Obsidian.
const KEY = 'dm:vault';

const TEMPLATES = {
  'Templates/Session.md': '---\nsession: {{session}}\ndate: {{date}}\ntags: [session]\n---\n# Session {{session}}\n\n## Recap\n- \n\n## Log\n**{{time}}** Start\n\n## People\n- \n\n## Loot\n- \n\n## Threads\n- [ ] \n\n## Next time\n- \n',
  'Templates/NPC.md': '---\ntags: [npc]\n---\n# {{title}}\n\n**Role:** \n**Where:** \n**Wants:** \n**Voice:** \n\n## Met\n- {{date}}: \n',
  'Templates/Location.md': '---\ntags: [location]\n---\n# {{title}}\n\n**Region:** \n**Feel:** \n\n## People here\n- \n\n## Notes\n- \n',
};
const WIKILINK = /\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
const TAG = /(?:^|\s)#([\w/-]*[A-Za-z_/-][\w/-]*)/g;
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

const now = () => Date.now() / 1000;
const stem = (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');

function fail(status, message, data = {}) {
  const e = new Error(message);
  e.status = status;
  e.data = { error: message, ...data };
  throw e;
}

function read() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY)); } catch { /* start over */ }
  if (!v || typeof v !== 'object' || !v.files) {
    v = { files: {}, folders: ['Sessions', 'People', 'Places', 'Templates'] };
    for (const [p, text] of Object.entries(TEMPLATES)) v.files[p] = { text, mtime: now() };
    write(v);
  }
  return v;
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {
    fail(507, `This browser is out of room for notes (${e.message}). Download them from Settings, Notes, and clear old ones.`);
  }
}

function cleanPath(p, mustBeNote = true) {
  const rel = String(p || '').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  const parts = rel.split('/');
  if (!rel || parts.some((x) => !x || x === '.' || x === '..') || rel.includes(':')) fail(400, 'Bad note path');
  if (mustBeNote && !/\.md$/i.test(rel)) fail(400, 'Notes must be .md files');
  return rel;
}
const hidden = (p) => p.split('/').some((x) => x.startsWith('.'));

function meta(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = fm ? text.slice(fm[0].length) : text;
  let tags = [];
  if (fm) {
    const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
    if (inline) tags = inline[1].split(',').map((t) => t.trim().replace(/^['"#]+|['"]+$/g, '')).filter(Boolean);
    else {
      const block = fm[1].match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
      if (block) tags = block[1].split('\n').map((t) => t.trim().replace(/^-\s*/, '').replace(/^['"#]+|['"]+$/g, '')).filter(Boolean);
    }
  }
  const plain = body.replace(CODE, '');
  return {
    links: [...new Set([...plain.matchAll(WIKILINK)].map((m) => m[1].trim()))].sort(),
    tags: [...new Set([...tags, ...[...plain.matchAll(TAG)].map((m) => m[1])])].sort(),
  };
}

function parentsOf(p) {
  const seg = p.split('/');
  return seg.slice(0, -1).map((_, i) => seg.slice(0, i + 1).join('/'));
}

export const vault = {
  /** Every note, for downloading: [{path, text}]. */
  all() {
    const v = read();
    return Object.entries(v.files).filter(([p]) => !hidden(p)).map(([path, f]) => ({ path, text: f.text }));
  },
  /** Add notes from files (imports): [{path, text}]. Existing notes with the same path are kept as "name 2". */
  add(list) {
    const v = read();
    for (const { path, text } of list) {
      let p = cleanPath(path);
      for (let n = 2; v.files[p]; n++) p = p.replace(/( \d+)?\.md$/i, ` ${n}.md`);
      v.files[p] = { text, mtime: now() };
      for (const d of parentsOf(p)) if (!v.folders.includes(d)) v.folders.push(d);
    }
    write(v);
  },

  async handle(method, url, body) {
    const u = new URL(url, location.href);
    const route = u.pathname.replace(/^.*\/api\/notes\//, '');
    const v = read();
    if (route === 'tree' && method === 'GET') {
      const files = Object.entries(v.files).filter(([p]) => !hidden(p))
        .map(([path, f]) => ({ path, mtime: f.mtime, size: f.text.length, ...meta(f.text) }));
      const folders = new Set(v.folders.filter((d) => !hidden(d)));
      for (const f of files) for (const d of parentsOf(f.path)) folders.add(d);
      return { root: '', name: 'Notes on this device', files, folders: [...folders].sort() };
    }
    if (route === 'file' && method === 'GET') {
      const p = cleanPath(u.searchParams.get('path'));
      const f = v.files[p];
      if (!f) fail(404, 'No such note.');
      return { path: p, content: f.text, mtime: f.mtime };
    }
    if (route === 'file' && method === 'PUT') {
      const p = cleanPath(body.path);
      const content = String(body.content ?? '');
      const f = v.files[p];
      if (body.create && f) fail(409, 'A note with that name already exists.', { exists: true });
      if (f && body.baseMtime != null && !body.force && Math.abs(f.mtime - Number(body.baseMtime)) > 0.002) {
        fail(409, 'Changed in another tab.', { conflict: true, mtime: f.mtime, content: f.text });
      }
      const mtime = Math.max(now(), (f?.mtime || 0) + 0.01);
      v.files[p] = { text: content, mtime };
      write(v);
      return { path: p, mtime };
    }
    if (route === 'file' && method === 'DELETE') {
      const p = cleanPath(u.searchParams.get('path'));
      const f = v.files[p];
      if (f) {
        let target = `.trash/${p.slice(p.lastIndexOf('/') + 1)}`;
        for (let n = 1; v.files[target]; n++) target = `.trash/${stem(p)} ${n}.md`;
        v.files[target] = f;
        delete v.files[p];
        write(v);
      }
      return { ok: true };
    }
    if (route === 'rename' && method === 'POST') {
      const from = cleanPath(body.from);
      const to = cleanPath(body.to);
      const f = v.files[from];
      if (!f) fail(404, 'No such note.');
      if (v.files[to] && to !== from) fail(409, 'A note with that name already exists.');
      delete v.files[from];
      f.mtime = Math.max(now(), f.mtime + 0.01);
      v.files[to] = f;
      for (const d of parentsOf(to)) if (!v.folders.includes(d)) v.folders.push(d);
      let linksUpdated = 0;
      const old = stem(from);
      const next = stem(to);
      if (old !== next && body.updateLinks !== false) {
        const pattern = new RegExp(`\\[\\[${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\]|#])`, 'g');
        for (const [p, g] of Object.entries(v.files)) {
          if (hidden(p)) continue;
          const text = g.text.replace(pattern, `[[${next}`);
          if (text !== g.text) { g.text = text; g.mtime = now(); linksUpdated++; }
        }
      }
      write(v);
      return { path: to, mtime: f.mtime, linksUpdated };
    }
    if (route === 'folder' && method === 'POST') {
      const p = cleanPath(body.path, false);
      for (const d of [...parentsOf(p), p]) if (!v.folders.includes(d)) v.folders.push(d);
      write(v);
      return { path: p };
    }
    if (route === 'search' && method === 'GET') {
      const q = (u.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) return { results: [] };
      const results = [];
      const files = Object.entries(v.files).filter(([p]) => !hidden(p)).sort((a, b) => b[1].mtime - a[1].mtime);
      for (const [path, f] of files) {
        const nameHit = stem(path).toLowerCase().includes(q);
        const hits = f.text.split('\n').map((l, i) => [i, l]).filter(([, l]) => l.toLowerCase().includes(q)).slice(0, 3);
        if (nameHit || hits.length) results.push({ path, name: nameHit, hits: hits.map(([i, l]) => ({ line: i + 1, text: l.trim().slice(0, 160) })) });
        if (results.length >= 60) break;
      }
      results.sort((a, b) => Number(b.name) - Number(a.name));
      return { results };
    }
    return fail(404, 'Not a notes call.');
  },
};
