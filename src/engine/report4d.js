// Weekly and monthly progress reports from the 4D model: one self-contained, printable HTML page (A4) → "Save as PDF".
// Pure (no DOM, no three.js): numbers are computed here and unit-tested; the 3D pictures are passed in as data URLs.
// Copy follows the app's design rules: sentence case, no all-caps labels, weights 400/500, tabular numbers.
import { DONE_AT, planAt } from './progress4d.js';

const T = {
  id: {
    week: { title: 'Laporan progres mingguan', unit: 'Minggu ke-', gain: 'Kenaikan minggu ini', delta: 'Δ minggu', acts: 'Pekerjaan yang maju minggu ini', issues: 'Isu dan kendala minggu ini', nothing: 'Tidak ada pekerjaan yang maju minggu ini.', look: 'Look-ahead 2 minggu', cal: 'Kenaikan progres per hari' },
    month: { title: 'Laporan progres bulanan', unit: 'Bulan', gain: 'Kenaikan bulan ini', delta: 'Δ bulan', acts: 'Pekerjaan yang maju bulan ini', issues: 'Isu dan kendala bulan ini', nothing: 'Tidak ada pekerjaan yang maju bulan ini.', look: 'Look-ahead 4 minggu', cal: 'Kalender kenaikan progres harian' },
    period: 'Periode', to: 's/d', reportDate: 'Tanggal laporan', projWeek: 'Minggu proyek', days: 'hari lapor',
    actual: 'Progres aktual', plan: 'Progres rencana', dev: 'Deviasi', spi: 'SPI',
    manpower: 'Tenaga kerja', avg: 'rata-rata', peak: 'puncak', people: 'orang', noPlan: 'tanpa baseline',
    sCurve: 'Kurva S: rencana vs aktual', planLine: 'Rencana', actualLine: 'Aktual', mpBars: 'Tenaga kerja per hari',
    model: 'Kondisi model 3D pada tanggal laporan', pkgs: 'Progres per paket pekerjaan', weeks: 'Rincian per minggu',
    pkg: 'Paket', weight: 'Bobot', status: 'Status', act: 'Aktivitas', qty: 'Volume periode ini', total: 'Kumulatif',
    target: 'Target rencana', need: 'Perlu dikejar', start: 'Mulai', finish: 'Selesai', trend: 'Proyeksi laju',
    none: 'Tidak ada isu tercatat.', overall: 'Keseluruhan', noReport: 'Tanpa laporan', issueDot: 'Ada isu', low: 'Naik sedikit', high: 'Naik banyak',
    stDone: 'Selesai', stAhead: 'Lebih cepat', stOn: 'Sesuai rencana', stBehind: 'Terlambat', stTodo: 'Belum mulai', stWip: 'Berjalan',
    src: (n, d0, d1) => `Sumber: ${n} laporan harian kontraktor (${d0} s/d ${d1}).`,
    sim: 'Data simulasi, bukan laporan kontraktor', gen: 'Dibuat dengan Review 3D',
    lookNoPlan: 'Belum ada baseline, jadi look-ahead memakai laju rata-rata 2 minggu terakhir.',
    forecast: 'Perkiraan selesai', onTrend: 'laju 4 minggu terakhir', onSpi: 'durasi rencana dibagi SPI',
    wValue: (v) => `Progres dibobot nilai kontrak (volume BQ × harga satuan), total ${v}.`, wCount: 'Progres dibobot jumlah aktivitas per paket.', blSrc: 'Baseline',
    print: 'Simpan sebagai PDF lewat menu Cetak', printBtn: 'Cetak atau simpan PDF', dow: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
    months: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  },
  en: {
    week: { title: 'Weekly progress report', unit: 'Week ', gain: 'Gained this week', delta: 'Δ week', acts: 'Work progressed this week', issues: 'Issues this week', nothing: 'No work progressed this week.', look: '2-week look-ahead', cal: 'Progress gained per day' },
    month: { title: 'Monthly progress report', unit: 'Month', gain: 'Gained this month', delta: 'Δ month', acts: 'Work progressed this month', issues: 'Issues this month', nothing: 'No work progressed this month.', look: '4-week look-ahead', cal: 'Daily progress calendar' },
    period: 'Period', to: 'to', reportDate: 'Report date', projWeek: 'Project week', days: 'report days',
    actual: 'Actual progress', plan: 'Planned progress', dev: 'Deviation', spi: 'SPI',
    manpower: 'Manpower', avg: 'average', peak: 'peak', people: 'people', noPlan: 'no baseline',
    sCurve: 'S-curve: plan vs actual', planLine: 'Plan', actualLine: 'Actual', mpBars: 'Manpower per day',
    model: '3D model at the report date', pkgs: 'Progress by work package', weeks: 'Week by week',
    pkg: 'Package', weight: 'Weight', status: 'Status', act: 'Activity', qty: 'Quantity this period', total: 'Cumulative',
    target: 'Planned', need: 'To catch up', start: 'Start', finish: 'Finish', trend: 'Rate projection',
    none: 'No issues recorded.', overall: 'Overall', noReport: 'No report', issueDot: 'Issue logged', low: 'Small gain', high: 'Large gain',
    stDone: 'Complete', stAhead: 'Ahead', stOn: 'On plan', stBehind: 'Behind', stTodo: 'Not started', stWip: 'In progress',
    src: (n, d0, d1) => `Source: ${n} contractor daily reports (${d0} to ${d1}).`,
    sim: 'Simulated data, not a contractor report', gen: 'Generated with Review 3D',
    lookNoPlan: 'No baseline yet, so the look-ahead uses the average rate of the last 2 weeks.',
    forecast: 'Forecast finish', onTrend: 'rate of the last 4 weeks', onSpi: 'planned duration divided by SPI',
    wValue: (v) => `Progress weighted by contract value (BQ quantity × unit rate), total ${v}.`, wCount: 'Progress weighted by the number of activities per package.', blSrc: 'Baseline',
    print: 'Save as PDF from the Print menu', printBtn: 'Print or save PDF', dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (d) => Date.parse(`${d}T00:00:00Z`);

/** Index of the last report on or before a date (−1 if none). */
function idxAtOrBefore(dates, isoDate) {
  let k = -1;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= isoDate) k = i; else break;
  return k;
}

/** All the numbers of a report for report day `di`. kind: 'week' (7 days ending on the report day) or 'month' (1st → report day). */
export function periodFacts(model, di, kind = 'week') {
  const D = model.dates, n = D.length;
  di = Math.max(0, Math.min(n - 1, Math.round(di)));
  const date = D[di], t0 = utc(D[0]), tr = utc(date);
  const week = Math.floor((tr - t0) / (7 * DAY)) + 1;
  const from = kind === 'month' ? `${date.slice(0, 7)}-01` : iso(tr - 6 * DAY);
  const prev = idxAtOrBefore(D, iso(utc(from) - DAY));          // last report before the period
  const at = (arr, i) => (i < 0 ? 0 : arr[i]);
  const real = model.pkgs.filter((p) => !p.summary);
  const pkgs = real.map((p) => {
    const actual = p.curve[di], plan = p.plan ? p.plan[di] : null, wk = actual - at(p.curve, prev);
    const status = actual >= DONE_AT ? 'done' : actual <= 0.05 && !(plan > 0.5) ? 'todo' : plan == null ? 'wip' : actual - plan > 1 ? 'ahead' : actual - plan < -1 ? 'behind' : 'on';
    return { id: p.id, name: p.name, area: p.area, w: p.w, actual, plan, dev: plan == null ? null : actual - plan, wk, status, bl: p.bl || null };
  });
  const acts = [];
  for (const p of real) for (const a of p.acts) {
    const d = a.pct[di] - at(a.pct, prev);
    if (d > 0.05) acts.push({ pkg: p.name, desc: a.desc, unit: a.unit, bq: a.bq, d, qty: (a.bq * d) / 100, total: a.pct[di] });
  }
  acts.sort((x, y) => y.d - x.d);
  const days = [];
  for (let i = prev + 1; i <= di; i++) days.push(i);
  const mp = days.map((i) => model.manpower[i]).filter((x) => x != null);
  const issues = [...new Set(days.flatMap((i) => model.concerns[D[i]] || []))];
  // calendar: every calendar day of the period with the overall % gained that day (null = no report)
  const cal = [];
  for (let t = utc(from); t <= tr; t += DAY) {
    const d = iso(t), i = D.indexOf(d);
    cal.push({ date: d, gain: i < 0 ? null : model.overall[i] - at(model.overall, i - 1), mp: i < 0 ? null : model.manpower[i], issue: i >= 0 && (model.concerns[d] || []).length > 0 });
  }
  // month: week-by-week gains, in 7-day steps back from the report day
  const weeks = [];
  if (kind === 'month') {
    for (let e = tr; e >= utc(from); e -= 7 * DAY) {
      const s = Math.max(utc(from), e - 6 * DAY), i1 = idxAtOrBefore(D, iso(e)), i0 = idxAtOrBefore(D, iso(s - DAY));
      weeks.unshift({ from: iso(s), to: iso(e), week: Math.floor((e - t0) / (7 * DAY)) + 1, gain: at(model.overall, i1) - at(model.overall, i0), plan: model.plan ? at(model.plan, i1) - at(model.plan, i0) : null, actual: at(model.overall, i1) });
    }
  }
  // look-ahead: planned progress at the horizon vs today's actual
  const horizon = kind === 'month' ? 28 : 14;
  const look = [];
  const tEnd = tr + horizon * DAY;
  const rate = (p) => { // %/day over the last 14 days of reports
    const j = idxAtOrBefore(D, iso(tr - 14 * DAY));
    const span = Math.max(1, (tr - utc(D[Math.max(0, j)])) / DAY);
    return (p.curve[di] - at(p.curve, j)) / span;
  };
  for (const p of real) {
    if (p.curve[di] >= DONE_AT) continue;
    if (p.bl) {
      const a = utc(p.bl.start), z = utc(p.bl.finish);
      if (a > tEnd) continue;
      const target = planAt(tEnd, a, z);
      look.push({ name: p.name, start: p.bl.start, finish: p.bl.finish, actual: p.curve[di], target, need: Math.max(0, target - p.curve[di]) });
    } else {
      const r = rate(p);
      if (r <= 0 && p.curve[di] <= 0.05) continue;
      look.push({ name: p.name, start: null, finish: null, actual: p.curve[di], target: Math.min(100, p.curve[di] + r * horizon), need: null });
    }
  }
  look.sort((x, y) => (y.need ?? 0) - (x.need ?? 0) || x.actual - y.actual);
  const j4 = idxAtOrBefore(D, iso(tr - 28 * DAY));
  const r4 = (model.overall[di] - at(model.overall, j4)) / Math.max(1, (tr - utc(D[Math.max(0, j4)])) / DAY);
  const planned = model.plan ? model.plan[di] : null, actualCov = model.plan ? model.plan.actual[di] : null;
  const planFinish = real.reduce((m, p) => (p.bl && p.bl.finish > m ? p.bl.finish : m), '');
  const planStart = real.reduce((m, p) => (p.bl && (!m || p.bl.start < m) ? p.bl.start : m), '');
  // forecast: with a baseline, planned duration ÷ SPI (earned-schedule style); without, the last 4 weeks' rate
  const spi = planned > 0.5 ? actualCov / planned : null;
  let forecast = null, basis = null;
  if (model.overall[di] >= DONE_AT) forecast = date;
  else if (spi && planFinish && spi > 0.2) { const a = utc(planStart), z = utc(planFinish); forecast = iso(a + (z - a) / Math.min(1.5, spi)); basis = 'spi'; }
  else if (r4 > 0.01) { forecast = iso(tr + ((100 - model.overall[di]) / r4) * DAY); basis = 'rate'; }
  return {
    kind, date, from, week, di, n, month: Number(date.slice(5, 7)) - 1, year: Number(date.slice(0, 4)), reportDays: days.length,
    actual: model.overall[di], wk: model.overall[di] - at(model.overall, prev),
    plan: planned, dev: planned == null ? null : actualCov - planned, spi, basis,
    mpAvg: mp.length ? Math.round(mp.reduce((a, b) => a + b, 0) / mp.length) : null, mpPeak: mp.length ? Math.max(...mp) : null,
    pkgs, acts, issues, look, forecast, planFinish, cal, weeks,
  };
}
export const weeklyFacts = (model, di) => periodFacts(model, di, 'week');

function sCurveSvg(model, di, L) {
  const W = 720, H = 230, P = { l: 34, r: 34, t: 12, b: 26 }, n = model.dates.length;
  const x = (i) => P.l + ((W - P.l - P.r) * i) / Math.max(1, n - 1);
  const y = (v) => H - P.b - ((H - P.t - P.b) * v) / 100;
  const line = (arr) => Array.from(arr, (v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const mp = model.manpower, mpMax = Math.max(1, ...mp.filter((v) => v != null));
  const ym = (v) => H - P.b - ((H - P.t - P.b) * 0.35 * v) / mpMax;
  const bw = Math.max(1, (W - P.l - P.r) / n - 0.6);
  const bars = mp.map((v, i) => (v == null || i > di ? '' : `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${ym(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - P.b - ym(v)).toFixed(1)}" fill="#c4d1dd"/>`)).join('');
  const grid = [0, 25, 50, 75, 100].map((g) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="#e3e8ee"/><text x="${P.l - 6}" y="${y(g) + 3}" text-anchor="end">${g}%</text>`).join('');
  const ticks = [];
  let last = '';
  model.dates.forEach((d, i) => { const m = d.slice(0, 7); if (m !== last) { last = m; ticks.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.slice(5, 7)}/${d.slice(2, 4)}</text>`); } });
  const actual = Array.from(model.overall).slice(0, di + 1);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(L.sCurve)}">
  <g font-size="9" fill="#7b8687">${grid}${ticks.join('')}<text x="${W - P.r + 6}" y="${ym(mpMax) + 3}">${mpMax}</text></g>
  <g>${bars}</g>
  ${model.plan ? `<polyline points="${line(model.plan)}" fill="none" stroke="#c98a12" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
  <polyline points="${line(actual)}" fill="none" stroke="#0f766e" stroke-width="2.6" stroke-linejoin="round"/>
  <line x1="${x(di)}" x2="${x(di)}" y1="${P.t}" y2="${H - P.b}" stroke="#cf3b2e" stroke-width="1.2"/>
  <circle cx="${x(di)}" cy="${y(model.overall[di])}" r="4" fill="#0f766e" stroke="#fff" stroke-width="1.5"/>
</svg>
<div class="legend"><span><i style="background:#0f766e"></i>${esc(L.actualLine)}</span>${model.plan ? `<span><i class="dash"></i>${esc(L.planLine)}</span>` : ''}<span><i style="background:#c4d1dd"></i>${esc(L.mpBars)}</span><span><i style="background:#cf3b2e"></i>${esc(L.reportDate)}</span></div>`;
}

