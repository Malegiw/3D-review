// 4D progress panel for the 3D review: daily reports → work-package progress → colours on the model, with a timeline.
//   import PDF/CSV  →  pick objects in 3D and assign them to a work package  →  scrub or play the timeline / record a video.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { h, icon, toast, formDialog, confirmDialog, pickFiles, download, fmt, uid, modal } from '../core/ui.js';
import { db } from '../core/db.js';
import { openPdf, closePdf } from '../engine/pdf.js';
import { linesOfPdf, parseReport, dateFromName } from '../engine/dailyreport.js';
import { buildModel, pctAt, stateOf, activitiesAt, buildProgressXlsx, reportsFromCSV, mergeReports, slimReport, DONE_AT } from '../engine/progress4d.js';
import { objectGeometry, searchObjects, objectName } from '../engine/objects.js';
import { displayName } from '../engine/groups.js';
import { baselineFromCSV } from '../engine/progress4d.js';
import { parseSchedule, scheduleToBaseline } from '../engine/schedule.js';
import { createSequence } from '../engine/sequence4d.js';
import { autoMap, routeOrder } from '../engine/automap.js';
import { reportHtml } from '../engine/report4d.js';
import { currentLang, t as tr } from '../core/i18n.js';
import { repoClient } from '../core/jobs.js';
import { toBase64 } from '../engine/github.js';
import { SYNC_DIR, syncName, pack4d, unpack4d } from '../engine/sync4d.js';

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

