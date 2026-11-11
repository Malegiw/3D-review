// Command palette (after beUI's ⌘K block): one search box for projects, pages, deliverables, objects in the open 3D
// model and quick actions. Arrow keys move a highlight that glides between rows; Enter runs the row.
import { h, icon } from '../core/ui.js';
import { db } from '../core/db.js';
import { state, go, projectRoute } from '../core/app.js';
import { THEMES, getTheme, setTheme } from '../core/theme.js';
import { LANGS, currentLang, setLang } from '../core/i18n.js';
import { statusOf } from '../core/domain.js';
import { play } from '../core/sound.js';

let openNow = null;

const SECTIONS = [['overview', 'Overview', 'grid'], ['docs', 'Docs', 'docs'], ['plot', 'Plot→3D', 'map'], ['review', '3D Review', 'cube']];

const norm = (s) => String(s || '').toLowerCase();
function score(hay, q) {
  if (!q) return 1;
  const t = norm(hay);
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.every((w) => t.includes(w))) return 0;
  return t.startsWith(words[0]) ? 3 : t.includes(` ${words[0]}`) ? 2 : 1;
}

/** @param {{ onNewProject?: () => void, onSettings?: () => void, onRefresh?: () => void }} hooks */
export async function openPalette(hooks = {}) {
  if (openNow) return openNow.focus();
  const [projects, docs] = await Promise.all([db.all('projects'), state.project ? db.byProject('deliverables', state.project.id) : []]);
  const viewer = state.route?.tab === 'review' ? state.viewer : null;

  const input = h('input', { class: 'pal-inp', type: 'search', placeholder: 'Search projects, documents, objects or actions…', 'aria-label': 'Search', autocomplete: 'off', spellcheck: false });
  const list = h('div', { class: 'pal-list', role: 'listbox' });
  const hi = h('span', { class: 'pal-hi', 'aria-hidden': 'true' });
  const back = h('div', { class: 'pal-back' });
  const box = h('div', { class: 'pal', role: 'dialog', 'aria-label': 'Command palette' },
    h('label', { class: 'pal-top' }, icon('search'), input, h('kbd', {}, 'esc')),
    h('div', { class: 'pal-scroll' }, hi, list),
    h('div', { class: 'pal-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' to move'), h('span', {}, h('kbd', {}, '↵'), ' to open')));
  back.append(box);
  document.body.append(back);
  play('open');

  let rows = [], active = 0;
  const close = () => { back.classList.add('out'); document.removeEventListener('keydown', onKey, true); setTimeout(() => back.remove(), 160); openNow = null; };
  const run = (r) => { close(); r.run(); };

  function build(qRaw) {
    const q = norm(qRaw).trim();
    const groups = [];
    const add = (title, items, max = 6) => {
      const scored = items.map((it) => ({ ...it, s: score(`${it.label} ${it.hint || ''} ${it.keys || ''}`, q) })).filter((it) => it.s > 0).sort((a, b) => b.s - a.s).slice(0, q ? max : Math.min(max, 4));
      if (scored.length) groups.push([title, scored]);
    };
    if (state.project) {
      add('This project', SECTIONS.map(([id, label, ic]) => ({ label, hint: state.project.name, icon: ic, run: () => go(projectRoute(state.project.id, id)) })));
    }
    if (viewer && q.length >= 2) {
      const found = viewer.findObjects(q, 6);
      const items = found.items.map((x) => ({ label: x.name, hint: x.layer, icon: 'box', mono: true, run: () => { viewer.selectObject(x.mesh, x.k); viewer.fit(viewer.selectionTargets()); } }));
      if (items.length < 6) {
        for (const m of viewer.meshes()) {
          const nm = m.userData?.name || m.name;
          if (nm && norm(nm).includes(q) && !m.userData.objs) items.push({ label: nm, hint: m.userData.layer || '', icon: 'box', mono: true, run: () => { viewer.selectMeshes([m]); viewer.fit([m]); } });
          if (items.length >= 6) break;
        }
      }
      if (items.length) groups.push(['Objects in the 3D model', items.map((it) => ({ ...it, s: 1 }))]);
    }
    if (docs.length) {
      add('Deliverables', docs.map((d) => ({ label: d.title, hint: d.docNo, keys: d.pic, icon: 'docs', dot: statusOf(d.status).c, run: () => { state.docQuery = d.docNo; go(projectRoute(state.project.id, 'docs')); } })), 6);
    }
    add('Projects', projects.map((p) => ({ label: p.name, hint: p.code, keys: p.facility, icon: 'folder', run: () => go(projectRoute(p.id)) })), 5);
    add('Actions', [
      { label: 'New project', icon: 'plus', run: () => hooks.onNewProject?.() },
      { label: 'All projects', icon: 'home', run: () => go('home') },
      { label: 'Settings', icon: 'gear', run: () => hooks.onSettings?.() },
      ...THEMES.filter((t) => t.id !== getTheme()).map((t) => ({ label: `${t.label} theme`, keys: 'theme dark light tema gelap terang', icon: 'palette', run: () => setTheme(t.id) })),
      ...LANGS.filter((l) => l.id !== currentLang()).map((l) => ({ label: `Language: ${l.name}`, keys: 'language bahasa', icon: 'check', run: () => { setLang(l.id); hooks.onRefresh?.(); } })),
    ], 6);
    rows = [];
    list.replaceChildren(...(groups.length ? groups.map(([title, items]) => h('div', { class: 'pal-group', role: 'group', 'aria-label': title }, h('div', { class: 'pal-gh' }, title), items.map((it) => {
      const i = rows.length;
      const el = h('button', { type: 'button', class: 'pal-row', role: 'option', onclick: () => run(it), onpointermove: () => { if (active !== i) { active = i; paint(); } } },
        it.dot ? h('i', { class: 'pal-dot', style: { background: it.dot } }) : icon(it.icon),
        h('span', { class: `pal-label ${it.mono ? 'mono-code no-i18n' : ''}` }, it.label),
        it.hint ? h('span', { class: 'pal-hint no-i18n' }, it.hint) : null,
        icon('enter', 'pal-enter'));
      rows.push({ ...it, el });
      return el;
    }))) : [h('p', { class: 'pal-none' }, 'Nothing found.')]));
    active = 0;
    paint(true);
  }
  function paint(instant = false) {
    rows.forEach((r, i) => { r.el.classList.toggle('on', i === active); r.el.setAttribute('aria-selected', String(i === active)); });
    const r = rows[active];
    if (!r) { hi.style.opacity = '0'; return; }
    hi.classList.toggle('instant', instant);
    hi.style.opacity = '1';
    hi.style.transform = `translateY(${r.el.offsetTop}px)`;
    hi.style.height = `${r.el.offsetHeight}px`;
    r.el.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); run(rows[active]); }
  }
  input.addEventListener('input', () => build(input.value));
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  build('');
  setTimeout(() => input.focus(), 20);
  openNow = { focus: () => input.focus() };
}
