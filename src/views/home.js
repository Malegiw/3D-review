import { h, icon, toast, formDialog, pickFiles, fmt } from '../core/ui.js';
import { db } from '../core/db.js';
import { docStats, PHASES } from '../core/domain.js';
import { importProject } from '../core/store.js';
import { VERSION, COPYRIGHT, go, projectRoute } from '../core/app.js';

export async function projectDialog(p = {}) {
  return formDialog({
    title: p.id ? 'Edit project' : 'New project', eyebrow: 'Project data', submitLabel: p.id ? 'Save' : 'Create',
    fields: [
      { id: 'code', label: 'Project No. / WBS', value: p.code, required: true, mono: true, placeholder: 'e.g. SPHR01149A' },
      { id: 'name', label: 'Project name', value: p.name, required: true, span: true },
      { id: 'facility', label: 'Facility / location', value: p.facility, placeholder: 'e.g. Petani GS' },
      { id: 'phase', label: 'Phase', type: 'select', options: PHASES, value: p.phase || 'DED' },
      { id: 'client', label: 'Client / owner', value: p.client },
      { id: 'contractor', label: 'Contractor / consultant', value: p.contractor },
      { id: 'start', label: 'Start', type: 'date', value: p.start },
      { id: 'finish', label: 'Finish', type: 'date', value: p.finish },
      { id: 'description', label: 'Scope / notes', type: 'textarea', value: p.description, span: true },
    ],
  });
}

export async function renderHome(main) {
  const page = h('div', { class: 'page' });
  main.append(page);
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cards = [];
  for (const p of projects) {
    const [docs, models, plans, tests] = await Promise.all([db.byProject('deliverables', p.id), db.byProject('models', p.id), db.byProject('plotplans', p.id), db.byProject('clashtests', p.id)]);
    const st = docStats(docs);
    const openClash = tests.reduce((n, t) => n + (t.results || []).filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length, 0);
    cards.push(h('article', { class: 'panel pcard', tabindex: 0, onclick: () => go(projectRoute(p.id)), onkeydown: (e) => e.key === 'Enter' && go(projectRoute(p.id)) },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' } },
        h('span', { class: 'code' }, p.code || '—'),
        h('span', { style: { display: 'flex', gap: '6px' } }, p.sample ? h('span', { class: 'chip', style: { '--c': 'var(--yellow)' } }, 'Sample') : null, h('span', { class: 'chip dot', style: { '--c': 'var(--cyan)' } }, p.phase || '—'))),
      h('h2', {}, p.name),
      h('div', { class: 'meta' }, h('span', {}, p.facility || '—'), h('span', {}, `${fmt.date(p.start)} → ${fmt.date(p.finish)}`)),
      h('div', {}, h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }, class: 'mono dim' }, h('span', {}, 'Deliverable progress'), h('span', { class: 'neon-c' }, fmt.pct(st.progress))),
        h('div', { class: 'bar' }, h('i', { style: { width: `${st.progress}%` } }))),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, st.total), h('span', {}, 'Docs')),
        h('div', {}, h('b', { style: { color: st.overdue ? 'var(--red)' : null } }, st.overdue), h('span', {}, 'Overdue')),
        h('div', {}, h('b', { style: { color: openClash ? 'var(--magenta)' : null } }, openClash), h('span', {}, 'Open clash'))),
      h('div', { class: 'meta' }, h('span', {}, `${plans.length} plot plan · ${models.length} model${models.length === 1 ? '' : 's'}`))));
  }

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Project grid'), h('h1', {}, 'Facility projects'), h('p', { class: 'dim2', style: { margin: 0, maxWidth: '62ch' } }, 'Turn 2D plot plans into 3D, review contractor models, run clash checks and MTO, and keep every deliverable on track.')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: async () => {
          const [f] = await pickFiles({ accept: '.zip' });
          if (!f) return;
          try { const pid = await importProject(f); toast('Backup restored.', 'ok'); go(projectRoute(pid)); } catch (e) { toast(e.message, 'err'); }
        } }, icon('upload'), 'Restore backup'),
        h('button', { class: 'btn primary', onclick: async () => {
          const v = await projectDialog();
          if (!v) return;
          const p = await db.put('projects', { id: `p${Date.now().toString(36)}`, ...v, created: Date.now() });
          go(projectRoute(p.id));
        } }, icon('plus'), 'New project'))),
    projects.length
      ? h('div', { class: 'grid cards' }, cards)
      : h('div', { class: 'panel empty' }, icon('folder'), h('h2', {}, 'No projects yet'), h('p', { style: { margin: 0 } }, 'Create a project, then add its deliverable list, plot plan PDF and contractor models.')),
    h('div', { class: 'grid two' },
      h('div', { class: 'panel' }, h('div', { class: 'eyebrow' }, 'Supported inputs'), h('dl', { class: 'kv', style: { marginTop: '12px' } },
        h('dt', {}, 'Plot plan'), h('dd', {}, 'PDF (vector or scanned)'),
        h('dt', {}, 'Direct 3D'), h('dd', {}, 'GLB · glTF · FBX · OBJ · DAE · STL · PLY'),
        h('dt', {}, 'Via converter'), h('dd', {}, 'NWD · NWC · DWFx · DWF · SKP · RVT · IFC'),
        h('dt', {}, 'Exports'), h('dd', {}, 'XLSX · GLB-ready · MP4/WebM motion'))),
      h('div', { class: 'panel' }, h('div', { class: 'eyebrow' }, 'Install on phone / iPad'), h('p', { class: 'dim2', style: { margin: '12px 0 0' } },
        'iPhone & iPad: open in Safari → Share → Add to Home Screen. Android: Chrome menu → Install app. Laptop: the install icon in the address bar. Data is stored on each device; use Backup on a project to move it.'))),
    h('div', { class: 'foot' }, h('span', {}, COPYRIGHT), h('span', { class: 'no-i18n' }, `Review 3D v${VERSION}`)),
  );
}