const PEOPLE = /\/(copy-of-)?(wo)?m[ae]n\d*\b|\/(person|people|human)\b/i;
const rupiah = (v) => (v >= 1e9 ? `Rp ${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M` : v >= 1e6 ? `Rp ${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt` : `Rp ${Math.round(v).toLocaleString('id-ID')}`);

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
    // a long object (a pipeline string kilometres long is often ONE object) is cut into ~25 m pieces along its own
    // length, so it is laid progressively instead of popping in whole
    const cum = [0], boxes = [];
    for (const x of items) {
      const pieces = splitLong(x.g);
      for (const pc of pieces) { cum.push(cum[cum.length - 1] + pc.n); boxes.push(pc.bb); }
    }
    const geo = items.length === 1 ? items[0].g : mergeGeometries(items.map((x) => x.g), false);
    if (items.length > 1) items.forEach((x) => x.g.dispose());
    const ov = new THREE.Mesh(geo, MAT_GHOST);
    ov.userData.helper = true;
    ov.raycast = () => {};
    ov.frustumCulled = false;
    mesh.add(ov);
    ov.updateWorldMatrix(true, false);
    o = { mesh, ov, geo, cum, boxes, k: 0 };
    overlays.set(id, o);
    return o;
  }
  function splitLong(g) {
    const bb = g.boundingBox, sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z, L = Math.hypot(sx, sz);
    const idx = g.index, tris = idx.count / 3;
    if (L < 40 || tris < 24) return [{ n: idx.count, bb: bb.clone() }];
    const pos = g.attributes.position, a = idx.array;
    const cx = new Float32Array(tris), cz = new Float32Array(tris), cy = new Float32Array(tris);
    for (let t = 0; t < tris; t++) {
      let X = 0, Y = 0, Z = 0;
      for (let j = 0; j < 3; j++) { const v = a[t * 3 + j]; X += pos.getX(v); Y += pos.getY(v); Z += pos.getZ(v); }
      cx[t] = X / 3; cy[t] = Y / 3; cz[t] = Z / 3;
    }
    const r = routeOrder(Array.from(cx, (x, t) => ({ x, z: cz[t] })));
    const order = Array.from(r.keys()).sort((p, q) => r[p] - r[q]);
    const out = new (a.constructor)(a.length);
    order.forEach((t, i) => { out[i * 3] = a[t * 3]; out[i * 3 + 1] = a[t * 3 + 1]; out[i * 3 + 2] = a[t * 3 + 2]; });
    idx.array.set(out); idx.needsUpdate = true;
    const pieces = Math.min(200, Math.max(2, Math.round(L / 25))), per = Math.ceil(tris / pieces), res = [];
    for (let i = 0; i < tris; i += per) {
      const e = Math.min(tris, i + per), b = new THREE.Box3();
      for (let j = i; j < e; j++) { const t = order[j]; b.expandByPoint(new THREE.Vector3(cx[t], cy[t], cz[t])); }
      res.push({ n: (e - i) * 3, bb: b });
    }
    return res;
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
  function removeFloat() { floatEl?.remove(); floatEl = null; floatDay = -1; viewer.host.classList.remove('p4-on'); }
  function updateFloat() {
    if (!model || !hasPanel() || !opts.hud) return removeFloat();
    if (!floatEl) { floatEl = h('div', { class: 'p4-float' }); viewer.host.append(floatEl); floatDay = -1; viewer.host.classList.add('p4-on'); }
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
  // ---------- panels burned into the recorded video (same content as the on-screen panels) ----------
  function paintOverlay(ctx, W, H, dpr) {
    if (!model) return;
    const s = Math.max(1, Math.min(W / 1280, H / 720) * 1.15), n = N(), di = Math.min(n - 1, Math.round(t));
    const F = (w, px) => `${w} ${Math.round(px * s)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
    const box = (x, y, w, h) => { ctx.fillStyle = 'rgba(10,14,22,0.74)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10 * s); ctx.fill(); };
    const clip = (txt, w) => { let t2 = String(txt); while (t2.length > 3 && ctx.measureText(t2).width > w) t2 = t2.slice(0, -2); return t2 === String(txt) ? t2 : t2 + '…'; };
    const pad = 14 * s;
    // title bar: project · date · progress (· plan)
    const ov = pctAt(model.overall, t);
    const plan = model.plan ? pctAt(model.plan, t) : null;
    const title = `${project.name || project.code || 'Project'}  ·  ${fmt.date(model.dates[di])}`;
    const ID = currentLang() === 'id', dv = plan != null ? pctAt(model.plan.actual, t) - plan : 0;
    const sub = ID
      ? `Progres ${pct1(ov)}${plan != null ? `  ·  rencana ${pct1(plan)}  ·  ${dv >= 0 ? 'lebih cepat' : 'terlambat'} ${Math.abs(dv).toFixed(1)}%` : ''}  ·  hari ${di + 1}/${n}`
      : `Progress ${pct1(ov)}${plan != null ? `  ·  plan ${pct1(plan)}  ·  ${dv >= 0 ? 'ahead' : 'behind'} ${Math.abs(dv).toFixed(1)}%` : ''}  ·  day ${di + 1}/${n}`;
    ctx.font = F(500, 18); const tw = Math.max(ctx.measureText(title).width, (ctx.font = F(400, 13), ctx.measureText(sub).width)) + pad * 2;
    box(pad, pad, tw, 58 * s);
    ctx.fillStyle = '#fff'; ctx.font = F(500, 18); ctx.fillText(title, pad * 2, pad + 26 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = F(400, 13); ctx.fillText(sub, pad * 2, pad + 47 * s);
    // overall bar
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(pad, pad + 62 * s, tw, 5 * s);
    ctx.fillStyle = '#2fbf71'; ctx.fillRect(pad, pad + 62 * s, tw * ov / 100, 5 * s);
    // active operations (right)
    const ops = [];
    for (const p of model.pkgs) if (!p.summary) for (const a of activitiesAt(p, di)) if (a.pct - a.was > 0.05 && !a.dropped) ops.push({ p, a, d: a.pct - a.was });
    ops.sort((x, y) => y.d - x.d);
    const lead = ops[0], ow = 330 * s, oh = (40 + Math.min(7, ops.length) * 21) * s, ox = W - ow - pad;
    box(ox, pad, ow, oh);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = F(500, 11); ctx.fillText(`${tr('Current stage')} · ${clip(lead ? lead.p.name : tr('Mobilisation'), ow - 140 * s)}`, ox + pad, pad + 22 * s);
    ops.slice(0, 7).forEach(({ a, d }, i) => {
      const y = pad + (44 + i * 21) * s;
      ctx.font = F(400, 13); ctx.fillStyle = '#fff'; ctx.fillText(clip(a.desc, ow - 90 * s), ox + pad, y);
      ctx.fillStyle = '#5fe39a'; ctx.textAlign = 'right'; ctx.fillText(`+${d.toFixed(d < 10 ? 1 : 0)}%`, ox + ow - pad, y); ctx.textAlign = 'left';
    });
    // build sequence (bottom-left)
    const sp = spans().filter(({ p, z }) => z == null ? pctAt(p.curve, t) < DONE_AT : z >= di - 1).slice(0, 8);
    if (!sp.length) return;
    const gw = Math.min(W * 0.55, 620 * s), gh = (34 + sp.length * 16) * s, gx = pad, gy = H - gh - pad, nw = 170 * s, bx = gx + pad + nw, bw = gw - pad * 2 - nw;
    box(gx, gy, gw, gh);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = F(500, 11); ctx.fillText(tr('Build sequence'), gx + pad, gy + 20 * s);
    sp.forEach(({ p, a, z }, i) => {
      const y = gy + (30 + i * 16) * s, end = z ?? n - 1;
      ctx.fillStyle = di >= a ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.font = F(400, 11); ctx.fillText(clip(p.name, nw - 8 * s), gx + pad, y + 9 * s);
      const x0 = bx + bw * a / n, w0 = Math.max(2, bw * (end - a + 1) / n);
      ctx.fillStyle = 'rgba(245,184,46,0.35)'; ctx.fillRect(x0, y, w0, 9 * s);
      ctx.fillStyle = '#2fbf71'; ctx.fillRect(x0, y, w0 * pctAt(p.curve, t) / 100, 9 * s);
    });
    ctx.fillStyle = '#ff4d8d'; ctx.fillRect(bx + bw * Math.min(t, n - 1) / Math.max(1, n - 1), gy + 26 * s, 2 * s, gh - 32 * s);
  }
  async function playRecord() {
    if (!model || N() < 2) return;
    let mime;
    try { mime = viewer.startRecording(30, { overlay: opts.hud ? paintOverlay : null }); } catch (e) { return toast(e.message, 'err'); }
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
    model = Object.keys(rec.reports).length ? buildModel(reps, { weights: rec.weights || {}, baseline: rec.baseline || {}, weighting: rec.weighting || 'count' }) : null;
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
  async function makeReport(kind = opts.repKind || 'week') {
    if (!model) return;
    stop();
    const di = Math.round(t);
    setT(di);
    const images = [];
    try {
      // frame what has been built so far on the main site (remote tie-ins and terrain left out), from the usual 3/4 angle:
      // the plant (onplot) close up, and everything built including offplot pipelines
      const site = viewer.boundsOf(null, { robust: true }).clone().expandByScalar(30);
      const all = new THREE.Box3(), xs = [], zs = [], ys = [];
      for (const o of overlays.values()) for (let i = 0; i < o.k; i++) {
        const b = o.boxes[i].clone().applyMatrix4(o.mesh.matrixWorld), c = b.getCenter(new THREE.Vector3());
        if (!site.containsPoint(c)) continue;
        all.union(b); xs.push(c.x); zs.push(c.z); ys.push(b.min.y, b.max.y);
      }
      // close-up: the central 70 % of the built objects (where the plant is), whole: everything built so far
      const q = (arr, f) => { const v = [...arr].sort((m, n) => m - n); return v[Math.min(v.length - 1, Math.max(0, Math.floor(f * (v.length - 1))))]; };
      const core = xs.length > 20 ? new THREE.Box3(new THREE.Vector3(q(xs, 0.15), q(ys, 0.02), q(zs, 0.15)), new THREE.Vector3(q(xs, 0.85), q(ys, 0.98), q(zs, 0.85))).expandByScalar(12) : null;
      const cap = `${fmt.date(model.dates[di])} · ${pct1(pctAt(model.overall, di))}`;
      const two = core && all.getSize(new THREE.Vector3()).length() > core.getSize(new THREE.Vector3()).length() * 1.6;
      const s1 = viewer.coverShot(1600, two ? 1.45 : 1.9, core || (all.isEmpty() ? null : all.clone().expandByScalar(8)));
      if (s1) images.push({ src: s1, caption: `${two ? (currentLang() === 'id' ? 'Area utama · ' : 'Main area · ') : ''}${cap}` });
      if (two) { const s2 = viewer.coverShot(1600, 1.45, all.clone().expandByScalar(10)); if (s2) images.push({ src: s2, caption: `${currentLang() === 'id' ? 'Keseluruhan' : 'Whole site'} · ${cap}` }); }
    } catch (e) { console.warn(e); }
    const html = reportHtml(model, di, {
      kind, project: project.name || project.code || '', lang: currentLang(), simulated: !!rec.demo, images, dateFmt: (d) => fmt.date(d), baselineSrc: model.plan ? rec.baselineSrc || '' : '',
    });
    const name = `Laporan-${kind === 'month' ? 'bulanan' : 'mingguan'}_${(project.code || project.name || 'proyek').replace(/[^\w-]+/g, '_')}_${model.dates[di]}.html`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) download(blob, name); // pop-up blocked: hand over the file instead
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    toast(kind === 'month' ? 'Monthly report opened. Use Print to save it as PDF.' : 'Weekly report opened. Use Print to save it as PDF.', 'ok', kind === 'month' ? 'Monthly report' : 'Weekly report');
  }
  function downloadTemplate() {
    const rows = [
      'date,area,package,package_id,hint,activity,unit,bq,progress,manpower,concern',
      '2026-09-01,ONPLOT,Pondasi tank & equipment,CIV-FDN,pondasi|pedestal,Galian pondasi,m3,380,0,22,',
      '2026-09-01,ONPLOT,Pondasi tank & equipment,CIV-FDN,pondasi|pedestal,Pengecoran K-300,m3,410,0,22,',
      '2026-09-01,ONPLOT,Tank T-0103,MEC-T0103,t-0103,Erection shell course 1-3,course,3,0,22,',
      '2026-09-01,OFFPLOT,Pipeline A - B,OFF-PL,pipeline,Welding joint,joint,420,0,22,Hujan siang hari',
      '2026-09-02,ONPLOT,Pondasi tank & equipment,CIV-FDN,pondasi|pedestal,Galian pondasi,m3,380,6.5,31,',
      '2026-09-02,ONPLOT,Pondasi tank & equipment,CIV-FDN,pondasi|pedestal,Pengecoran K-300,m3,410,0,31,',
      '2026-09-02,ONPLOT,Tank T-0103,MEC-T0103,t-0103,Erection shell course 1-3,course,3,0,31,',
      '2026-09-02,OFFPLOT,Pipeline A - B,OFF-PL,pipeline,Welding joint,joint,420,1.2,31,',
    ].join('\n');
    const base = ['package,start,finish', 'Pondasi tank & equipment,2026-09-01,2026-10-15', 'Tank T-0103,2026-10-01,2027-01-15', 'Pipeline A - B,2026-09-15,2026-12-20'].join('\n');
    download(new Blob([`\ufeff${rows}\n`], { type: 'text/csv' }), 'Template_laporan_harian_4D.csv');
    setTimeout(() => download(new Blob([`\ufeff${base}\n`], { type: 'text/csv' }), 'Template_baseline_4D.csv'), 400);
    toast('Two templates downloaded: daily report (one row per activity per day; progress is cumulative %) and baseline (package, start, finish). The hint column lists object or layer names for Auto-map, separated by |.', 'ok', 'CSV templates');
  }
  async function loadDemo() {
    const base = (p) => new URL(`samples/seruni/${p}`, document.baseURI).href;
    try {
      viewer.setHud('Loading demo data', 'Seruni Waterflood (simulated)');
      const [csv, xer] = await Promise.all(['Seruni_WF_daily_report_SIMULASI.csv', 'Seruni_WF_baseline_SIMULASI.xer'].map((f) => fetch(base(f)).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.text(); })));
      rec.reports = mergeReports(rec.reports, reportsFromCSV(csv));
      rebuild(true);
      rec.baseline = scheduleToBaseline(parseSchedule('baseline.xer', xer), model.pkgs).baseline;
      rec.baselineSrc = 'Primavera P6 (XER) · Seruni_WF_baseline_SIMULASI.xer';
      rec.weighting = 'value';
      rec.demo = true;
      await save(); clearVisuals(); rebuild(true);
      viewer.setHud('');
      toast(`Demo loaded: ${model.dates.length} days, ${model.pkgs.length} packages (SIMULATED data, not a contractor report).`, 'ok', '4D demo');
      if (viewer.layers.size) await runAutoMap(false); else refresh();
    } catch (e) { viewer.setHud(''); toast(e.message, 'err', 'Demo data'); }
  }
  async function exportXlsx() {
    if (!model) return;
    download(buildProgressXlsx(model, { project: project.name }), `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_progress_${fmt.today()}.xlsx`);
  }
  async function clearData() {
    if (!(await confirmDialog('Remove all imported reports and the object mapping of this project?', { title: 'Clear 4D data', okLabel: 'Clear', danger: true }))) return;
    stop(); clearVisuals();
    rec.reports = {}; rec.map = {}; rec.baseline = {}; rec.weights = {}; rec.removed = []; rec.demo = false; rec.weighting = 'count'; rec.baselineSrc = '';
    await save();
    rebuild();
    refresh();
  }

  // ---------- mapping ----------
  // baseline: Primavera P6 (.xer), Microsoft Project (.xml, MSPDI) at activity level, or a simple CSV per package
  async function importBaseline() {
    const [f] = await pickFiles({ accept: '.xer,.xml,.csv,.txt' });
    if (!f) return;
    const text = await f.text();
    try {
      const sch = parseSchedule(f.name, text);
      if (sch) {
        const r = scheduleToBaseline(sch, model.pkgs);
        if (!r.packages) return toast(`No package or activity in ${sch.source} matched the daily reports. Activity names or WBS names must match the report.`, 'warn', 'Baseline');
        rec.baseline = r.baseline; rec.baselineSrc = `${sch.source} · ${f.name}`;
        await save(); rebuild(); render();
        return toast(`${sch.source}: ${r.packages} packages and ${r.matchedActs} of ${r.totalActs} activities matched.`, 'ok', 'Baseline');
      }
    } catch (e) { return toast(e.message, 'err', 'Baseline'); }
    const { baseline, missing } = baselineFromCSV(text, model.pkgs);
    const n = Object.keys(baseline).length;
    if (!n) return toast('No rows matched. Use columns: package, start, finish (package = name or id).', 'warn', 'Baseline');
    rec.baseline = baseline; rec.baselineSrc = `CSV · ${f.name}`; await save(); rebuild(); render();
    toast(`${n} packages have a plan${missing.length ? ` · ${missing.length} rows not matched` : ''}.`, 'ok', 'Baseline');
  }
  // ---------- 4D data on GitHub (same data on every device and for the team) ----------
  async function syncClient() {
    const gh = await repoClient();
    if (!gh) { toast('Connect GitHub first: Settings, then Converter (repository and token). The 4D data is stored in that repository.', 'warn', 'GitHub'); return null; }
    return gh;
  }
  async function saveToGitHub() {
    const gh = await syncClient(); if (!gh) return;
    try {
      const info = await gh.info();
      const path = `${SYNC_DIR}/${syncName(project)}`;
      if (!info.private && !rec.publicOk) {
        const ok = await confirmDialog(`${gh.slug} is a public repository, so anyone with the link can read the 4D data (reports, baseline, weights). Save it there anyway?`, { title: 'Save 4D data to GitHub', okLabel: 'Save to public repository' });
        if (!ok) return;
        rec.publicOk = true; await save();
      }
      viewer.setHud('Saving 4D data to GitHub', path);
      const bytes = await pack4d(rec, project);
      await gh.putFile(path, toBase64(bytes), `4D data: ${project.name || project.code || 'project'} (${Object.keys(rec.reports).length} reports)`);
      rec.syncedAt = new Date().toISOString(); rec.syncPath = path; await save();
      viewer.setHud('');
      toast(`Saved to ${gh.slug}/${path} (${(bytes.length / 1024).toFixed(0)} KB). Open this project on another device and use Load from GitHub.`, 'ok', 'GitHub');
      render();
    } catch (e) { viewer.setHud(''); toast(e.message, 'err', 'GitHub'); }
  }
  async function loadFromGitHub() {
    const gh = await syncClient(); if (!gh) return;
    try {
      const files = (await gh.listDir(SYNC_DIR)).filter((f) => /\.4d\.json(\.gz)?$/.test(f.name));
      if (!files.length) return toast(`No 4D data in ${gh.slug}/${SYNC_DIR} yet. Save it from the device that has the reports.`, 'info', 'GitHub');
      const mine = syncName(project);
      let pick = files.find((f) => f.name === mine)?.name;
      if (!pick) {
        pick = await new Promise((resolve) => {
          let dlg = null;
          dlg = modal({
            title: 'Load 4D data from GitHub', body: h('div', { class: 'p4-pick' }, files.map((f) => h('button', { class: 'btn', type: 'button', onclick: () => dlg?.close(f.name) }, icon('download'), `${f.name.replace(/\.4d\.json(\.gz)?$/, '')} · ${(f.size / 1024).toFixed(0)} KB`))),
            actions: [{ label: 'Cancel', value: null }], onClose: (v) => resolve(v || null),
          });
        });
        if (!pick) return;
      }
      viewer.setHud('Loading 4D data from GitHub', pick);
      const { fields, saved } = await unpack4d(await gh.download(`${SYNC_DIR}/${pick}`));
      if (Object.keys(rec.reports || {}).length && !(await confirmDialog(`Replace the 4D data on this device with ${pick} (saved ${fmt.date(saved?.slice(0, 10))})?`, { title: 'Load 4D data', okLabel: 'Replace' }))) { viewer.setHud(''); return; }
      clearVisuals();
      for (const k of ['reports', 'baseline', 'baselineSrc', 'weights', 'weighting', 'removed', 'map', 'demo']) rec[k] = fields[k] ?? (k === 'reports' || k === 'baseline' || k === 'weights' || k === 'map' ? {} : k === 'removed' ? [] : rec[k]);
      rec.syncedAt = saved; rec.syncPath = `${SYNC_DIR}/${pick}`;
      await save(); rebuild(true);
      viewer.setHud('');
      // object keys differ between devices, so the mapping is redone by name when the stored one does not fit this model
      const fits = Object.values(rec.map || {}).flat().some((tg) => index().has(tg.key));
      if (viewer.layers.size && !fits) await runAutoMap(!!rec.autoReverse); else { redraw(); render(); }
      toast(`Loaded ${Object.keys(rec.reports).length} reports from ${gh.slug}.`, 'ok', 'GitHub');
    } catch (e) { viewer.setHud(''); toast(e.message, 'err', 'GitHub'); }
  }
  async function setWeighting(w) { rec.weighting = w; await save(); rebuild(); render(); }
  async function setWeight(p, v) {
    rec.weights = { ...(rec.weights || {}) };
    if (v > 0) rec.weights[p.id] = v; else delete rec.weights[p.id];
    await save(); rebuild(); render();
  }
  // terrain, site pads and ROW strips: big flat surfaces that would paint the whole screen — context, not built work
  function isGround(mesh, k) {
    const { start } = mesh.userData.objs, idx = mesh.geometry.index.array, pos = mesh.geometry.attributes.position;
    let y0 = Infinity, y1 = -Infinity, flat = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = start[k] * 3, e = start[k + 1] * 3; i < e; i += 3) {
      A.fromBufferAttribute(pos, idx[i]); B.fromBufferAttribute(pos, idx[i + 1]); C.fromBufferAttribute(pos, idx[i + 2]);
      y0 = Math.min(y0, A.y, B.y, C.y); y1 = Math.max(y1, A.y, B.y, C.y);
      n.subVectors(B, A).cross(C.clone().sub(A));
      const area = n.length() / 2;
      if (area > 0 && Math.abs(n.y) / (2 * area) > 0.9) flat += area;
    }
    const sc = mesh.matrixWorld.getMaxScaleOnAxis();
    return flat * sc * sc > 2 * 1500 && (y1 - y0) * sc < 3; // both faces of a slab count, hence 2 ×
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
    // two passes: specific hints first, then fall-back terms written as *term (whatever is left in a layer)
    const hits = new Map();
    for (const pass of [0, 1]) for (const p of model.pkgs) {
      if (!p.hint) continue;
      const found = hits.get(p.id) || [];
      for (let q of p.hint.split('|').map((x) => x.trim()).filter(Boolean)) {
        if (q.startsWith('*') !== (pass === 1)) continue;
        q = q.replace(/^\*/, '');
        for (const it of searchObjects(blocks, q, 50000).items) {
          const o = it.mesh.userData.objs;
          if (/existing/i.test(o.table.layers[o.ly[it.k]] || '')) continue; // what is already there is not built
          const id = `${it.mesh.userData.key}|${it.k}`;
          if (taken.has(id)) continue;
          taken.add(id);
          if (isGround(it.mesh, it.k)) continue; // terrain / site pad: context, not something that gets built
          if (PEOPLE.test(objectName(o, it.k))) continue; // scale figures placed in the model
          found.push({ key: it.mesh.userData.key, k: it.k });
        }
        if (pass === 0) for (const m of viewer.meshes({ visibleOnly: false })) if (!m.userData.objs && !m.userData.ground && displayName(m).toLowerCase().includes(q.toLowerCase()) && !taken.has(m.userData.key)) { taken.add(m.userData.key); found.push({ key: m.userData.key }); }
      }
      if (found.length) hits.set(p.id, found);
    }
    for (const [id, found] of hits) { map[id] = found; byHint++; }
    if (byHint) notes.push(`${byHint} packages matched by name`);
    const ids = Object.keys(map);
    if (!ids.length) return toast('Nothing recognised in this model.', 'warn', 'Auto-map');
    for (const id of ids) rec.map[id] = map[id];
    rec.autoReverse = reverse;
    await save(); seqReady = false; redraw(); render();
    const segs = notes.some((x) => /header segments/.test(x));
    toast(`${notes.join(' · ')}.${segs ? ' Check the order of segments; flip it if segment 1 is at the other end.' : ''}`, 'ok', 'Auto-mapped');
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
  // S-curve with a crosshair readout; tap or drag to jump the timeline there (line chart pattern)
  function curveChart({ actual, plan = null, mp = null, W = 350, H = 96, label = 'Overall progress', jump = true }) {
    const P = 4, n = N();
    const xs = (i) => P + ((W - 2 * P) * i) / Math.max(1, n - 1), ys = (v) => H - P - ((H - 2 * P) * v) / 100;
    const pts = Array.from(actual, (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`);
    const cur = h('line', { svg: true, y1: P, y2: H - P, class: 'p4-cur' });
    const dot = h('circle', { svg: true, r: 4, class: 'p4-dotc' });
    const hx = h('line', { svg: true, y1: P, y2: H - P, class: 'p4-hx' });
    const tip = h('div', { class: 'ch-tip p4-tip', hidden: true });
    const move = () => {
      const x = xs(t), y = ys(pctAt(actual, t));
      cur.setAttribute('x1', x); cur.setAttribute('x2', x); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    };
    live.push(move); move();
    const mpMax = mp ? Math.max(0, ...mp.filter((v) => v != null)) : 0;
    const bw = Math.max(0.6, (W - 2 * P) / n - 0.4);
    const bars = mpMax ? mp.map((v, i) => (v == null ? null : h('rect', { svg: true, x: (xs(i) - bw / 2).toFixed(1), y: (H - P - (H - 2 * P) * 0.32 * v / mpMax).toFixed(1), width: bw.toFixed(1), height: ((H - 2 * P) * 0.32 * v / mpMax).toFixed(1), class: 'p4-mp' }))) : [];
    const svg = h('svg', { svg: true, class: 'p4-curve', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
      bars,
      [0, 50, 100].map((g) => h('line', { svg: true, x1: P, x2: W - P, y1: ys(g), y2: ys(g), class: 'p4-grid' })),
      h('polygon', { svg: true, points: `${xs(0)},${ys(0)} ${pts.join(' ')} ${xs(n - 1)},${ys(0)}`, class: 'p4-area' }),
      h('polyline', { svg: true, points: pts.join(' '), class: 'p4-act' }),
      plan ? h('polyline', { svg: true, points: Array.from(plan, (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' '), class: 'p4-planl' }) : null,
      hx, cur, dot);
    const wrap = h('div', { class: 'p4-chart', tabindex: 0, role: 'slider', 'aria-label': label, 'aria-valuemin': 1, 'aria-valuemax': n }, svg, tip);
    const idxAt = (e) => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width * W - P) / (W - 2 * P) * (n - 1)))); };
    const show = (i) => {
      const x = xs(i);
      hx.setAttribute('x1', x); hx.setAttribute('x2', x); hx.style.opacity = 1;
      tip.hidden = false;
      tip.replaceChildren(
        h('div', { class: 'ch-tip-h' }, fmt.date(model.dates[i])),
        h('div', { class: 'ch-tip-r' }, h('i', { class: 'k act' }), h('b', {}, pct1(actual[i])), h('span', {}, 'Actual')),
        plan ? h('div', { class: 'ch-tip-r' }, h('i', { class: 'k plan' }), h('b', {}, pct1(plan[i])), h('span', {}, 'Planned')) : null,
        mp && mp[i] != null ? h('div', { class: 'ch-tip-r' }, h('i', { class: 'k mp' }), h('b', {}, String(mp[i])), h('span', {}, 'people on site')) : null);
      const left = (x / W) * wrap.clientWidth;
      tip.style.left = `${Math.max(0, Math.min(wrap.clientWidth - tip.offsetWidth, left + (left > wrap.clientWidth / 2 ? -tip.offsetWidth - 10 : 10)))}px`;
    };
    const hide = () => { tip.hidden = true; hx.style.opacity = 0; };
    let drag = false;
    wrap.addEventListener('pointermove', (e) => { const i = idxAt(e); show(i); if (drag && jump) { stop(); setT(i); } });
    wrap.addEventListener('pointerleave', () => { if (!drag) hide(); });
    wrap.addEventListener('pointerdown', (e) => { if (!jump) return; drag = true; wrap.setPointerCapture(e.pointerId); stop(); setT(idxAt(e)); });
    wrap.addEventListener('pointerup', () => { drag = false; });
    wrap.addEventListener('keydown', (e) => {
      if (!jump || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); stop();
      const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, Math.round(t) + (e.key === 'ArrowRight' ? 1 : -1)));
      setT(i); show(i);
    });
    wrap.addEventListener('blur', hide);
    return wrap;
  }
  function sCurve() { return curveChart({ actual: model.overall, plan: model.plan, mp: model.manpower, H: 96 }); }
  // tiny trend for a package row (sparkline): actual up to today, plan dashed
  function spark(p) {
    const W = 64, H = 18, n = N();
    const xs = (i) => 1 + ((W - 2) * i) / Math.max(1, n - 1), ys = (v) => H - 1 - ((H - 2) * v) / 100;
    const act = h('polyline', { svg: true, class: 'p4-sp-a' });
    const upd = () => { const k = Math.min(n - 1, Math.round(t)); act.setAttribute('points', Array.from(p.curve.slice(0, k + 1), (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ')); };
    live.push(upd); upd();
    return h('svg', { svg: true, class: 'p4-spark', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' },
      p.plan ? h('polyline', { svg: true, class: 'p4-sp-p', points: Array.from(p.plan, (v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ') }) : null, act);
  }
  // daily progress calendar (heat calendar): one cell per day, weeks as columns; tap a day to jump there
  function heatCalendar() {
    const D = model.dates, n = D.length, day = 864e5;
    const t0 = Date.parse(`${D[0]}T00:00:00Z`), t1 = Date.parse(`${D[n - 1]}T00:00:00Z`);
    const dow0 = (new Date(t0).getUTCDay() + 6) % 7;
    const gains = D.map((d, i) => model.overall[i] - (i ? model.overall[i - 1] : 0));
    const max = Math.max(0.1, ...gains);
    const idx = new Map(D.map((d, i) => [d, i]));
    const cells = [];
    const weeks = Math.ceil((dow0 + (t1 - t0) / day + 1) / 7);
    const grid = h('div', { class: 'p4-hc-grid', style: { gridTemplateColumns: `repeat(${weeks}, 1fr)` } });
    for (let w = 0; w < weeks; w++) for (let r = 0; r < 7; r++) {
      const k = w * 7 + r - dow0, tt = t0 + k * day, d = new Date(tt).toISOString().slice(0, 10), i = idx.get(d);
      if (k < 0 || tt > t1) { grid.append(h('i', { class: 'p4-hc pad', style: { gridColumn: w + 1, gridRow: r + 1 } })); continue; }
      const g = i == null ? null : gains[i];
      const c = h('button', {
        class: `p4-hc${(model.concerns[d] || []).length ? ' issue' : ''}`, style: { gridColumn: w + 1, gridRow: r + 1, '--a': g == null ? 0 : (0.14 + 0.86 * Math.min(1, g / max)).toFixed(2) },
        'aria-label': `${fmt.date(d)} · ${g == null ? 'no report' : `+${g.toFixed(1)}%`}`, 'data-tip': `${fmt.date(d)} · ${g == null ? 'no report' : `+${g.toFixed(1)}%`}`,
        onclick: () => { if (i != null) { stop(); setT(i); } },
      });
      if (i != null) cells[i] = c;
      grid.append(c);
    }
    let on = null;
    live.push(() => { const c = cells[Math.round(t)]; if (c === on) return; on?.classList.remove('on'); c?.classList.add('on'); on = c; });
    return h('details', { class: 'p4-hcal', open: !!opts.calOpen, ontoggle: (e) => { opts.calOpen = e.target.open; saveOpts(); } },
      h('summary', { class: 'p4-gh' }, h('span', { class: 'p4-gn' }, 'Daily progress calendar'), h('span', { class: 'dim2' }, `max +${max.toFixed(1)}%/day`)),
      grid,
      h('div', { class: 'p4-legend' }, h('span', {}, h('i', { class: 'p4-hc-k', style: { '--a': 0.2 } }), 'Small gain'), h('span', {}, h('i', { class: 'p4-hc-k', style: { '--a': 1 } }), 'Large gain'), h('span', {}, h('i', { class: 'p4-hc-k issue' }), 'Issue logged')));
  }
  // markers above the timeline: days with contractor concerns
  function issueMarks() {
    const n = N(), D = model.dates;
    const box = h('div', { class: 'p4-marks', 'aria-hidden': 'true' });
    const seen = new Set();
    D.forEach((d, i) => {
      const fresh = (model.concerns[d] || []).filter((x) => !seen.has(x)); // mark the day an issue is first reported
      fresh.forEach((x) => seen.add(x));
      if (!fresh.length) return;
      box.append(h('i', { class: 'p4-mark', style: { left: `${(i / Math.max(1, n - 1)) * 100}%` }, 'data-tip': `${fmt.date(d)}: ${fresh[0]}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}` }));
    });
    return box;
  }
  function pkgRow(p) {
    const n = targets(p.id).length;
    const bar = h('i'), val = h('b', { class: 'mono' }), dot = h('span', { class: 'p4-dot' });
    const mark = p.plan ? h('u', { class: 'p4-planmark' }) : null, devL = p.plan ? h('span', { class: 'mono p4-dev' }) : null;
    const upd = () => {
      const v = pctAt(p.curve, t), st = stateOf(v);
      bar.style.width = `${v}%`; bar.style.background = STATE_VAR[st];
      dot.style.background = STATE_VAR[st];
      val.textContent = pct1(v);
      if (mark) {
        const pl = pctAt(p.plan, t), d = v - pl;
        mark.style.left = `${pl}%`;
        devL.textContent = `plan ${pct1(pl)} · ${Math.abs(d) < 1 ? 'on plan' : d > 0 ? `+${d.toFixed(1)}%` : `${d.toFixed(1)}%`}`;
        devL.style.color = d < -1 ? 'var(--red, #e5484d)' : d > 1 ? 'var(--green, #2fbf71)' : '';
      }
    };
    live.push(upd); upd();
    const acts = h('div', { class: 'p4-acts' });
    const chartHost = h('div', { class: 'p4-pchart' });
    const fill = () => {
      if (!chartHost.firstChild) chartHost.append(curveChart({ actual: p.curve, plan: p.plan, H: 70, label: `${p.name} progress` }));
      acts.replaceChildren(...activitiesAt(p, Math.round(t)).map((a) => h('div', { class: 'p4-act' },
        h('span', { class: 'p4-an' }, a.desc),
        h('span', { class: 'mono dim2' }, `${fmt.num(a.bq, a.bq % 1 ? 1 : 0)} ${a.unit}`),
        h('b', { class: 'mono', style: { color: a.pct >= DONE_AT ? 'var(--green, #2fbf71)' : 'var(--fg-1)' } }, `${Math.round(a.pct)}%`))));
    };
    const btn = (ic, tip, fn) => h('button', { class: 'btn sm icon ghost', 'data-tip': tip, 'aria-label': tip, onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } }, icon(ic));
    return h('details', { class: `p4-pkg ${n ? 'mapped' : ''}`, ontoggle: (e) => { if (e.target.open) fill(); } },
      h('summary', {},
        h('div', { class: 'p4-top' }, dot, h('span', { class: 'p4-name' }, p.name), spark(p), val),
        h('div', { class: 'progress p4-bar' }, bar, mark),
        devL,
        h('div', { class: 'p4-sub' },
          h('span', { class: 'dim2' }, n ? `${fmt.int(n)} object${n > 1 ? 's' : ''} mapped` : 'Not mapped · tap ◎ to assign the selection'),
          h('span', { class: 'p4-tools' },
            btn('target', 'Assign selected objects', () => assignSelection(p)),
            btn('search', 'Assign by name', () => assignByName(p, p.hint)),
            btn('focus', 'Zoom to package', () => zoom(p)),
            n ? btn('x', 'Clear mapping', () => unassign(p)) : null,
            btn('trash', 'Remove package from 4D', () => removePkgs([p.id], `“${p.name}”`))))),
      h('label', { class: 'p4-w' }, h('span', { class: 'dim2' }, 'Weight'),
        h('input', { type: 'number', min: 0, step: 'any', placeholder: model.weighting === 'value' ? String(Math.round(p.value || 0)) : String(p.acts.length), value: rec.weights?.[p.id] ?? '', 'aria-label': `Weight of ${p.name}`, onchange: (e) => setWeight(p, +e.target.value) }),
        h('span', { class: 'dim2' }, rec.weights?.[p.id] ? 'custom' : model.weighting === 'value' ? 'default = contract value' : 'default = activity count'),
        p.value ? h('span', { class: 'mono dim2 p4-val' }, rupiah(p.value)) : null),
      chartHost,
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
        h('button', { class: 'btn', style: { width: '100%' }, onclick: loadDemo }, icon('film'), 'Load demo: Seruni WF (simulated)'),
        h('button', { class: 'btn ghost', style: { width: '100%' }, onclick: loadFromGitHub }, icon('download'), 'Load from GitHub'),
        h('button', { class: 'btn ghost', style: { width: '100%' }, onclick: downloadTemplate }, icon('download'), 'Download CSV templates'),
        h('p', { class: 'dim2', style: { margin: 0, fontSize: '12px' } }, 'Everything stays on this device. CSV columns: date, package, activity, unit, bq, progress (cumulative %), with optional area, package_id, hint, manpower and concern.'));
      return;
    }
    const n = N(), di = () => Math.round(t);
    // headline numbers (stats band): values update with the timeline, digits are tabular so nothing shifts
    const sv = {}, sn = {};
    const stat = (key, label, tone = '') => h('div', { class: `stat ${tone}`, 'data-k': key }, h('span', { class: 'stat-l' }, label), (sv[key] = h('b', { class: 'stat-v' }, '·')), (sn[key] = h('small', { class: 'stat-n' })));
    const stats = h('div', { class: 'stats p4-stats' },
      stat('act', 'Actual'), model.plan ? stat('plan', 'Planned') : null, model.plan ? stat('dev', 'Deviation') : null, stat('mp', 'Manpower'));
    const dl = h('b', {}), dayL = h('span', { class: 'dim2 mono' });
    const slider = h('input', { type: 'range', class: 'p4-slider', min: 0, max: n - 1, step: 0.01, value: t, 'aria-label': 'Report day', oninput: (e) => { const v = +e.target.value; stop(); setT(v, { fromSlider: true }); e.target.value = v; } });
    const play$ = h('button', { class: 'btn primary icon', 'aria-label': 'Play', onclick: () => (playing ? stop() : play()) });
    const rec$ = h('button', { class: 'btn sm mag', onclick: playRecord }, h('span', { class: 'rec-dot' }), 'Play & record');
    const conc = h('div', { class: 'p4-conc' });
    const seg = (label, key, list, on) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, list.map(([v, l]) => h('button', { class: opts[key] === v ? 'on' : '', 'aria-pressed': String(opts[key] === v), onclick: (e) => {
      opts[key] = v; saveOpts();
      for (const b of e.currentTarget.parentElement.querySelectorAll('button')) { const sel = b === e.currentTarget; b.classList.toggle('on', sel); b.setAttribute('aria-pressed', String(sel)); }
      on?.();
    } }, l)));
    if (!opts.repKind) opts.repKind = 'week';
    const repLbl = h('span');
    const repBtn = h('button', { class: 'btn primary p4-rep', onclick: () => makeReport(opts.repKind) }, icon('docs'), repLbl);
    const repLabel = () => {
      const d = model.dates[di()];
      repLbl.textContent = opts.repKind === 'month' ? `Monthly report · ${fmt.date(d).replace(/^\d+\s*/, '')}` : `Weekly report · week ${Math.floor((Date.parse(d) - Date.parse(model.dates[0])) / 6048e5) + 1}`;
    };
    live.push(repLabel);
    live.push((fromSlider) => {
      const a = pctAt(model.overall, t), i = di();
      sv.act.textContent = pct1(a);
      const prev = model.dates.findIndex((d) => d > new Date(Date.parse(model.dates[i]) - 7 * 864e5).toISOString().slice(0, 10));
      sn.act.textContent = `+${(a - (prev > 0 ? model.overall[prev - 1] : 0)).toFixed(1)}% in 7 days`;
      if (model.plan) {
        const pl = pctAt(model.plan, t), ac = pctAt(model.plan.actual, t), d = ac - pl;
        sv.plan.textContent = pct1(pl); sn.plan.textContent = `${model.plan.covered} pkgs with baseline`;
        sv.dev.textContent = `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;
        sn.dev.textContent = pl > 0.5 ? `SPI ${(ac / pl).toFixed(2)}` : 'SPI ·';
        sv.dev.parentElement.className = `stat ${d < -1 ? 'bad' : d > 1 ? 'good' : ''}`;
      }
      const m = model.manpower[i];
      sv.mp.textContent = m != null ? String(m) : '·'; sn.mp.textContent = 'people on site';
      dl.textContent = fmt.date(model.dates[i]);
      dayL.textContent = `day ${i + 1}/${n}`;
      if (!fromSlider) slider.value = t;
      play$.replaceChildren(icon(playing ? 'x' : 'play')); play$.setAttribute('aria-label', playing ? 'Stop' : 'Play');
      rec$.disabled = recording;
      const c = model.concerns[model.dates[i]] || [];
      conc.replaceChildren(...(c.length ? [h('b', { class: 'dim2' }, 'Contractor concerns'), ...c.map((x) => h('p', {}, x))] : []));
    });
    const chk = (label, key, on) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; saveOpts(); on?.(); } }), label);
    const groups = ['OFFPLOT', 'ONPLOT', ''].map((a) => [a, model.pkgs.filter((p) => (p.area || '') === a && !p.summary)]).filter(([, l]) => l.length);
    const summ = model.pkgs.filter((p) => p.summary);
    shell('4D progress', `${model.dates[0].slice(5)} → ${model.dates[n - 1].slice(5)} · ${n} report days · ${model.count} activities${model.hasValue ? ` · ${rupiah(model.totalValue)}` : ''}`,
      stats,
      model.hasValue ? h('div', { class: 'p4-wt' }, h('span', { class: 'dim2' }, 'Progress weighted by'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Progress weighting' }, [['count', 'Activities'], ['value', 'Contract value']].map(([v, l]) => h('button', { class: (rec.weighting || 'count') === v ? 'on' : '', 'aria-pressed': String((rec.weighting || 'count') === v), onclick: () => setWeighting(v) }, l)))) : null,
      model.plan && rec.baselineSrc ? h('p', { class: 'dim2 p4-src' }, `Baseline: ${rec.baselineSrc}`) : null,
      h('div', { class: 'p4-when' }, dl, dayL),
      h('div', { class: 'p4-ctl' }, play$, h('div', { class: 'p4-track' }, issueMarks(), slider)),
      sCurve(),
      h('div', { class: 'p4-legend p4-clegend' }, h('span', {}, h('i', { class: 'k act' }), 'Actual'), model.plan ? h('span', {}, h('i', { class: 'k plan' }), 'Planned') : null, h('span', {}, h('i', { class: 'k mp' }), 'Manpower'), h('span', {}, h('i', { class: 'p4-mark-k' }), 'Issue')),
      heatCalendar(),
      h('div', { class: 'p4-repbox' },
        seg('Report period', 'repKind', [['week', 'Weekly'], ['month', 'Monthly']], repLabel),
        repBtn),
      h('div', { class: 'p4-opts' },
        h('div', { class: 'p4-speed' }, h('span', {}, 'Speed (days per second)'), seg('Speed', 'speed', [[1, '1'], [2, '2'], [4, '4'], [8, '8'], [16, '16']])),
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
      summ.length ? h('details', { class: 'p4-grp' }, h('summary', { class: 'dim2' }, `Summary rows (${summ.length}), shown in the report but not counted in the overall %`), summ.map(pkgRow)) : null,
      conc,
      h('div', { class: 'p4-sync' },
        h('div', {}, h('b', {}, 'GitHub'), h('span', { class: 'dim2' }, rec.syncedAt ? `Saved ${fmt.date(String(rec.syncedAt).slice(0, 10))} · ${rec.syncPath || ''}` : 'Not saved yet. Save to use the same data on other devices.')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: saveToGitHub }, icon('upload'), 'Save to GitHub'),
          h('button', { class: 'btn sm ghost', onclick: loadFromGitHub }, icon('download'), 'Load from GitHub'))),
      h('div', { class: 'btn-row' },
        rec$,
        h('button', { class: 'btn sm', onclick: importBaseline, 'data-tip': 'Primavera P6 .xer, MS Project .xml or CSV (package, start, finish)' }, icon('upload'), model.plan ? 'Replace baseline' : 'Import baseline (plan)'),
        h('button', { class: 'btn sm', onclick: () => runAutoMap(false) }, icon('target'), 'Auto-map'),
        model.pkgs.some((p) => /^HDR-S\d+$/.test(p.id)) ? h('button', { class: 'btn sm ghost', onclick: () => runAutoMap(!rec.autoReverse) }, 'Flip segment order') : null,
        h('button', { class: 'btn sm', onclick: importFiles }, icon('upload'), 'Add reports'),
        h('button', { class: 'btn sm', onclick: exportXlsx }, icon('download'), 'XLSX'),
        h('button', { class: 'btn sm ghost', onclick: downloadTemplate }, icon('download'), 'CSV templates'),
        h('button', { class: 'btn sm ghost', onclick: clearData }, icon('trash'), 'Clear')),
      h('p', { class: 'dim2', style: { margin: 0, fontSize: '12px' } }, 'Overall % is weighted by package weight (default: number of activities; set a weight in each package). Auto-map links packages to objects by name; ◎ assigns the current selection.'));
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
