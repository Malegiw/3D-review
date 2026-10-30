// Tiny DOM + UI helpers (no framework).
import { locale } from './i18n.js';

export function h(tag, attrs = {}, ...kids) {
  const el = tag === 'svg' || attrs?.svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string' && !(el instanceof SVGElement)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ICONS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  docs: 'M6 2h9l5 5v15H6zM15 2v5h5M9 12h8M9 16h8M9 8h3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12L3 7M12 12v10',
  layers: 'M12 3l10 5-10 5L2 8zM2 13l10 5 10-5M2 17.5l10 5 10-5',
  info: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 10v7M12 7v.01',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  section: 'M4 4h16v16H4zM4 12h16M12 4v4M12 16v4',
  xray: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 10a4 4 0 100 8 4 4 0 000-8z',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
  calc: 'M5 2h14v20H5zM8 6h8v3H8zM8 13h2M12 13h2M16 13v6M8 17h2M12 17h2',
  play: 'M7 4l13 8-13 8z',
  film: 'M3 4h18v16H3zM7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 100 10 5 5 0 000-10z',
  plus: 'M12 4v16M4 12h16',
  x: 'M5 5l14 14M19 5L5 19',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  search: 'M10 3a7 7 0 100 14 7 7 0 000-14zM21 21l-6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 10a2 2 0 100 4 2 2 0 000-4z',
  eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.8M6.6 6.6A17 17 0 002 12s4 6 10 6a9.6 9.6 0 004.4-1.1',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-1-3-2 .2-1.3-1.5.4-2-3-1-1 2h-2l-1-2-3 1 .4 2L5.2 8.3 3 8 2 11l2 1v0l-2 1 1 3 2.2-.3 1.3 1.5-.4 2 3 1 1-2h2l1 2 3-1-.4-2 1.3-1.5 2 .3 1-3z',
  pointer: 'M5 3l14 7-6 2-2 6z',
  square: 'M4 4h16v16H4z',
  circle: 'M12 3a9 9 0 100 18 9 9 0 000-18z',
  poly: 'M4 18l3-12 9-2 4 10-8 6z',
  line: 'M3 18l6-8 5 4 7-10',
  hand: 'M8 13V5a1.5 1.5 0 013 0v6M11 11V3.5a1.5 1.5 0 013 0V11M14 11V5a1.5 1.5 0 013 0v8c0 4-3 8-7 8s-6-2-8-6l-1-3a1.5 1.5 0 012.6-1.4L8 13',
  scale: 'M3 21L21 3M6 18l-2-2M9 15l-2-2M12 12l-2-2M15 9l-2-2M18 6l-2-2',
  check: 'M4 12l5 5L20 6',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  save: 'M5 3h11l3 3v15H5zM8 3v5h8V3M8 14h8v7H8z',
  folder: 'M3 6h6l2 2h10v12H3z',
  focus: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  rec: 'M12 7a5 5 0 100 10 5 5 0 000-10z',
  orbit: 'M12 9a3 3 0 100 6 3 3 0 000-6zM2 12c0-3 4.5-5.5 10-5.5S22 9 22 12s-4.5 5.5-10 5.5c-2 0-4-.3-5.5-1M6 18l.5-1.8L4.6 15.5',
  db: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0',
  palette: 'M12 3a9 9 0 100 18c1.2 0 1.6-.9 1.6-1.6 0-1-.8-1.3-.8-2.2 0-.9.8-1.6 1.7-1.6H16a5 5 0 005-5c0-4.3-4-7.6-9-7.6zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01',
  github: 'M9 19c-4 1.5-4-2-6-2.5M15 22v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 00-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22',
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.box);
  svg.append(p);
  return svg;
}

export function logoMark() {
  // Isometric cube: one face per working view (plan, elevation, 3D). Face colours come from the theme.
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><path class="f-top" d="M16 3.2l11.1 6.4L16 16 4.9 9.6z"/><path class="f-left" d="M4.9 9.6L16 16v12.8L4.9 22.4z"/><path class="f-right" d="M27.1 9.6L16 16v12.8l11.1-6.4z"/></svg>`;
  return wrap.firstChild;
}

export function toast(msg, type = 'info', title) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${type}` }, h('b', {}, title || { info: 'Info', ok: 'Done', err: 'Error', warn: 'Notice' }[type] || 'Info'), msg);
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, type === 'err' ? 6500 : 3800);
}

