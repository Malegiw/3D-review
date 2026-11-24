// 4D progress panel for the 3D review: daily reports → work-package progress → colours on the model, with a timeline.
//   import PDF/CSV  →  pick objects in 3D and assign them to a work package  →  scrub or play the timeline / record a video.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { h, icon, toast, formDialog, confirmDialog, pickFiles, download, fmt, uid } from '../core/ui.js';
import { db } from '../core/db.js';
import { openPdf, closePdf } from '../engine/pdf.js';
import { linesOfPdf, parseReport, dateFromName } from '../engine/dailyreport.js';
import { buildModel, pctAt, stateOf, activitiesAt, buildProgressXlsx, reportsFromCSV, mergeReports, slimReport, DONE_AT } from '../engine/progress4d.js';
import { objectGeometry, searchObjects, objectName } from '../engine/objects.js';
import { displayName } from '../engine/groups.js';
import { baselineFromCSV } from '../engine/progress4d.js';
import { createSequence } from '../engine/sequence4d.js';
import { autoMap, routeOrder } from '../engine/automap.js';

const OPT_KEY = 'r3d-4d';
const AMBER = new THREE.Color(0xf5b82e), GREEN = new THREE.Color(0x2fbf71);
const mk = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...extra });
const MAT_DONE = mk(GREEN, { emissive: 0x0b5a30, emissiveIntensity: 0.35 });
const MAT_GHOST = new THREE.MeshBasicMaterial({ color: 0x8b95a7, transparent: true, opacity: 0.14, depthWrite: false });
const wipMats = new Map();
function matFor(state, pct) {
  if (state === 'done') return MAT_DONE;
  if (state === 'todo') return MAT_GHOST;
  const b = Math.min(9, Math.floor(pct / 10));
  if (!wipMats.has(b)) wipMats.set(b, mk(AMBER.clone().lerp(GREEN, (b + 0.5) / 10), { emissive: 0x4a3200, emissiveIntensity: 0.25 }));
  return wipMats.get(b);
}
const STATE_VAR = { todo: 'var(--st-not, var(--fg-3))', wip: 'var(--yellow, #f5b82e)', done: 'var(--green, #2fbf71)' };
const pct1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;

async function loadRecord(projectId) {
  const rows = await db.byProject('progress', projectId);
  return rows[0] || { id: uid('pg'), projectId, reports: {}, map: {}, created: Date.now() };
}

