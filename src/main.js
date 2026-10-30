import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles/fonts.css';
import './styles/theme.css';

import { h, icon, logoMark, toast } from './core/ui.js';
import { THEMES, getTheme, setTheme, applyTheme } from './core/theme.js';
import { LANGS, currentLang, setLang, startI18n } from './core/i18n.js';
import { db, requestPersistence } from './core/db.js';
import { seedSample } from './core/store.js';
import { ensurePoller } from './core/jobs.js';
import { renderHome } from './views/home.js';
import { renderOverview, renderDocs } from './views/project.js';
import { renderPlot } from './views/plotplan.js';
import { renderReview } from './views/review.js';

import { VERSION, YEAR, state, projectRoute } from './core/app.js';

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

const app = document.getElementById('app');
const shell = h('div', { class: 'shell' });
const top = h('header', { class: 'topbar' });
const rail = h('nav', { class: 'rail', 'aria-label': 'Sections' });
const main = h('main', { class: 'main', id: 'main' });
shell.append(top, rail, main);
app.append(shell);

const SWATCH = { cloud: 'linear-gradient(135deg, #eef1f0 50%, #0a6c6a 50% 80%, #f2621a 80%)', night: 'linear-gradient(135deg, #0c1716 50%, #35c2b1 50% 80%, #ff7a33 80%)', cyber: 'linear-gradient(135deg, #07060c 50%, #00f0ff 50% 80%, #ff2fd0 80%)' };

function openDisplayMenu(anchor) {
  document.querySelector('.menu')?.remove();
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey); anchor.setAttribute('aria-expanded', 'false'); };
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  const cur = getTheme();
  const menu = h('div', { class: 'menu', role: 'dialog', 'aria-label': 'Theme and language' },
    h('h3', {}, 'Theme'),
    THEMES.map((th) => h('button', { type: 'button', class: `opt ${th.id === cur ? 'on' : ''}`, 'aria-pressed': String(th.id === cur), onclick: () => { setTheme(th.id); close(); } },
      h('span', { class: 'sw', style: { background: SWATCH[th.id] } }), h('span', {}, h('b', {}, th.label), h('small', {}, th.hint)), th.id === cur ? icon('check') : h('span'))),
    h('h3', {}, 'Language'),
    LANGS.map((l) => h('button', { type: 'button', class: `opt ${l.id === currentLang() ? 'on' : ''}`, 'aria-pressed': String(l.id === currentLang()), onclick: () => { close(); changeLang(l.id); } },
      h('span', { class: 'sw', style: { display: 'grid', placeItems: 'center', font: '700 11px/1 var(--f-ui)', background: 'var(--bg-3)' } }, l.label), h('span', {}, h('b', { class: 'no-i18n' }, l.name)), l.id === currentLang() ? icon('check') : h('span'))),
    h('div', { class: 'copy' }, `Review 3D v${VERSION} · © ${YEAR} Yan Malegi Diardi`));
  document.body.append(menu);
  anchor.setAttribute('aria-expanded', 'true');
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey); menu.querySelector('.opt.on')?.focus(); }, 0);
}

function changeLang(l) {
  setLang(l);
  route_(); // re-render so dates and generated text follow the language
}

function renderTop(route) {
  top.innerHTML = '';
  const logo = h('a', { class: 'logo', href: '#home', 'aria-label': 'Review 3D home' }, logoMark(),
    h('div', {}, h('div', { class: 'logo-text glitch no-i18n', 'data-t': 'REVIEW//3D' }, h('b', {}, 'Review'), h('i', {}, '//'), h('span', { class: 'logo-3d' }, '3D')),
      h('div', { class: 'logo-sub' }, 'by Yan Malegi Diardi')));
  const crumb = h('div', { class: 'crumb' });
  if (route.name === 'project' && state.project) {
    crumb.append(h('span', { class: 'crumb-hide sep' }, '/'), h('span', { class: 'crumb-hide no-i18n' }, state.project.code || 'PRJ'), h('span', { class: 'crumb-hide sep' }, '/'), h('b', { class: 'no-i18n' }, state.project.name));
  } else crumb.append(h('span', { class: 'crumb-hide sep' }, '/'), h('b', {}, 'Projects'));
  const lang = h('div', { class: 'lang', role: 'group', 'aria-label': 'Interface language' },
    LANGS.map((l) => h('button', { type: 'button', class: `no-i18n ${l.id === currentLang() ? 'on' : ''}`, 'aria-pressed': String(l.id === currentLang()), title: l.name, onclick: () => changeLang(l.id) }, l.label)));
  const themeBtn = h('button', { type: 'button', class: 'theme-btn', 'aria-label': 'Change theme', title: 'Theme', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: (e) => openDisplayMenu(e.currentTarget) }, icon('palette'));
  top.append(logo, crumb, h('div', { class: 'top-actions' },
    h('span', { class: 'crumb crumb-hide', title: db.persistent ? 'Data is stored on this device' : 'Storage unavailable — data lives only in this tab' }, h('i', { class: 'sys-dot', style: db.persistent ? null : { background: 'var(--yellow)' } }), db.persistent ? 'Saved on this device' : 'Memory only'),
    lang, themeBtn));
}

function renderRail(route) {
  rail.innerHTML = '';
  rail.append(h('a', { href: '#home', class: `rail-home ${route.name === 'home' ? 'on' : ''}` }, icon('home'), 'Projects'));
  if (route.name === 'project') {
    rail.append(h('div', { class: 'rail-sep' }));
    for (const t of TABS) rail.append(h('a', { href: `#${projectRoute(route.pid, t.id)}`, class: route.tab === t.id ? 'on' : '' }, icon(t.icon), t.label));
  }
}

async function route_() {
  const route = parse();
  state.cleanup?.();
  state.cleanup = null;
  if (route.name === 'project') {
    if (state.project?.id !== route.pid) state.project = await db.get('projects', route.pid);
    if (!state.project) { toast('Project not found on this device.', 'warn'); location.hash = 'home'; return; }
  } else state.project = null;
  state.route = route;
  renderTop(route);
  renderRail(route);
  main.innerHTML = '';
  main.scrollTop = 0;
  const full = route.name === 'project' && (route.tab === 'plot' || route.tab === 'review');
  main.style.overflow = full ? 'hidden' : 'auto';
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

window.nexus = state; // handy for debugging from the browser console
applyTheme();
startI18n();
window.addEventListener('r3d:theme', () => { const r = state.route; if (r) renderTop(r); });

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
