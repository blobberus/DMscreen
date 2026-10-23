// A mixer fader: vertical or horizontal, dragged, wheeled or moved with the arrow keys.
// value 0..1; onInput(value) while moving, onChange(value) when released.
import { h } from './dom.js';
import { clamp } from './util.js';

export function fader({ value = 0.5, label, vertical = true, onInput, onChange, format = (v) => Math.round(v * 100) } = {}) {
  const fill = h('i', { class: 'fader-fill' });
  const thumb = h('b', { class: 'fader-thumb' });
  const track = h('div', { class: 'fader-track' }, fill, thumb);
  const el = h('div', {
    class: `fader ${vertical ? 'is-v' : 'is-h'}`, role: 'slider', tabindex: 0, 'aria-label': label,
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-orientation': vertical ? 'vertical' : 'horizontal',
  }, track);
  let v = value;
  const draw = () => {
    const p = `${(v * 100).toFixed(1)}%`;
    if (vertical) { fill.style.height = p; thumb.style.bottom = p; } else { fill.style.width = p; thumb.style.left = p; }
    el.setAttribute('aria-valuenow', String(format(v)));
    el.setAttribute('aria-valuetext', `${format(v)}`);
  };
  const set = (nv, done = false) => {
    nv = clamp(Math.round(nv * 100) / 100, 0, 1);
    if (nv === v && !done) return;
    v = nv;
    draw();
    onInput?.(v);
    if (done) onChange?.(v);
  };
  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    return vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    set(fromEvent(e));
    const move = (ev) => set(fromEvent(ev));
    const up = () => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onChange?.(v);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(v + (e.deltaY < 0 ? 0.02 : -0.02), true);
  }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 };
    if (e.key in map) { e.preventDefault(); set(v + map[e.key], true); }
    if (e.key === 'Home') { e.preventDefault(); set(0, true); }
    if (e.key === 'End') { e.preventDefault(); set(1, true); }
  });
  el.addEventListener('dblclick', () => set(0.8, true));
  draw();
  return {
    el,
    get value() { return v; },
    set value(nv) { if (!el.classList.contains('is-dragging')) { v = clamp(nv, 0, 1); draw(); } },
  };
}
