// Shared app state + navigation (kept separate from main.js to avoid import cycles).
export const VERSION = '0.2.0';
export const YEAR = Math.max(2026, new Date().getFullYear());
export const COPYRIGHT = `© ${YEAR} Yan Malegi Diardi. All rights reserved.`;
export const state = { project: null, route: null, cleanup: null, viewer: null, viewerProject: null, playPlan: null };
export const projectRoute = (pid, tab = 'overview') => `p-${pid}-${tab}`;
export function go(route) {
  if (location.hash.slice(1) !== route) location.hash = route;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}
