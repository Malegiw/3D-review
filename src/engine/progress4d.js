// 4D progress model: daily reports → one series per activity → package (work package) progress per day.
// Pure functions (no DOM, no three.js) so they are unit-tested in node.
import { buildXlsx, parseCSV } from '../core/xlsx.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 || /\d/.test(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}
const lerp = (a, b, t) => a + (b - a) * t;

export const DONE_AT = 99.5; // % at which a package counts as complete

/**
 * Merge daily reports into a model.
 * reports: { 'YYYY-MM-DD': { rows: [{ pkg, pkgName, area, hint, summary, sub, desc, unit, bq, pct }], manpower?, concerns? } }
 *
 * Activity identity is (package, description, n-th repeat of that description). Contractors reword rows from day to day,
 * so a row that is new today, in a package where a row went missing and reads alike (≥ 55 % shared words), continues
 * that activity. Before its first report an activity counts 0 %; after its last report it keeps its last value.
 */
export function buildModel(reports) {
  const dates = Object.keys(reports || {}).sort();
  const pkgs = new Map();
  const byKey = new Map();
  const D = dates.length;
  dates.forEach((date, di) => {
    const rows = reports[date].rows || [];
    const occ = new Map();
    const seen = new Set();
    const fresh = [];
    for (const r of rows) {
      let p = pkgs.get(r.pkg);
      if (!p) { p = { id: r.pkg, name: r.pkgName || r.pkg, area: r.area || '', hint: r.hint || '', summary: !!r.summary, acts: [] }; pkgs.set(r.pkg, p); }
      if (!p.area && r.area) p.area = r.area;
      const base = `${r.pkg}|${norm(r.sub ? `${r.sub} ${r.desc}` : r.desc)}`;
      const n = occ.get(base) || 0;
      occ.set(base, n + 1);
      const key = `${base}#${n}`;
      const a = byKey.get(key);
      if (a) { a.raw[di] = r.pct; a.last = di; a.bq = r.bq; a.unit = r.unit || a.unit; seen.add(a); } else fresh.push({ r, key, p });
    }
    for (const f of fresh) {
      const label = f.r.sub ? `${f.r.sub} · ${f.r.desc}` : f.r.desc;
      const tk = tokens(label);
      let best = null, bs = 0;
      for (const a of f.p.acts) {
        if (seen.has(a) || a.last >= di) continue;
        const s = jaccard(tk, a.tk);
        if (s > bs) { bs = s; best = a; }
      }
      let a;
      if (best && bs >= 0.55) { a = best; a.desc = label; a.tk = tk; a.renamed = (a.renamed || 0) + 1; } else {
        a = { key: f.key, desc: label, tk, unit: f.r.unit, bq: f.r.bq, raw: new Array(D).fill(null), first: di, last: di, pkg: f.p.id };
        f.p.acts.push(a);
      }
      byKey.set(f.key, a);
      a.raw[di] = f.r.pct; a.last = di; a.bq = f.r.bq; a.unit = f.r.unit || a.unit;
      seen.add(a);
    }
  });
  // fill: 0 before the first report, carry the last value afterwards and through gaps
  for (const p of pkgs.values()) {
    for (const a of p.acts) {
      a.pct = new Float32Array(D);
      let v = 0;
      for (let i = 0; i < D; i++) { if (a.raw[i] != null) v = a.raw[i]; a.pct[i] = i < a.first ? 0 : v; }
      a.dropped = a.last < D - 1;
    }
    p.curve = new Float32Array(D);
    for (let i = 0; i < D; i++) p.curve[i] = p.acts.length ? p.acts.reduce((s, a) => s + a.pct[i], 0) / p.acts.length : 0;
  }
  const real = [...pkgs.values()].filter((p) => !p.summary);
  const total = real.reduce((n, p) => n + p.acts.length, 0) || 1;
  const overall = new Float32Array(D);
  for (let i = 0; i < D; i++) overall[i] = real.reduce((s, p) => s + p.curve[i] * p.acts.length, 0) / total;
  const manpower = dates.map((d) => reports[d].manpower?.today ?? null);
  return { dates, pkgs: [...pkgs.values()], overall, manpower, count: total, concerns: Object.fromEntries(dates.map((d) => [d, reports[d].concerns || []])) };
}

/** Progress (%) of a package at fractional day index t (0 … dates-1), interpolated between report days. */
export function pctAt(curve, t) {
  const n = curve.length;
  if (!n) return 0;
  const x = Math.min(Math.max(t, 0), n - 1), i = Math.floor(x);
  return i >= n - 1 ? curve[n - 1] : lerp(curve[i], curve[i + 1], x - i);
}
export const stateOf = (pct) => (pct <= 0.05 ? 'todo' : pct >= DONE_AT ? 'done' : 'wip');

/** Index of the report day at or before a date (-1 before the first). */
export function dayIndex(dates, date) {
  let k = -1;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= date) k = i;
  return k;
}

