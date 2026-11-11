// Small hand-built charts for the project dashboard (no chart library): progress S-curve, status donut, bar list.
// Marks follow the dataviz rules: 2px lines, 10% area wash, hairline solid grid, 2px surface gaps and rings,
// text in text colours (never the series colour), a legend for two series, hover/focus readouts.
import { h, fmt } from '../core/ui.js';
import { locale, t } from '../core/i18n.js';
import { DOC_STATUS, statusOf } from '../core/domain.js';

const S = (tag, attrs = {}, ...kids) => h(tag, { svg: true, ...attrs }, ...kids);
const DAY = 86400000;
const parse = (d) => (d ? Date.parse(`${String(d).slice(0, 10)}T00:00:00`) : NaN);

/**
 * Cumulative planned vs actual progress. Planned: a deliverable counts 100% on its plan date. Actual: its current
 * status weight on its actual date; today's actual equals the weighted progress shown in the KPI row.
 */
export function sCurveData(docs, { start, finish, progress, today = fmt.today() }) {
  const n = docs.length;
  if (!n) return null;
  const tToday = parse(today);
  const all = [start, finish, ...docs.flatMap((d) => [d.planDate, d.actualDate])].map(parse).filter(isFinite);
  if (!all.length) return null;
  const a = Math.min(...all, tToday), b = Math.max(...all, tToday);
  if (b - a < DAY) return null;
  const steps = 60;
  const xs = Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps).filter((x) => Math.abs(x - tToday) > (b - a) / steps / 2);
  xs.push(tToday);
  xs.sort((p, q) => p - q);
  const plan = docs.map((d) => parse(d.planDate)), act = docs.map((d) => [parse(d.actualDate), statusOf(d.status).w]);
  const pts = xs.map((x) => {
    const planned = (100 * plan.filter((t) => t <= x).length) / n;
    let actual = null;
    if (x < tToday) actual = act.reduce((s, [t, w]) => s + (t <= x ? w : 0), 0) / n;
    else if (x === tToday) actual = progress;
    return { x, planned, actual };
  });
  // the actual curve may not dip below what was already earned
  let best = 0;
  for (const p of pts) if (p.actual != null) { p.actual = Math.max(best, p.actual); best = p.actual; }
  const now = pts.find((p) => p.x === tToday);
  return { pts, a, b, today: tToday, planned: now.planned, actual: now.actual };
}

