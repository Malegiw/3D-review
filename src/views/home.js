import { h, icon, toast, formDialog, pickFiles, fmt, countUp } from '../core/ui.js';
import { db } from '../core/db.js';
import { docStats, PHASES, statusOf, isOverdue } from '../core/domain.js';
import { importProject } from '../core/store.js';
import { go, projectRoute, state } from '../core/app.js';
import { locale } from '../core/i18n.js';
import { coverArt } from './cover-art.js';

export async function projectDialog(p = {}) {
  return formDialog({
    title: p.id ? 'Edit project' : 'New project', submitLabel: p.id ? 'Save' : 'Create',
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

export async function newProject() {
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

// Project card: framed cover, then the numbers that matter. Pointer devices get a gentle tilt (Bencho/beUI tilt card).
function tilt(el) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return el;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(x * 6).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
    el.classList.add('tilting');
  });
  el.addEventListener('pointerleave', () => { el.classList.remove('tilting'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  return el;
}

function card(p, { st, openClash, plans, models }) {
  const dates = p.start || p.finish ? `${fmt.date(p.start)} → ${fmt.date(p.finish)}` : null;
  const stat = (n, label, tone) => h('span', { class: `st ${tone || ''}` }, h('b', {}, n), h('em', {}, label));
  return tilt(h('a', { class: 'hcard', href: `#${projectRoute(p.id)}` },
    h('div', { class: 'cover' },
      p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy' }) : coverArt(),
      h('div', { class: 'tags' },
        p.sample ? h('span', { class: 'chip glass' }, 'Sample') : null,
        p.phase ? h('span', { class: 'chip glass dot', style: { '--c': 'var(--cyan)' } }, p.phase) : null),
      h('i', { class: 'glare', 'aria-hidden': 'true' })),
    h('div', { class: 'hbody' },
      h('span', { class: 'code no-i18n' }, p.code || '—'),
      h('h2', { class: 'no-i18n' }, p.name),
      h('p', { class: 'meta' }, [p.facility, dates].filter(Boolean).join('  ·  ') || '—'),
      h('div', { class: 'hprog' },
        h('div', { class: 'bar' }, h('i', { style: { width: `${st.progress}%` } })),
        h('span', {}, fmt.pct(st.progress))),
      h('div', { class: 'hstats' },
        stat(st.total, 'Docs'),
        stat(st.overdue, 'Overdue', st.overdue ? 'warn' : ''),
        stat(openClash, 'Open clash', openClash ? 'alert' : '')),
      h('p', { class: 'meta small' }, `${plans} plot plan · ${models} model${models === 1 ? '' : 's'}`))));
}

const greeting = () => { const hr = new Date().getHours(); return hr < 11 ? 'Good morning' : hr < 15 ? 'Good day' : hr < 18 ? 'Good afternoon' : 'Good evening'; };

export async function renderHome(main) {
  const page = h('div', { class: 'page home' });
  main.append(page);
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const cards = [], due = [];
  let docsAll = 0, overdueAll = 0, clashAll = 0, weighted = 0;
  const today = fmt.today(), soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  for (const p of projects) {
    const [docs, models, plans, tests] = await Promise.all([db.byProject('deliverables', p.id), db.byProject('models', p.id), db.byProject('plotplans', p.id), db.byProject('clashtests', p.id)]);
    const openClash = tests.reduce((n, t) => n + (t.results || []).filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length, 0);
    const st = docStats(docs);
    docsAll += st.total; overdueAll += st.overdue; clashAll += openClash; weighted += (st.progress || 0) * st.total;
    for (const d of docs) if (statusOf(d.status).w < 100 && d.status !== 'ON HOLD' && d.planDate && d.planDate <= soon) due.push({ d, p });
    cards.push(card(p, { st, openClash, plans: plans.length, models: models.length }));
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

  const stat = (label, value, opts = {}) => h('div', { class: `stat ${opts.tone || ''}` }, h('span', { class: 'stat-l' }, label), countUp(h('b', { class: 'stat-v' }), value, opts));
  due.sort((a, b) => a.d.planDate.localeCompare(b.d.planDate));
  const dueList = due.slice(0, 8).map(({ d, p }) => {
    const late = isOverdue(d);
    return h('button', { type: 'button', class: 'due-row', onclick: () => { state.docQuery = d.docNo; go(projectRoute(p.id, 'docs')); } },
      h('i', { class: 'due-dot', style: { background: statusOf(d.status).c }, title: statusOf(d.status).s }),
      h('span', { class: 'due-main' }, h('b', { class: 'no-i18n' }, d.title), h('small', { class: 'no-i18n' }, `${p.code || p.name} · ${d.docNo}`)),
      h('span', { class: `due ${late ? 'late' : ''}` }, late ? 'Late' : '', h('em', {}, fmt.date(d.planDate))));
  });

  page.append(
    h('div', { class: 'hhead' },
      h('div', {}, h('h1', {}, greeting()), h('p', { class: 'sub' }, `${new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${projects.length} project${projects.length === 1 ? '' : 's'}`)),
      h('button', { class: 'btn primary', onclick: newProject }, icon('plus'), 'New project')),
    h('div', { class: 'stats' },
      stat('Projects', projects.length),
      stat('Deliverables', docsAll),
      stat('Weighted progress', docsAll ? weighted / docsAll : 0, { suffix: '%' }),
      stat('Overdue', overdueAll, { tone: overdueAll ? 'bad' : '' }),
      stat('Open clashes', clashAll, { tone: clashAll ? 'warn' : '' })),
    h('div', { class: 'home-cols' },
      h('section', { class: 'home-proj' }, h('h2', { class: 'sec-h' }, 'Projects'),
        h('div', { class: 'hgrid' }, cards,
          h('button', { class: 'hcard add', type: 'button', onclick: newProject }, icon('plus'), h('b', {}, 'New project'), h('small', {}, 'Start from a plot plan PDF or a contractor 3D model.')))),
      h('section', { class: 'panel home-due' },
        h('div', { class: 'panel-title' }, h('h2', {}, 'Due in the next 14 days'), h('span', { class: 'sub' }, `${due.length}`)),
        dueList.length ? h('div', { class: 'due-list' }, dueList) : h('p', { class: 'dim2', style: { margin: 0 } }, 'Nothing due. Good work.'),
        due.length > 8 ? h('p', { class: 'sub', style: { marginTop: '10px' } }, `+${due.length - 8} more`) : null)));
}