/** Calendar of the period: one cell per day, shade = overall % gained that day (a static heat calendar). */
function calendarHtml(f, L) {
  if (!f.cal.length) return '';
  const max = Math.max(0.1, ...f.cal.map((c) => c.gain ?? 0));
  const shade = (g) => (g == null ? '#f3f5f5' : g <= 0.01 ? '#e9efee' : `rgba(15,118,110,${(0.16 + 0.84 * Math.min(1, g / max)).toFixed(2)})`);
  const dow = (d) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < dow(f.cal[0].date); i++) cells.push('<td class="cal-pad"></td>');
  for (const c of f.cal) {
    const dark = c.gain != null && c.gain / max > 0.55;
    cells.push(`<td style="background:${shade(c.gain)};color:${dark ? '#fff' : '#121a1b'}"><span class="cal-d">${Number(c.date.slice(8))}${c.issue ? '<i class="cal-i"></i>' : ''}</span><span class="cal-g">${c.gain == null ? '·' : `+${c.gain.toFixed(c.gain < 10 ? 1 : 0)}%`}</span></td>`);
  }
  while (cells.length % 7) cells.push('<td class="cal-pad"></td>');
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  return `<table class="cal"><thead><tr>${L.dow.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
<div class="legend"><span><i style="background:rgba(15,118,110,.22)"></i>${esc(L.low)}</span><span><i style="background:#0f766e"></i>${esc(L.high)} (+${max.toFixed(1)}%)</span><span><i style="background:#f3f5f5;outline:1px solid #e0e5e5"></i>${esc(L.noReport)}</span><span><i class="dot"></i>${esc(L.issueDot)}</span></div>`;
}