export function sCurve(data) {
  const wrap = h('div', { class: 'chart scurve', tabindex: '0', role: 'img' });
  const tip = h('div', { class: 'ch-tip', hidden: true });
  const svgHost = h('div', { class: 'ch-svg' });
  wrap.append(svgHost, tip);
  wrap.setAttribute('aria-label', `Progress S-curve. Planned ${fmt.pct(data.planned)}, actual ${fmt.pct(data.actual)} today.`);
  let idx = -1, geo = null;

  const draw = () => {
    const W = Math.max(280, wrap.clientWidth || 600), H = W < 480 ? 210 : 250;
    const m = { l: 40, r: W < 480 ? 16 : 74, t: 14, b: 28 };
    const X = (x) => m.l + ((x - data.a) / (data.b - data.a)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
    geo = { X, Y, W, H, m };
    const grid = [0, 25, 50, 75, 100].map((v) => S('g', {},
      S('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'ch-grid' }),
      S('text', { x: m.l - 8, y: Y(v) + 4, class: 'ch-tick', 'text-anchor': 'end' }, `${v}%`)));
    // month ticks: at most ~6
    const months = [];
    const d0 = new Date(data.a); d0.setDate(1); d0.setHours(0, 0, 0, 0);
    for (let d = new Date(d0); d.getTime() <= data.b; d.setMonth(d.getMonth() + 1)) if (d.getTime() >= data.a) months.push(d.getTime());
    const every = Math.max(1, Math.ceil(months.length / (W < 480 ? 3 : 6)));
    const xt = months.filter((_, i) => i % every === 0).map((t) => S('text', { x: X(t), y: H - 8, class: 'ch-tick', 'text-anchor': 'middle' }, new Date(t).toLocaleDateString(locale(), { month: 'short', year: '2-digit' })));
    const line = (key) => data.pts.filter((p) => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');
    const actPts = data.pts.filter((p) => p.actual != null);
    const area = `${line('actual')}L${X(actPts.at(-1).x).toFixed(1)},${Y(0)}L${X(actPts[0].x).toFixed(1)},${Y(0)}Z`;
    const lastP = data.pts.at(-1);
    const end = [];
    if (m.r > 40) {
      const yp = Y(lastP.planned), ya = Y(data.actual);
      const xa = X(data.today);
      end.push(S('text', { x: X(lastP.x) + 8, y: yp + 4, class: 'ch-end' }, `${Math.round(lastP.planned)}%`));
      if (Math.abs(xa - X(lastP.x)) > 40 || Math.abs(ya - yp) > 16) end.push(S('text', { x: xa + 8, y: ya - 8, class: 'ch-end strong' }, `${Math.round(data.actual)}%`));
    }
    const svg = S('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
      S('g', {}, grid), S('g', {}, xt),
      S('line', { x1: X(data.today), x2: X(data.today), y1: m.t, y2: H - m.b, class: 'ch-today' }),
      S('text', { x: X(data.today), y: m.t - 3, class: 'ch-tick', 'text-anchor': 'middle' }, t('Today')),
      S('path', { d: area, class: 'ch-area' }),
      S('path', { d: line('planned'), class: 'ch-line plan' }),
      S('path', { d: line('actual'), class: 'ch-line act' }),
      S('circle', { cx: X(lastP.x), cy: Y(lastP.planned), r: 4, class: 'ch-dot plan' }),
      S('circle', { cx: X(data.today), cy: Y(data.actual), r: 4.5, class: 'ch-dot act' }),
      ...end,
      S('g', { class: 'ch-hover', opacity: 0 },
        S('line', { class: 'ch-cross', y1: m.t, y2: H - m.b }),
        S('circle', { r: 4, class: 'ch-dot plan h' }),
        S('circle', { r: 4.5, class: 'ch-dot act h' })));
    svgHost.replaceChildren(svg);
    if (idx >= 0) show(idx);
  };

  function show(i) {
    idx = i;
    const p = data.pts[i], { X, Y } = geo;
    const g = svgHost.querySelector('.ch-hover');
    g.setAttribute('opacity', 1);
    const x = X(p.x);
    g.children[0].setAttribute('x1', x); g.children[0].setAttribute('x2', x);
    g.children[1].setAttribute('cx', x); g.children[1].setAttribute('cy', Y(p.planned));
    g.children[2].setAttribute('cx', x); g.children[2].setAttribute('cy', p.actual == null ? -20 : Y(p.actual));
    tip.hidden = false;
    tip.replaceChildren(
      h('div', { class: 'ch-tip-h' }, new Date(p.x).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' })),
      p.actual != null ? h('div', { class: 'ch-tip-r' }, h('i', { class: 'k act' }), h('b', {}, fmt.pct(p.actual)), h('span', {}, 'Actual')) : null,
      h('div', { class: 'ch-tip-r' }, h('i', { class: 'k plan' }), h('b', {}, fmt.pct(p.planned)), h('span', {}, 'Planned')));
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(geo.W - tw - 4, Math.max(4, x + 12))}px`;
    tip.style.top = `${geo.m.t}px`;
  }
  const hide = () => { idx = -1; tip.hidden = true; svgHost.querySelector('.ch-hover')?.setAttribute('opacity', 0); };
  const nearest = (clientX) => {
    const r = svgHost.getBoundingClientRect(), x = clientX - r.left;
    let best = 0, bd = Infinity;
    data.pts.forEach((p, i) => { const d = Math.abs(geo.X(p.x) - x); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  wrap.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  wrap.addEventListener('pointerleave', hide);
  wrap.addEventListener('blur', hide);
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const start = idx < 0 ? data.pts.findIndex((p) => p.x === data.today) : idx;
    show(Math.max(0, Math.min(data.pts.length - 1, start + (e.key === 'ArrowRight' ? 1 : -1))));
  });
  const ro = new ResizeObserver(() => draw());
  ro.observe(wrap);
  requestAnimationFrame(draw);
  return wrap;
}

/** Status donut with a centre readout and a legend that lists every status with its count and share. */
export function statusDonut(byStatus, total) {
  const R = 62, SW = 16, C = 2 * Math.PI * R, size = 164;
  const parts = DOC_STATUS.filter((s) => byStatus[s.v]).map((s) => ({ ...s, n: byStatus[s.v] }));
  const gap = parts.length > 1 ? 3 : 0;
  let off = 0;
  const big = h('b', {}, String(total)), small = h('span', {}, 'deliverables');
  const reset = () => { big.textContent = String(total); small.textContent = 'deliverables'; wrap.classList.remove('focus'); segs.forEach((x) => x.classList.remove('on')); rows.forEach((x) => x.classList.remove('on')); };
  const focus = (i) => { const p = parts[i]; big.textContent = String(p.n); small.textContent = p.s; wrap.classList.add('focus'); segs.forEach((x, j) => x.classList.toggle('on', i === j)); rows.forEach((x, j) => x.classList.toggle('on', i === j)); };
  const segs = parts.map((p, i) => {
    const len = (p.n / total) * C;
    const c = S('circle', { cx: size / 2, cy: size / 2, r: R, class: 'dn-seg', stroke: p.c, 'stroke-width': SW, 'stroke-dasharray': `${Math.max(0.5, len - gap)} ${C}`, 'stroke-dashoffset': `${-off}`, fill: 'none' });
    c.addEventListener('pointerenter', () => focus(i));
    c.addEventListener('pointerleave', reset);
    off += len;
    return c;
  });
  const rows = parts.map((p, i) => h('li', { tabindex: '0', onpointerenter: () => focus(i), onpointerleave: reset, onfocus: () => focus(i), onblur: reset },
    h('i', { style: { background: p.c } }), h('span', { class: 'dn-l' }, p.s), h('b', {}, String(p.n)), h('em', {}, fmt.pct((100 * p.n) / total))));
  const wrap = h('div', { class: 'donut' },
    h('div', { class: 'dn-ring' },
      S('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
        S('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', class: 'dn-track', 'stroke-width': SW }),
        S('g', { transform: `rotate(-90 ${size / 2} ${size / 2})` }, segs)),
      h('div', { class: 'dn-mid' }, big, small)),
    h('ul', { class: 'dn-legend', 'aria-label': 'Status of deliverables' }, rows));
  return wrap;
}

/** Horizontal bars, one series: label and context on the left, the bar, and its value at the tip. */
export function barList(rows) {
  return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
    h('div', { class: 'bar-lbl' }, h('span', {}, r.label), h('small', {}, r.meta)),
    h('div', { class: 'bar-track', role: 'img', 'aria-label': `${r.label}: ${fmt.pct(r.value)}` }, h('i', { style: { '--w': `${Math.max(0, Math.min(100, r.value))}%` } })),
    h('b', { class: 'bar-val' }, fmt.pct(r.value)))));
}
