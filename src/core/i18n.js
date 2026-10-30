// ID / EN interface language.
// The UI is written in English; Indonesian is applied to the live DOM (text nodes + a few attributes)
// from one dictionary, so every view — including toasts and dialogs — follows the switch without
// threading t() through the code. User data (project names, tags, model trees) is left alone: it is
// either inside .no-i18n containers or simply never matches a dictionary entry.
import { EXACT, RULES } from './i18n-id.js';

const KEY = 'r3d-lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

export const LANGS = [{ id: 'id', label: 'ID', name: 'Bahasa Indonesia' }, { id: 'en', label: 'EN', name: 'English' }];

export function getLang() {
  let l = null;
  try { l = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return l === 'en' || l === 'id' ? l : 'id';
}
let lang = getLang();
export const currentLang = () => lang;
export const locale = () => (lang === 'id' ? 'id-ID' : 'en-GB');

/** Translate one English UI string into the current language (exact entry first, then pattern rules). */
export function t(s) {
  if (lang === 'en' || s == null) return s;
  const str = String(s);
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str);
  const core = m[2];
  if (!core || !/[A-Za-z]/.test(core)) return str;
  let out = EXACT.get(core);
  if (out == null) {
    for (const [re, rep] of RULES) {
      const mm = re.exec(core);
      if (mm) { out = typeof rep === 'function' ? rep(...mm.slice(1)) : core.replace(re, rep); break; }
    }
  }
  return out == null ? str : m[1] + out + m[3];
}

// ---------- live DOM translation ----------
const textOrig = new WeakMap(); // Text node → { en, shown }
const attrOrig = new WeakMap(); // Element → { attr: { en, shown } }

function skipped(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.classList?.contains('no-i18n') || e.namespaceURI === 'http://www.w3.org/2000/svg') return true;
  }
  return false;
}

function doText(node) {
  const rec = textOrig.get(node);
  const data = node.data;
  if (rec && data === rec.shown) return;          // our own write
  const en = data;                                // fresh English text from the app
  const shown = t(en);
  if (shown === en) { if (rec) textOrig.delete(node); return; }
  textOrig.set(node, { en, shown });
  node.data = shown;
}

function doAttrs(el) {
  let recs = attrOrig.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const v = el.getAttribute(a);
    const r = recs?.[a];
    if (r && v === r.shown) continue;
    const shown = t(v);
    if (shown === v) continue;
    if (!recs) attrOrig.set(el, (recs = {}));
    recs[a] = { en: v, shown };
    el.setAttribute(a, shown);
  }
}

function walk(root) {
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1 && skipped(root)) return;
  if (root.nodeType === 1) doAttrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.classList.contains('no-i18n') || n.namespaceURI === 'http://www.w3.org/2000/svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else doAttrs(n);
  }
}

function restore(root = document.body) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.currentNode; n; n = tw.nextNode()) {
    if (n.nodeType === 3) {
      const r = textOrig.get(n);
      if (r) { if (n.data === r.shown) n.data = r.en; textOrig.delete(n); }
    } else {
      const recs = attrOrig.get(n);
      if (recs) { for (const [a, r] of Object.entries(recs)) if (n.getAttribute(a) === r.shown) n.setAttribute(a, r.en); attrOrig.delete(n); }
    }
  }
}

let observer = null;
export function startI18n() {
  document.documentElement.lang = lang;
  if (observer) return;
  observer = new MutationObserver((list) => {
    if (lang === 'en') return;
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) doText(m.target); }
      else if (m.type === 'attributes' && !skipped(m.target)) doAttrs(m.target);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (lang !== 'en') walk(document.body);
}

export function setLang(l) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ }
  document.documentElement.lang = l;
  if (l === 'en') restore();
  else walk(document.body);
  window.dispatchEvent(new CustomEvent('r3d:lang', { detail: l }));
}