const rp = (v) => (v >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : `Rp ${Math.round(v / 1e6).toLocaleString('id-ID')} jt`);
const fmtPct = (v) => (v == null ? '·' : `${(Math.round(v * 10) / 10).toFixed(1)}%`);
const fmtDev = (v) => (v == null ? '·' : `${v > 0 ? '+' : ''}${(Math.round(v * 10) / 10).toFixed(1)}%`);
const fmtQty = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('id-ID') : (Math.round(v * 10) / 10).toLocaleString('id-ID'));

/** Self-contained printable HTML. opts: { kind: 'week'|'month', project, lang, simulated, images: [{src, caption}], dateFmt(iso) } */
export function reportHtml(model, di, { kind = 'week', project = '', lang = 'id', simulated = false, images = [], dateFmt = (d) => d, baselineSrc = '' } = {}) {
  const L = T[lang] || T.id, K = L[kind] || L.week;
  const f = periodFacts(model, di, kind);
  const st = { done: L.stDone, ahead: L.stAhead, on: L.stOn, behind: L.stBehind, todo: L.stTodo, wip: L.stWip };
  const stCol = { done: '#18804a', ahead: '#18804a', on: '#2a5fa8', behind: '#cf3b2e', todo: '#7b8687', wip: '#a86b00' };
  const bar = (v, plan) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i>${plan != null ? `<u style="left:${Math.max(0, Math.min(100, plan))}%"></u>` : ''}</div>`;
  const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><small>${esc(label)}</small><b>${value}</b><span>${sub}</span></div>`;
  const devCls = f.dev == null ? '' : f.dev < -1 ? 'bad' : f.dev > 1 ? 'good' : '';
  const groups = ['ONPLOT', 'OFFPLOT', ''].map((a) => [a, f.pkgs.filter((p) => (p.area || '') === a)]).filter(([, l]) => l.length);
  const label = kind === 'month' ? `${L.months[f.month]} ${f.year}` : `${K.unit}${f.week}`;
  const maxActs = kind === 'month' ? 24 : 18;
  const range = (a, b) => `${esc(dateFmt(a))} ${esc(L.to)} ${esc(dateFmt(b))}`;
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(K.title)} · ${esc(project)} · ${esc(label)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: A4; margin: 12mm 11mm; }
* { box-sizing: border-box; }
body { font: 400 10.5pt/1.4 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; letter-spacing: -0.005em; color: #121a1b; margin: 0; background: #fff; }
b, strong, th { font-weight: 500; }
.page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid #c9d1d1; padding-bottom: 10px; margin-bottom: 12px; gap: 12px; }
header h1 { font-size: 19pt; font-weight: 500; letter-spacing: -0.03em; line-height: 1.1; margin: 0 0 4px; }
header .meta { text-align: right; font-size: 9pt; color: #4d5859; }
header .meta b { font-size: 11pt; color: #121a1b; }
header .proj { font-size: 11pt; color: #4d5859; }
.sim { border: 1px solid rgba(207,59,46,.35); background: rgba(207,59,46,.06); color: #b8321f; text-align: center; padding: 5px; border-radius: 10px; margin: 0 0 12px; font-size: 9pt; }
h2 { font-size: 12pt; font-weight: 500; letter-spacing: -0.01em; margin: 18px 0 8px; break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #e0e5e5; border-radius: 16px; overflow: hidden; }
.kpi { padding: 9px 12px 10px; border-right: 1px solid #e0e5e5; }
.kpi:last-child { border-right: 0; }
.kpi small { display: block; color: #4d5859; font-size: 8.5pt; }
.kpi b { display: block; font-size: 19pt; font-weight: 500; letter-spacing: -0.035em; font-variant-numeric: tabular-nums; margin: 2px 0 1px; }
.kpi span { display: block; color: #7b8687; font-size: 8.5pt; }
.kpi.bad b { color: #cf3b2e; } .kpi.good b { color: #18804a; }
.chart { width: 100%; height: auto; display: block; }
.legend { display: flex; gap: 14px; font-size: 8.5pt; color: #4d5859; margin-top: 4px; flex-wrap: wrap; align-items: center; }
.legend i { display: inline-block; width: 14px; height: 4px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.legend i.dash { background: repeating-linear-gradient(90deg, #c98a12 0 5px, transparent 5px 8px); }
.legend i.dot { width: 6px; height: 6px; border-radius: 50%; background: #ef6a1f; }
.shots { display: grid; grid-template-columns: ${images.length > 1 ? '1fr 1fr' : '1fr'}; gap: 8px; }
figure { margin: 0; } figure img { width: 100%; border-radius: 14px; border: 1px solid #e0e5e5; display: block; } figcaption { font-size: 8.5pt; color: #7b8687; margin-top: 3px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { text-align: left; font-size: 8.5pt; color: #4d5859; border-bottom: 1px solid #c9d1d1; padding: 5px; }
td { border-bottom: 1px solid #eef1f1; padding: 4px 5px; vertical-align: middle; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.grp td { background: #f3f5f5; font-weight: 500; font-size: 8.5pt; color: #4d5859; }
tr { break-inside: avoid; }
.bar { position: relative; height: 6px; background: #eef1f1; border-radius: 3px; min-width: 70px; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #0f766e; border-radius: 3px; }
.bar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #c98a12; border-radius: 1px; }
.st { font-weight: 500; font-size: 8.5pt; white-space: nowrap; }
.cal { table-layout: fixed; border-collapse: separate; border-spacing: 3px; break-inside: avoid; }
.cal th { text-align: center; border: 0; padding: 2px; }
.cal td { border: 0; border-radius: 8px; height: 38px; padding: 4px 6px; vertical-align: top; }
.cal td.cal-pad { background: transparent; }
.cal-d { display: flex; align-items: center; gap: 4px; font-size: 8pt; opacity: .8; }
.cal-g { display: block; font-size: 9pt; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 2px; }
.cal-i { width: 5px; height: 5px; border-radius: 50%; background: #ef6a1f; display: inline-block; }
ul.issues { margin: 0; padding-left: 18px; } ul.issues li { margin: 3px 0; }
.note { color: #7b8687; font-size: 8.5pt; }
footer { margin-top: 16px; border-top: 1px solid #e0e5e5; padding-top: 6px; font-size: 8pt; color: #7b8687; display: flex; justify-content: space-between; }
.noprint { position: sticky; top: 0; z-index: 2; background: rgba(255,255,255,.9); backdrop-filter: blur(12px); border-bottom: 1px solid #e0e5e5; padding: 8px 12px; display: flex; gap: 12px; align-items: center; justify-content: center; font-size: 10pt; color: #4d5859; }
.noprint button { font: 500 10pt/1 inherit; padding: 9px 16px; border-radius: 14px; border: 0; background: #121a1b; color: #fff; cursor: pointer; transition: transform 520ms cubic-bezier(.2,.9,.3,1.1); }
.noprint button:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) { .noprint button { transition: none; } }
@media print { .noprint { display: none; } .page { padding: 0; } h2 { margin-top: 14px; } }
@media (max-width: 640px) { .kpis { grid-template-columns: repeat(2, 1fr); } .kpi:nth-child(2) { border-right: 0; } .kpi:nth-child(-n+2) { border-bottom: 1px solid #e0e5e5; } .shots { grid-template-columns: 1fr; } .page { padding: 4mm; } }
</style></head><body>
<div class="noprint">${esc(L.print)} <button onclick="window.print()">${esc(L.printBtn)}</button></div>
<div class="page">
<header><div><h1>${esc(K.title)}</h1><div class="proj">${esc(project)}</div></div>
<div class="meta"><b>${esc(label)}</b>${kind === 'month' ? ` · ${esc(L.projWeek.toLowerCase())} ${f.week}` : ''}<br>${esc(L.period)}: ${range(f.from, f.date)}<br>${esc(L.reportDate)}: ${esc(dateFmt(f.date))} · ${f.reportDays} ${esc(L.days)}</div></header>
${simulated ? `<div class="sim">${esc(L.sim)}</div>` : ''}
<div class="kpis">
${kpi(L.actual, fmtPct(f.actual), `${K.gain}: ${fmtDev(f.wk)}`)}
${kpi(L.plan, fmtPct(f.plan), f.plan == null ? L.noPlan : '')}
${kpi(L.dev, fmtDev(f.dev), f.spi != null ? `${L.spi} ${f.spi.toFixed(2)}` : '', devCls)}
${kpi(L.manpower, f.mpAvg != null ? `${f.mpAvg}` : '·', f.mpAvg != null ? `${L.avg}, ${L.peak} ${f.mpPeak} ${L.people}` : '')}
</div>
<p class="note">${f.forecast ? `${esc(L.forecast)}: <b>${esc(dateFmt(f.forecast))}</b> (${esc(f.basis === 'spi' ? L.onSpi : L.onTrend)})${f.planFinish ? `. ${esc(L.planLine)}: ${esc(dateFmt(f.planFinish))}` : ''}. ` : ''}${esc(model.weighting === 'value' ? L.wValue(rp(model.totalValue)) : L.wCount)}${baselineSrc ? ` ${esc(L.blSrc)}: ${esc(baselineSrc)}.` : ''}</p>
<h2>${esc(L.sCurve)}</h2>
${sCurveSvg(model, f.di, L)}
${images.length ? `<h2>${esc(L.model)}</h2><div class="shots">${images.map((im) => `<figure><img src="${im.src}" alt=""><figcaption>${esc(im.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
<h2>${esc(K.cal)}</h2>
${calendarHtml(f, L)}
${f.weeks.length ? `<h2>${esc(L.weeks)}</h2><table><thead><tr><th>${esc(L.projWeek)}</th><th>${esc(L.period)}</th><th class="n">${esc(L.planLine)} Δ</th><th class="n">${esc(L.actualLine)} Δ</th><th class="n">${esc(L.total)}</th></tr></thead><tbody>
${f.weeks.map((w) => `<tr><td>${w.week}</td><td>${range(w.from, w.to)}</td><td class="n">${w.plan == null ? '·' : fmtDev(w.plan)}</td><td class="n"><b>${fmtDev(w.gain)}</b></td><td class="n">${fmtPct(w.actual)}</td></tr>`).join('')}
</tbody></table>` : ''}
<h2>${esc(L.pkgs)}</h2>
<table><thead><tr><th>${esc(L.pkg)}</th><th class="n">${esc(L.weight)}</th><th class="n">${esc(L.planLine)}</th><th class="n">${esc(L.actualLine)}</th><th class="n">${esc(L.dev)}</th><th class="n">${esc(K.delta)}</th><th></th><th>${esc(L.status)}</th></tr></thead><tbody>
${groups.map(([a, list]) => `${groups.length > 1 ? `<tr class="grp"><td colspan="8">${esc(a === 'ONPLOT' ? 'Onplot' : a === 'OFFPLOT' ? 'Offplot' : L.overall)}</td></tr>` : ''}${list.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${fmtQty(p.w)}</td><td class="n">${fmtPct(p.plan)}</td><td class="n"><b>${fmtPct(p.actual)}</b></td><td class="n" style="color:${p.dev == null ? 'inherit' : p.dev < -1 ? '#cf3b2e' : p.dev > 1 ? '#18804a' : 'inherit'}">${fmtDev(p.dev)}</td><td class="n">${p.wk > 0.05 ? fmtDev(p.wk) : '·'}</td><td style="width:22%">${bar(p.actual, p.plan)}</td><td class="st" style="color:${stCol[p.status]}">${esc(st[p.status])}</td></tr>`).join('')}`).join('')}
<tr class="grp"><td>${esc(L.overall)}</td><td></td><td class="n">${fmtPct(f.plan)}</td><td class="n">${fmtPct(f.actual)}</td><td class="n">${fmtDev(f.dev)}</td><td class="n">${fmtDev(f.wk)}</td><td>${bar(f.actual, f.plan)}</td><td></td></tr>
</tbody></table>
<h2>${esc(K.acts)}</h2>
${f.acts.length ? `<table><thead><tr><th>${esc(L.act)}</th><th>${esc(L.pkg)}</th><th class="n">${esc(L.qty)}</th><th class="n">${esc(K.delta)}</th><th class="n">${esc(L.total)}</th></tr></thead><tbody>
${f.acts.slice(0, maxActs).map((a) => `<tr><td>${esc(a.desc)}</td><td class="note">${esc(a.pkg)}</td><td class="n">${fmtQty(a.qty)} ${esc(a.unit)}</td><td class="n">${fmtDev(a.d)}</td><td class="n">${fmtPct(a.total)}</td></tr>`).join('')}
</tbody></table>${f.acts.length > maxActs ? `<p class="note">+ ${f.acts.length - maxActs} …</p>` : ''}` : `<p class="note">${esc(K.nothing)}</p>`}
<h2>${esc(K.look)}</h2>
${!model.plan ? `<p class="note">${esc(L.lookNoPlan)}</p>` : ''}
${f.look.length ? `<table><thead><tr><th>${esc(L.pkg)}</th>${model.plan ? `<th class="n">${esc(L.start)}</th><th class="n">${esc(L.finish)}</th>` : ''}<th class="n">${esc(L.actualLine)}</th><th class="n">${esc(model.plan ? L.target : L.trend)}</th>${model.plan ? `<th class="n">${esc(L.need)}</th>` : ''}</tr></thead><tbody>
${f.look.slice(0, 14).map((r) => `<tr><td>${esc(r.name)}</td>${model.plan ? `<td class="n">${r.start ? esc(dateFmt(r.start)) : '·'}</td><td class="n">${r.finish ? esc(dateFmt(r.finish)) : '·'}</td>` : ''}<td class="n">${fmtPct(r.actual)}</td><td class="n">${fmtPct(r.target)}</td>${model.plan ? `<td class="n" style="color:${r.need > 5 ? '#cf3b2e' : 'inherit'}">${r.need > 0.05 ? `+${r.need.toFixed(1)}%` : '·'}</td>` : ''}</tr>`).join('')}
</tbody></table>` : `<p class="note">·</p>`}
<h2>${esc(K.issues)}</h2>
${f.issues.length ? `<ul class="issues">${f.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note">${esc(L.none)}</p>`}
<footer><span>${esc(L.src(model.dates.length, dateFmt(model.dates[0]), dateFmt(model.dates[model.dates.length - 1])))}</span><span>${esc(L.gen)}</span></footer>
</div></body></html>`;
}
export const weeklyReportHtml = (model, di, opts = {}) => reportHtml(model, di, { ...opts, kind: 'week' });