export function modal({ title, eyebrow, body, actions = [], wide = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(v); };
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  const acts = h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
    class: `btn ${a.kind || 'ghost'}`, type: a.submit ? 'submit' : 'button',
    onclick: async (e) => { if (a.submit) return; const r = await a.onClick?.(e); if (r !== false) close(a.value ?? r); },
  }, a.icon ? icon(a.icon) : null, a.label)));
  const box = h('form', { class: 'panel modal', style: wide ? { width: 'min(920px, 100%)' } : null, onsubmit: async (e) => {
    e.preventDefault();
    const a = actions.find((x) => x.submit);
    if (!a) return;
    const r = await a.onClick?.(e);
    if (r !== false) close(a.value ?? r);
  } },
  h('div', { class: 'panel-title' }, h('div', {}, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('h2', { style: { marginTop: eyebrow ? '8px' : 0 } }, title)),
    h('button', { class: 'btn sm icon ghost', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
  body, actions.length ? acts : null);
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => box.querySelector('input,select,textarea')?.focus(), 30);
  return { close, el: box };
}

export function confirmDialog(message, { title = 'Confirm', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    modal({
      title, eyebrow: danger ? 'Warning' : 'Confirm', body: h('p', { style: { margin: 0, color: 'var(--fg-2)' } }, message),
      actions: [{ label: 'Cancel', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }],
      onClose: (v) => resolve(!!v),
    });
  });
}

/** fields: [{id,label,type:'text'|'number'|'date'|'select'|'textarea',options:[v|{v,l}],value,required,step,span}] */
export function formDialog({ title, eyebrow, fields, submitLabel = 'Save', wide }) {
  return new Promise((resolve) => {
    const inputs = {};
    const grid = h('div', { class: 'form-grid' }, fields.map((f) => {
      let inp;
      if (f.type === 'select') {
        inp = h('select', { class: 'inp', id: `f-${f.id}` }, (f.options || []).map((o) => {
          const v = typeof o === 'object' ? o.v : o; const l = typeof o === 'object' ? o.l : o;
          return h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l);
        }));
      } else if (f.type === 'textarea') {
        inp = h('textarea', { class: 'inp', id: `f-${f.id}` }, f.value ?? '');
      } else {
        inp = h('input', { class: `inp ${f.type === 'number' || f.mono ? 'mono' : ''}`, id: `f-${f.id}`, type: f.type || 'text', value: f.value ?? '', step: f.step || (f.type === 'number' ? 'any' : null), required: !!f.required, placeholder: f.placeholder || '' });
      }
      inputs[f.id] = inp;
      return h('div', { class: 'field', style: f.span ? { gridColumn: '1 / -1' } : null }, h('label', { for: `f-${f.id}` }, f.label), inp);
    }));
    modal({
      title, eyebrow, body: grid, wide,
      actions: [{ label: 'Cancel', value: null }, {
        label: submitLabel, kind: 'primary', submit: true, onClick: () => {
          const out = {};
          for (const f of fields) {
            const v = inputs[f.id].value;
            out[f.id] = f.type === 'number' ? (v === '' ? null : Number(v)) : v.trim?.() ?? v;
          }
          return out;
        },
      }],
      onClose: (v) => resolve(v || null),
    });
  });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const fmt = {
  date(d) {
    if (!d) return '—';
    const x = new Date(d);
    if (isNaN(x)) return d;
    return x.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
  },
  num(n, dp = 2) {
    if (n == null || !isFinite(n)) return '—';
    if (Math.abs(n) < 0.5 * Math.pow(10, -dp)) n = 0; // no "-0.00"
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  },
  int(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); },
  pct(n) { return n == null || !isFinite(n) ? '—' : `${Math.round(n)}%`; },
  pad(n, w = 3) { return String(n).padStart(w, '0'); },
  today() { return new Date().toISOString().slice(0, 10); },
  bytes(b) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return `${b.toFixed(i ? 1 : 0)} ${u[i]}`; },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
