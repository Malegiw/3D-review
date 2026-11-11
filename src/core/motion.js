// Gliding highlight for single-choice groups (segmented controls, the section rail).
// Groups are re-rendered often (a panel redraws after every tap), so the thumb remembers where it was for each group
// and starts the next one from there: the highlight travels from the old option to the new one instead of jumping.
// Pure transform/size transitions; reduced motion just places it.

const GROUPS = '.seg, .side-nav, .tabbar';
const last = new Map(); // group key → { x, y, w, h } relative to the group
let raf = 0;
const pending = new Set();

const keyOf = (g) => (g.classList.contains('side-nav') ? 'side' : g.classList.contains('tabbar') ? 'tabbar' : g.getAttribute('aria-label') || `${g.className}|${[...g.children].filter((c) => c.tagName === 'BUTTON' || c.tagName === 'A').length}`);

function place(g) {
  if (!g.isConnected) return;
  const theme = document.documentElement.dataset.theme;
  let thumb = g.querySelector(':scope > .glide');
  if (theme === 'cyber') { thumb?.remove(); g.classList.remove('has-glide'); return; }
  const on = g.querySelector(':scope > .on');
  if (!thumb) {
    thumb = document.createElement('span');
    thumb.className = 'glide';
    thumb.setAttribute('aria-hidden', 'true');
    g.prepend(thumb);
    g.classList.add('has-glide');
  }
  if (!on || on.offsetParent === null) { thumb.classList.remove('ready'); return; }
  const r = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
  if (!r.w || !r.h) return;
  const key = keyOf(g);
  const prev = thumb.classList.contains('ready') ? null : last.get(key);
  const set = (p) => { thumb.style.transform = `translate(${p.x}px, ${p.y}px)`; thumb.style.width = `${p.w}px`; thumb.style.height = `${p.h}px`; };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prev && !reduce && (prev.x !== r.x || prev.y !== r.y || prev.w !== r.w)) {
    // a freshly rendered group: start from where this group's highlight was, then travel
    thumb.classList.add('instant');
    set(prev);
    thumb.classList.add('ready');
    void thumb.offsetWidth;
    thumb.classList.remove('instant');
    set(r);
  } else {
    if (!thumb.classList.contains('ready')) thumb.classList.add('instant');
    set(r);
    thumb.classList.add('ready');
    void thumb.offsetWidth;
    thumb.classList.remove('instant');
  }
  last.set(key, r);
}

function schedule(g) {
  pending.add(g);
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; for (const x of pending) place(x); pending.clear(); });
}

function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches(GROUPS)) schedule(node);
  else if (node.parentElement?.matches(GROUPS)) schedule(node.parentElement);
  if (node.firstElementChild) for (const g of node.querySelectorAll(GROUPS)) schedule(g);
}

export function startGlide() {
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target.classList?.contains('glide')) continue; // our own class toggles
      if (r.type === 'attributes') { const g = r.target.parentElement; if (g?.matches(GROUPS)) schedule(g); continue; }
      if (r.target.matches?.(GROUPS)) schedule(r.target);
      for (const n of r.addedNodes) scan(n);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  for (const g of document.querySelectorAll(GROUPS)) schedule(g);
  let t = 0;
  const all = () => { for (const g of document.querySelectorAll(GROUPS)) { g.querySelector(':scope > .glide')?.classList.add('instant'); schedule(g); } clearTimeout(t); t = setTimeout(() => document.querySelectorAll('.glide.instant').forEach((x) => x.classList.remove('instant')), 80); };
  window.addEventListener('resize', all);
  window.addEventListener('r3d:theme', all);
  document.fonts?.ready.then(all);
}
