// Parser for the EPC "Daily Activity Report" (one PDF per day): BQ-based activity table with cumulative volume and %.
// Pure functions (no DOM) so they run in the browser and in node tests. PDF → lines → report.
//
// Table columns:  DESCRIPTION | UNIT | BQ VOLUME | YESTERDAY | TODAY | TOTAL VOLUME | REMAINING | PERCENT | REMARK
// Headings (no numbers) group the rows into work packages: "SURGE TANK", "Main Line Header Segment 2", "Meno CTI-05" …

const MONTHS = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2, mar: 3, march: 3, maret: 3, apr: 4, april: 4,
  may: 5, mei: 5, jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7, aug: 8, august: 8, agu: 8, agt: 8, agustus: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, des: 12, desember: 12,
};

/** "1.000,00" → 1000, "-" → 0 (Indonesian number format). */
export function num(s) {
  const t = String(s ?? '').trim();
  if (!t || t === '-') return 0;
  const v = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

/** Work packages: a heading line of the report → stable id, name and area. First match wins. */
export const PACKAGES = [
  { rx: /pipe support piling/i, id: 'OFF-PILING', name: 'Pipe support piling (summary)', area: 'OFFPLOT', summary: true },
  { rx: /pipe stringing and full weld/i, id: 'OFF-STRING', name: 'Pipe stringing & welding (summary)', area: 'OFFPLOT', summary: true },
  { rx: /main line header segment\s*(\d)/i, id: (m) => `HDR-S${m[1]}`, name: (m) => `Main header · Segment ${m[1]}`, area: 'OFFPLOT', hint: 'header' },
  { rx: /\bCTI[- ]?(\d+)/i, id: (m) => `CTI-${m[1]}`, name: (m) => `Well pad CTI-${m[1]}`, area: 'OFFPLOT', hint: (m) => `CTI-${m[1]}` },
  { rx: /segment\s*(\d)\s*power distribusi/i, id: (m) => `PWR-S${m[1]}`, name: (m) => `Power distribution · Segment ${m[1]}`, area: 'OFFPLOT', hint: 'pole' },
  { rx: /mcc room/i, id: 'MCC', name: 'MCC room', area: 'ONPLOT', hint: 'MCC' },
  { rx: /surge tank/i, id: 'TANK', name: 'Surge tank', area: 'ONPLOT', hint: 'surge' },
  { rx: /transformer/i, id: 'TRF', name: 'Transformer', area: 'ONPLOT', hint: 'transformer' },
  { rx: /water injection pump/i, id: 'WIP', name: 'Water injection pump (Unit 1-3)', area: 'ONPLOT', hint: 'WIP' },
  { rx: /control building/i, id: 'CB', name: 'Control building', area: 'ONPLOT', hint: 'control' },
  { rx: /new vcb/i, id: 'VCB', name: 'New VCB · Menggala substation', area: '', hint: 'VCB' },
  { rx: /tie[- ]?in/i, id: 'TIE', name: 'Tie-in to existing facility', area: 'ONPLOT', hint: 'tie' },
  { rx: /pipe line .*gs|pipe support new onplot|pipe line onplot/i, id: 'PIPE-ON', name: 'Onplot pipeline & supports (Meno GS)', area: 'ONPLOT', hint: 'pipe' },
];
// Rows that sit under the last well pad heading but belong to the whole 12" main header (tests, crossings, CP).
const TEST_ROW = /segmen\s*1,\s*2\s*and\s*3|waterfilling|hydro\s*test pipe line 12|road crossing underground pipe line \(all|cathodic protection all/i;
const TEST_PKG = { id: 'OFF-TEST', name: 'Main header 12" · test & crossings', area: 'OFFPLOT', hint: 'header' };
const SUB_HEAD = /^screw pil\w* pole/i;
const SUB_ROW = /^(type\s+[a-c]\b|guy pole)/i; // rows that sit under the "Screw Pile Pole" sub-heading

const resolve = (v, m) => (typeof v === 'function' ? v(m) : v);

/** Package for a heading line, or null when the line is not a known heading. */
export function packageOfHeading(line) {
  for (const p of PACKAGES) {
    const m = p.rx.exec(line);
    if (m) return { id: resolve(p.id, m), name: resolve(p.name, m), area: p.area, summary: !!p.summary, hint: resolve(p.hint, m) || '' };
  }
  // a new ALL-CAPS heading (e.g. a new facility) becomes its own package instead of being swallowed by the previous one
  if (/^[A-Z0-9][A-Z0-9 ,.&()/\-]{3,60}$/.test(line) && /[A-Z]{3}/.test(line) && !/^[AB]\s/.test(line) && !/^(NO|TODAY|PAGE|DESCRIPTION|CONCERN)\b/.test(line)) {
    const id = line.replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    return { id, name: line.replace(/\s+/g, ' ').replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()), area: '', summary: false, hint: '' };
  }
  return null;
}

/** pdf.js text items [{ s, x, y }] (y grows downwards) → one string per visual row, items joined left to right. */
export function groupLines(items, tol = 3) {
  const its = items.filter((i) => i.s && i.s.trim()).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of its) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(it.y - r.y) <= tol) { r.items.push(it); r.y = (r.y * (r.items.length - 1) + it.y) / r.items.length; } else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' ').replace(/\s+/g, ' ').trim());
}

