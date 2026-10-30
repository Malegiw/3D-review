// Visual themes. "cloud" (light) and "night" (dark) follow the 2026/27 direction: calm Cloud-Dancer white,
// WGSN Transformative Teal as the working accent and hi-vis safety orange as the single hot colour.
// "cyber" keeps the original neon control-room look.
const KEY = 'r3d-theme';

export const THEMES = [
  { id: 'cloud', label: 'Cloud', hint: 'Light · 2026' },
  { id: 'night', label: 'Night', hint: 'Dark · 2026' },
  { id: 'cyber', label: 'Cyberpunk', hint: 'Neon classic' },
];

/** Colours the 3D engine cannot read from CSS. */
export const VIEW3D = {
  cloud: {
    bg: ['#f4f7f6', '#c9d4d2'], gridMinor: 0xb9c7c4, gridMajor: 0x6f9e98, gridOpacity: [0.55, 0.7],
    sel: 0xf2621a, selEmissive: 0x8a2f00, xray: 0x0a6c6a, hemi: [0xffffff, 0x7d8a86, 1.15], sun: 1.6, env: 0.6,
    edge: 0x0a4f4d, edgeOpacity: 0.35, beam: 0xf2621a, beamBlend: 'normal', measure: 0xd9530f, box: 0x0a6c6a,
    ground: [10, 79, 77, 0, 215],
  },
  night: {
    bg: ['#15302d', '#060c0b'], gridMinor: 0x16302c, gridMajor: 0x2f7c72, gridOpacity: [0.5, 0.6],
    sel: 0xff7a33, selEmissive: 0xb54300, xray: 0x35c2b1, hemi: [0xd8f3ee, 0x1a2422, 1.05], sun: 1.5, env: 0.55,
    edge: 0xa6e6dc, edgeOpacity: 0.4, beam: 0xff7a33, beamBlend: 'add', measure: 0xffb347, box: 0x35c2b1,
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

const META = { cloud: '#eef1f0', night: '#0c1716', cyber: '#07060c' };

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
