// OWNER: Worker 2. Graphs from ```plot blocks (SPEC 9.7), drawn as SVG with DOM
// calls only. Colors come from CSS classes that use the --plot-* tokens.
//
// ```plot
// { "title": "Titration curve", "x": { "label": "mL NaOH", "min": 0, "max": 50 },
//   "y": { "label": "pH", "min": 0, "max": 14 },
//   "series": [ { "label": "fit", "fn": "7 + 6*atan((x-25)/2)/pi" },
//               { "label": "data", "points": [[0,1.2],[10,1.8],[25,7],[40,12.1]] } ] }
// ```

import { compileExpression } from './expr.js';

const SVG = 'http://www.w3.org/2000/svg';
const MAX_SERIES = 6;
const MAX_POINTS = 2000;
const SAMPLES = 240;
const W = 320;
const H = 200;
const PAD = { left: 40, right: 10, top: 12, bottom: 32 };

export class PlotError extends Error {}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const label = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Validate a plot spec (already JSON-parsed or a JSON string). Throws PlotError.
 * @returns {{ title: string, x: { label: string, min: number, max: number },
 *   y: { label: string, min: number, max: number },
 *   series: { label: string, points: [number, number][], kind: 'fn'|'points' }[] }}
 */
export function parsePlot(input) {
  let spec = input;
  if (typeof input === 'string') {
    try {
      spec = JSON.parse(input);
    } catch {
      throw new PlotError('The graph is not valid JSON');
    }
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new PlotError('The graph must be a JSON object');
  const ax = spec.x || {};
  const xMin = isNum(ax.min) ? ax.min : null;
  const xMax = isNum(ax.max) ? ax.max : null;
  if (!Array.isArray(spec.series) || !spec.series.length) throw new PlotError('The graph has no series');
  if (spec.series.length > MAX_SERIES) throw new PlotError(`At most ${MAX_SERIES} series`);

  // x range: given, or from the data points.
  const allPts = spec.series.flatMap((s) => (s && Array.isArray(s.points) ? s.points : []));
  let lo = xMin;
  let hi = xMax;
  if (lo === null || hi === null) {
    const xs = allPts.filter((p) => Array.isArray(p) && isNum(p[0])).map((p) => p[0]);
    if (lo === null) lo = xs.length ? Math.min(...xs) : 0;
    if (hi === null) hi = xs.length ? Math.max(...xs) : 10;
  }
  if (!(hi > lo)) throw new PlotError('x.max must be greater than x.min');

  const series = spec.series.map((s, i) => {
    if (!s || typeof s !== 'object') throw new PlotError(`Series ${i + 1} is not an object`);
    const name = label(s.label, 40) || `Series ${i + 1}`;
    if (typeof s.fn === 'string') {
      let f;
      try {
        f = compileExpression(s.fn);
      } catch (err) {
        throw new PlotError(`Series "${name}": ${err.message}`);
      }
      const points = [];
      for (let k = 0; k <= SAMPLES; k += 1) {
        const x = lo + ((hi - lo) * k) / SAMPLES;
        points.push([x, f(x)]);
      }
      return { label: name, points, kind: 'fn' };
    }
    if (Array.isArray(s.points)) {
      if (s.points.length > MAX_POINTS) throw new PlotError(`Series "${name}" has too many points`);
      const points = s.points.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map((p) => [p[0], p[1]]);
      if (!points.length) throw new PlotError(`Series "${name}" has no valid points`);
      return { label: name, points, kind: 'points' };
    }
    throw new PlotError(`Series "${name}" needs "fn" or "points"`);
  });

  // y range: given, or from the finite values (with a little headroom).
  const ay = spec.y || {};
  let yLo = isNum(ay.min) ? ay.min : null;
  let yHi = isNum(ay.max) ? ay.max : null;
  if (yLo === null || yHi === null) {
    const ys = series.flatMap((s) => s.points.map((p) => p[1])).filter(isNum).sort((a, b) => a - b);
    if (!ys.length) throw new PlotError('Nothing to draw: every value is undefined');
    // Ignore the extreme 1% so asymptotes (tan, 1/x) don't flatten everything.
    const cut = Math.floor(ys.length * 0.01);
    const a = ys[cut];
    const b = ys[ys.length - 1 - cut];
    const span = b - a || Math.abs(a) || 1;
    if (yLo === null) yLo = a - span * 0.05;
    if (yHi === null) yHi = b + span * 0.05;
  }
  if (!(yHi > yLo)) throw new PlotError('y.max must be greater than y.min');

  return {
    title: label(spec.title, 80),
    x: { label: label(ax.label), min: lo, max: hi },
    y: { label: label(ay.label), min: yLo, max: yHi },
    series,
  };
}

/** About `count` round tick values between lo and hi. */
export function niceTicks(lo, hi, count = 5) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // The round step (1, 2 or 5 times a power of ten) closest to the raw step.
  const step = [1, 2, 5, 10].map((m) => m * mag)
    .reduce((best, s) => (Math.abs(Math.log(s / raw)) < Math.abs(Math.log(best / raw)) ? s : best));
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function formatTick(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
  return String(Number(v.toPrecision(4)));
}

function svgEl(doc, tag, attrs = {}, cls) {
  const n = doc.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (cls) n.setAttribute('class', cls);
  return n;
}

/**
 * Split a sampled curve into drawable runs: undefined values and jumps far off
 * the chart (asymptotes) break the line.
 */
export function segments(points, sx, sy, yLo, yHi) {
  const runs = [];
  let run = [];
  const span = yHi - yLo;
  for (const [x, y] of points) {
    if (!isNum(y) || y < yLo - span * 2 || y > yHi + span * 2) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    run.push([sx(x), sy(y)]);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/**
 * Draw a validated plot.
 * @param {ReturnType<typeof parsePlot>} plot
 * @param {Document} doc
 */
export function drawPlot(plot, doc) {
  const { x, y } = plot;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const sx = (v) => +(PAD.left + ((v - x.min) / (x.max - x.min)) * iw).toFixed(2);
  const sy = (v) => +(PAD.top + ih - ((v - y.min) / (y.max - y.min)) * ih).toFixed(2);

  const svg = svgEl(doc, 'svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': plot.title || 'Graph',
    preserveAspectRatio: 'xMidYMid meet',
  }, 'rich-plot-svg');
  const clipId = `plot-clip-${Math.random().toString(36).slice(2, 10)}`;
  const defs = svgEl(doc, 'defs');
  const clip = svgEl(doc, 'clipPath', { id: clipId });
  clip.appendChild(svgEl(doc, 'rect', { x: PAD.left, y: PAD.top, width: iw, height: ih }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Grid and tick labels.
  for (const t of niceTicks(x.min, x.max)) {
    svg.appendChild(svgEl(doc, 'line', { x1: sx(t), x2: sx(t), y1: PAD.top, y2: PAD.top + ih }, 'plot-grid'));
    const tx = svgEl(doc, 'text', { x: sx(t), y: PAD.top + ih + 11, 'text-anchor': 'middle' }, 'plot-tick');
    tx.textContent = formatTick(t);
    svg.appendChild(tx);
  }
  for (const t of niceTicks(y.min, y.max)) {
    svg.appendChild(svgEl(doc, 'line', { x1: PAD.left, x2: PAD.left + iw, y1: sy(t), y2: sy(t) }, 'plot-grid'));
    const ty = svgEl(doc, 'text', { x: PAD.left - 4, y: sy(t) + 3, 'text-anchor': 'end' }, 'plot-tick');
    ty.textContent = formatTick(t);
    svg.appendChild(ty);
  }
  // Axes box.
  svg.appendChild(svgEl(doc, 'rect', { x: PAD.left, y: PAD.top, width: iw, height: ih }, 'plot-axis'));
  if (x.label) {
    const t = svgEl(doc, 'text', { x: PAD.left + iw / 2, y: H - 4, 'text-anchor': 'middle' }, 'plot-label');
    t.textContent = x.label;
    svg.appendChild(t);
  }
  if (y.label) {
    const t = svgEl(doc, 'text', { x: 10, y: PAD.top + ih / 2, 'text-anchor': 'middle', transform: `rotate(-90 10 ${PAD.top + ih / 2})` }, 'plot-label');
    t.textContent = y.label;
    svg.appendChild(t);
  }

  // Series.
  const body = svgEl(doc, 'g', { 'clip-path': `url(#${clipId})` });
  plot.series.forEach((s, i) => {
    const cls = `plot-series plot-series-${(i % 4) + 1}`;
    if (s.kind === 'fn') {
      for (const run of segments(s.points, sx, sy, y.min, y.max)) {
        body.appendChild(svgEl(doc, 'polyline', { points: run.map((p) => p.join(',')).join(' '), fill: 'none' }, `${cls} plot-line`));
      }
    } else {
      for (const [px, py] of s.points) {
        body.appendChild(svgEl(doc, 'circle', { cx: sx(px), cy: sy(py), r: 2.5 }, `${cls} plot-point`));
      }
    }
  });
  svg.appendChild(body);

  const fig = doc.createElement('figure');
  fig.className = 'rich-plot';
  if (plot.title) {
    const cap = doc.createElement('figcaption');
    cap.className = 'rich-plot-title';
    cap.textContent = plot.title;
    fig.appendChild(cap);
  }
  fig.appendChild(svg);
  if (plot.series.length > 1 || plot.series[0].label !== 'Series 1') {
    const legend = doc.createElement('div');
    legend.className = 'rich-plot-legend';
    plot.series.forEach((s, i) => {
      const item = doc.createElement('span');
      item.className = `rich-plot-key plot-series-${(i % 4) + 1}`;
      item.textContent = s.label;
      legend.appendChild(item);
    });
    fig.appendChild(legend);
  }
  return fig;
}

/**
 * Fence handler for ```plot: a figure, or the code with a short note when the
 * graph can't be drawn.
 */
export function renderPlotBlock(source, doc) {
  try {
    return drawPlot(parsePlot(source), doc);
  } catch (err) {
    const box = doc.createElement('div');
    box.className = 'rich-plot rich-plot-error';
    const note = doc.createElement('p');
    note.className = 'rich-plot-note';
    note.textContent = `Couldn't draw this graph${err instanceof Error && err.message ? `: ${err.message}` : ''}.`;
    const pre = doc.createElement('pre');
    pre.className = 'rich-code';
    const code = doc.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    box.appendChild(note);
    box.appendChild(pre);
    return box;
  }
}