/** Activities of a package at day index `di` with their % (for the detail list), unfinished first. */
export function activitiesAt(pkg, di) {
  return pkg.acts.map((a) => ({ desc: a.desc, unit: a.unit, bq: a.bq, pct: a.pct[Math.max(0, di)], was: di > 0 ? a.pct[di - 1] : 0, dropped: a.dropped }))
    .sort((x, y) => (x.pct >= DONE_AT) - (y.pct >= DONE_AT) || y.pct - x.pct);
}

// ---------- exchange formats ----------

/** Long table: one row per activity per report day (the CSV import format). */
export function toLong(model) {
  const rows = [];
  for (const p of model.pkgs) for (const a of p.acts) model.dates.forEach((d, i) => {
    if (a.raw[i] == null) return;
    rows.push({ date: d, area: p.area, package: p.name, package_id: p.id, activity: a.desc, unit: a.unit, bq: a.bq, progress: Math.round(a.raw[i] * 10) / 10 });
  });
  return rows;
}

const numFlex = (s) => {
  const t = String(s ?? '').trim().replace('%', '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (t.includes(',')) return Number(t.replace(',', '.'));
  return Number(t);
};
const toIso = (s) => {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** CSV (long format: date, package, activity, unit, bq, progress; package_id/area optional) → reports. */
export function reportsFromCSV(text) {
  const rows = parseCSV(text);
  const reports = {};
  for (const r of rows) {
    const date = toIso(r.date || r.tanggal), pct = numFlex(r.progress ?? r['progress %'] ?? r.percent ?? r.persen);
    const name = r.package || r.paket || r.pkg, desc = r.activity || r.aktivitas || r.description || r.uraian;
    if (!date || !name || !desc || !Number.isFinite(pct)) continue;
    const id = (r.package_id || name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 24);
    (reports[date] ||= { rows: [], concerns: [] }).rows.push({
      pkg: id, pkgName: name, area: (r.area || '').toUpperCase(), hint: '', summary: false, sub: '', desc, unit: r.unit || '', bq: numFlex(r.bq ?? r.volume) || 0, pct: Math.min(100, Math.max(0, pct)),
    });
  }
  return reports;
}

/** XLSX: Packages (daily % per package + overall + manpower), Activities (wide), Long (re-importable as CSV). */
export function buildProgressXlsx(model, { project = '' } = {}) {
  const ds = model.dates;
  const dcols = ds.map((d, i) => ({ header: d.slice(5), key: `d${i}`, width: 8, type: 'n', dp: 1 }));
  const pk = model.pkgs.map((p) => ({ package: p.name, area: p.area, acts: p.acts.length, ...Object.fromEntries(ds.map((_, i) => [`d${i}`, p.curve[i]])) }));
  pk.push({ package: 'OVERALL (activity-weighted, excl. summaries)', area: '', acts: model.count, ...Object.fromEntries(ds.map((_, i) => [`d${i}`, model.overall[i]])) });
  pk.push({ package: 'Manpower (people on site)', area: '', acts: '', ...Object.fromEntries(ds.map((_, i) => [`d${i}`, model.manpower[i] ?? ''])) });
  const act = [];
  for (const p of model.pkgs) for (const a of p.acts) act.push({ package: p.name, activity: a.desc, unit: a.unit, bq: a.bq, ...Object.fromEntries(ds.map((_, i) => [`d${i}`, a.pct[i]])) });
  return buildXlsx([
    { name: 'Packages', title: project ? `${project} — progress per work package (%)` : undefined, columns: [{ header: 'Work package', key: 'package', width: 44 }, { header: 'Area', key: 'area', width: 10 }, { header: 'Activities', key: 'acts', width: 10, type: 'n', dp: 0 }, ...dcols], rows: pk },
    { name: 'Activities', columns: [{ header: 'Work package', key: 'package', width: 34 }, { header: 'Activity', key: 'activity', width: 56 }, { header: 'Unit', key: 'unit', width: 8 }, { header: 'BQ', key: 'bq', width: 10, type: 'n', dp: 2 }, ...dcols], rows: act },
    { name: 'Long', columns: [{ header: 'date', key: 'date', width: 12 }, { header: 'area', key: 'area', width: 9 }, { header: 'package', key: 'package', width: 34 }, { header: 'package_id', key: 'package_id', width: 12 }, { header: 'activity', key: 'activity', width: 56 }, { header: 'unit', key: 'unit', width: 8 }, { header: 'bq', key: 'bq', width: 10, type: 'n', dp: 2 }, { header: 'progress', key: 'progress', width: 9, type: 'n', dp: 1 }], rows: toLong(model) },
  ]);
}

/** Merge new reports over stored ones (same date → replaced). */
export const mergeReports = (stored, incoming) => ({ ...(stored || {}), ...incoming });

/** Compact a parsed report for storage. */
export function slimReport(r) {
  return {
    manpower: r.manpower || null,
    concerns: r.concerns || [],
    rows: r.rows.map(({ pkg, pkgName, area, hint, summary, sub, desc, unit, bq, pct }) => ({ pkg, pkgName, area, hint, summary, sub, desc, unit, bq, pct })),
  };
}
