import { h, icon, toast, formDialog, confirmDialog, pickFiles, download, fmt, uid, countUp, holdButton, popover } from '../core/ui.js';
import { sCurveData, sCurve, statusDonut, barList } from './charts.js';
import { db } from '../core/db.js';
import { DOC_STATUS, REVIEW_CODES, DISCIPLINES, DOC_TYPES, statusOf, docStats, isOverdue } from '../core/domain.js';
import { buildXlsx, parseCSV } from '../core/xlsx.js';
import { exportProject } from '../core/store.js';
import { go, projectRoute, state } from '../core/app.js';
import { projectDialog } from './home.js';

export async function renderOverview(main, project) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const [docs, models, plans, tests] = await Promise.all([db.byProject('deliverables', project.id), db.byProject('models', project.id), db.byProject('plotplans', project.id), db.byProject('clashtests', project.id)]);
  const st = docStats(docs);
  const clashes = tests.flatMap((t) => t.results || []);
  const openClash = clashes.filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length;
  const today = fmt.today();

  const byDisc = {};
  for (const d of docs) { const k = d.discipline || 'General'; (byDisc[k] ||= []).push(d); }
  const discRows = Object.entries(byDisc).map(([k, list]) => {
    const s = docStats(list);
    return { label: k, value: s.progress, meta: `${s.total} docs${s.overdue ? ` · ${s.overdue} overdue` : ''}` };
  }).sort((a, b) => b.value - a.value);

  const upcoming = docs.filter((d) => statusOf(d.status).w < 100 && d.status !== 'ON HOLD' && d.planDate).sort((a, b) => a.planDate.localeCompare(b.planDate)).slice(0, 6);
  const curve = sCurveData(docs, { start: project.start, finish: project.finish, progress: st.progress, today });
  const gap = curve ? curve.actual - curve.planned : 0;

  const stat = (label, value, opts = {}) => h('div', { class: `stat ${opts.tone || ''}` }, h('span', { class: 'stat-l' }, label), countUp(h('b', { class: 'stat-v' }), value, opts), opts.note ? h('small', { class: 'stat-n' }, opts.note) : null);
  const del = holdButton({ label: 'Hold to delete', onConfirm: async () => {
    await db.deleteProject(project.id);
    if (state.viewerProject === project.id) { state.viewer?.clear(); state.viewerProject = null; }
    toast('Project deleted.', 'ok');
    go('home');
  } });

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'no-i18n' }, project.name),
        h('div', { class: 'head-meta' },
          h('span', { class: 'head-tags' }, h('span', { class: 'chip code no-i18n' }, project.code || 'Project'), project.phase ? h('span', { class: 'chip dot', style: { '--c': 'var(--cyan)' } }, project.phase) : null),
          h('span', {}, project.facility || '—'), h('span', {}, `Client ${project.client || '—'}`), h('span', {}, `Contractor ${project.contractor || '—'}`), h('span', {}, `${fmt.date(project.start)} → ${fmt.date(project.finish)}`))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', onclick: async () => {
          const v = await projectDialog(project);
          if (!v) return;
          Object.assign(project, v);
          await db.put('projects', project);
          state.project = project;
          go(projectRoute(project.id));
        } }, icon('edit'), 'Edit'),
        h('button', { class: 'btn ghost sm', onclick: async () => {
          toast('Packing backup…');
          const blob = await exportProject(project.id);
          download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_${fmt.today()}.nexus.zip`);
          toast(`Backup ready (${fmt.bytes(blob.size)}).`, 'ok');
        } }, icon('download'), 'Backup'),
        del)),
    h('div', { class: 'stats' },
      stat('Deliverables', st.total),
      stat('Weighted progress', st.progress || 0, { suffix: '%', tone: 'accent' }),
      stat('IFC / AFC / As-built', st.done, { tone: st.done ? 'good' : '' }),
      stat('Overdue', st.overdue, { tone: st.overdue ? 'bad' : '' }),
      stat('Models + plot plans', models.length + plans.length),
      stat('Open clashes', openClash, { tone: openClash ? 'warn' : '' })),
    curve ? h('section', { class: 'panel' },
      h('div', { class: 'panel-title' },
        h('div', {}, h('h3', {}, 'Progress S-curve'), h('p', { class: 'sub', style: { marginTop: '4px' } }, 'Cumulative weighted progress, planned against actual.')),
        h('div', { class: 'ch-legend' },
          h('span', {}, h('i', { class: 'k act' }), 'Actual', h('b', {}, fmt.pct(curve.actual))),
          h('span', {}, h('i', { class: 'k plan' }), 'Planned', h('b', {}, fmt.pct(curve.planned))),
          h('span', { class: `ch-gap ${gap < -0.5 ? 'behind' : 'ahead'}` }, Math.abs(gap) < 0.5 ? 'On plan' : `${gap > 0 ? '+' : '−'}${fmt.num(Math.abs(gap), 0)}% ${gap > 0 ? 'ahead of plan' : 'behind plan'}`))),
      sCurve(curve)) : null,
    h('div', { class: 'grid two' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Status'), h('a', { class: 'btn sm ghost', href: `#${projectRoute(project.id, 'docs')}` }, 'Open list', icon('arrowr'))),
        st.total ? statusDonut(st.byStatus, st.total) : h('p', { class: 'dim2' }, 'No deliverables yet.')),
      h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Progress by discipline')),
        discRows.length ? barList(discRows) : h('p', { class: 'dim2' }, 'Add deliverables to see progress.'))),
    h('div', { class: 'grid two' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Next due'), h('span', { class: 'sub' }, `Today ${fmt.date(today)}`)),
        upcoming.length ? h('div', { class: 'clist duelist' }, upcoming.map((d) => h('button', { type: 'button', class: 'citem', onclick: () => { state.docQuery = d.docNo; go(projectRoute(project.id, 'docs')); } },
          h('span', { class: 'chip', style: { '--c': statusOf(d.status).c } }, statusOf(d.status).s), h('div', { class: 'nm' }, h('span', { class: 'no-i18n' }, d.title), h('small', { class: 'no-i18n' }, d.docNo)),
          h('span', { class: `due ${isOverdue(d) ? 'late' : ''}` }, fmt.date(d.planDate))))) : h('p', { class: 'dim2' }, 'Nothing pending.')),
      h('div', { class: 'col' },
        h('a', { class: 'panel pcard go', href: `#${projectRoute(project.id, 'plot')}` }, h('span', { class: 'go-ic' }, icon('map')), h('div', {}, h('h3', {}, plans.length ? `${plans.length} plot plan${plans.length > 1 ? 's' : ''} · ${plans.reduce((n, p) => n + (p.objects?.length || 0), 0)} objects` : 'Upload a plot plan PDF'), h('p', { class: 'sub' }, 'Pick outlines from the PDF, set heights, generate the 3D model with build-up motion.')), icon('arrowr', 'go-arrow')),
        h('a', { class: 'panel pcard go', href: `#${projectRoute(project.id, 'review')}` }, h('span', { class: 'go-ic' }, icon('cube')), h('div', {}, h('h3', {}, `${models.length} contractor model${models.length === 1 ? '' : 's'} · ${clashes.length} clash results`), h('p', { class: 'sub' }, 'Federated view, section box, measure, viewpoints, clash detection and MTO.')), icon('arrowr', 'go-arrow')))),
  );
}

