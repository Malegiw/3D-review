// Baseline schedules from planning tools: Primavera P6 (.xer) and Microsoft Project (MSPDI .xml), plus the simple CSV.
// Pure text parsing (no DOM) so it runs in the browser and in node tests.
// A schedule becomes { pkgId: { start, finish, acts: [{ name, start, finish }] } }: activities are matched to the daily
// report's activities by name, packages get the span of their matched activities (or of a WBS / summary task of the
// same name when no activity matches).

const day = (s) => {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/) || String(s || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (x) => new Set(norm(x).split(' ').filter((w) => w.length > 1));
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
};

/** Primavera P6 XER (tab separated: %T table, %F fields, %R rows). Returns tasks with their WBS path. */
export function parseXER(text) {
  const tables = {};
  let cur = null, fields = null;
  for (const line of String(text).split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[0] === '%T') { cur = c[1]; fields = null; tables[cur] = []; }
    else if (c[0] === '%F') fields = c.slice(1);
    else if (c[0] === '%R' && cur && fields) { const r = {}; fields.forEach((f, i) => { r[f] = c[i + 1] ?? ''; }); tables[cur].push(r); }
  }
  const wbs = new Map((tables.PROJWBS || []).map((w) => [w.wbs_id, w]));
  const path = (id) => { const out = []; let w = wbs.get(id), guard = 0; while (w && guard++ < 50) { out.unshift(w.wbs_name || w.wbs_short_name); w = wbs.get(w.parent_wbs_id); } return out; };
  const tasks = (tables.TASK || []).map((t) => ({
    id: t.task_id, code: t.task_code, name: t.task_name,
    start: day(t.target_start_date || t.early_start_date || t.act_start_date || t.restart_date),
    finish: day(t.target_end_date || t.early_end_date || t.act_end_date || t.reend_date),
    wbs: path(t.wbs_id), summary: /TT_WBS|TT_LOE/i.test(t.task_type || ''),
  })).filter((t) => t.name && t.start && t.finish);
  if (!tasks.length) throw new Error('No activities with dates found in the XER file (TASK table).');
  return { tasks, source: 'Primavera P6 (XER)' };
}

/** Microsoft Project XML (MSPDI). Summary tasks become the WBS path of the tasks under them. */
export function parseMSPDI(xml) {
  const tasks = [], stack = [];
  const blocks = String(xml).match(/<Task>[\s\S]*?<\/Task>/g) || [];
  const tag = (b, n) => { const m = b.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() : ''; };
  for (const b of blocks) {
    const name = tag(b, 'Name'), lvl = Number(tag(b, 'OutlineLevel') || 1), summary = tag(b, 'Summary') === '1';
    if (!name) continue;
    while (stack.length && stack[stack.length - 1].lvl >= lvl) stack.pop();
    const t = { id: tag(b, 'UID'), code: tag(b, 'WBS'), name, start: day(tag(b, 'Start')), finish: day(tag(b, 'Finish')), wbs: stack.map((s) => s.name), summary };
    if (summary && lvl > 0 && tag(b, 'UID') !== '0') stack.push({ lvl, name }); // the project summary (UID 0) is not a WBS level
    if (t.start && t.finish && tag(b, 'UID') !== '0') tasks.push(t);
  }
  if (!tasks.length) throw new Error('No tasks with dates found in the Microsoft Project XML.');
  return { tasks, source: 'Microsoft Project (XML)' };
}

/** Pick the parser from the file name / content. CSV (package, start, finish) is handled by baselineFromCSV. */
export function parseSchedule(name, text) {
  if (/\.xer$/i.test(name) || /^ERMHDR/.test(text)) return parseXER(text);
  if (/\.xml$/i.test(name) || /<Project[\s>]/.test(text.slice(0, 2000))) return parseMSPDI(text);
  return null;
}

/**
 * Match schedule tasks to the model's packages and activities.
 * Activities: best name match (Jaccard ≥ 0.5), preferring tasks whose WBS path mentions the package.
 * Packages: span of their matched activities; otherwise a WBS level / summary task with the package's name or id.
 */
export function scheduleToBaseline({ tasks }, pkgs) {
  const out = {}, used = new Set();
  const leaf = tasks.filter((t) => !t.summary);
  const tk = leaf.map((t) => ({ t, tk: tokens(t.name), wb: tokens(t.wbs.join(' ')), code: norm(t.code) }));
  let matchedActs = 0, totalActs = 0;
  for (const p of pkgs) {
    if (p.summary) continue;
    const pTok = tokens(`${p.name} ${p.id}`);
    const acts = [];
    for (const a of p.acts || []) {
      totalActs++;
      const at = tokens(a.desc);
      let best = null, bs = 0;
      for (const c of tk) {
        if (used.has(c.t)) continue;
        let s = jaccard(at, c.tk);
        if (s > 0 && (jaccard(pTok, c.wb) > 0.3 || c.code.includes(norm(p.id)))) s += 0.15; // same package in the WBS
        if (s > bs) { bs = s; best = c; }
      }
      if (best && bs >= 0.5) { used.add(best.t); matchedActs++; acts.push({ key: a.key, name: best.t.name, start: best.t.start, finish: best.t.finish }); }
    }
    let start = null, finish = null;
    for (const a of acts) { if (!start || a.start < start) start = a.start; if (!finish || a.finish > finish) finish = a.finish; }
    if (!start) {
      // package-level: a WBS node or summary task named like the package
      const pn = norm(p.name), pid = norm(p.id);
      const hits = tasks.filter((t) => (t.summary && (norm(t.name) === pn || jaccard(tokens(t.name), tokens(p.name)) >= 0.6))
        || t.wbs.some((w) => norm(w) === pn || norm(w) === pid) || norm(t.code).startsWith(pid));
      for (const t of hits) { if (!start || t.start < start) start = t.start; if (!finish || t.finish > finish) finish = t.finish; }
    }
    if (start && finish) out[p.id] = { start, finish, ...(acts.length ? { acts } : {}) };
  }
  return { baseline: out, matchedActs, totalActs, packages: Object.keys(out).length };
}
