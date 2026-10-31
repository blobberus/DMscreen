// Tiny hyperscript helpers (the same contract as Stone Wardens' core/dom.js).
// h('div', {class: 'x', onclick: fn}, 'text', child, [more])

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate', 'innerHTML', 'textContent', 'htmlFor', 'draggable']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'use', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'title']);

export function h(tag, attrs, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Replace el's children with the given children. */
export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** An outline icon from the sprite. */
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `img/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

/** Write text or an attribute only when it differs: an identical write still counts as a change and restyles. */
export function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
export function setAttr(el, name, value) { if (el.getAttribute(name) !== value) el.setAttribute(name, value); }

/** Point an existing icon at another symbol. */
export function setIcon(svg, name) {
  const use = svg.querySelector('use');
  if (use) setAttr(use, 'href', `img/icons.svg#i-${name}`);
}
