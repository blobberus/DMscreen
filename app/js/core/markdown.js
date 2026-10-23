// Obsidian-flavoured markdown, adapted from Stone Wardens' core/markdown.js:
// [[wikilinks|alias]], [[note#heading]], > [!callouts], ==highlights==, %%comments%%, #tags,
// task lists, tables, YAML frontmatter. Links resolve against the vault through setResolver().
import { Marked } from '../../vendor/marked/marked.esm.js';
import DOMPurify from '../../vendor/dompurify/purify.es.mjs';
import { load as yamlLoad, dump as yamlDump } from '../../vendor/js-yaml/js-yaml.mjs';
import { escapeHtml, slugify } from './util.js';

const CALLOUT_ALIASES = {
  summary: 'abstract', tldr: 'abstract', hint: 'tip', important: 'tip', check: 'success', done: 'success',
  help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure',
  error: 'danger', cite: 'quote',
};
const TAG_RE = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u;

let resolver = (target) => ({ exists: false, path: null });
/** fn(target) -> {exists, path} */
export function setResolver(fn) { resolver = fn; }

export function parseLink(raw) {
  const [left, alias] = String(raw).split('|');
  const [target, anchor] = left.split('#');
  return { target: target.trim(), anchor: (anchor || '').trim(), alias: (alias || '').trim() };
}

const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'wikilink', raw: m[0], body: m[1] };
  },
  renderer(t) {
    const p = parseLink(t.body);
    const r = resolver(p.target);
    const label = p.alias || (p.anchor ? `${p.target} › ${p.anchor}` : p.target);
    return `<a class="wikilink${r.exists ? '' : ' is-unresolved'}" href="#" data-target="${escapeHtml(p.target)}" data-anchor="${escapeHtml(p.anchor)}" title="${escapeHtml(r.exists ? r.path : `Create “${p.target}”`)}">${escapeHtml(label)}</a>`;
  },
};

const embed = {
  name: 'embed',
  level: 'inline',
  start: (src) => { const i = src.indexOf('![['); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^!\[\[([^\]\n]+?)\]\]/.exec(src);
    if (m) return { type: 'embed', raw: m[0], body: m[1] };
  },
  renderer(t) {
    const p = parseLink(t.body);
    if (/^https?:\/\//.test(p.target)) return `<img src="${escapeHtml(p.target)}" alt="">`;
    return `<a class="wikilink embed-link" href="#" data-target="${escapeHtml(p.target)}">↳ ${escapeHtml(p.alias || p.target)}</a>`;
  },
};

const highlight = {
  name: 'highlight',
  level: 'inline',
  start: (src) => { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
    if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
};

const tag = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const re = /(^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])/gu;
    const m = re.exec(src);
    return m ? m.index + m[1].length : undefined;
  },
  tokenizer(src) {
    const m = TAG_RE.exec(src);
    if (m) return { type: 'tag', raw: m[0], tag: m[1] };
  },
  renderer(t) { return `<a class="tag" href="#" data-tag="${escapeHtml(t.tag)}">#${escapeHtml(t.tag)}</a>`; },
};

const callout = {
  name: 'callout',
  level: 'block',
  start(src) { const m = /^ {0,3}>\s*\[!/m.exec(src); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^( {0,3}>[^\n]*(?:\n|$))+/.exec(src);
    if (!m) return;
    const lines = m[0].replace(/\n$/, '').split('\n').map((l) => l.replace(/^ {0,3}> ?/, ''));
    const head = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(lines[0].trim());
    if (!head) return;
    const kind = head[1].toLowerCase();
    const token = {
      type: 'callout', raw: m[0], kind: CALLOUT_ALIASES[kind] || kind, fold: head[2],
      title: head[3] || kind.charAt(0).toUpperCase() + kind.slice(1), tokens: [], titleTokens: [],
    };
    this.lexer.blockTokens(lines.slice(1).join('\n'), token.tokens);
    this.lexer.inline(token.title, token.titleTokens);
    return token;
  },
  renderer(t) {
    const cls = ['callout', t.fold ? 'is-collapsible' : '', t.fold === '-' ? 'is-collapsed' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-callout="${escapeHtml(t.kind)}"><div class="callout-title">${this.parser.parseInline(t.titleTokens)}</div>`
      + `<div class="callout-content">${this.parser.parse(t.tokens)}</div></div>`;
  },
  childTokens: ['tokens', 'titleTokens'],
};

const renderer = {
  heading({ tokens, depth, text }) {
    return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  },
  link({ href, title, tokens }) {
    const inner = this.parser.parseInline(tokens);
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a class="external" href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
  },
};

const md = new Marked({ gfm: true, breaks: true });
md.use({ extensions: [callout, embed, wikilink, highlight, tag], renderer });

function outsideCode(src, fn) {
  return src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => (i % 2 ? part : fn(part))).join('');
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text || '');
  if (!m) return { data: {}, body: text || '' };
  let data = {};
  try { data = yamlLoad(m[1]) || {}; } catch { /* leave it */ }
  return { data: typeof data === 'object' && !Array.isArray(data) ? data : {}, body: text.slice(m[0].length) };
}

export function stringifyFrontmatter(data, body = '') {
  const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (!Object.keys(clean).length) return body;
  return `---\n${yamlDump(clean, { lineWidth: 120 })}---\n${body.replace(/^\n+/, '')}`;
}

/** Toggle the n-th task checkbox the way they render (not in code or frontmatter). */
export function toggleTask(src, index, checked) {
  const { body } = parseFrontmatter(src);
  const offset = src.length - body.length;
  const lines = body.split('\n');
  let i = -1;
  let fence = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const unquoted = line.replace(/^(\s*>)+\s?/, '');
    const f = /^\s*(```+|~~~+)/.exec(unquoted);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const m = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line);
    if (!m) continue;
    i += 1;
    if (i === index) {
      lines[n] = `${m[1]}${checked ? 'x' : ' '}${m[3]}${line.slice(m[0].length)}`;
      return src.slice(0, offset) + lines.join('\n');
    }
  }
  return src;
}

export function renderMarkdown(src) {
  const { body } = parseFrontmatter(String(src ?? ''));
  const pre = outsideCode(body, (part) => part.replace(/%%[\s\S]*?%%/g, ''));
  return DOMPurify.sanitize(md.parse(pre), { ADD_ATTR: ['target', 'data-target', 'data-anchor', 'data-tag'], ADD_TAGS: ['input'] });
}

/** Render into el and wire links, tags, folding callouts and task boxes. */
export function renderInto(el, src, { onLink, onTag, onTaskToggle } = {}) {
  el.classList.add('prose');
  el.innerHTML = renderMarkdown(src);
  el.querySelectorAll('.callout.is-collapsible > .callout-title').forEach((t) => {
    t.setAttribute('role', 'button');
    t.tabIndex = 0;
    const toggle = () => t.parentElement.classList.toggle('is-collapsed');
    t.addEventListener('click', toggle);
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  el.querySelectorAll('a.wikilink').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); onLink?.(a.dataset.target, a.dataset.anchor); }));
  el.querySelectorAll('a.tag').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); onTag?.(a.dataset.tag); }));
  const boxes = [...el.querySelectorAll('li input[type="checkbox"]')];
  boxes.forEach((box, i) => {
    box.closest('li')?.classList.add('task-list-item');
    if (!onTaskToggle) return;
    box.disabled = false;
    box.addEventListener('change', () => onTaskToggle(i, box.checked));
  });
  return el;
}