const N = '\\d[\\d.]*,\\d+';
const ROW = new RegExp(`^(.+?)\\s+([A-Za-z][A-Za-z0-9²]{0,7})\\s+(${N})((?:\\s+(?:-|${N}))*)\\s+(${N})%(?:\\s+(.*))?$`);
const SKIP = /^(TODAY ACTIVITIES?|No\.? DESCRIPTION|1 2 3 4|Page \d+ of \d+|PROJECT\s*:|LOCATION\s*:|NO\. DESCRIPTION)/i;

/**
 * Parse the text rows of one report.
 * @param {string[]} lines
 * @returns {{ date: string|null, project: string, manpower: object|null, concerns: string[], rows: object[], unknown: string[] }}
 */
export function parseReport(lines) {
  const out = { date: null, project: '', manpower: null, concerns: [], rows: [], unknown: [] };
  let inTable = false, inConcern = false, area = '', pkg = null, sub = '';
  for (const raw of lines) {
    const s = raw.replace(/\bPage \d+ of \d+\b/gi, ' ').replace(/\s+/g, ' ').trim(); // a page footer can land inside a row
    if (!s) continue;
    if (!out.date) {
      const d = /Date\s*:\s*(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(s);
      const mo = d && MONTHS[d[2].toLowerCase()];
      if (mo) out.date = `${d[3]}-${String(mo).padStart(2, '0')}-${String(Number(d[1])).padStart(2, '0')}`;
    }
    if (!out.project) { const p = /PROJECT\s*:\s*(.+?)(?:\s{2,}|\s+Date\s*:|$)/i.exec(s); if (p) out.project = p[1].trim(); }
    const mp = /GRAND TOTAL MANPOWER\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)\s+(\d[\d.]*)/i.exec(s);
    if (mp) out.manpower = { today: Number(mp[1].replace(/\./g, '')), hoursToday: Number(mp[4].replace(/\./g, '')), hoursTotal: Number(mp[5].replace(/\./g, '')) };
    if (/^TODAY ACTIVITIES/i.test(s)) { inTable = true; inConcern = false; continue; }
    if (/^CONCERN\b/i.test(s)) { inTable = false; inConcern = true; continue; }
    if (/^(Attachment|Prepared By|ACTIVITY PHOTOGRAPH)/i.test(s)) { inConcern = false; if (/^ACTIVITY PHOTOGRAPH/i.test(s)) inTable = false; continue; }
    if (inConcern) {
      if (/^(NO\.?\s*DESCRIPTION|\d+)$/i.test(s) || SKIP.test(s)) continue;
      out.concerns.push(s.replace(/^\d+\s+/, ''));
      continue;
    }
    if (!inTable || SKIP.test(s)) continue;

    const a = /^([A-Z])\s+MENO?\s*(OFFPLOT|ONPLOT)|^[A-Z]\s+.*\b(OFFPLOT|ONPLOT)\b/i.exec(s);
    if (a) { area = (a[2] || a[3]).toUpperCase(); continue; }

    const m = ROW.exec(s);
    if (m) {
      const [, desc, unit, bq, mid, pct, remark] = m;
      const nums = (mid || '').trim().split(/\s+/).filter(Boolean).map(num);
      const bqv = num(bq), pc = num(pct);
      let p = pkg;
      if (TEST_ROW.test(desc)) p = { ...TEST_PKG, summary: false };
      if (!p) { out.unknown.push(s); continue; }
      out.rows.push({
        pkg: p.id, pkgName: p.name, area: p.area || area, hint: p.hint || '', summary: !!p.summary,
        sub: sub && SUB_ROW.test(desc.trim()) ? sub : '', desc: desc.trim(), unit, bq: bqv,
        total: nums.length >= 3 ? nums[2] : (bqv * pc) / 100, pct: pc, remark: (remark || '').trim(),
      });
      continue;
    }
    if (SUB_HEAD.test(s)) { sub = 'Screw pile pole'; continue; }
    const hp = packageOfHeading(s);
    if (hp) { pkg = { ...hp, area: hp.area || area }; sub = ''; continue; }
    out.unknown.push(s);
  }
  return out;
}

/** Date from a file name like "… 21 Nov 2026.pdf" / "…28 Okt 2026" / "2026-11-21". */
export function dateFromName(name) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = /(\d{1,2})[ _.-]+([A-Za-z]{3,9})[ _.-]+(\d{4})/.exec(name);
  const mo = m && MONTHS[m[2].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}` : null;
}

/** All text rows of an opened pdf.js document, page after page (works in the browser and in node). */
export async function linesOfPdf(doc) {
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: -it.transform[5] }));
    lines.push(...groupLines(items));
  }
  return lines;
}