export function createProgress4D({ viewer, project, shell, refresh, hasPanel }) {
  let rec = null, model = null, t = 0, playing = false, stopTick = null, recording = false, live = [];
  let meshIdx = null, xraySet = false, growing = [], ovGrowing = [];
  const opts = { dim: true, hideTodo: false, orbit: false, speed: 2, seq: true, fromZero: true, follow: true, hud: true, ...(() => { try { return JSON.parse(localStorage.getItem(OPT_KEY)) || {}; } catch { return {}; } })() };
  const saveOpts = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch { /* storage blocked */ } };
  const touched = new Map();   // mesh → previous visibility (meshes we recoloured or hid)
  const overlays = new Map();  // `${pkg}|${meshKey}` → { mesh, ov, geo }
  const applied = new Map();   // pkg → last drawn signature
  const seq = createSequence(viewer);
  let seqReady = false, framed = false, siteBox = null, floatEl = null, focus = null, floatDay = -1;
  const off = viewer.on('layers', () => { meshIdx = null; seqReady = false; });

  const save = async () => { await db.put('progress', rec); };
  const N = () => (model ? model.dates.length : 0);
  const index = () => {
    if (!meshIdx) { meshIdx = new Map(); for (const L of viewer.layers.values()) for (const m of L.meshes) meshIdx.set(m.userData.key, m); }
    return meshIdx;
  };
  const targets = (id) => rec.map[id] || [];

  // ---------- drawing on the model ----------
  function clearVisuals() {
    seq.reset(); seqReady = false; focus = null; framed = false; siteBox = null;
    for (const [m, vis] of touched) { viewer.overrides.delete(m); m.visible = vis; viewer.refresh(m); }
    touched.clear();
    for (const o of overlays.values()) { o.ov.removeFromParent(); o.geo.dispose(); }
    overlays.clear();
    applied.clear();
    if (xraySet) { viewer.setXray(false); xraySet = false; }
    viewer.requestRender();
  }
  // Objects of a package inside a merged block are drawn as one overlay whose draw range grows with the package %:
  // objects ordered bottom-up, then along the route, so a tank rises ring by ring and a pipe is laid end to end.
  function overlayFor(p, key, mesh, ks) {
    const id = `${p.id}|${key}`;
    let o = overlays.get(id);
    if (o) return o;
    const items = ks.map((k) => {
      const g = objectGeometry(mesh, k);
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      return { g, c, bb: g.boundingBox.clone(), y: Math.floor(g.boundingBox.min.y / 2) };
    });
    const r = routeOrder(items.map((x) => x.c));
    items.forEach((x, i) => { x.d = r[i]; });
    items.sort((a, b) => a.y - b.y || a.d - b.d);
    const cum = [0];
    for (const x of items) cum.push(cum[cum.length - 1] + x.g.index.count);
    const geo = items.length === 1 ? items[0].g : mergeGeometries(items.map((x) => x.g), false);
    if (items.length > 1) items.forEach((x) => x.g.dispose());
    const ov = new THREE.Mesh(geo, MAT_GHOST);
    ov.userData.helper = true;
    ov.raycast = () => {};
    ov.frustumCulled = false;
    mesh.add(ov);
    ov.updateWorldMatrix(true, false);
    o = { mesh, ov, geo, cum, boxes: items.map((x) => x.bb), k: 0 };
    overlays.set(id, o);
    return o;
  }
  function growOverlay(o, pct) {
    const n = o.cum.length - 1;
    const k = pct >= DONE_AT ? n : Math.min(n, Math.ceil((n * pct) / 100));
    o.geo.setDrawRange(0, o.cum[k]);
    o.ov.visible = k > 0;
    // the objects that just appeared are "active work" for the camera and the build sequence
    if (k > o.k) for (let i = Math.max(o.k, k - 6); i < k; i++) {
      const b = o.boxes[i].clone().applyMatrix4(o.mesh.matrixWorld);
      ovGrowing.push({ b, c: b.getCenter(new THREE.Vector3()) });
    }
    o.k = k;
  }
  function drawPkg(p, pct) {
    const st = stateOf(pct);
    const sig = `${st}${st === 'wip' ? Math.floor(pct / 10) : ''}${opts.hideTodo ? 'h' : ''}`;
    const fresh = applied.get(p.id) !== sig;
    applied.set(p.id, sig);
    const mat = matFor(st, pct);
    const byMesh = new Map();
    for (const tg of targets(p.id)) {
      const m = index().get(tg.key);
      if (!m) continue;
      if (tg.k == null) {
        if (!fresh) continue;
        if (!touched.has(m)) touched.set(m, m.visible);
        m.visible = !(st === 'todo' && opts.hideTodo);
        viewer.overrides.set(m, mat);
        viewer.refresh(m);
      } else (byMesh.get(m) || byMesh.set(m, []).get(m)).push(tg.k);
    }
    for (const [m, ks] of byMesh) {
      if (st === 'todo' && !overlays.has(`${p.id}|${m.userData.key}`)) continue; // nothing to draw yet
      const o = overlayFor(p, m.userData.key, m, ks);
      if (fresh) o.ov.material = mat;
      growOverlay(o, opts.seq ? pct : (st === 'todo' ? 0 : 100));
    }
    viewer.requestRender();
  }
  function apply() {
    if (!model) return;
    // dim the rest of the model once something is mapped (dimming an unmapped model would only hide it)
    const dim = opts.dim && model.pkgs.some((p) => targets(p.id).length);
    if (dim && !xraySet && hasPanel()) { viewer.xray = true; viewer.refreshAll(); xraySet = true; }
    if (!dim && xraySet) { viewer.setXray(false); xraySet = false; }
    ovGrowing = [];
    for (const p of model.pkgs) if (targets(p.id).length) drawPkg(p, pctAt(p.curve, t));
    if (opts.seq && hasPanel()) {
      if (!seqReady) {
        const used = new Set(), groups = [];
        for (const p of model.pkgs) {
          if (p.summary) continue;
          const ms = [];
          for (const tg of targets(p.id)) { const m = index().get(tg.key); if (!m || used.has(m)) continue; used.add(m); if (tg.k == null) ms.push(m); }
          if (ms.length) groups.push({ meshes: ms, frac: () => pctAt(p.curve, t) / 100 });
        }
        seq.prepare((m) => used.has(m), groups);
        seqReady = true;
        if (!framed) { framed = true; frameAll(); }
      }
      const o = pctAt(model.overall, t), o0 = pctAt(model.overall, 0);
      const frac = opts.fromZero ? (o - o0) / Math.max(1, 100 - o0) : o / 100;
      growing = seq.set(frac).concat(ovGrowing);
    } else if (seqReady) { seq.reset(); seqReady = false; growing = []; }
    viewer.requestRender();
  }
  const redraw = () => { applied.clear(); apply(); };

  // ---------- playback ----------
  function setT(v, { fromSlider = false } = {}) {
    t = Math.min(Math.max(v, 0), Math.max(0, N() - 1));
    apply();
    updateLive(fromSlider);
    updateFloat();
    if (!playing) followCam(2);
    const di = Math.round(t);
    viewer.setHud(`4D · ${fmt.date(model.dates[di])}`, `Progress ${pct1(pctAt(model.overall, t))} · day ${di + 1}/${N()}`);
  }
  function stop() {
    if (stopTick) { stopTick(); stopTick = null; }
    playing = false;
    viewer.controls.autoRotate = false;
    updateLive();
  }
  function followCam(dt) {
    if (!opts.follow || !growing.length) return;
    // follow the work on the main site only (a remote tie-in kilometres away would drag the camera off)
    const site = (siteBox ||= viewer.boundsOf(null, { robust: true }).clone().expandByScalar(30));
    const near = growing.filter((x) => site.containsPoint(x.c));
    if (!near.length) return;
    const c = new THREE.Vector3();
    for (const x of near) c.add(x.c);
    c.multiplyScalar(1 / near.length);
    focus = focus ? focus.lerp(c, 1 - Math.exp(-dt * 1.6)) : c.clone();
    const ctl = viewer.controls, cam = viewer.camera;
    const delta = focus.clone().sub(ctl.target).multiplyScalar(1 - Math.exp(-dt * 2.2));
    cam.position.add(delta); ctl.target.add(delta);
    // framing distance follows the size of the active cluster, kept within a sane range for long pipelines
    const cb = new THREE.Box3(); for (const x of near) cb.union(x.b);
    const want = Math.min(450, Math.max(70, cb.getSize(new THREE.Vector3()).length() * 0.9));
    const off = cam.position.clone().sub(ctl.target), d = off.length();
    if (d > 0) cam.position.copy(ctl.target).addScaledVector(off, (d + (want - d) * (1 - Math.exp(-dt * 0.9))) / d);
    ctl.update();
  }
  function frameAll() {
    const b = seq.bounds(); if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()), r = Math.max(b.getSize(new THREE.Vector3()).length() * 0.55, 20);
    viewer.camera.far = Math.max(viewer.camera.far, r * 20); viewer.camera.updateProjectionMatrix();
    viewer.camera.position.copy(c).add(new THREE.Vector3(r * 0.75, r * 0.55, r * 0.75));
    viewer.controls.target.copy(c); viewer.controls.update(); focus = null;
  }
  // ---------- on-screen panels (stage · active operations · Gantt), like a construction-sequence video ----------
  function spans() {
    if (model._spans) return model._spans;
    const n = N();
    model._spans = model.pkgs.filter((p) => !p.summary).map((p) => {
      let a = -1, z = -1;
      for (let i = 0; i < n; i++) { const v = pctAt(p.curve, i); if (a < 0 && v > 0.05) a = i; if (z < 0 && v >= DONE_AT) z = i; }
      return { p, a: a < 0 ? n - 1 : a, z: z < 0 ? null : z };
    }).sort((x, y) => x.a - y.a || (x.z ?? 99) - (y.z ?? 99));
    return model._spans;
  }
  function removeFloat() { floatEl?.remove(); floatEl = null; floatDay = -1; }
  function updateFloat() {
    if (!model || !hasPanel() || !opts.hud) return removeFloat();
    if (!floatEl) { floatEl = h('div', { class: 'p4-float' }); viewer.host.append(floatEl); floatDay = -1; }
    const n = N(), di = Math.round(t);
    const key = `${di}|${Math.floor(t * 4)}`;
    if (floatDay === key) return;
    floatDay = key;
    const sp = spans();
    // active operations: activities that moved on this report day
    const ops = [];
    for (const p of model.pkgs) if (!p.summary) for (const a of activitiesAt(p, di)) if (a.pct - a.was > 0.05 && !a.dropped) ops.push({ p, a, d: a.pct - a.was });
    ops.sort((x, y) => y.d - x.d);
    const lead = ops[0];
    const phase = lead ? lead.p.name : (di >= n - 1 ? 'Complete' : 'Mobilisation');
    const bars = sp.filter(({ p, z }) => z == null ? pctAt(p.curve, t) < DONE_AT : z >= di - 1).slice(0, 10).map(({ p, a, z }) => {
      const end = z ?? n - 1, w = Math.max(1, end - a + 1), l = (a / n) * 100, v = pctAt(p.curve, t);
      const on = di >= a && (z == null || di <= z);
      return h('div', { class: 'p4-g-row' + (on ? ' on' : '') }, h('span', { class: 'p4-g-n' }, p.name),
        h('span', { class: 'p4-g-t' }, h('i', { class: 'p4-g-b', style: { left: `${l}%`, width: `${(w / n) * 100}%` } }, h('u', { style: { width: `${v}%` } }))));
    });
    floatEl.replaceChildren(
      h('div', { class: 'p4-f-stage' }, h('small', {}, 'Current stage'), h('b', {}, phase), h('span', { class: 'mono' }, `${fmt.date(model.dates[di])} · ${pct1(pctAt(model.overall, t))}`)),
      h('div', { class: 'p4-f-ops' }, h('small', {}, `Active operations · ${ops.length}`), ...ops.slice(0, 7).map(({ p, a, d }) =>
        h('div', { class: 'p4-f-op' }, h('span', {}, a.desc), h('em', { class: 'mono' }, `+${d.toFixed(d < 10 ? 1 : 0)}%`)))),
      h('div', { class: 'p4-f-gantt', style: { '--now-k': String(Math.min(t, n - 1) / Math.max(1, n - 1)) } }, h('small', {}, 'Build sequence'), h('div', { class: 'p4-g-body' }, ...bars, h('span', { class: 'p4-g-now' }))));
  }
  function play(from = null) {
    if (!model || N() < 2) return;
    stop();
    if (from != null) setT(from); else if (t >= N() - 1) setT(0);
    playing = true;
    if (opts.follow && t < 0.5) { apply(); frameAll(); }
    viewer.controls.autoRotate = !!opts.orbit;
    viewer.controls.autoRotateSpeed = 1.2;
    updateLive();
    return new Promise((res) => {
      stopTick = viewer.addTicker((dt) => {
        setT(t + dt * opts.speed);
        followCam(dt);
        if (t >= N() - 1) { stop(); res(); return false; }
        return true;
      });
    });
  }
  async function playRecord() {
    if (!model || N() < 2) return;
    let mime;
    try { mime = viewer.startRecording(); } catch (e) { return toast(e.message, 'err'); }
    recording = true; updateLive();
    await play(0);
    await new Promise((r) => setTimeout(r, 800)); // hold the last frame
    const blob = await viewer.stopRecording();
    recording = false; updateLive();
    if (blob?.size) {
      const extn = mime.includes('mp4') ? 'mp4' : 'webm';
      download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_4D_${fmt.today()}.${extn}`);
      toast(`Video saved (${fmt.bytes(blob.size)}, ${extn.toUpperCase()}).`, 'ok', '4D recorded');
    }
  }

  // ---------- data ----------
  async function init() {
    if (rec) return;
    rec = await loadRecord(project.id);
    rebuild(true);
  }
  async function removePkgs(ids, label) {
    if (!(await confirmDialog(`Remove ${label} from the 4D view? Reports stay stored; you can restore it anytime.`, { title: 'Remove from 4D', okLabel: 'Remove', danger: true }))) return;
    rec.removed = [...new Set([...(rec.removed || []), ...ids])];
    await save(); redraw(); rebuild(); render();
  }
  async function restoreAll() { rec.removed = []; await save(); rebuild(); render(); }
  function rebuild(toEnd = false) {
    const ex = new Set(rec.removed || []);
    const reps = ex.size ? Object.fromEntries(Object.entries(rec.reports).map(([d, r]) => [d, { ...r, rows: (r.rows || []).filter((x) => !ex.has(x.pkg)) }])) : rec.reports;
    model = Object.keys(rec.reports).length ? buildModel(reps, { weights: rec.weights || {}, baseline: rec.baseline || {} }) : null;
    if (model) t = toEnd ? model.dates.length - 1 : Math.min(t, model.dates.length - 1); else t = 0;
  }
  async function importFiles() {
    const files = await pickFiles({ accept: '.pdf,.csv,.txt', multiple: true });
    if (!files.length) return;
    const incoming = {};
    let i = 0, skipped = 0;
    for (const f of files) {
      i++;
      viewer.setHud('Reading daily reports', `${i} / ${files.length} · ${f.name}`);
      try {
        if (/\.pdf$/i.test(f.name)) {
          const doc = await openPdf(f);
          try {
            const r = parseReport(await linesOfPdf(doc));
            const date = r.date || dateFromName(f.name);
            if (!date || !r.rows.length) { skipped++; toast(`${f.name}: no activity table found.`, 'warn'); continue; }
            incoming[date] = slimReport(r);
          } finally { closePdf(doc); }
        } else Object.assign(incoming, reportsFromCSV(await f.text()));
      } catch (e) { skipped++; console.error(e); toast(`${f.name}: ${e.message}`, 'err'); }
    }
    viewer.setHud('');
    const n = Object.keys(incoming).length;
    if (!n) return;
    rec.reports = mergeReports(rec.reports, incoming);
    await save();
    clearVisuals();
    rebuild(true);
    toast(`${n} report day${n > 1 ? 's' : ''} added${skipped ? `, ${skipped} skipped` : ''}. ${model.pkgs.length} work packages, ${model.count} activities.`, 'ok', '4D data');
    refresh();
  }
  async function exportXlsx() {
    if (!model) return;
    download(buildProgressXlsx(model, { project: project.name }), `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_progress_${fmt.today()}.xlsx`);
  }
  async function clearData() {
    if (!(await confirmDialog('Remove all imported reports and the object mapping of this project?', { title: 'Clear 4D data', okLabel: 'Clear', danger: true }))) return;
    stop(); clearVisuals();
    rec.reports = {}; rec.map = {}; rec.baseline = {}; rec.weights = {}; rec.removed = [];
    await save();
    rebuild();
    refresh();
  }

  // ---------- mapping ----------
  async function importBaseline() {
    const [f] = await pickFiles({ accept: '.csv,.txt' });
    if (!f) return;
    const { baseline, missing } = baselineFromCSV(await f.text(), model.pkgs);
    const n = Object.keys(baseline).length;
    if (!n) return toast('No rows matched. Use columns: package, start, finish (package = name or id).', 'warn', 'Baseline');
    rec.baseline = baseline; await save(); rebuild(); render();
    toast(`${n} packages have a plan${missing.length ? ` · ${missing.length} rows not matched` : ''}.`, 'ok', 'Baseline');
  }
  async function setWeight(p, v) {
    rec.weights = { ...(rec.weights || {}) };
    if (v > 0) rec.weights[p.id] = v; else delete rec.weights[p.id];
    await save(); rebuild(); render();
  }
  async function runAutoMap(reverse = false) {
    const descs = [];
    const box = new THREE.Box3(), c = new THREE.Vector3();
    for (const m of viewer.meshes({ visibleOnly: false })) {
      if (m.userData.ground || !m.geometry) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).getCenter(c);
      descs.push({ key: m.userData.key, name: displayName(m), x: c.x, z: c.z });
    }
    const { map, notes } = autoMap(descs, model.pkgs.filter((p) => !p.hint), { reverse });
    // packages that carry a name hint (CSV column "hint", alternatives separated by |) are matched by object name / layer
    const blocks = viewer.meshes({ visibleOnly: false }).filter((m) => m.userData.objs);
    const taken = new Set();
    let byHint = 0;
    for (const p of model.pkgs) {
      if (!p.hint) continue;
      const found = [];
      for (const q of p.hint.split('|').map((x) => x.trim()).filter(Boolean)) {
        for (const it of searchObjects(blocks, q, 50000).items) {
          const o = it.mesh.userData.objs;
          if (/existing/i.test(o.table.layers[o.ly[it.k]] || '')) continue; // what is already there is not built
          const id = `${it.mesh.userData.key}|${it.k}`;
          if (taken.has(id)) continue;
          taken.add(id); found.push({ key: it.mesh.userData.key, k: it.k });
        }
        for (const m of viewer.meshes({ visibleOnly: false })) if (!m.userData.objs && !m.userData.ground && displayName(m).toLowerCase().includes(q.toLowerCase()) && !taken.has(m.userData.key)) { taken.add(m.userData.key); found.push({ key: m.userData.key }); }
      }
      if (found.length) { map[p.id] = found; byHint++; }
    }
    if (byHint) notes.push(`${byHint} packages matched by name`);
    const ids = Object.keys(map);
    if (!ids.length) return toast('Nothing recognised in this model.', 'warn', 'Auto-map');
    for (const id of ids) rec.map[id] = map[id];
    rec.autoReverse = reverse;
    await save(); seqReady = false; redraw(); render();
    toast(`${notes.join(' · ')}. Check the order of segments; flip it if segment 1 is at the other end.`, 'ok', 'Auto-mapped');
  }
  function selectionTargets() {
    const po = viewer.pickedObj;
    if (po) return [{ key: po.mesh.userData.key, k: po.k, name: objectName(po.mesh.userData.objs, po.k) }];
    return viewer.selection.map((m) => ({ key: m.userData.key, name: displayName(m) }));
  }
  async function addTargets(p, list, label) {
    if (!list.length) return toast('Nothing to assign.', 'warn');
    const cur = rec.map[p.id] || [];
    const seen = new Set(cur.map((x) => `${x.key}|${x.k ?? ''}`));
    const add = list.filter((x) => !seen.has(`${x.key}|${x.k ?? ''}`));
    rec.map[p.id] = cur.concat(add);
    // an object can belong to one package only
    for (const q of model.pkgs) if (q.id !== p.id && rec.map[q.id]) {
      const mine = new Set(list.map((x) => `${x.key}|${x.k ?? ''}`));
      rec.map[q.id] = rec.map[q.id].filter((x) => !mine.has(`${x.key}|${x.k ?? ''}`));
    }
    clearVisuals();
    await save();
    apply();
    refresh();
    toast(`${fmt.int(add.length)} ${label} → ${p.name}`, 'ok', 'Assigned');
  }
  const assignSelection = (p) => {
    const l = selectionTargets();
    if (!l.length) return toast('Select objects in the 3D view first (tap an object; Select resolution: Item or Component).', 'warn');
    addTargets(p, l, 'selected');
  };
  async function assignByName(p, hint) {
    const v = await formDialog({ title: 'Assign by name', eyebrow: p.name, submitLabel: 'Find & assign', fields: [
      { id: 'q', label: 'Name or layer contains', value: hint || '', required: true, span: true },
    ] });
    if (!v) return;
    const q = v.q.trim().toLowerCase();
    const found = [];
    const blocks = viewer.meshes({ visibleOnly: false }).filter((m) => m.userData.objs);
    const hit = searchObjects(blocks, q, 4000);
    for (const it of hit.items) found.push({ key: it.mesh.userData.key, k: it.k, name: objectName(it.mesh.userData.objs, it.k) });
    for (const m of viewer.meshes({ visibleOnly: false })) {
      if (m.userData.objs) continue;
      const L = viewer.layers.get(m.userData.layerId);
      if (displayName(m).toLowerCase().includes(q) || (L?.kind === 'plotplan' && (m.userData.tag || '').toLowerCase().includes(q))) found.push({ key: m.userData.key, name: displayName(m) });
    }
    if (!found.length) return toast(`No object matches “${v.q}”.`, 'warn');
    if (hit.total > hit.items.length) toast(`${fmt.int(hit.total)} objects match; the first ${fmt.int(hit.items.length)} were assigned.`, 'info');
    addTargets(p, found, 'matched');
  }
  async function unassign(p) {
    rec.map[p.id] = [];
    clearVisuals();
    await save();
    apply();
    refresh();
  }
  function zoom(p) {
    const ms = [];
    for (const tg of targets(p.id)) {
      const m = index().get(tg.key);
      if (!m) continue;
      const o = overlays.get(`${p.id}|${tg.key}`);
      ms.push(tg.k != null && o ? o.ov : m);
    }
    if (!ms.length) return toast('Nothing assigned to this package yet.', 'warn');
    viewer.fit(ms);
  }

  // ---------- panel ----------
  function sCurve() {
    const W = 350, H = 84, P = 4, n = N();
    const xs = (i) => P + ((W - 2 * P) * i) / Math.max(1, n - 1), ys = (v) => H - P - ((H - 2 * P) * v) / 100;
    const pts = Array.from(model.overall, (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`);
    const cur = h('line', { svg: true, y1: P, y2: H - P, stroke: 'var(--fg-2)', 'stroke-width': 1 });
    const dot = h('circle', { svg: true, r: 4, fill: 'var(--cyan)', stroke: 'var(--surface, var(--bg-2))', 'stroke-width': 2 });
    const move = () => {
      const x = xs(t), y = ys(pctAt(model.overall, t));
      cur.setAttribute('x1', x); cur.setAttribute('x2', x); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    };
    live.push(move);
    move();
    return h('svg', { svg: true, class: 'p4-curve', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Overall progress ${pct1(model.overall[0])} to ${pct1(model.overall[n - 1])}` },
      [0, 50, 100].map((g) => h('line', { svg: true, x1: P, x2: W - P, y1: ys(g), y2: ys(g), stroke: 'var(--line)', 'stroke-width': 1 })),
      h('polygon', { svg: true, points: `${xs(0)},${ys(0)} ${pts.join(' ')} ${xs(n - 1)},${ys(0)}`, fill: 'var(--cyan)', opacity: 0.1 }),
      h('polyline', { svg: true, points: pts.join(' '), fill: 'none', stroke: 'var(--cyan)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      model.plan ? h('polyline', { svg: true, points: Array.from(model.plan, (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' '), fill: 'none', stroke: 'var(--amber, #f5b82e)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }) : null,
      cur, dot);
  }
  function pkgRow(p) {
    const n = targets(p.id).length;
    const bar = h('i'), val = h('b', { class: 'mono' }), dot = h('span', { class: 'p4-dot' });
    const upd = () => {
      const v = pctAt(p.curve, t), st = stateOf(v);
      bar.style.width = `${v}%`; bar.style.background = STATE_VAR[st];
      dot.style.background = STATE_VAR[st];
      val.textContent = pct1(v);
    };
    live.push(upd); upd();
    const acts = h('div', { class: 'p4-acts' });
    const fill = () => {
      acts.replaceChildren(...activitiesAt(p, Math.round(t)).map((a) => h('div', { class: 'p4-act' },
        h('span', { class: 'p4-an' }, a.desc),
        h('span', { class: 'mono dim2' }, `${fmt.num(a.bq, a.bq % 1 ? 1 : 0)} ${a.unit}`),
        h('b', { class: 'mono', style: { color: a.pct >= DONE_AT ? 'var(--green, #2fbf71)' : 'var(--fg-1)' } }, `${Math.round(a.pct)}%`))));
    };
    const btn = (ic, tip, fn) => h('button', { class: 'btn sm icon ghost', 'data-tip': tip, 'aria-label': tip, onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } }, icon(ic));
    return h('details', { class: `p4-pkg ${n ? 'mapped' : ''}`, ontoggle: (e) => { if (e.target.open) fill(); } },
      h('summary', {},
        h('div', { class: 'p4-top' }, dot, h('span', { class: 'p4-name' }, p.name), val),
        h('div', { class: 'progress p4-bar' }, bar),
        h('div', { class: 'p4-sub' },
          h('span', { class: 'dim2' }, n ? `${fmt.int(n)} object${n > 1 ? 's' : ''} mapped` : 'Not mapped · tap ◎ to assign the selection'),
          h('span', { class: 'p4-tools' },
            btn('target', 'Assign selected objects', () => assignSelection(p)),
            btn('search', 'Assign by name', () => assignByName(p, p.hint)),
            btn('focus', 'Zoom to package', () => zoom(p)),
            n ? btn('x', 'Clear mapping', () => unassign(p)) : null,
            btn('trash', 'Remove package from 4D', () => removePkgs([p.id], `“${p.name}”`))))),
      h('label', { class: 'p4-w' }, h('span', { class: 'dim2' }, 'Weight'),
        h('input', { type: 'number', min: 0, step: 'any', placeholder: String(p.acts.length), value: rec.weights?.[p.id] ?? '', 'aria-label': `Weight of ${p.name}`, onchange: (e) => setWeight(p, +e.target.value) }),
        h('span', { class: 'dim2' }, rec.weights?.[p.id] ? 'custom' : 'default = activity count')),
      acts);
  }
  function render() {
    live = [];
    if (!rec) { shell('4D progress', 'Daily reports × 3D model', h('p', { class: 'dim2' }, 'Loading…')); init().then(() => { if (hasPanel()) render(); }); return; }
    if (!model) {
      shell('4D progress', 'Daily reports × 3D model',
        h('div', { class: 'mto-empty' }, icon('film'),
          h('p', {}, 'Import the contractor’s Daily Activity Report PDFs (one per day). Progress per work package is read from the BQ table, then coloured on the 3D model and played day by day.')),
        h('button', { class: 'btn primary', style: { width: '100%' }, onclick: importFiles }, icon('upload'), 'Import daily report PDF / CSV'),
        h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'Everything stays on this device. CSV format: date, package, activity, unit, bq, progress (long format; the XLSX export has a Long sheet you can re-import as CSV).'));
      return;
    }
    const n = N(), di = () => Math.round(t);
    const kpi = h('b', { class: 'p4-kpi mono' }), dl = h('span', { class: 'mono' }), mp = h('span', { class: 'mono dim2' });
    const slider = h('input', { type: 'range', class: 'p4-slider', min: 0, max: n - 1, step: 0.01, value: t, 'aria-label': 'Report day', oninput: (e) => { const v = +e.target.value; stop(); setT(v, { fromSlider: true }); } });
    const play$ = h('button', { class: 'btn primary icon', 'aria-label': 'Play', onclick: () => (playing ? stop() : play()) });
    const rec$ = h('button', { class: 'btn sm mag', onclick: playRecord }, h('span', { class: 'rec-dot' }), 'Play & record');
    const conc = h('div', { class: 'p4-conc' });
    const planL = h('div', { class: 'p4-plan mono' });
    live.push((fromSlider) => {
      kpi.textContent = pct1(pctAt(model.overall, t));
      if (model.plan) {
        const pl = pctAt(model.plan, t), ac = pctAt(model.plan.actual, t), d = ac - pl;
        planL.textContent = `Plan ${pct1(pl)} · actual ${pct1(ac)} · ${Math.abs(d) < 0.05 ? 'on plan' : d > 0 ? `ahead ${d.toFixed(1)}%` : `behind ${(-d).toFixed(1)}%`} (${model.plan.covered} pkgs with baseline)`;
        planL.style.color = d < -0.05 ? 'var(--red, #e5484d)' : 'var(--green, #2fbf71)';
      } else planL.textContent = '';
      dl.textContent = fmt.date(model.dates[di()]);
      mp.textContent = model.manpower[di()] != null ? `${model.manpower[di()]} people on site · day ${di() + 1}/${n}` : `day ${di() + 1}/${n}`;
      if (!fromSlider) slider.value = t;
      play$.replaceChildren(icon(playing ? 'x' : 'play')); play$.setAttribute('aria-label', playing ? 'Stop' : 'Play');
      rec$.disabled = recording;
      const c = model.concerns[model.dates[di()]] || [];
      conc.replaceChildren(...(c.length ? [h('b', { class: 'dim2' }, 'Contractor concerns'), ...c.map((x) => h('p', {}, x))] : []));
    });
    const chk = (label, key, on) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; saveOpts(); on?.(); } }), label);
    const groups = ['OFFPLOT', 'ONPLOT', ''].map((a) => [a, model.pkgs.filter((p) => (p.area || '') === a && !p.summary)]).filter(([, l]) => l.length);
    const summ = model.pkgs.filter((p) => p.summary);
    shell('4D progress', `${model.dates[0].slice(5)} → ${model.dates[n - 1].slice(5)} · ${n} report days · ${model.count} activities`,
      h('div', { class: 'p4-head' }, h('div', {}, h('div', { class: 'p4-kpi-l dim2' }, 'Reported progress'), kpi), h('div', { class: 'p4-date' }, dl, mp)),
      h('div', { class: 'p4-ctl' }, play$, slider),
      sCurve(),
      planL,
      h('div', { class: 'p4-opts' },
        h('label', { class: 'p4-speed' }, 'Speed', h('select', { class: 'inp', onchange: (e) => { opts.speed = +e.target.value; saveOpts(); } }, [[1, '1 day/s'], [2, '2 days/s'], [4, '4 days/s'], [8, '8 days/s']].map(([v, l]) => h('option', { value: v, selected: v === opts.speed }, l)))),
        chk('Build the model up as progress advances', 'seq', redraw),
        chk('Start from an empty site at the first report', 'fromZero', redraw),
        chk('Camera follows the active work', 'follow'),
        chk('Show stage / operations / Gantt on screen', 'hud', () => { floatDay = -1; updateFloat(); }),
        chk('Dim the rest of the model', 'dim', redraw),
        chk('Hide not-started packages', 'hideTodo', redraw),
        chk('Slow orbit while playing', 'orbit', () => { viewer.controls.autoRotate = playing && opts.orbit; })),
      h('div', { class: 'p4-legend' }, h('span', {}, h('i', { style: { background: STATE_VAR.todo } }), 'Not started'), h('span', {}, h('i', { style: { background: STATE_VAR.wip } }), 'In progress'), h('span', {}, h('i', { style: { background: STATE_VAR.done } }), 'Complete')),
      groups.map(([a, list]) => {
        const nm = a === 'OFFPLOT' ? 'Offplot' : a === 'ONPLOT' ? 'Onplot' : 'Other';
        const avg = h('span', { class: 'mono dim2' });
        live.push(() => { avg.textContent = pct1(list.reduce((x, p) => x + pctAt(p.curve, t), 0) / list.length); });
        return h('details', { class: 'p4-grp', open: !(opts.collapsed || {})[a], ontoggle: (e) => { opts.collapsed = { ...(opts.collapsed || {}), [a]: !e.target.open }; saveOpts(); } },
          h('summary', { class: 'p4-gh' }, h('span', { class: 'p4-gn' }, nm), h('span', { class: 'dim2' }, `${list.length} pkg`), avg,
            h('button', { class: 'btn sm icon ghost', 'data-tip': `Remove ${nm} from 4D`, 'aria-label': `Remove ${nm}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); removePkgs(list.map((p) => p.id), `all ${nm} packages`); } }, icon('trash'))),
          list.map(pkgRow));
      }),
      (rec.removed || []).length ? h('button', { class: 'btn sm ghost', onclick: restoreAll }, `Restore removed (${rec.removed.length})`) : null,
      summ.length ? h('details', { class: 'p4-grp' }, h('summary', { class: 'dim2' }, `Summary rows (${summ.length}) — counted in the report, not in the overall %`), summ.map(pkgRow)) : null,
      conc,
      h('div', { class: 'btn-row' },
        rec$,
        h('button', { class: 'btn sm', onclick: importBaseline, 'data-tip': 'CSV: package, start, finish' }, icon('upload'), model.plan ? 'Replace baseline' : 'Import baseline (plan)'),
        h('button', { class: 'btn sm', onclick: () => runAutoMap(false) }, icon('target'), 'Auto-map'),
        h('button', { class: 'btn sm ghost', onclick: () => runAutoMap(!rec.autoReverse) }, 'Flip segment order'),
        h('button', { class: 'btn sm', onclick: importFiles }, icon('upload'), 'Add reports'),
        h('button', { class: 'btn sm', onclick: exportXlsx }, icon('download'), 'XLSX'),
        h('button', { class: 'btn sm ghost', onclick: clearData }, icon('trash'), 'Clear')),
      h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'Overall % is the plain average of every activity’s reported %, not a cost- or manhour-weighted progress. Map objects first (◎ assigns the current selection).'));
    updateLive();
    setT(t);
  }
  function updateLive(fromSlider = false) { for (const f of live) f(fromSlider); }

  return {
    render,
    leave() { stop(); clearVisuals(); removeFloat(); viewer.setHud(''); },
    dispose() { stop(); clearVisuals(); removeFloat(); off(); },
    get playing() { return playing; },
    init,
  };
}