// ---------------- deliverables ----------------
const docFields = (d = {}) => [
  { id: 'docNo', label: 'Document No.', value: d.docNo, required: true, mono: true },
  { id: 'rev', label: 'Revision', value: d.rev, mono: true },
  { id: 'title', label: 'Title', value: d.title, required: true, span: true },
  { id: 'discipline', label: 'Discipline', type: 'select', options: DISCIPLINES, value: d.discipline || 'Civil' },
  { id: 'type', label: 'Type', type: 'select', options: DOC_TYPES, value: d.type || 'Drawing' },
  { id: 'status', label: 'Status', type: 'select', options: DOC_STATUS.map((s) => ({ v: s.v, l: s.l })), value: d.status || 'NOT STARTED' },
  { id: 'review', label: 'Review code', type: 'select', options: REVIEW_CODES, value: d.review || '' },
  { id: 'planDate', label: 'Plan date', type: 'date', value: d.planDate },
  { id: 'actualDate', label: 'Actual / submit date', type: 'date', value: d.actualDate },
  { id: 'pic', label: 'PIC / originator', value: d.pic },
  { id: 'remarks', label: 'Remarks', type: 'textarea', value: d.remarks, span: true },
];

function normDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy (Indonesian locale)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function pick(row, keys) { for (const k of Object.keys(row)) if (keys.some((x) => k.includes(x))) return row[k]; return ''; }

