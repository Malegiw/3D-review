import { h, icon, toast, formDialog, confirmDialog, pickFiles, download, fmt, uid } from '../core/ui.js';
import { db } from '../core/db.js';
import { DOC_STATUS, REVIEW_CODES, DISCIPLINES, DOC_TYPES, statusOf, docStats, isOverdue } from '../core/domain.js';
import { buildXlsx, parseCSV } from '../core/xlsx.js';
import { exportProject } from '../core/store.js';
import { go, projectRoute, state } from '../core/app.js';
import { projectDialog } from './home.js';

const kpi = (v, l, color) => h('div', { class: 'panel kpi' }, h('div', { class: 'v', style: color ? { color } : null }, v), h('div', { class: 'l' }, l));

export async function renderOverview(main, project) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const [docs, models, plans, tests] = await Promise.all([db.byProject('deliverables', project.id), db.byProject('models', project.id), db.byProject('plotplans', project.id), db.byProject('clashtests', project.id)]);
  const st = docStats(docs);
  const clashes = tests.flatMap((t) => t.results || []);
  const openClash = clashes.filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length;
  const today = fmt.today();

  const stack = h('div', { class: 'stack' }, DOC_STATUS.filter((s) => st.byStatus[s.v]).map((s) => h('i', { style: { width: `${(st.byStatus[s.v] / Math.max(1, st.total)) * 100}%`, background: s.c }, title: `${s.v}: ${st.byStatus[s.v]}` })));
  const legend = h('div', { class: 'legend' }, DOC_STATUS.filter((s) => st.byStatus[s.v]).map((s) => h('span', { style: { '--c': s.c } }, `${s.v} ${st.byStatus[s.v]}`)));

  const byDisc = {};
  for (const d of docs) { const k = d.discipline || 'General'; (byDisc[k] ||= []).push(d); }
  const discRows = Object.entries(byDisc).sort((a, b) => b[1].length - a[1].length).map(([k, list]) => {
    const s = docStats(list);
    return h('tr', {}, h('td', { 'data-l': 'Discipline' }, k), h('td', { class: 'num', 'data-l': 'Docs' }, s.total), h('td', { class: 'num', 'data-l': 'Done' }, s.done),
      h('td', { 'data-l': 'Progress', style: { minWidth: '140px' } }, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, h('div', { class: 'bar', style: { flex: 1 } }, h('i', { style: { width: `${s.progress}%` } })), h('span', { class: 'mono' }, fmt.pct(s.progress)))),
      h('td', { class: 'num', 'data-l': 'Overdue', style: { color: s.overdue ? 'var(--red)' : null } }, s.overdue));
  });

  const upcoming = docs.filter((d) => statusOf(d.status).w < 100 && d.status !== 'ON HOLD' && d.planDate).sort((a, b) => a.planDate.localeCompare(b.planDate)).slice(0, 7);

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, `${project.code || 'Project'} · ${project.phase || ''}`), h('h1', {}, project.name),
        h('div', { class: 'mono dim', style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: '12px' } },
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
        h('button', { class: 'btn danger sm', onclick: async () => {
          if (!await confirmDialog(`Delete "${project.name}" with all its documents, plot plans, models and clash tests from this device?`, { title: 'Delete project', okLabel: 'Delete', danger: true })) return;
          await db.deleteProject(project.id);
          if (state.viewerProject === project.id) { state.viewer?.clear(); state.viewerProject = null; }
          toast('Project deleted.', 'ok');
          go('home');
        } }, icon('trash'), 'Delete'))),
    h('div', { class: 'grid kpis' },
      kpi(st.total, 'Deliverables'),
      kpi(fmt.pct(st.progress), 'Weighted progress', 'var(--cyan)'),
      kpi(st.done, 'IFC / AFC / As-built', 'var(--green)'),
      kpi(st.overdue, 'Overdue', st.overdue ? 'var(--red)' : null),
      kpi(models.length + plans.length, 'Models + plot plans'),
      kpi(openClash, 'Open clashes', openClash ? 'var(--magenta)' : null)),
    h('div', { class: 'grid two' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Status distribution'), h('a', { class: 'btn sm ghost', href: `#${projectRoute(project.id, 'docs')}` }, 'Open list')),
        st.total ? [stack, legend] : h('p', { class: 'dim2' }, 'No deliverables yet.')),
      h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Next due'), h('span', { class: 'mono dim', style: { fontSize: '12px' } }, `Today ${fmt.date(today)}`)),
        upcoming.length ? h('div', { class: 'clist' }, upcoming.map((d) => h('div', { class: 'citem', style: { cursor: 'default', borderColor: isOverdue(d) ? 'var(--red)' : null } },
          h('span', { class: 'chip', style: { '--c': statusOf(d.status).c } }, d.status), h('div', { class: 'nm' }, d.title, h('small', {}, d.docNo)),
          h('span', { class: 'mono', style: { fontSize: '12px', color: isOverdue(d) ? 'var(--red)' : 'var(--fg-2)' } }, fmt.date(d.planDate))))) : h('p', { class: 'dim2' }, 'Nothing pending.'))),
    h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('h3', {}, 'Progress by discipline')),
      discRows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cards' }, h('thead', {}, h('tr', {}, h('th', {}, 'Discipline'), h('th', { class: 'num' }, 'Docs'), h('th', { class: 'num' }, 'Done'), h('th', {}, 'Progress'), h('th', { class: 'num' }, 'Overdue'))), h('tbody', {}, discRows))) : h('p', { class: 'dim2' }, 'Add deliverables to see progress.')),
    h('div', { class: 'grid two' },
      h('a', { class: 'panel pcard', href: `#${projectRoute(project.id, 'plot')}`, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'eyebrow' }, 'Plot plan → 3D'), h('h2', {}, plans.length ? `${plans.length} plot plan${plans.length > 1 ? 's' : ''} · ${plans.reduce((n, p) => n + (p.objects?.length || 0), 0)} objects` : 'Upload a plot plan PDF'), h('p', { class: 'dim2', style: { margin: 0 } }, 'Pick outlines from the PDF, set heights, generate the 3D model with build-up motion.')),
      h('a', { class: 'panel pcard', href: `#${projectRoute(project.id, 'review')}`, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'eyebrow' }, '3D review'), h('h2', {}, `${models.length} contractor model${models.length === 1 ? '' : 's'} · ${clashes.length} clash results`), h('p', { class: 'dim2', style: { margin: 0 } }, 'Federated view, section box, measure, viewpoints, clash detection and MTO.'))),
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
  const f = { q: '', status: '', disc: '' };
  const tbody = h('tbody');
  const summary = h('div', { class: 'mono dim', style: { fontSize: '12px' } });

  const save = async (d) => { await db.put('deliverables', d); };
  const edit = async (d) => {
    const v = await formDialog({ title: d ? 'Edit deliverable' : 'Add deliverable', eyebrow: 'Document register', fields: docFields(d || {}), wide: true });
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
      const stSel = h('select', { class: 'inp st-sel', 'aria-label': 'Status', style: { borderLeftColor: s.c, color: s.c }, onchange: async (e) => {
        d.status = e.target.value;
        if (statusOf(d.status).w >= 60 && !d.actualDate) d.actualDate = fmt.today();
        await save(d); draw();
      } }, DOC_STATUS.map((o) => h('option', { value: o.v, selected: o.v === d.status }, o.v)));
      const rvSel = h('select', { class: 'inp', 'aria-label': 'Review code', onchange: async (e) => { d.review = e.target.value; await save(d); } }, REVIEW_CODES.map((o) => h('option', { value: o.v, selected: o.v === (d.review || '') }, o.v || '—')));
      tbody.append(h('tr', { class: isOverdue(d) ? 'overdue' : '' },
        h('td', { class: 'mono', 'data-l': 'Doc No' }, d.docNo),
        h('td', { 'data-l': 'Title', style: { minWidth: '200px' } }, d.title),
        h('td', { 'data-l': 'Disc.' }, d.discipline),
        h('td', { 'data-l': 'Type' }, d.type),
        h('td', { class: 'mono', 'data-l': 'Rev' }, d.rev || '—'),
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
      h('div', {}, h('div', { class: 'eyebrow' }, 'Document register'), h('h1', {}, 'Deliverable list'), summary),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost sm', onclick: importCSV, title: 'Columns: Doc No, Title, Discipline, Type, Rev, Status, Review, Plan, Actual, PIC, Remarks' }, icon('upload'), 'Import CSV'),
        h('button', { class: 'btn ghost sm', onclick: exportX }, icon('download'), 'Export XLSX'),
        h('button', { class: 'btn primary sm', onclick: () => edit(null) }, icon('plus'), 'Add'))),
    h('div', { class: 'panel', style: { padding: '12px' } }, h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'dq' }, 'Search'), h('input', { class: 'inp', id: 'dq', placeholder: 'Doc no, title, PIC…', oninput: (e) => { f.q = e.target.value; draw(); } })),
      h('div', { class: 'field' }, h('label', { for: 'ds' }, 'Status'), h('select', { class: 'inp', id: 'ds', onchange: (e) => { f.status = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), DOC_STATUS.map((s) => h('option', { value: s.v }, s.v)))),
      h('div', { class: 'field' }, h('label', { for: 'dd' }, 'Discipline'), h('select', { class: 'inp', id: 'dd', onchange: (e) => { f.disc = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), DISCIPLINES.map((s) => h('option', { value: s }, s)))))),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cards' },
      h('thead', {}, h('tr', {}, ['Doc No', 'Title', 'Disc.', 'Type', 'Rev', 'Status', 'Review', 'Plan', 'Actual', 'PIC', ''].map((x) => h('th', {}, x)))), tbody)),
  );
  draw();
}
