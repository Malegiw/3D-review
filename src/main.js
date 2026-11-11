import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles/fonts.css';
import './styles/theme.css';
import './styles/shell.css';

import { h, icon, logoMark, toast, popover } from './core/ui.js';
import { getTheme, applyTheme } from './core/theme.js';
import { startI18n } from './core/i18n.js';
import { db, requestPersistence } from './core/db.js';
import { seedSample } from './core/store.js';
import { ensurePoller } from './core/jobs.js';
import { renderHome, newProject } from './views/home.js';
import { renderOverview, renderDocs } from './views/project.js';
import { renderPlot } from './views/plotplan.js';
import { renderReview } from './views/review.js';
import { openSettings } from './views/settings.js';
import { openPalette } from './views/palette.js';
import { startGlide } from './core/motion.js';
import { startSounds } from './core/sound.js';
import { setActivity, endActivity, clearActivity } from './core/island.js';

import { VERSION, YEAR, state, projectRoute, go } from './core/app.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'grid', render: renderOverview },
  { id: 'docs', label: 'Docs', icon: 'docs', render: renderDocs },
  { id: 'plot', label: 'Plot→3D', icon: 'map', render: renderPlot },
  { id: 'review', label: '3D Review', icon: 'cube', render: renderReview },
];

// Hash routes use plain names only (#home, #p-<id>-<tab>) so links survive any host.
function parse() {
  const r = location.hash.slice(1) || 'home';
  const m = r.match(/^p-([a-z0-9]+)-([a-z]+)$/i);
  if (m) return { name: 'project', pid: m[1], tab: TABS.some((t) => t.id === m[2]) ? m[2] : 'overview' };
  return { name: 'home' };
}

// ---------- shell: floating sidebar (iPad / desktop), slim top bar + tab bar (phone) ----------
const SIDE_KEY = 'r3d-side';
const app = document.getElementById('app');
const shell = h('div', { class: 'shell' });
const side = h('aside', { class: 'side', 'aria-label': 'Navigation' });
const mtop = h('header', { class: 'mtop' });
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' });
const main = h('main', { class: 'main', id: 'main' });
shell.append(side, mtop, main, tabbar);
app.append(shell);

let sideMini = false;
try { sideMini = localStorage.getItem(SIDE_KEY) === 'mini'; } catch { /* storage blocked */ }
let forceOpen = false; // sidebar opened by hand on a full-screen page (plot / 3D)

const palette = () => openPalette({ onNewProject: newProject, onSettings: settings, onRefresh: () => route_() });
const settings = () => openSettings({ onLang: () => route_() });
const isMac = /Mac|iPad|iPhone/.test(navigator.platform || navigator.userAgent);

function applySide(route) {
  const full = route.name === 'project' && (route.tab === 'plot' || route.tab === 'review');
  shell.classList.toggle('side-mini', full ? !forceOpen : sideMini);
}

function storage() {
  return h('div', { class: 'store', title: db.persistent ? 'Data is stored on this device' : 'Storage unavailable — data lives only in this tab' },
    h('i', { class: 'sys-dot', style: db.persistent ? null : { background: 'var(--yellow)' } }), h('span', { class: 'side-txt' }, db.persistent ? 'Saved on this device' : 'Memory only'));
}