export async function renderDocs(main, project) {
  const page = h('div', { class: 'page' });
  main.append(page);
  let docs = await db.byProject('deliverables', project.id);
  const f = { q: state.docQuery || '', status: '', disc: '' };
  state.docQuery = null; // set by search / dashboard links to open the list filtered on one document
  const tbody = h('tbody');
  const summary = h('div', { class: 'mono dim', style: { fontSize: '12px' } });

  const save = async (d) => { await db.put('deliverables', d); };
  const edit = async (d) => {
    const v = await formDialog({ title: d ? 'Edit deliverable' : 'Add deliverable', fields: docFields(d || {}), wide: true });
    if (!v) return;
    if (d) Object.assign(d, v); else { d = { id: uid('d'), projectId: project.id, ...v }; docs.push(d); }
    await save(d);
    draw();
  };

  function draw() {
    const q = f.q.toLowerCase();
    const list = docs.filter((d) => (!f.status || d.status === f.status) && (!f.disc || d.discipline === f.disc) && (!q || `${d.docNo} ${d.title} ${d.pic} ${d.remarks}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.docNo || '').localeCompare(b.docNo || ''));
    tbody.innerHTML = '';
    for (const d of list) {
      const s = statusOf(d.status);
      // status picker: a popover with every status and its colour instead of a plain dropdown
      const stSel = h('button', { type: 'button', class: 'st-pick', style: { '--c': s.c }, 'aria-haspopup': 'listbox', title: s.l, onclick: (e) => {
        const { close } = popover(e.currentTarget, h('div', { class: 'pop-list', role: 'listbox', 'aria-label': 'Status' }, h('div', { class: 'pop-h' }, 'Status'),
          DOC_STATUS.map((o) => h('button', { type: 'button', role: 'option', 'aria-selected': String(o.v === d.status), class: `pop-row ${o.v === d.status ? 'on' : ''}`, onclick: async () => {
            close();
            if (o.v === d.status) return;
            d.status = o.v;
            if (statusOf(d.status).w >= 60 && !d.actualDate) d.actualDate = fmt.today();
            await save(d); draw();
          } }, h('i', { class: 'pop-dot', style: { background: o.c } }), h('span', {}, o.s), o.l.includes('·') ? h('small', {}, o.l.split('· ')[1]) : null))), { width: 290 });
      } }, h('i', { class: 'pop-dot', style: { background: s.c } }), h('span', {}, s.s), icon('chev'));
      const rvSel = h('select', { class: 'inp', 'aria-label': 'Review code', onchange: async (e) => { d.review = e.target.value; await save(d); } }, REVIEW_CODES.map((o) => h('option', { value: o.v, selected: o.v === (d.review || '') }, o.v || '—')));
      tbody.append(h('tr', { class: isOverdue(d) ? 'overdue' : '' },
        h('td', { class: 'code no-i18n', 'data-l': 'Doc No' }, d.docNo),
        h('td', { 'data-l': 'Title', style: { minWidth: '200px' } }, d.title),
        h('td', { 'data-l': 'Disc.' }, d.discipline),
        h('td', { 'data-l': 'Type' }, d.type),
        h('td', { class: 'code', 'data-l': 'Rev' }, d.rev || '—'),
        h('td', { 'data-l': 'Status' }, stSel),
        h('td', { 'data-l': 'Review' }, rvSel),
        h('td', { class: 'mono', 'data-l': 'Plan', style: { color: isOverdue(d) ? 'var(--red)' : null, whiteSpace: 'nowrap' } }, fmt.date(d.planDate)),
        h('td', { class: 'mono', 'data-l': 'Actual', style: { whiteSpace: 'nowrap' } }, fmt.date(d.actualDate)),
        h('td', { 'data-l': 'PIC' }, d.pic || '—'),
        h('td', { 'data-l': '' }, h('div', { class: 'btn-row', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          h('button', { class: 'btn sm icon ghost', 'aria-label': 'Edit', onclick: () => edit(d) }, icon('edit')),
          h('button', { class: 'btn sm icon danger', 'aria-label': 'Delete', onclick: async () => {
            if (!await confirmDialog(`Delete ${d.docNo}?`, { danger: true, okLabel: 'Delete' })) return;
            await db.del('deliverables', d.id); docs = docs.filter((x) => x !== d); draw();
          } }, icon('trash'))))));
    }
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: 11, class: 'dim2', style: { textAlign: 'center', padding: '28px' } }, docs.length ? 'No documents match the filter.' : 'No deliverables yet — add one or import a CSV.')));
    const st = docStats(docs);
    summary.textContent = `${list.length} of ${docs.length} shown · progress ${fmt.pct(st.progress)} · overdue ${st.overdue}`;
  }

  const exportX = () => {
    const rows = docs.slice().sort((a, b) => (a.docNo || '').localeCompare(b.docNo || ''));
    const blob = buildXlsx([{
      name: 'Deliverables', title: `${project.code || ''} ${project.name} — Deliverable List (${fmt.date(fmt.today())})`,
      columns: [
        { header: 'No', key: (r) => rows.indexOf(r) + 1, width: 6, type: 'n', dp: 0 },
        { header: 'Document No.', key: 'docNo', width: 22 }, { header: 'Title', key: 'title', width: 44 },
        { header: 'Discipline', key: 'discipline', width: 13 }, { header: 'Type', key: 'type', width: 13 }, { header: 'Rev', key: 'rev', width: 6 },
        { header: 'Status', key: 'status', width: 14 }, { header: 'Review Code', key: 'review', width: 12 },
        { header: 'Plan Date', key: 'planDate', width: 12 }, { header: 'Actual Date', key: 'actualDate', width: 12 },
        { header: 'Weight %', key: (r) => statusOf(r.status).w, width: 10, type: 'n', dp: 0 },
        { header: 'Overdue', key: (r) => (isOverdue(r) ? 'YES' : ''), width: 9 },
        { header: 'PIC', key: 'pic', width: 14 }, { header: 'Remarks', key: 'remarks', width: 30 },
      ],
      rows,
    }, {
      name: 'Summary', title: 'Status summary',
      columns: [{ header: 'Status', key: 'l', width: 32 }, { header: 'Count', key: 'n', type: 'n', dp: 0, width: 10 }, { header: 'Weight %', key: 'w', type: 'n', dp: 0, width: 10 }],
      rows: DOC_STATUS.map((s) => ({ l: s.l, n: docStats(docs).byStatus[s.v], w: s.w })),
    }]);
    download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_Deliverables_${fmt.today()}.xlsx`);
  };

  const importCSV = async () => {
    const [file] = await pickFiles({ accept: '.csv,.txt' });
    if (!file) return;
    const rows = parseCSV(await file.text());
    let n = 0;
    for (const r of rows) {
      const docNo = pick(r, ['doc no', 'document no', 'doc. no', 'no. dok', 'nomor', 'docno', 'document number']) || pick(r, ['no']);
      const title = pick(r, ['title', 'judul', 'description', 'deskripsi']);
      if (!docNo && !title) continue;
      const stRaw = (pick(r, ['status']) || '').toUpperCase();
      const status = DOC_STATUS.find((s) => stRaw.startsWith(s.v))?.v || 'NOT STARTED';
      const d = { id: uid('d'), projectId: project.id, docNo, title, discipline: DISCIPLINES.find((x) => x.toLowerCase() === (pick(r, ['discipline', 'disiplin']) || '').toLowerCase()) || pick(r, ['discipline', 'disiplin']) || 'General',
        type: pick(r, ['type', 'tipe', 'jenis']) || 'Drawing', rev: pick(r, ['rev']), status, review: (pick(r, ['review', 'code', 'kode']) || '').slice(0, 1).toUpperCase(),
        planDate: normDate(pick(r, ['plan', 'rencana', 'target'])), actualDate: normDate(pick(r, ['actual', 'aktual', 'submit', 'realisasi'])), pic: pick(r, ['pic', 'originator']), remarks: pick(r, ['remark', 'catatan', 'keterangan']) };
      await db.put('deliverables', d); docs.push(d); n++;
    }
    toast(`${n} deliverables imported.`, n ? 'ok' : 'warn');
    draw();
  };

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Deliverable list'), summary),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', onclick: importCSV, title: 'Columns: Doc No, Title, Discipline, Type, Rev, Status, Review, Plan, Actual, PIC, Remarks' }, icon('upload'), 'Import CSV'),
        h('button', { class: 'btn ghost sm', onclick: exportX }, icon('download'), 'Export XLSX'),
        h('button', { class: 'btn primary sm', onclick: () => edit(null) }, icon('plus'), 'Add'))),
    h('div', { class: 'panel', style: { padding: '12px' } }, h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'dq' }, 'Search'), h('input', { class: 'inp', id: 'dq', type: 'search', value: f.q, placeholder: 'Doc no, title, PIC…', oninput: (e) => { f.q = e.target.value; draw(); } })),
      h('div', { class: 'field' }, h('label', { for: 'ds' }, 'Status'), h('select', { class: 'inp', id: 'ds', onchange: (e) => { f.status = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), DOC_STATUS.map((s) => h('option', { value: s.v }, s.s)))),
      h('div', { class: 'field' }, h('label', { for: 'dd' }, 'Discipline'), h('select', { class: 'inp', id: 'dd', onchange: (e) => { f.disc = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), DISCIPLINES.map((s) => h('option', { value: s }, s)))))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cards' },
      h('thead', {}, h('tr', {}, ['Doc No', 'Title', 'Disc.', 'Type', 'Rev', 'Status', 'Review', 'Plan', 'Actual', 'PIC', ''].map((x) => h('th', {}, x)))), tbody)),
  );
  draw();
}
