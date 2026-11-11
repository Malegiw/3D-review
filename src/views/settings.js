// Settings dialog: look & language, installing the app, supported files, backup restore, about.
// Things the person needs once (install on iPad, file formats) live here instead of on the first page.
import { h, icon, modal, toast, pickFiles } from '../core/ui.js';
import { THEMES, getTheme, setTheme } from '../core/theme.js';
import { LANGS, currentLang, setLang } from '../core/i18n.js';
import { importProject } from '../core/store.js';
import { VERSION, COPYRIGHT, go, projectRoute } from '../core/app.js';

// a tiny picture of each theme: page, a card on it, the accent and the 3D pick colour
const SWATCH = {
  cloud: 'radial-gradient(circle at 78% 34%, #ef6a1f 0 7%, transparent 7.5%), linear-gradient(90deg, transparent 18%, #0f766e 18% 44%, transparent 44%) 0 72% / 100% 12% no-repeat, linear-gradient(#ffffff, #ffffff) 12% 50% / 64% 70% no-repeat, #e9eded',
  night: 'radial-gradient(circle at 78% 34%, #ff7d3a 0 7%, transparent 7.5%), linear-gradient(90deg, transparent 18%, #5cd0bf 18% 44%, transparent 44%) 0 72% / 100% 12% no-repeat, linear-gradient(#1d2426, #1d2426) 12% 50% / 64% 70% no-repeat, #0d1112',
  cyber: 'linear-gradient(135deg, #07060c 50%, #00f0ff 50% 80%, #ff2fd0 80%)',
};

const platform = () => {
  const ua = navigator.userAgent || '';
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS reports itself as a Mac
  if (/iPhone|iPad|iPod/.test(ua) || touchMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
};

const INSTALL = {
  ios: { title: 'iPad / iPhone', steps: ['Open this page in Safari.', 'Tap Share, then Add to Home Screen.', 'Open Review 3D from the Home Screen like any other app.'] },
  android: { title: 'Android', steps: ['Open this page in Chrome.', 'Open the Chrome menu and tap Install app.', 'Open Review 3D from the Home Screen like any other app.'] },
  desktop: { title: 'Laptop / PC', steps: ['Open this page in Chrome or Edge.', 'Click the install icon in the address bar.', 'Open Review 3D from the Start menu or Dock.'] },
};

function section(title, ...kids) {
  return h('section', { class: 'set-sec' }, h('h3', {}, title), ...kids);
}

/** @param {{ onLang?: () => void }} o  onLang re-renders the page behind the dialog after a language switch */
export function openSettings({ onLang } = {}) {
  const here = platform();
  const themeRow = h('div', { class: 'set-themes', role: 'group', 'aria-label': 'Theme' });
  const paintThemes = () => {
    themeRow.replaceChildren(...THEMES.map((th) => h('button', {
      type: 'button', class: `set-theme ${th.id === getTheme() ? 'on' : ''}`, 'aria-pressed': String(th.id === getTheme()),
      onclick: (e) => switchTheme(th.id, e),
    }, h('span', { class: 'sw', style: { background: SWATCH[th.id] } }), h('b', {}, th.label), h('small', {}, th.hint))));
  };
  // the new theme opens as a circle from the tapped swatch (View Transitions); instant when motion is reduced
  const switchTheme = (id, e) => {
    if (id === getTheme()) return;
    const run = () => { setTheme(id); paintThemes(); };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce || !e) return run();
    const x = e.clientX || innerWidth / 2, y = e.clientY || innerHeight / 2;
    const root = document.documentElement.style;
    root.setProperty('--vt-x', `${x}px`); root.setProperty('--vt-y', `${y}px`);
    root.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    document.startViewTransition(run);
  };
  paintThemes();

  const langRow = h('div', { class: 'seg', role: 'group', 'aria-label': 'Interface language' });
  const paintLang = () => {
    langRow.replaceChildren(...LANGS.map((l) => h('button', {
      type: 'button', class: `no-i18n ${l.id === currentLang() ? 'on' : ''}`, 'aria-pressed': String(l.id === currentLang()),
      onclick: () => { setLang(l.id); paintLang(); onLang?.(); },
    }, l.name)));
  };
  paintLang();

  const steps = (key) => h('ol', { class: 'set-steps' }, INSTALL[key].steps.map((s) => h('li', {}, s)));
  const others = Object.keys(INSTALL).filter((k) => k !== here);

  let m;
  const body = h('div', { class: 'settings' },
    section('Appearance',
      themeRow,
      h('div', { class: 'set-line' }, h('span', {}, 'Language'), langRow)),
    section('Install on your device',
      h('div', { class: 'set-card' }, h('b', {}, INSTALL[here].title), steps(here)),
      h('details', { class: 'set-more' }, h('summary', {}, 'Other devices'),
        others.map((k) => h('div', { class: 'set-card' }, h('b', {}, INSTALL[k].title), steps(k)))),
      h('p', { class: 'set-note' }, 'Your data stays on each device. Use Backup in a project to move it to another device.')),
    section('Supported files',
      h('dl', { class: 'kv' },
        h('dt', {}, 'Plot plan'), h('dd', {}, 'PDF (vector or scanned)'),
        h('dt', {}, 'Direct 3D'), h('dd', {}, 'GLB · glTF · FBX · OBJ · DAE · STL · PLY'),
        h('dt', {}, 'Via converter'), h('dd', {}, 'NWD · NWC · DWFx · DWF · SKP · RVT · IFC'),
        h('dt', {}, 'Exports'), h('dd', {}, 'XLSX · GLB-ready · MP4/WebM motion'))),
    section('Data',
      h('div', { class: 'set-line' },
        h('span', {}, 'Restore a project from a backup file (.zip).'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
          const [f] = await pickFiles({ accept: '.zip' });
          if (!f) return;
          try { const pid = await importProject(f); m.close(); toast('Backup restored.', 'ok'); go(projectRoute(pid)); } catch (e) { toast(e.message, 'err'); }
        } }, icon('upload'), 'Restore backup'))),
    h('p', { class: 'set-about' }, h('span', { class: 'no-i18n' }, `Review 3D v${VERSION}`), h('span', {}, COPYRIGHT)));

  m = modal({ title: 'Settings', body, actions: [{ label: 'Done', kind: 'primary', submit: true }] });
  m.el.classList.add('settings-modal');
  return m;
}