async function projectSwitch(btn) {
  const projects = (await db.all('projects')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const { close } = popover(btn, h('div', { class: 'pop-list' },
    h('div', { class: 'pop-h' }, 'Switch project'),
    projects.map((p) => h('button', { type: 'button', class: `pop-row ${p.id === state.project?.id ? 'on' : ''}`, onclick: () => { close(); go(projectRoute(p.id, state.route?.tab || 'overview')); } },
      h('span', { class: 'code no-i18n' }, p.code || '—'), h('span', { class: 'no-i18n' }, p.name))),
    h('button', { type: 'button', class: 'pop-row add', onclick: () => { close(); newProject(); } }, icon('plus'), h('span', {}, 'New project'))), { width: 300 });
}

function renderSide(route) {
  const p = route.name === 'project' ? state.project : null;
  const link = (href, ic, label, on) => h('a', { href, class: on ? 'on' : '', title: label, 'aria-current': on ? 'page' : null }, icon(ic), h('span', { class: 'side-txt' }, label));
  const nav = h('nav', { class: 'side-nav', 'aria-label': 'Sections' },
    link('#home', 'home', 'Projects', route.name === 'home'),
    p ? [h('div', { class: 'side-sep' }), ...TABS.map((t) => link(`#${projectRoute(p.id, t.id)}`, t.icon, t.label, route.tab === t.id))] : null);
  side.replaceChildren(...[
    h('div', { class: 'side-top' },
      h('a', { class: 'brand', href: '#home', 'aria-label': 'Review 3D home' }, logoMark(),
        h('span', { class: 'side-txt brand-txt' }, h('span', { class: 'logo-text glitch no-i18n', 'data-t': 'REVIEW//3D' }, h('b', {}, 'Review'), h('i', {}, '//'), h('span', { class: 'logo-3d' }, '3D')), h('small', { class: 'logo-sub' }, 'by Yan Malegi Diardi'))),
      h('button', { type: 'button', class: 'side-btn collapse', 'aria-label': 'Collapse sidebar', title: 'Collapse sidebar', onclick: toggleSide }, icon('panel'))),
    h('button', { type: 'button', class: 'side-search', onclick: palette, title: `Search (${isMac ? '⌘' : 'Ctrl'} K)` }, icon('search'), h('span', { class: 'side-txt' }, 'Search'), h('kbd', { class: 'side-txt no-i18n' }, isMac ? '⌘K' : 'Ctrl K')),
    p ? h('button', { type: 'button', class: 'proj-switch', onclick: (e) => projectSwitch(e.currentTarget), title: p.name },
      h('span', { class: 'proj-av no-i18n', 'aria-hidden': 'true' }, (p.code || p.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()),
      h('span', { class: 'side-txt proj-txt' }, h('small', { class: 'code no-i18n' }, p.code || '—'), h('b', { class: 'no-i18n' }, p.name)),
      h('span', { class: 'side-txt' }, icon('updown'))) : null,
    nav,
    h('div', { class: 'side-foot' }, storage(),
      h('button', { type: 'button', class: 'side-btn', 'aria-label': 'Settings', title: 'Settings', 'aria-haspopup': 'dialog', onclick: settings }, icon('gear')))].filter(Boolean));
  // phone
  mtop.replaceChildren(
    h('a', { class: 'brand', href: '#home', 'aria-label': 'Review 3D home' }, logoMark(), h('span', { class: 'logo-text no-i18n' }, h('b', {}, 'Review'), h('span', { class: 'logo-3d' }, '3D'))),
    p ? h('button', { type: 'button', class: 'mtop-proj no-i18n', onclick: (e) => projectSwitch(e.currentTarget) }, h('span', {}, p.name), icon('chev')) : h('span', { class: 'mtop-sp' }),
    h('button', { type: 'button', class: 'side-btn', 'aria-label': 'Search', onclick: palette }, icon('search')),
    h('button', { type: 'button', class: 'side-btn', 'aria-label': 'Settings', onclick: settings }, icon('gear')));
  const tab = (href, ic, label, on) => h('a', { href, class: on ? 'on' : '', 'aria-current': on ? 'page' : null }, icon(ic), h('span', {}, label));
  tabbar.replaceChildren(...(p
    ? TABS.map((t) => tab(`#${projectRoute(p.id, t.id)}`, t.icon, t.label, route.tab === t.id))
    : [tab('#home', 'home', 'Projects', true)]));
  tabbar.hidden = !p;
}

function toggleSide() {
  const route = state.route || parse();
  const full = route.name === 'project' && (route.tab === 'plot' || route.tab === 'review');
  if (full) forceOpen = shell.classList.contains('side-mini');
  else { sideMini = !shell.classList.contains('side-mini'); try { localStorage.setItem(SIDE_KEY, sideMini ? 'mini' : 'open'); } catch { /* storage blocked */ } }
  applySide(route);
  window.dispatchEvent(new Event('resize')); // the 3D view and charts follow the new width
}

async function route_() {
  const route = parse();
  try { await state.cleanup?.(); } catch (e) { console.warn('cleanup failed', e); }
  state.cleanup = null;
  if (route.name === 'project') {
    if (state.project?.id !== route.pid) state.project = await db.get('projects', route.pid);
    if (!state.project) { toast('Project not found on this device.', 'warn'); location.hash = 'home'; return; }
  } else state.project = null;
  if (state.route?.tab !== route.tab || state.route?.pid !== route.pid) forceOpen = false;
  state.route = route;
  applySide(route);
  renderSide(route);
  main.innerHTML = '';
  main.scrollTop = 0;
  const full = route.name === 'project' && (route.tab === 'plot' || route.tab === 'review');
  main.style.overflow = full ? 'hidden' : 'auto';
  main.classList.toggle('full', full);
  try {
    if (route.name === 'home') state.cleanup = await renderHome(main);
    else state.cleanup = await TABS.find((t) => t.id === route.tab).render(main, state.project);
  } catch (e) {
    console.error(e);
    main.append(h('div', { class: 'page' }, h('div', { class: 'panel' }, h('h2', {}, 'Something broke'), h('p', { class: 'dim2' }, String(e.message || e)))));
  }
}

function boot() {
  const lines = ['REVIEW//3D v' + VERSION + ' · © ' + YEAR + ' YAN MALEGI DIARDI', '> mounting local datastore ........ OK', '> calibrating neon grid ........... OK', '> loading geometry kernel ......... OK', '> SYSTEM ONLINE'];
  const pre = h('pre', {});
  const el = h('div', { class: 'boot no-i18n' }, pre);
  document.body.append(el);
  let i = 0;
  const step = () => {
    if (i < lines.length) { pre.textContent += (i ? '\n' : '') + lines[i++]; setTimeout(step, 110); }
    else setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 220);
  };
  step();
}

// conversions on GitHub show up in the island while they run
const JOB_BUSY = new Set(['uploading', 'queued', 'running', 'downloading']);
window.addEventListener('nexus:jobs', (e) => {
  const job = e.detail;
  if (!job?.id) return;
  const id = `job-${job.id}`;
  if (JOB_BUSY.has(job.status)) setActivity(id, { title: job.step || 'Converting model', detail: job.file, progress: job.progress ?? null });
  else if (job.status === 'done') endActivity(id, { title: 'Model ready', detail: job.file });
  else if (job.status === 'failed') endActivity(id, { tone: 'err', title: 'Conversion failed', detail: job.file, after: 6000 });
  else clearActivity(id);
});

window.nexus = state; // handy for debugging from the browser console
applyTheme();
startI18n();
startGlide();
startSounds();
window.addEventListener('r3d:theme', () => { const r = state.route; if (r) renderSide(r); });
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
  else if (e.key === '/' && !typing && !document.querySelector('.modal-back, .pal-back')) { e.preventDefault(); palette(); }
  else if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSide(); }
});

(async function start() {
  let seen = false;
  try { seen = sessionStorage.getItem('nx-boot') === '1'; sessionStorage.setItem('nx-boot', '1'); } catch { /* sandboxed */ }
  if (!seen && getTheme() === 'cyber' && !matchMedia('(prefers-reduced-motion: reduce)').matches) boot();
  requestPersistence();
  try {
    const projects = await db.all('projects');
    if (!projects.length) await seedSample();
  } catch (e) { console.warn('seed failed', e); }
  window.addEventListener('hashchange', route_);
  await route_();
  ensurePoller(); // resume conversions that were running on GitHub while the app was closed
  if (getTheme() === 'cyber') setTimeout(() => document.querySelector('.logo-text')?.classList.add('run'), 900);
  if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
