// charts.js — small hand-drawn SVG charts (no outside code, works offline).
// One series per chart; a crosshair + readout follows your finger or the arrow keys,
// and every value is also in the table under the chart.

const NS = 'http://www.w3.org/2000/svg';
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; min = Math.max(0, min - 1); }
  const span = max - min, raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}

const fmtDate = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * Draw a chart into `host`.
 * opts: { kind: 'line' | 'column', points: [{ date: Date, y: number, text: string }],
 *         yMin?, yMax?, unit: string, label: string (for screen readers) }
 * `text` is the readout shown for that point (plain text).
 */
export function draw(host, opts) {
  const { kind = 'line', points, unit = '', label = '' } = opts;
  host.textContent = '';
  if (!points.length) return;
  const W = Math.max(280, host.clientWidth || 340), H = opts.height || 200;
  const pad = { l: 40, r: 14, t: 14, b: 28 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const ys = points.map(p => p.y);
  const ticks = niceTicks(opts.yMin ?? (kind === 'column' ? 0 : Math.min(...ys)), opts.yMax ?? Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const t0 = +points[0].date, t1 = +points[points.length - 1].date;
  const n = points.length;
  // Columns sit in equal slots; lines use real time spacing.
  const xAt = i => kind === 'column'
    ? pad.l + (iw / n) * (i + 0.5)
    : pad.l + (t1 === t0 ? iw / 2 : ((+points[i].date - t0) / (t1 - t0)) * iw);
  const yAt = v => pad.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  const ink = css('--chalk-dim') || '#a9b1ba', grid = css('--mat-edge') || '#33414f';
  const mark = css('--birch') || '#d9b27c', surface = css('--mat-raised') || '#212c38';

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, tabindex: '0', class: 'chart-svg' });

  // gridlines + y ticks
  for (const t of ticks) {
    const y = yAt(t);
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: grid, 'stroke-width': 1 }));
    const tx = el('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', fill: ink, 'font-size': 12 });
    tx.textContent = t >= 1000 ? `${+(t / 1000).toFixed(1)}K` : String(t);
    svg.append(tx);
  }
  // x labels: first, last, and one in the middle when there's room
  const xi = n <= 2 ? [...new Set([0, n - 1])] : [0, Math.floor((n - 1) / 2), n - 1];
  for (const i of xi) {
    const tx = el('text', { x: xAt(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', fill: ink, 'font-size': 12 });
    if (kind === 'column') tx.setAttribute('text-anchor', 'middle');
    tx.textContent = fmtDate(points[i].date);
    svg.append(tx);
  }

  if (kind === 'column') {
    const slot = iw / n, bw = Math.min(24, Math.max(4, slot - 2)); // ≤24 px, 2 px air between
    points.forEach((p, i) => {
      const x = xAt(i) - bw / 2, top = yAt(p.y), base = yAt(y0), h = Math.max(1, base - top), r = Math.min(4, bw / 2, h);
      // rounded data end, square at the baseline
      svg.append(el('path', { d: `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`, fill: mark, class: 'chart-mark' }));
    });
  } else {
    // a 10% wash under the line, then the 2 px line, then ringed dots
    const pts = points.map((p, i) => [xAt(i), yAt(p.y)]);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    if (n > 1) {
      svg.append(el('path', { d: `${d} L${pts[n - 1][0]},${yAt(y0)} L${pts[0][0]},${yAt(y0)} Z`, fill: mark, 'fill-opacity': 0.1 }));
      svg.append(el('path', { d, fill: 'none', stroke: mark, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    pts.forEach(q => svg.append(el('circle', { cx: q[0], cy: q[1], r: 4, fill: mark, stroke: surface, 'stroke-width': 2 })));
    // label the latest value only
    const last = pts[n - 1];
    const lt = el('text', { x: Math.min(last[0], W - pad.r), y: Math.max(12, last[1] - 10), 'text-anchor': 'end', fill: css('--chalk') || '#edeae3', 'font-size': 13, 'font-weight': 700 });
    lt.textContent = `${points[n - 1].y}${unit ? ' ' + unit : ''}`;
    svg.append(lt);
  }

  // crosshair + readout
  const cross = el('line', { y1: pad.t, y2: pad.t + ih, stroke: ink, 'stroke-width': 1, visibility: 'hidden' });
  svg.append(cross);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.append(svg, tip);

  let sel = -1;
  const show = i => {
    sel = Math.max(0, Math.min(n - 1, i));
    const x = xAt(sel);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const v = document.createElement('strong'); v.textContent = `${points[sel].y}${unit ? ' ' + unit : ''}`;
    const s = document.createElement('span'); s.textContent = `${fmtDate(points[sel].date)}. ${points[sel].text || ''}`;
    tip.append(v, s);
    tip.hidden = false;
    const left = Math.min(Math.max(0, x - tip.offsetWidth / 2), W - tip.offsetWidth);
    tip.style.left = `${left}px`;
  };
  const nearest = clientX => {
    const r = svg.getBoundingClientRect(), px = clientX - r.left;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const dd = Math.abs(xAt(i) - px); if (dd < bd) { bd = dd; best = i; } }
    return best;
  };
  svg.addEventListener('pointerdown', e => show(nearest(e.clientX)));
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) show(nearest(e.clientX)); });
  svg.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { show(sel < 0 ? 0 : sel + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { show(sel < 0 ? n - 1 : sel - 1); e.preventDefault(); }
  });
  svg.addEventListener('focus', () => { if (sel < 0) show(n - 1); });
}
