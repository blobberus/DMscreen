// Waveform drawing from server-made peaks. Columns are computed once per view and recoloured cheaply
// as the playhead moves. Colours come from the tokens so both themes draw correctly.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function themeColors() {
  return {
    wave: css('--wave'), dim: css('--wave-dim'), played: css('--accent'), text: css('--text'),
    muted: css('--muted'), faint: css('--faint'), rule: css('--rule'), border: css('--border'),
    raised: css('--raised-3'), focus: css('--focus'), pane: css('--pane'),
  };
}

/** Fit a canvas to its CSS box at device resolution. Returns {ctx, w, h} in CSS pixels. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Column heights (0..1) for `cols` columns covering [t0, t1] seconds. */
export function columns(peaks, t0, t1, cols, step = 1) {
  const n = Math.max(1, Math.floor(cols / step));
  const out = new Float32Array(n);
  if (!peaks) return out;
  const { rate, data } = peaks;
  const span = (t1 - t0) / n;
  for (let x = 0; x < n; x++) {
    const a = Math.max(0, Math.floor((t0 + x * span) * rate));
    const b = Math.min(data.length, Math.max(a + 1, Math.ceil((t0 + (x + 1) * span) * rate)));
    let m = 0;
    for (let i = a; i < b; i++) if (data[i] > m) m = data[i];
    out[x] = m / 255;
  }
  return out;
}

/**
 * Draw mirrored bars. opts: {t0, t1, played (seconds or null), trim: [a, b] | null, step (px per bar),
 * gap, colors, cache} — pass the same `cache` object between frames to skip recomputing columns.
 */
export function drawBars(canvas, peaks, opts) {
  const { ctx, w, h } = fitCanvas(canvas);
  const c = opts.colors || themeColors();
  const step = opts.step || 2;
  const gap = opts.gap ?? (step >= 3 ? 1 : 0.5);
  const key = `${w}|${opts.t0}|${opts.t1}|${step}|${peaks ? peaks.data.length : 0}`;
  let cols;
  if (opts.cache && opts.cache.key === key) cols = opts.cache.cols;
  else {
    cols = columns(peaks, opts.t0, opts.t1, w, step);
    if (opts.cache) { opts.cache.key = key; opts.cache.cols = cols; }
  }
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  const span = opts.t1 - opts.t0;
  const bw = Math.max(1, step - gap);
  for (let i = 0; i < cols.length; i++) {
    const x = i * step;
    const t = opts.t0 + ((x + step / 2) / w) * span;
    const v = Math.max(0.02, cols[i]);
    const bh = Math.max(1, v * (h - 2));
    let color = c.wave;
    if (opts.trim && (t < opts.trim[0] || t > opts.trim[1])) color = c.dim;
    else if (opts.played != null && t <= opts.played) color = c.played;
    ctx.fillStyle = color;
    ctx.fillRect(x, mid - bh / 2, bw, bh);
  }
  return { w, h, colors: c };
}

export const timeToX = (t, t0, t1, w) => ((t - t0) / (t1 - t0)) * w;
export const xToTime = (x, t0, t1, w) => t0 + (x / w) * (t1 - t0);

/** A tick step (seconds) that gives about `target` labels across `span` seconds. */
export function tickStep(span, target = 8) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const s of steps) if (span / s <= target) return s;
  return 7200;
}
