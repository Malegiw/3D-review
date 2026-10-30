// Shared app state + navigation (kept separate from main.js to avoid import cycles).
export const VERSION = '0.1.0';
export const state = { project: null, route: null, cleanup: null, viewer: null, viewerProject: null, playPlan: null };
export const projectRoute = (pid, tab = 'overview') => `p-${pid}-${tab}`;
export function go(route) {
  if (location.hash.slice(1) !== route) location.hash = route;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}
