// Dynamic Island (after beUI's block): one pill at the top centre that shows what is running right now (a model
// loading, an upload, a GitHub conversion) and morphs between a compact pill and a card listing every activity.
// The island measures its content and animates its own width and height, so it reads as one shape changing.
import { h, icon } from './ui.js';

const acts = new Map(); // id → { title, detail, progress: 0..1 | null, tone: 'busy' | 'ok' | 'err', at }
let el = null, body = null, open = false;
const timers = new Map();

function ensure() {
  if (el) return;
  body = h('div', { class: 'isl-body' });
  el = h('button', { type: 'button', class: 'island', 'aria-live': 'polite', 'aria-label': 'Activity', onclick: () => { open = !open; render(); } }, body);
  document.body.append(el);
}

/** Show or update an activity. */
export function setActivity(id, a) {
  clearTimeout(timers.get(id));
  acts.set(id, { tone: 'busy', progress: null, ...acts.get(id), ...a, at: acts.get(id)?.at || Date.now() });
  render();
}
/** Finish an activity: it shows its result for a moment, then leaves. */
export function endActivity(id, { tone = 'ok', title, detail = '', after = 2800 } = {}) {
  const cur = acts.get(id);
  if (!cur && !title) return;
  acts.set(id, { ...cur, title: title ?? cur.title, detail, tone, progress: null, at: Date.now() });
  render();
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => clearActivity(id), after));
}
export function clearActivity(id) {
  clearTimeout(timers.get(id));
  if (!acts.delete(id)) return;
  render();
}

function mark(a) {
  if (a.tone === 'ok') return h('span', { class: 'isl-mark ok' }, icon('check'));
  if (a.tone === 'err') return h('span', { class: 'isl-mark err' }, icon('x'));
  if (a.progress != null) {
    const c = 2 * Math.PI * 7;
    const svg = h('svg', { svg: true, class: 'isl-ring', viewBox: '0 0 18 18', 'aria-hidden': 'true' },
      h('circle', { svg: true, cx: 9, cy: 9, r: 7, class: 'trk' }),
      h('circle', { svg: true, cx: 9, cy: 9, r: 7, class: 'val', 'stroke-dasharray': `${c}`, 'stroke-dashoffset': `${c * (1 - Math.max(0, Math.min(1, a.progress)))}` }));
    return h('span', { class: 'isl-mark' }, svg);
  }
  return h('span', { class: 'isl-mark busy', 'aria-hidden': 'true' });
}

function render() {
  ensure();
  const list = [...acts.values()].sort((a, b) => b.at - a.at);
  if (!list.length) open = false;
  el.classList.toggle('on', list.length > 0);
  el.classList.toggle('open', open);
  el.setAttribute('aria-expanded', String(open));
  if (!list.length) return;
  const top = list[0];
  const row = (a, full) => h('div', { class: `isl-row ${a.tone}` }, mark(a),
    h('span', { class: 'isl-txt' }, h('b', {}, a.title), a.detail && (full || !open) ? h('small', {}, a.detail) : null),
    full && a.progress != null ? h('span', { class: 'isl-pct' }, `${Math.round(a.progress * 100)}%`) : null);
  body.replaceChildren(...(open
    ? list.map((a) => row(a, true))
    : [row(top, false), list.length > 1 ? h('span', { class: 'isl-more' }, `+${list.length - 1}`) : null].filter(Boolean)));
  // morph: animate to the size of the new content
  requestAnimationFrame(() => {
    const w = Math.ceil(body.scrollWidth), hgt = Math.ceil(body.scrollHeight);
    el.style.setProperty('--w', `${w}px`);
    el.style.setProperty('--h', `${hgt}px`);
  });
}
