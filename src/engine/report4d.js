// Weekly progress report from the 4D model: one self-contained, printable HTML page (A4) → "Save as PDF".
// Pure (no DOM, no three.js): numbers are computed here and unit-tested; the 3D pictures are passed in as data URLs.
import { DONE_AT, planAt } from './progress4d.js';

const T = {
  id: {
    title: 'Laporan Progres Mingguan', week: 'Minggu ke', period: 'Periode', reportDate: 'Tanggal laporan',
    actual: 'Progres aktual', plan: 'Progres rencana', dev: 'Deviasi', spi: 'SPI', weekGain: 'Kenaikan minggu ini',
    manpower: 'Tenaga kerja', avg: 'rata-rata', peak: 'puncak', people: 'orang', noPlan: 'tanpa baseline',
    sCurve: 'Kurva S — rencana vs aktual', planLine: 'Rencana', actualLine: 'Aktual', mpBars: 'Tenaga kerja / hari',
    model: 'Kondisi model 3D pada tanggal laporan', pkgs: 'Progres per paket pekerjaan',
    pkg: 'Paket', area: 'Area', weight: 'Bobot', status: 'Status', wk: 'Δ minggu',
    acts: 'Pekerjaan yang maju minggu ini', act: 'Aktivitas', qty: 'Volume minggu ini', total: 'Kumulatif',
    ahead: 'Look-ahead 2 minggu', target: 'Target rencana', need: 'Perlu dikejar', start: 'Mulai', finish: 'Selesai',
    issues: 'Isu & kendala minggu ini', none: 'Tidak ada isu tercatat.', nothing: 'Tidak ada pekerjaan yang maju minggu ini.',
    stDone: 'Selesai', stAhead: 'Lebih cepat', stOn: 'Sesuai rencana', stBehind: 'Terlambat', stTodo: 'Belum mulai', stWip: 'Berjalan',
    src: (n, d0, d1) => `Sumber: ${n} laporan harian kontraktor (${d0} s/d ${d1}).`,
    sim: 'DATA SIMULASI — bukan laporan kontraktor', gen: 'Dibuat dengan Review 3D', overall: 'Keseluruhan',
    lookNoPlan: 'Belum ada baseline — look-ahead memakai laju rata-rata 2 minggu terakhir.', trend: 'Proyeksi laju',
    forecast: 'Perkiraan selesai', onTrend: 'dengan laju 4 minggu terakhir', onSpi: 'durasi rencana ÷ SPI',
  },
  en: {
    title: 'Weekly Progress Report', week: 'Week', period: 'Period', reportDate: 'Report date',
    actual: 'Actual progress', plan: 'Planned progress', dev: 'Deviation', spi: 'SPI', weekGain: 'Gained this week',
    manpower: 'Manpower', avg: 'average', peak: 'peak', people: 'people', noPlan: 'no baseline',
    sCurve: 'S-curve — plan vs actual', planLine: 'Plan', actualLine: 'Actual', mpBars: 'Manpower / day',
    model: '3D model at the report date', pkgs: 'Progress by work package',
    pkg: 'Package', area: 'Area', weight: 'Weight', status: 'Status', wk: 'Δ week',
    acts: 'Work progressed this week', act: 'Activity', qty: 'Quantity this week', total: 'Cumulative',
    ahead: '2-week look-ahead', target: 'Planned', need: 'To catch up', start: 'Start', finish: 'Finish',
    issues: 'Issues this week', none: 'No issues recorded.', nothing: 'No work progressed this week.',
    stDone: 'Complete', stAhead: 'Ahead', stOn: 'On plan', stBehind: 'Behind', stTodo: 'Not started', stWip: 'In progress',
    src: (n, d0, d1) => `Source: ${n} contractor daily reports (${d0} to ${d1}).`,
    sim: 'SIMULATED DATA — not a contractor report', gen: 'Generated with Review 3D', overall: 'Overall',
    lookNoPlan: 'No baseline yet — the look-ahead uses the average rate of the last 2 weeks.', trend: 'Rate projection',
    forecast: 'Forecast finish', onTrend: 'at the rate of the last 4 weeks', onSpi: 'planned duration ÷ SPI',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Index of the last report on or before a date (−1 if none). */
function idxAtOrBefore(dates, isoDate) {
  let k = -1;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= isoDate) k = i; else break;
  return k;
}

/** All the numbers of a weekly report for report day `di`. */
export function weeklyFacts(model, di) {
  const D = model.dates, n = D.length;
  di = Math.max(0, Math.min(n - 1, Math.round(di)));
  const date = D[di], t0 = Date.parse(D[0]), tr = Date.parse(date);
  const week = Math.floor((tr - t0) / (7 * DAY)) + 1;
  const from = iso(tr - 6 * DAY);
  const prev = idxAtOrBefore(D, iso(tr - 7 * DAY));            // last report before this week
  const at = (arr, i) => (i < 0 ? 0 : arr[i]);
  const real = model.pkgs.filter((p) => !p.summary);
  const pkgs = real.map((p) => {
    const actual = p.curve[di], plan = p.plan ? p.plan[di] : null, wk = actual - at(p.curve, prev);
    let status = actual >= DONE_AT ? 'done' : actual <= 0.05 && !(plan > 0.5) ? 'todo' : plan == null ? 'wip' : actual - plan > 1 ? 'ahead' : actual - plan < -1 ? 'behind' : 'on';
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
  // look-ahead: planned progress 14 days after the report date vs today's actual
  const look = [];
  const tEnd = tr + 14 * DAY;
  const rate = (p) => { // %/day over the last 14 days of reports
    const j = idxAtOrBefore(D, iso(tr - 14 * DAY));
    const span = Math.max(1, (tr - Date.parse(D[Math.max(0, j)])) / DAY);
    return (p.curve[di] - at(p.curve, j)) / span;
  };
  for (const p of real) {
    if (p.curve[di] >= DONE_AT) continue;
    if (p.bl) {
      const a = Date.parse(p.bl.start), z = Date.parse(p.bl.finish);
      if (a > tEnd) continue;
      const target = planAt(tEnd, a, z);
      look.push({ name: p.name, start: p.bl.start, finish: p.bl.finish, actual: p.curve[di], target, need: Math.max(0, target - p.curve[di]) });
    } else {
      const r = rate(p);
      if (r <= 0 && p.curve[di] <= 0.05) continue;
      look.push({ name: p.name, start: null, finish: null, actual: p.curve[di], target: Math.min(100, p.curve[di] + r * 14), need: null });
    }
  }
  look.sort((x, y) => (y.need ?? 0) - (x.need ?? 0) || x.actual - y.actual);
  // forecast finish at the overall rate of the last 4 weeks
  const j4 = idxAtOrBefore(D, iso(tr - 28 * DAY));
  const r4 = (model.overall[di] - at(model.overall, j4)) / Math.max(1, (tr - Date.parse(D[Math.max(0, j4)])) / DAY);
  const planned = model.plan ? model.plan[di] : null, actualCov = model.plan ? model.plan.actual[di] : null;
  const planFinish = real.reduce((m, p) => (p.bl && p.bl.finish > m ? p.bl.finish : m), '');
  const planStart = real.reduce((m, p) => (p.bl && (!m || p.bl.start < m) ? p.bl.start : m), '');
  // forecast: with a baseline, planned duration ÷ SPI (earned-schedule style); without, the last 4 weeks' rate
  const spi = planned > 0.5 ? actualCov / planned : null;
  let forecast = null, basis = null;
  if (model.overall[di] >= DONE_AT) forecast = date;
  else if (spi && planFinish && spi > 0.2) { const a = Date.parse(planStart), z = Date.parse(planFinish); forecast = iso(a + (z - a) / Math.min(1.5, spi)); basis = 'spi'; }
  else if (r4 > 0.01) { forecast = iso(tr + ((100 - model.overall[di]) / r4) * DAY); basis = 'rate'; }
  return {
    date, from, week, di, n,
    actual: model.overall[di], wk: model.overall[di] - at(model.overall, prev),
    plan: planned, dev: planned == null ? null : actualCov - planned, spi, basis,
    mpAvg: mp.length ? Math.round(mp.reduce((a, b) => a + b, 0) / mp.length) : null, mpPeak: mp.length ? Math.max(...mp) : null,
    pkgs, acts, issues, look, forecast, planFinish,
  };
}

function sCurveSvg(model, di, L) {
  const W = 720, H = 230, P = { l: 34, r: 34, t: 12, b: 26 }, n = model.dates.length;
  const x = (i) => P.l + ((W - P.l - P.r) * i) / Math.max(1, n - 1);
  const y = (v) => H - P.b - ((H - P.t - P.b) * v) / 100;
  const line = (arr) => Array.from(arr, (v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const mp = model.manpower, mpMax = Math.max(1, ...mp.filter((v) => v != null));
  const ym = (v) => H - P.b - ((H - P.t - P.b) * 0.35 * v) / mpMax;
  const bw = Math.max(1, (W - P.l - P.r) / n - 0.6);
  const bars = mp.map((v, i) => (v == null || i > di ? '' : `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${ym(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - P.b - ym(v)).toFixed(1)}" fill="#9fb3c8"/>`)).join('');
  const grid = [0, 25, 50, 75, 100].map((g) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="#e3e8ee"/><text x="${P.l - 6}" y="${y(g) + 3}" text-anchor="end">${g}%</text>`).join('');
  const ticks = [];
  let last = '';
  model.dates.forEach((d, i) => { const m = d.slice(0, 7); if (m !== last) { last = m; ticks.push(`<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.slice(5, 7)}/${d.slice(2, 4)}</text>`); } });
  const actual = Array.from(model.overall).slice(0, di + 1);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(L.sCurve)}">
  <g font-size="9" fill="#6b7785">${grid}${ticks.join('')}<text x="${W - P.r + 6}" y="${ym(mpMax) + 3}">${mpMax}</text></g>
  <g>${bars}</g>
  ${model.plan ? `<polyline points="${line(model.plan)}" fill="none" stroke="#e0a21a" stroke-width="2" stroke-dasharray="6 4"/>` : ''}
  <polyline points="${line(actual)}" fill="none" stroke="#0f9d8a" stroke-width="2.6"/>
  <line x1="${x(di)}" x2="${x(di)}" y1="${P.t}" y2="${H - P.b}" stroke="#e5484d" stroke-width="1.2"/>
  <circle cx="${x(di)}" cy="${y(model.overall[di])}" r="4" fill="#0f9d8a" stroke="#fff" stroke-width="1.5"/>
</svg>
<div class="legend"><span><i style="background:#0f9d8a"></i>${L.actualLine}</span>${model.plan ? `<span><i class="dash"></i>${L.planLine}</span>` : ''}<span><i style="background:#9fb3c8"></i>${L.mpBars}</span><span><i style="background:#e5484d"></i>${esc(L.reportDate)}</span></div>`;
}

const fmtPct = (v) => (v == null ? '—' : `${(Math.round(v * 10) / 10).toFixed(1)}%`);
const fmtDev = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(Math.round(v * 10) / 10).toFixed(1)}%`);
const fmtQty = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('id-ID') : (Math.round(v * 10) / 10).toLocaleString('id-ID'));

/** Self-contained printable HTML. opts: { project, lang, simulated, images: [{src, caption}], dateFmt(iso) } */
export function weeklyReportHtml(model, di, { project = '', lang = 'id', simulated = false, images = [], dateFmt = (d) => d } = {}) {
  const L = T[lang] || T.id;
  const f = weeklyFacts(model, di);
  const st = { done: L.stDone, ahead: L.stAhead, on: L.stOn, behind: L.stBehind, todo: L.stTodo, wip: L.stWip };
  const stCol = { done: '#1f9d55', ahead: '#1f9d55', on: '#2b6cb0', behind: '#d64545', todo: '#8a94a3', wip: '#b7791f' };
  const bar = (v, plan) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i>${plan != null ? `<u style="left:${Math.max(0, Math.min(100, plan))}%"></u>` : ''}</div>`;
  const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><small>${esc(label)}</small><b>${value}</b><span>${sub}</span></div>`;
  const devCls = f.dev == null ? '' : f.dev < -1 ? 'bad' : f.dev > 1 ? 'good' : '';
  const groups = ['ONPLOT', 'OFFPLOT', ''].map((a) => [a, f.pkgs.filter((p) => (p.area || '') === a)]).filter(([, l]) => l.length);
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(L.title)} — ${esc(project)} — ${esc(L.week)} ${f.week}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page { size: A4; margin: 12mm 11mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1b2430; margin: 0; background: #fff; }
.page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #0f9d8a; padding-bottom: 8px; margin-bottom: 10px; gap: 12px; }
header h1 { font-size: 17pt; margin: 0 0 2px; letter-spacing: -.01em; }
header .meta { text-align: right; font-size: 9pt; color: #4a5563; }
header .proj { font-size: 11pt; color: #4a5563; }
.sim { border: 1.5px solid #d64545; color: #d64545; font-weight: 700; text-align: center; padding: 4px; border-radius: 6px; margin: 0 0 10px; letter-spacing: .04em; font-size: 9pt; }
h2 { font-size: 11.5pt; margin: 16px 0 6px; padding-left: 8px; border-left: 3px solid #0f9d8a; break-after: avoid; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.kpi { border: 1px solid #e3e8ee; border-radius: 8px; padding: 7px 9px; }
.kpi small { display: block; color: #6b7785; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
.kpi b { font-size: 16pt; font-variant-numeric: tabular-nums; }
.kpi span { display: block; color: #6b7785; font-size: 8.5pt; }
.kpi.bad b { color: #d64545; } .kpi.good b { color: #1f9d55; }
.chart { width: 100%; height: auto; display: block; }
.legend { display: flex; gap: 14px; font-size: 8.5pt; color: #4a5563; margin-top: 2px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 14px; height: 3px; margin-right: 5px; vertical-align: middle; }
.legend i.dash { background: repeating-linear-gradient(90deg, #e0a21a 0 5px, transparent 5px 8px); }
.shots { display: grid; grid-template-columns: ${images.length > 1 ? '1fr 1fr' : '1fr'}; gap: 6px; }
figure { margin: 0; } figure img { width: 100%; border-radius: 6px; border: 1px solid #e3e8ee; display: block; } figcaption { font-size: 8.5pt; color: #6b7785; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { text-align: left; font-size: 8pt; color: #6b7785; text-transform: uppercase; letter-spacing: .03em; border-bottom: 1.5px solid #cfd7e0; padding: 4px 5px; }
td { border-bottom: 1px solid #eef1f4; padding: 3.5px 5px; vertical-align: middle; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.grp td { background: #f4f7f9; font-weight: 600; font-size: 8.5pt; color: #4a5563; }
tr { break-inside: avoid; }
.bar { position: relative; height: 7px; background: #edf1f5; border-radius: 4px; min-width: 70px; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #0f9d8a; border-radius: 4px; }
.bar u { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #e0a21a; }
.st { font-weight: 600; font-size: 8.5pt; white-space: nowrap; }
ul.issues { margin: 0; padding-left: 18px; } ul.issues li { margin: 2px 0; }
.note { color: #6b7785; font-size: 8.5pt; }
footer { margin-top: 14px; border-top: 1px solid #e3e8ee; padding-top: 6px; font-size: 8pt; color: #8a94a3; display: flex; justify-content: space-between; }
.noprint { position: sticky; top: 0; background: #0f9d8a; color: #fff; padding: 8px 12px; display: flex; gap: 10px; align-items: center; justify-content: center; font-size: 10pt; }
.noprint button { font: inherit; padding: 5px 14px; border-radius: 6px; border: 0; background: #fff; color: #0f9d8a; font-weight: 600; cursor: pointer; }
@media print { .noprint { display: none; } .page { padding: 0; } h2 { margin-top: 12px; } }
@media (max-width: 640px) { .kpis { grid-template-columns: repeat(2, 1fr); } .shots { grid-template-columns: 1fr; } .page { padding: 4mm; } }
</style></head><body>
<div class="noprint">${lang === 'id' ? 'Simpan sebagai PDF lewat menu Cetak' : 'Save as PDF from the Print menu'} <button onclick="window.print()">${lang === 'id' ? 'Cetak / PDF' : 'Print / PDF'}</button></div>
<div class="page">
<header><div><h1>${esc(L.title)}</h1><div class="proj">${esc(project)}</div></div>
<div class="meta"><b>${esc(L.week)} ${f.week}</b><br>${esc(L.period)}: ${esc(dateFmt(f.from))} – ${esc(dateFmt(f.date))}<br>${esc(L.reportDate)}: ${esc(dateFmt(f.date))}</div></header>
${simulated ? `<div class="sim">${esc(L.sim)}</div>` : ''}
<div class="kpis">
${kpi(L.actual, fmtPct(f.actual), `${L.weekGain}: ${fmtDev(f.wk)}`)}
${kpi(L.plan, fmtPct(f.plan), f.plan == null ? L.noPlan : '')}
${kpi(L.dev, fmtDev(f.dev), f.spi != null ? `${L.spi} ${f.spi.toFixed(2)}` : '', devCls)}
${kpi(L.manpower, f.mpAvg != null ? `${f.mpAvg}` : '—', f.mpAvg != null ? `${L.avg} · ${L.peak} ${f.mpPeak} ${L.people}` : '')}
</div>
<p class="note">${f.forecast ? `${esc(L.forecast)}: <b>${esc(dateFmt(f.forecast))}</b> (${esc(f.basis === 'spi' ? L.onSpi : L.onTrend)})${f.planFinish ? ` · ${esc(L.plan)}: ${esc(dateFmt(f.planFinish))}` : ''}.` : ''}</p>
<h2>${esc(L.sCurve)}</h2>
${sCurveSvg(model, f.di, L)}
${images.length ? `<h2>${esc(L.model)}</h2><div class="shots">${images.map((im) => `<figure><img src="${im.src}" alt=""><figcaption>${esc(im.caption || '')}</figcaption></figure>`).join('')}</div>` : ''}
<h2>${esc(L.pkgs)}</h2>
<table><thead><tr><th>${esc(L.pkg)}</th><th class="n">${esc(L.weight)}</th><th class="n">${esc(L.planLine)}</th><th class="n">${esc(L.actualLine)}</th><th class="n">${esc(L.dev)}</th><th class="n">${esc(L.wk)}</th><th></th><th>${esc(L.status)}</th></tr></thead><tbody>
${groups.map(([a, list]) => `${groups.length > 1 ? `<tr class="grp"><td colspan="8">${esc(a === 'ONPLOT' ? 'Onplot' : a === 'OFFPLOT' ? 'Offplot' : L.overall)}</td></tr>` : ''}${list.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${fmtQty(p.w)}</td><td class="n">${fmtPct(p.plan)}</td><td class="n"><b>${fmtPct(p.actual)}</b></td><td class="n" style="color:${p.dev == null ? 'inherit' : p.dev < -1 ? '#d64545' : p.dev > 1 ? '#1f9d55' : 'inherit'}">${fmtDev(p.dev)}</td><td class="n">${p.wk > 0.05 ? fmtDev(p.wk) : '—'}</td><td style="width:22%">${bar(p.actual, p.plan)}</td><td class="st" style="color:${stCol[p.status]}">${esc(st[p.status])}</td></tr>`).join('')}`).join('')}
<tr class="grp"><td>${esc(L.overall)}</td><td></td><td class="n">${fmtPct(f.plan)}</td><td class="n">${fmtPct(f.actual)}</td><td class="n">${fmtDev(f.dev)}</td><td class="n">${fmtDev(f.wk)}</td><td>${bar(f.actual, f.plan)}</td><td></td></tr>
</tbody></table>
<h2>${esc(L.acts)}</h2>
${f.acts.length ? `<table><thead><tr><th>${esc(L.act)}</th><th>${esc(L.pkg)}</th><th class="n">${esc(L.qty)}</th><th class="n">${esc(L.wk)}</th><th class="n">${esc(L.total)}</th></tr></thead><tbody>
${f.acts.slice(0, 18).map((a) => `<tr><td>${esc(a.desc)}</td><td class="note">${esc(a.pkg)}</td><td class="n">${fmtQty(a.qty)} ${esc(a.unit)}</td><td class="n">${fmtDev(a.d)}</td><td class="n">${fmtPct(a.total)}</td></tr>`).join('')}
</tbody></table>${f.acts.length > 18 ? `<p class="note">+ ${f.acts.length - 18} …</p>` : ''}` : `<p class="note">${esc(L.nothing)}</p>`}
<h2>${esc(L.ahead)}</h2>
${!model.plan ? `<p class="note">${esc(L.lookNoPlan)}</p>` : ''}
${f.look.length ? `<table><thead><tr><th>${esc(L.pkg)}</th>${model.plan ? `<th class="n">${esc(L.start)}</th><th class="n">${esc(L.finish)}</th>` : ''}<th class="n">${esc(L.actualLine)}</th><th class="n">${esc(model.plan ? L.target : L.trend)} +14</th>${model.plan ? `<th class="n">${esc(L.need)}</th>` : ''}</tr></thead><tbody>
${f.look.slice(0, 14).map((r) => `<tr><td>${esc(r.name)}</td>${model.plan ? `<td class="n">${r.start ? esc(dateFmt(r.start)) : '—'}</td><td class="n">${r.finish ? esc(dateFmt(r.finish)) : '—'}</td>` : ''}<td class="n">${fmtPct(r.actual)}</td><td class="n">${fmtPct(r.target)}</td>${model.plan ? `<td class="n" style="color:${r.need > 5 ? '#d64545' : 'inherit'}">${r.need > 0.05 ? `+${r.need.toFixed(1)}%` : '—'}</td>` : ''}</tr>`).join('')}
</tbody></table>` : `<p class="note">—</p>`}
<h2>${esc(L.issues)}</h2>
${f.issues.length ? `<ul class="issues">${f.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="note">${esc(L.none)}</p>`}
<footer><span>${esc(L.src(model.dates.length, dateFmt(model.dates[0]), dateFmt(model.dates[model.dates.length - 1])))}</span><span>${esc(L.gen)}</span></footer>
</div></body></html>`;
}
