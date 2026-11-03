import { h, icon, toast, formDialog, pickFiles, fmt } from '../core/ui.js';
import { db } from '../core/db.js';
import { docStats, PHASES } from '../core/domain.js';
import { importProject } from '../core/store.js';
import { go, projectRoute } from '../core/app.js';
import { coverArt } from './cover-art.js';

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

async function newProject() {
  const v = await projectDialog();
  if (!v) return;
  const p = await db.put('projects', { id: `p${Date.now().toString(36)}`, ...v, created: Date.now() });
  go(projectRoute(p.id));
}

async function restoreBackup() {
  const [f] = await pickFiles({ accept: '.zip' });
  if (!f) return;
  try { const pid = await importProject(f); toast('Backup restored.', 'ok'); go(projectRoute(pid)); } catch (e) { toast(e.message, 'err'); }
}

function card(p, { st, openClash, plans, models }) {
  const dates = p.start || p.finish ? `${fmt.date(p.start)} → ${fmt.date(p.finish)}` : null;
  const stat = (n, label, tone) => h('span', { class: `st ${tone || ''}` }, h('b', {}, n), h('em', {}, label));
  return h('a', { class: 'hcard', href: `#${projectRoute(p.id)}` },
    h('div', { class: 'cover' },
      p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy' }) : coverArt(),
      h('div', { class: 'tags' },
        p.sample ? h('span', { class: 'chip glass', style: { '--c': 'var(--yellow)' } }, 'Sample') : null,
        p.phase ? h('span', { class: 'chip glass dot', style: { '--c': 'var(--cyan)' } }, p.phase) : null)),
    h('div', { class: 'hbody' },
      h('span', { class: 'code' }, p.code || '—'),
      h('h2', {}, p.name),
      h('p', { class: 'meta' }, [p.facility, dates].filter(Boolean).join('  ·  ') || '—'),
      h('div', { class: 'hprog' },
        h('div', { class: 'bar' }, h('i', { style: { width: `${st.progress}%` } })),
        h('span', {}, fmt.pct(st.progress))),
      h('div', { class: 'hstats' },
        stat(st.total, 'Docs'),
        stat(st.overdue, 'Overdue', st.overdue ? 'warn' : ''),
        stat(openClash, 'Open clash', openClash ? 'alert' : '')),
      h('p', { class: 'meta small' }, `${plans} plot plan · ${models} model${models === 1 ? '' : 's'}`)));
}

export async function renderHome(main) {
  const page = h('div', { class: 'page home' });
  main.append(page);
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cards = [];
  for (const p of projects) {
    const [docs, models, plans, tests] = await Promise.all([db.byProject('deliverables', p.id), db.byProject('models', p.id), db.byProject('plotplans', p.id), db.byProject('clashtests', p.id)]);
    const openClash = tests.reduce((n, t) => n + (t.results || []).filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length, 0);
    cards.push(card(p, { st: docStats(docs), openClash, plans: plans.length, models: models.length }));
  }

  if (!projects.length) {
    page.append(h('div', { class: 'hempty' },
      coverArt(),
      h('h1', {}, 'No projects yet'),
      h('p', {}, 'Create a project, then add its deliverable list, plot plan PDF and contractor models.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: newProject }, icon('plus'), 'New project'),
        h('button', { class: 'btn ghost', onclick: restoreBackup }, icon('upload'), 'Restore backup'))));
    return;
  }

  page.append(
    h('div', { class: 'hhead' },
      h('div', {}, h('h1', {}, 'Projects'), h('p', { class: 'sub' }, `${projects.length} project${projects.length === 1 ? '' : 's'}`)),
      h('button', { class: 'btn primary', onclick: newProject }, icon('plus'), 'New project')),
    h('div', { class: 'hgrid' }, cards,
      h('button', { class: 'hcard add', type: 'button', onclick: newProject }, icon('plus'), h('b', {}, 'New project'), h('small', {}, 'Start from a plot plan PDF or a contractor 3D model.'))));
}
