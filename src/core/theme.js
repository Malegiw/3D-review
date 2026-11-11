// Visual themes. "cloud" (Light) and "night" (Dark) follow the 2026/27 direction: calm neutral surfaces, a teal accent
// for what is active or selected, and safety orange only for what is picked or measured in 3D.
// "cyber" keeps the original neon control-room look.
const KEY = 'r3d-theme';

export const THEMES = [
  { id: 'cloud', label: 'Light', hint: 'Calm, for daylight' },
  { id: 'night', label: 'Dark', hint: 'Graphite, for the evening' },
  { id: 'cyber', label: 'Cyberpunk', hint: 'Neon classic' },
];

/** Colours the 3D engine cannot read from CSS. */
export const VIEW3D = {
  cloud: {
    bg: ['#f8fafa', '#d8dfdf'], gridMinor: 0xc3cdcd, gridMajor: 0x83a09d, gridOpacity: [0.55, 0.7],
    sel: 0xef6a1f, selEmissive: 0x7a2a00, xray: 0x0f766e, hemi: [0xffffff, 0x7d8a86, 1.15], sun: 1.6, env: 0.6,
    edge: 0x0b4440, edgeOpacity: 0.32, beam: 0xef6a1f, beamBlend: 'normal', measure: 0xe0601a, box: 0x0f766e,
    ground: [10, 79, 77, 0, 215],
  },
  night: {
    bg: ['#1b2325', '#090c0d'], gridMinor: 0x1e2a2c, gridMajor: 0x3b726b, gridOpacity: [0.5, 0.6],
    sel: 0xff7d3a, selEmissive: 0xb54300, xray: 0x5cd0bf, hemi: [0xe2f2ef, 0x1a2222, 1.05], sun: 1.5, env: 0.55,
    edge: 0xa6e6dc, edgeOpacity: 0.38, beam: 0xff7d3a, beamBlend: 'add', measure: 0xffb347, box: 0x5cd0bf,
    ground: [126, 226, 212, 6, 200],
  },
  cyber: {
    bg: ['#05040a', '#05040a'], gridMinor: 0x0e3a4c, gridMajor: 0x00b8c8, gridOpacity: [0.35, 0.45],
    sel: 0x00f0ff, selEmissive: 0x00a8c0, xray: 0x00f0ff, hemi: [0xbfe9ff, 0x2a1038, 1.1], sun: 1.5, env: 0.55,
    edge: 0xbff9ff, edgeOpacity: 0.55, beam: 0xff2fd0, beamBlend: 'add', measure: 0xf7ef00, box: 0xff2fd0,
  },
};

/** Plot plan category colours per theme (cyber keeps the neon defaults from domain.js). */
const CAT_COLORS = {
  cloud: { equipment: '#e0662a', vessel: '#7d6bd6', tank: '#3f97b0', building: '#e2b13c', piperack: '#c4862e', structure: '#b8573c', foundation: '#a3adab', paving: '#7f8c8a', bund: '#5c9db0', pit: '#6a5fc4', pipe: '#2c9a66', fence: '#7b8786', existing: '#8f9896' },
  night: { equipment: '#ff8a4c', vessel: '#a497ff', tank: '#5cc6dc', building: '#f2c75c', piperack: '#e0a44a', structure: '#e07a5a', foundation: '#93a19e', paving: '#56625f', bund: '#79c2d6', pit: '#8b80f0', pipe: '#4fd08f', fence: '#8a9896', existing: '#5f6b69' },
};
export const catColor = (cat, fallback, id = getTheme()) => CAT_COLORS[id]?.[cat] || fallback;

const META = { cloud: '#f3f5f5', night: '#0d1112', cyber: '#07060c' };

export function getTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return THEMES.some((x) => x.id === t) ? t : 'cloud';
}
export const view3d = (id = getTheme()) => VIEW3D[id] || VIEW3D.cloud;

export function applyTheme(id = getTheme()) {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = id === 'cloud' ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[id]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', id === 'cloud' ? 'light' : 'dark');
}

export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  applyTheme(id);
  window.dispatchEvent(new CustomEvent('r3d:theme', { detail: id }));
}
