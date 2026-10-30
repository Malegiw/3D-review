// Plot plan editor: PDF → picked outlines → categorised objects with heights → 3D.
import { h, icon, toast, confirmDialog, formDialog, pickFiles, fmt, uid } from '../core/ui.js';
import { db } from '../core/db.js';
import { CATS as BASE_CATS } from '../core/domain.js';
import { catColor } from '../core/theme.js';
import { go, projectRoute, state } from '../core/app.js';
import { openPdf, renderPage, analyzePage, closePdf } from '../engine/pdf.js';
import { shapeContains, tagInside, bboxOf } from '../engine/pdfvector.js';
import { putGround } from '../engine/ground.js';

const NS = 'http://www.w3.org/2000/svg';
// category definitions with the colours of the active theme
const CATS = new Proxy(BASE_CATS, { get: (t, k) => (typeof k === 'string' && t[k] ? { ...t[k], color: catColor(k, t[k].color) } : t[k]) });
const S = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
const PT_PER_M_1 = 72 / 0.0254; // points per metre at 1:1
const scaleFromRatio = (n) => n / PT_PER_M_1;
const ratioFromScale = (s) => Math.round(s * PT_PER_M_1);

function shapePath(s) {
  if (s.kind === 'circle') return `M${s.cx - s.r},${s.cy}a${s.r},${s.r} 0 1,0 ${2 * s.r},0a${s.r},${s.r} 0 1,0 ${-2 * s.r},0`;
  return `M${s.pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L')}${s.kind === 'line' ? '' : 'Z'}`;
}
const shapeBox = (s) => s.bbox || (s.kind === 'circle' ? [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r] : bboxOf(s.pts));
const centroid = (s) => { const b = shapeBox(s); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
function suggestCat(s, pageArea) {
  if (s.kind === 'circle') return 'tank';
  if (s.kind === 'line') return 'pipe';
  const b = shapeBox(s);
  const w = b[2] - b[0], hh = b[3] - b[1];
  if (s.area > pageArea * 0.15) return 'paving';
  if (Math.max(w, hh) / Math.max(0.1, Math.min(w, hh)) > 8) return 'piperack';
  return 'equipment';
}

export async function renderPlot(main, project) {
  let plans = await db.byProject('plotplans', project.id);
  let plan = plans[0] || null;
  let pdfDoc = null;
  let shapes = [], texts = [];
  let mode = 'select';
  let cand = null; // extracted shape picked but not yet categorised
  let selId = null;
  let draft = null;
  const view = { x: 0, y: 0, z: 1 };

  const root = h('div', { class: 'pp' });
  const stage = h('div', { class: 'pp-stage' });
  const world = h('div', { class: 'pp-world' });
  const canvasHolder = h('div', { style: { position: 'absolute', inset: 0 } });
  const svg = S('svg', { 'aria-label': 'Plot plan overlay' });
  const gShapes = S('g'), gObjs = S('g'), gUi = S('g');
  svg.append(gShapes, gObjs, gUi);
  world.append(canvasHolder, svg);
  const hint = h('div', { class: 'pp-hint' });
  const zoomBtns = h('div', { class: 'pp-zoom' },
    h('button', { class: 'btn icon sm', 'aria-label': 'Zoom in', onclick: () => zoomAt(1.4) }, icon('plus')),
    h('button', { class: 'btn icon sm', 'aria-label': 'Fit', onclick: () => fit() }, icon('focus')));
  stage.append(world, hint, zoomBtns);
  const tools = h('div', { class: 'pp-tools' });
  const side = h('aside', { class: 'pp-side' });
  root.append(tools, stage, side);
  main.append(root);

  const W = () => plan?.pageW || 1190.55, H = () => plan?.pageH || 841.89;
  const savePlan = debounce(async () => { if (plan) await db.put('plotplans', plan); }, 350);

  // ---------- view ----------
  function applyView() { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; updateLabels(); }
  function fit() {
    const r = stage.getBoundingClientRect();
    view.z = Math.min(r.width / W(), r.height / H()) * 0.95 || 1;
    view.x = (r.width - W() * view.z) / 2; view.y = (r.height - H() * view.z) / 2;
    applyView();
  }
  function zoomAt(f, cx, cy) {
    const r = stage.getBoundingClientRect();
    cx ??= r.width / 2; cy ??= r.height / 2;
    const z2 = Math.min(60, Math.max(0.05, view.z * f));
    view.x = cx - ((cx - view.x) / view.z) * z2; view.y = cy - ((cy - view.y) / view.z) * z2; view.z = z2;
    applyView();
  }
  const toPt = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z]; };
  let labelRaf = 0;
  function updateLabels() {
    cancelAnimationFrame(labelRaf);
    labelRaf = requestAnimationFrame(() => { const fs = 11 / view.z; gObjs.querySelectorAll('text').forEach((t) => t.setAttribute('font-size', fs)); gUi.querySelectorAll('circle.hdl').forEach((c) => c.setAttribute('r', 4 / view.z)); });
  }

  // ---------- drawing ----------
  function drawShapes() {
    gShapes.innerHTML = '';
    const groups = { closed: [], circle: [], line: [] };
    for (const s of shapes) groups[s.kind === 'circle' ? 'circle' : s.kind === 'line' ? 'line' : 'closed'].push(shapePath(s));
    for (const [k, list] of Object.entries(groups)) if (list.length) gShapes.append(S('path', { d: list.join(''), class: `shape ${k}` }));
    svg.setAttribute('viewBox', `0 0 ${W()} ${H()}`);
    world.style.width = `${W()}px`; world.style.height = `${H()}px`;
  }
  function drawObjs() {
    gObjs.innerHTML = '';
    for (const o of plan?.objects || []) {
      const c = CATS[o.cat] || CATS.equipment;
      const p = S('path', { d: shapePath(o.shape), class: `obj ${o.id === selId ? 'sel' : ''}`, fill: o.shape.kind === 'line' || c.kind === 'wall' ? 'none' : `${c.color}2a`, stroke: c.color });
      gObjs.append(p);
      if (o.tag) { const [x, y] = centroid(o.shape); const t = S('text', { x, y, fill: c.color, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'JetBrains Mono Variable, Share Tech Mono, monospace', 'pointer-events': 'none' }); t.textContent = o.tag; gObjs.append(t); }
    }
    updateLabels();
  }
  function drawUi() {
    gUi.innerHTML = '';
    if (cand) gUi.append(S('path', { d: shapePath(cand), class: 'shape sel', fill: 'rgba(247,239,0,.12)' }));
    if (draft) {
      if (draft.type === 'rect' && draft.b) { const [a, b] = [draft.a, draft.b]; gUi.append(S('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'draft' })); }
      if (draft.type === 'circle' && draft.b) gUi.append(S('circle', { cx: draft.a[0], cy: draft.a[1], r: Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]), class: 'draft' }));
      if ((draft.type === 'poly' || draft.type === 'line' || draft.type === 'calib') && draft.pts.length) {
        const pts = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
        gUi.append(S('path', { d: `M${pts.map((p) => p.join(',')).join('L')}`, class: 'draft', fill: draft.type === 'poly' ? 'rgba(247,239,0,.12)' : 'none' }));
        draft.pts.forEach((p) => gUi.append(S('circle', { cx: p[0], cy: p[1], r: 4 / view.z, fill: '#f7ef00', class: 'hdl' })));
      }
    }
  }
  const redraw = () => { drawObjs(); drawUi(); renderSide(); };

  // ---------- pdf ----------
  async function loadPdf() {
    canvasHolder.innerHTML = '';
    shapes = []; texts = [];
    closePdf(pdfDoc);
    pdfDoc = null;
    if (!plan?.pdf) { drawShapes(); fit(); redraw(); setHint(); return; }
    setHint('Rendering PDF…');
    pdfDoc = await openPdf(plan.pdf);
    const page = await pdfDoc.getPage(Math.min(plan.page || 1, pdfDoc.numPages));
    const { canvas, vp1 } = await renderPage(page);
    plan.pageW = vp1.width; plan.pageH = vp1.height;
    canvasHolder.append(canvas);
    putGround(plan, canvas);
    drawShapes(); fit();
    setHint('Analysing vectors…');
    const res = await analyzePage(page, { minSize: plan.minSize || 6 });
    shapes = res.shapes; texts = res.texts;
    drawShapes(); redraw();
    setHint();
    if (!shapes.length) toast('No vector outlines found — this looks like a scanned PDF. Trace objects with the Rect / Circle / Polygon tools.', 'warn', 'Raster PDF');
    else toast(`${shapes.length} outlines · ${texts.length} text labels detected.`, 'ok', 'Vectors');
  }

  async function newPlanFromFile(file) {
    const p = { id: uid('pp'), projectId: project.id, name: file.name.replace(/\.pdf$/i, ''), pdf: file, page: 1, pageW: 1190.55, pageH: 841.89, scale: scaleFromRatio(500), scaleNote: '1:500', minSize: 6, objects: [] };
    await db.put('plotplans', p);
    plans.push(p);
    plan = p;
    await loadPdf();
    renderTools();
    const v = await formDialog({ title: 'Drawing scale', eyebrow: 'Set scale', submitLabel: 'Apply', fields: [{ id: 'ratio', label: 'Scale 1 : N (as printed on the title block)', type: 'number', value: 500, required: true }] });
    if (v?.ratio) { plan.scale = scaleFromRatio(v.ratio); plan.scaleNote = `1:${v.ratio}`; savePlan(); renderTools(); renderSide(); }
    toast('Tip: use Calibrate on a known dimension to verify the scale.', 'info', 'Scale');
  }

  // ---------- interaction ----------
  const pointers = new Map();
  let gesture = null;
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: view.z, vx: view.x, vy: view.y };
      if (draft && (draft.type === 'rect' || draft.type === 'circle')) draft = null;
      return;
    }
    const p = toPt(e);
    if ((mode === 'rect' || mode === 'circle') && e.button === 0) { draft = { type: mode, a: p, b: null }; gesture = { type: 'draw' }; return; }
    gesture = { type: 'maybePan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, p, moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = stage.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z2 = Math.min(60, Math.max(0.05, gesture.z * d / gesture.d));
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      const ox = gesture.cx - r.left, oy = gesture.cy - r.top;
      view.z = z2;
      view.x = cx - ((ox - gesture.vx) / gesture.z) * z2;
      view.y = cy - ((oy - gesture.vy) / gesture.z) * z2;
      applyView();
      return;
    }
    if (gesture?.type === 'draw' && draft) { draft.b = toPt(e); drawUi(); return; }
    if (gesture?.type === 'maybePan' && pointers.size === 1) {
      const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
      if (gesture.moved || Math.hypot(dx, dy) > 5) { gesture.moved = true; view.x = gesture.vx + dx; view.y = gesture.vy + dy; applyView(); stage.style.cursor = 'grabbing'; }
      return;
    }
    if (draft && (draft.type === 'poly' || draft.type === 'line' || draft.type === 'calib') && e.pointerType === 'mouse') { draft.hover = toPt(e); drawUi(); }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    stage.style.cursor = '';
    const g = gesture;
    if (g?.type === 'pinch') { if (pointers.size === 0) gesture = null; return; }
    gesture = null;
    if (!g) return;
    if (g.type === 'draw' && draft?.b) finishDragDraw();
    else if (g.type === 'maybePan' && !g.moved && e.type === 'pointerup') tap(g.p);
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('dblclick', () => { if (draft?.type === 'poly' || draft?.type === 'line') finishPoly(); });

  function tap(p) {
    const tol = 5 / view.z;
    if (mode === 'select') {
      const objHits = (plan?.objects || []).filter((o) => shapeContains({ ...o.shape, bbox: shapeBox(o.shape) }, p[0], p[1], tol));
      if (objHits.length) { objHits.sort((a, b) => area(a.shape) - area(b.shape)); selId = objHits[0].id; cand = null; redraw(); return; }
      const hits = shapes.filter((s) => shapeContains(s, p[0], p[1], tol));
      hits.sort((a, b) => (a.kind === 'line') - (b.kind === 'line') || area(a) - area(b));
      cand = hits[0] || null; selId = null;
      redraw();
      return;
    }
    if (mode === 'poly' || mode === 'line' || mode === 'calib') {
      if (!draft) { draft = { type: mode, pts: [] }; }
      if (mode === 'poly' && draft.pts.length >= 3 && Math.hypot(p[0] - draft.pts[0][0], p[1] - draft.pts[0][1]) < 8 / view.z) { finishPoly(); return; }
      draft.pts.push(p);
      if (mode === 'calib' && draft.pts.length === 2) { finishCalib(); return; }
      drawUi(); setHint(); renderTools();
    }
  }
  const area = (s) => (s.kind === 'circle' ? Math.PI * s.r * s.r : s.kind === 'line' ? 0 : (s.area ?? (() => { const b = shapeBox(s); return (b[2] - b[0]) * (b[3] - b[1]); })()));

  function addObject(shape, cat, tag) {
    if (!plan) return;
    const o = { id: uid('o'), shape: { ...shape, bbox: shapeBox(shape) }, cat, tag: tag ?? tagInside(shape, texts), h: CATS[cat].h, elev: 0 };
    if (cat === 'pipe') o.dia = 0.3;
    if (cat === 'vessel') o.h = 0;
    plan.objects.push(o);
    selId = o.id; cand = null;
    savePlan(); redraw();
    return o;
  }
  function finishDragDraw() {
    const { type, a, b } = draft;
    draft = null;
    if (type === 'rect') {
      if (Math.abs(b[0] - a[0]) < 2 || Math.abs(b[1] - a[1]) < 2) return drawUi();
      addObject({ kind: 'rect', pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] }, 'equipment', '');
    } else {
      const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (r < 1.5) return drawUi();
      addObject({ kind: 'circle', cx: a[0], cy: a[1], r }, 'tank', '');
    }
  }
  function finishPoly() {
    if (!draft) return;
    const pts = draft.pts;
    const type = draft.type;
    draft = null;
    if (type === 'poly' && pts.length >= 3) addObject({ kind: 'poly', pts }, 'building', '');
    else if (type === 'line' && pts.length >= 2) addObject({ kind: 'line', pts }, 'pipe', '');
    else drawUi();
    setHint(); renderTools();
  }
  async function finishCalib() {
    const [a, b] = draft.pts;
    draft = null; drawUi();
    const dpt = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v = await formDialog({ title: 'Calibrate scale', eyebrow: `Picked ${dpt.toFixed(1)} pt on paper`, submitLabel: 'Apply', fields: [{ id: 'm', label: 'Real distance between the two points (m)', type: 'number', required: true, value: '' }] });
    if (v?.m > 0) {
      plan.scale = v.m / dpt;
      plan.scaleNote = `calibrated ≈ 1:${ratioFromScale(plan.scale)}`;
      savePlan(); renderTools(); renderSide();
      toast(`Scale set to ≈ 1:${ratioFromScale(plan.scale)}.`, 'ok', 'Calibrated');
    }
    setMode('select');
  }

  function setMode(m) {
    mode = m; draft = null;
    stage.classList.toggle('draw', m !== 'select');
    if (m !== 'select') cand = null;
    renderTools(); drawUi(); setHint();
  }
  function setHint(msg) {
    if (msg) { hint.textContent = msg; hint.hidden = false; return; }
    const M = {
      select: 'Tap an outline to pick it. Drag to pan, pinch or scroll to zoom.',
      rect: 'Drag to draw a rectangle (equipment, building, pad).',
      circle: 'Drag from the centre to draw a circle (tank, vessel).',
      poly: draft?.pts?.length ? `${draft.pts.length} points. Tap the first point or double-tap to close.` : 'Tap the corners of the outline.',
      line: draft?.pts?.length ? `${draft.pts.length} points. Double-tap or press Finish.` : 'Tap points along the pipe or line route.',
      calib: draft?.pts?.length ? 'Tap the second point.' : 'Tap two points of a known dimension.',
    };
    hint.textContent = plan ? M[mode] : 'Upload a plot plan PDF to start.';
    hint.hidden = false;
  }

  // ---------- toolbar ----------
  function renderTools() {
    tools.innerHTML = '';
    const modes = [['select', 'pointer', 'Pick'], ['rect', 'square', 'Rect'], ['circle', 'circle', 'Circle'], ['poly', 'poly', 'Polygon'], ['line', 'line', 'Line'], ['calib', 'scale', 'Calibrate']];
    tools.append(...[
      plans.length > 1 ? h('select', { class: 'inp', style: { width: 'auto', minHeight: '32px' }, 'aria-label': 'Plot plan', onchange: async (e) => { plan = plans.find((p) => p.id === e.target.value); selId = null; cand = null; await loadPdf(); renderTools(); } },
        plans.map((p) => h('option', { value: p.id, selected: p === plan }, p.name))) : null,
      h('button', { class: 'btn sm ghost', onclick: async () => { const [f] = await pickFiles({ accept: 'application/pdf,.pdf' }); if (f) await newPlanFromFile(f); } }, icon('upload'), plan ? 'New PDF' : 'Upload plot plan PDF'),
      plan ? h('div', { class: 'seg', role: 'toolbar' }, modes.map(([m, ic, l]) => h('button', { class: mode === m ? 'on' : '', onclick: () => setMode(m), title: l, 'aria-pressed': mode === m }, icon(ic), h('span', { class: 'crumb-hide' }, l)))) : null,
      draft && (draft.type === 'poly' || draft.type === 'line') ? h('button', { class: 'btn sm mag', onclick: finishPoly }, icon('check'), 'Finish') : null,
      plan && pdfDoc?.numPages > 1 ? h('select', { class: 'inp', style: { width: 'auto', minHeight: '32px' }, 'aria-label': 'Page', onchange: async (e) => { plan.page = +e.target.value; savePlan(); await loadPdf(); } },
        Array.from({ length: pdfDoc.numPages }, (_, i) => h('option', { value: i + 1, selected: plan.page === i + 1 }, `Page ${i + 1}`))) : null,
      plan ? h('span', { class: 'chip', style: { '--c': 'var(--cyan)' }, title: 'Drawing scale' }, plan.scaleNote || `1:${ratioFromScale(plan.scale)}`) : null,
      h('span', { style: { flex: 1 } }),
      plan ? h('button', { class: 'btn primary sm', onclick: generate }, icon('cube'), 'Generate 3D') : null,
    ].filter(Boolean));
  }

  async function generate() {
    if (!plan?.objects?.length) { toast('Pick at least one outline and give it a category first.', 'warn'); return; }
    await db.put('plotplans', plan);
    state.playPlan = plan.id;
    go(projectRoute(project.id, 'review'));
  }

  // ---------- side panel ----------
  function dims(shape) {
    const s = plan.scale;
    if (shape.kind === 'circle') return `Ø ${fmt.num(shape.r * 2 * s, 2)} m`;
    const b = shapeBox(shape);
    if (shape.kind === 'line') { let L = 0; for (let i = 1; i < shape.pts.length; i++) L += Math.hypot(shape.pts[i][0] - shape.pts[i - 1][0], shape.pts[i][1] - shape.pts[i - 1][1]); return `L ${fmt.num(L * s, 2)} m`; }
    return `${fmt.num((b[2] - b[0]) * s, 2)} × ${fmt.num((b[3] - b[1]) * s, 2)} m`;
  }
  function renderSide() {
    side.innerHTML = '';
    if (!plan) {
      side.append(h('div', { class: 'eyebrow' }, 'Plot plan'), h('p', { class: 'dim2', style: { margin: 0 } }, 'Upload the plot plan PDF (vector output from AutoCAD/MicroStation works best; scanned drawings can be traced by hand).'),
        h('button', { class: 'btn primary', onclick: async () => { const [f] = await pickFiles({ accept: 'application/pdf,.pdf' }); if (f) await newPlanFromFile(f); } }, icon('upload'), 'Upload PDF'));
      return;
    }
    const sel = plan.objects.find((o) => o.id === selId);
    side.append(h('div', { class: 'panel-title', style: { margin: 0 } },
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'eyebrow' }, 'Plot plan'), h('h3', { style: { marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis' } }, plan.name)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm icon ghost', 'aria-label': 'Plot plan settings', onclick: settings }, icon('gear')),
        h('button', { class: 'btn sm icon danger', 'aria-label': 'Delete plot plan', onclick: delPlan }, icon('trash')))));

    if (cand) {
      const sug = suggestCat(cand, W() * H());
      const tag = tagInside(cand, texts);
      const similar = shapes.filter((s) => s !== cand && s.kind === cand.kind && Math.abs(area(s) - area(cand)) / Math.max(1, area(cand)) < 0.04 && !plan.objects.some((o) => Math.abs(centroid(o.shape)[0] - centroid(s)[0]) < 0.5 && Math.abs(centroid(o.shape)[1] - centroid(s)[1]) < 0.5));
      side.append(h('div', { class: 'panel hot' },
        h('div', { class: 'eyebrow' }, `Picked ${cand.kind}`), h('h2', { style: { margin: '6px 0 4px' } }, tag || 'Untagged outline'), h('div', { class: 'mono dim2' }, dims(cand)),
        h('div', { class: 'lbl', style: { margin: '14px 0 8px' } }, 'Add as'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' } }, Object.entries(CATS).map(([k, c]) => h('button', {
          class: `btn sm ${k === sug ? 'primary' : 'ghost'}`, style: k === sug ? null : { '--c': c.color, borderColor: `${c.color}88`, color: c.color, justifyContent: 'flex-start' },
          onclick: () => addObject(cand, k, tag),
        }, c.label))),
        similar.length ? h('button', { class: 'btn sm mag', style: { marginTop: '10px', width: '100%' }, onclick: () => {
          const all = [cand, ...similar];
          const cat = sug;
          for (const s of all) plan.objects.push({ id: uid('o'), shape: { ...s }, cat, tag: tagInside(s, texts), h: CATS[cat].h, elev: 0, ...(cat === 'pipe' ? { dia: 0.3 } : {}) });
          cand = null; savePlan(); redraw();
          toast(`${all.length} ${CATS[cat].label} objects added.`, 'ok');
        } }, `Add all ${similar.length + 1} similar as ${CATS[sug].label}`) : null));
    } else if (sel) {
      const c = CATS[sel.cat];
      const upd = (k, v) => {
        sel[k] = v; savePlan(); drawObjs();
        const row = side.querySelector(`[data-oid="${sel.id}"]`);
        if (row) { row.children[1].textContent = sel.tag || CATS[sel.cat]?.label; row.children[2].textContent = sel.cat === 'pipe' ? `Ø${sel.dia}` : sel.cat === 'vessel' ? 'H-VSL' : `${sel.h} m`; }
      };
      side.append(h('div', { class: 'panel hot' },
        h('div', { class: 'eyebrow' }, 'Selected object'),
        h('div', { class: 'mono dim2', style: { margin: '6px 0 12px' } }, dims(sel.shape)),
        h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', { for: 'ot' }, 'Tag / name'), h('input', { class: 'inp mono', id: 'ot', value: sel.tag || '', oninput: (e) => upd('tag', e.target.value) })),
          h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', { for: 'oc' }, 'Category'), h('select', { class: 'inp', id: 'oc', onchange: (e) => { sel.cat = e.target.value; if (sel.cat === 'pipe' && !sel.dia) sel.dia = 0.3; savePlan(); redraw(); } }, Object.entries(CATS).map(([k, v]) => h('option', { value: k, selected: k === sel.cat }, v.label)))),
          sel.cat !== 'vessel' ? h('div', { class: 'field' }, h('label', { for: 'oh' }, sel.cat === 'pipe' ? 'Height (unused)' : sel.cat === 'pit' ? 'Depth (m)' : 'Height (m)'), h('input', { class: 'inp mono', id: 'oh', type: 'number', step: '0.1', value: sel.h, oninput: (e) => upd('h', Number(e.target.value)) })) : h('div', { class: 'field' }, h('label', {}, 'Diameter'), h('div', { class: 'mono dim2', style: { paddingTop: '10px' } }, 'from width')),
          h('div', { class: 'field' }, h('label', { for: 'oe' }, sel.cat === 'pipe' ? 'BOP elev. (m)' : 'Base elev. (m)'), h('input', { class: 'inp mono', id: 'oe', type: 'number', step: '0.1', value: sel.elev || 0, oninput: (e) => upd('elev', Number(e.target.value)) })),
          sel.cat === 'pipe' ? h('div', { class: 'field' }, h('label', { for: 'od' }, 'Pipe OD (m)'), h('input', { class: 'inp mono', id: 'od', type: 'number', step: '0.01', value: sel.dia ?? 0.3, oninput: (e) => upd('dia', Number(e.target.value)) })) : null),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('span', { class: 'chip dot', style: { '--c': c.color } }, c.label),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn sm danger', onclick: () => { plan.objects = plan.objects.filter((o) => o !== sel); selId = null; savePlan(); redraw(); } }, icon('trash'), 'Remove'))));
    } else {
      side.append(h('div', { class: 'note' }, h('b', {}, 'Workflow. '), 'Tap an outline → choose what it is → set height. Missing outlines? Draw them with Rect, Circle, Polygon or Line. Then press ', h('b', {}, 'Generate 3D'), '.'));
    }

    const counts = {};
    plan.objects.forEach((o) => { counts[o.cat] = (counts[o.cat] || 0) + 1; });
    side.append(h('div', {},
      h('div', { class: 'panel-title', style: { marginBottom: '8px' } }, h('div', { class: 'lbl' }, `Objects · ${plan.objects.length}`), h('span', { class: 'mono dim', style: { fontSize: '11px' } }, `${shapes.length} outlines found`)),
      plan.objects.length ? h('div', { class: 'olist' }, plan.objects.slice().reverse().map((o) => h('button', { class: o.id === selId ? 'on' : '', 'data-oid': o.id, onclick: () => { selId = o.id; cand = null; redraw(); centerOn(o.shape); } },
        h('i', { style: { background: CATS[o.cat]?.color } }), h('span', {}, o.tag || CATS[o.cat]?.label), h('span', { class: 'mono' }, o.cat === 'pipe' ? `Ø${o.dia}` : o.cat === 'vessel' ? 'H-VSL' : `${o.h} m`)))) : h('p', { class: 'dim', style: { margin: 0, fontSize: '13px' } }, 'Nothing added yet.')));
  }
  function centerOn(shape) {
    const [x, y] = centroid(shape);
    const r = stage.getBoundingClientRect();
    view.x = r.width / 2 - x * view.z; view.y = r.height / 2 - y * view.z;
    applyView();
  }
  async function settings() {
    const v = await formDialog({ title: 'Plot plan settings', eyebrow: 'Plot plan', fields: [
      { id: 'name', label: 'Name', value: plan.name, required: true, span: true },
      { id: 'ratio', label: 'Scale 1 : N', type: 'number', value: ratioFromScale(plan.scale) },
      { id: 'minSize', label: 'Ignore outlines smaller than (pt)', type: 'number', value: plan.minSize || 6 },
    ] });
    if (!v) return;
    plan.name = v.name;
    if (v.ratio && v.ratio !== ratioFromScale(plan.scale)) { plan.scale = scaleFromRatio(v.ratio); plan.scaleNote = `1:${v.ratio}`; }
    const reload = v.minSize && v.minSize !== plan.minSize;
    plan.minSize = v.minSize || 6;
    await db.put('plotplans', plan);
    renderTools(); renderSide();
    if (reload) await loadPdf();
  }
  async function delPlan() {
    if (!await confirmDialog(`Delete plot plan "${plan.name}" and its ${plan.objects.length} objects?`, { danger: true, okLabel: 'Delete' })) return;
    await db.del('plotplans', plan.id);
    if (state.viewer) state.viewer.removeLayer(`pp_${plan.id}`);
    plans = plans.filter((p) => p !== plan);
    plan = plans[0] || null; selId = null; cand = null;
    await loadPdf(); renderTools();
  }

  const onKey = (e) => {
    if (e.target.closest?.('input,select,textarea')) return;
    if (e.key === 'Escape') { draft = null; cand = null; selId = null; redraw(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { plan.objects = plan.objects.filter((o) => o.id !== selId); selId = null; savePlan(); redraw(); }
    if (e.key === 'Enter' && draft) finishPoly();
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (!view.fitted) { fit(); view.fitted = true; } });
  ro.observe(stage);

  renderTools();
  try { await loadPdf(); } catch (e) { console.error(e); toast(`Could not read the PDF: ${e.message}`, 'err'); }
  renderTools();

  return () => { document.removeEventListener('keydown', onKey); ro.disconnect(); closePdf(pdfDoc); savePlan.flush?.(); };
}

function debounce(fn, ms) {
  let t, args;
  const d = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = () => { clearTimeout(t); return fn(...(args || [])); };
  return d;
}
