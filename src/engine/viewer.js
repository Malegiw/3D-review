// NEXUS 3D viewer engine — federated model review (Navisworks-style) on Three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { h } from '../core/ui.js';
import { meshVolumeArea } from './mto.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAT_SEL = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00a8c0, emissiveIntensity: 0.9, metalness: 0.1, roughness: 0.35 });
const MAT_A = new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0xff1040, emissiveIntensity: 0.7, roughness: 0.4 });
const MAT_B = new THREE.MeshStandardMaterial({ color: 0x3dff9a, emissive: 0x10c060, emissiveIntensity: 0.6, roughness: 0.4 });
const MAT_XRAY = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.05, depthWrite: false });
const MAT_DEFAULT = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, metalness: 0.25, roughness: 0.65 });
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

export class Viewer {
  constructor() {
    this.host = h('div', { class: 'viewer-host' });
    this.labelsEl = h('div', { class: 'v-labels' });
    this.hudEl = h('div', { class: 'v-hud', style: { opacity: 0 } });
    this.cornerEl = h('div', { class: 'v-corner' });
    this.host.append(this.labelsEl, this.hudEl, this.cornerEl);

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x05040a, 1);
    r.localClippingEnabled = false;
    this.host.prepend(r.domElement);

    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 20000);
    this.camera.position.set(60, 50, 60);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xbfe9ff, 0x2a1038, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    this.headlight = new THREE.DirectionalLight(0xffffff, 0.7);
    this.camera.add(this.headlight);
    this.headlight.position.set(0, 0, 1);
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.world = new THREE.Group();
    this.root.add(this.world);
    this.scene.add(this.root);
    this.fx = new THREE.Group(); // measurements, section box, effects
    this.scene.add(this.fx);
    this.grid = new THREE.Group();
    this.scene.add(this.grid);

    this.layers = new Map();
    this.selected = null;
    this.mode = 'select';
    this.xray = false;
    this.overrides = new Map();
    this.labels = [];
    this.measures = [];
    this.pendingPt = null;
    this.tickers = new Set();
    this.listeners = {};
    this.section = { on: false, box: new THREE.Box3(), helper: null };
    this.clipPlanes = Array.from({ length: 6 }, () => new THREE.Plane());
    this.raycaster = new THREE.Raycaster();
    this._dirty = true;
    this._force = 0;
    this._timer = new THREE.Timer();

    this._bindPointer();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.host);
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this.buildGrid(200);
  }

  on(type, fn) { (this.listeners[type] ||= new Set()).add(fn); return () => this.listeners[type].delete(fn); }
  emit(type, data) { this.listeners[type]?.forEach((fn) => fn(data)); }
  requestRender() { this._dirty = true; }

  mount(parent) { parent.append(this.host); this.resize(); this.requestRender(); }
  resize() {
    const w = this.host.clientWidth || 1, hh = this.host.clientHeight || 1;
    this.renderer.setSize(w, hh, false);
    this.camera.aspect = w / hh;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  _loop(ts) {
    this._raf = requestAnimationFrame(this._loop);
    this._timer.update(ts);
    const dt = Math.min(this._timer.getDelta(), 0.1);
    if (this.tickers.size) {
      for (const fn of [...this.tickers]) { if (fn(dt) === false) this.tickers.delete(fn); }
      this._dirty = true;
    }
    this.controls.update();
    if (this._dirty || this._force > 0) {
      this._dirty = false;
      this.renderer.render(this.scene, this.camera);
      this._updateLabels();
    }
  }
  addTicker(fn) { this.tickers.add(fn); this.requestRender(); return () => this.tickers.delete(fn); }

  // ---------- layers ----------
  addLayer({ id, name, kind = 'import', object, units = 1, zUp = false, transform = {} }) {
    this.removeLayer(id);
    const wrap = new THREE.Group();
    const inner = new THREE.Group();
    wrap.name = name;
    wrap.add(inner);
    inner.add(object);
    this.world.add(wrap);
    const meshes = [];
    let i = 0;
    object.updateMatrixWorld(true);
    object.traverse((o) => {
      if (!o.isMesh || o.userData.helper) return;
      const g = o.geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!o.material) o.material = MAT_DEFAULT;
      if (!o.isInstancedMesh && !g.boundsTree && g.attributes.position.count > 2) {
        try { g.computeBoundsTree(); } catch (e) { console.warn('BVH failed', o.name, e); }
      }
      o.userData.layerId = id;
      o.userData.key = `${id}:${i}`;
      o.userData.baseMat = o.material;
      if (!o.name) o.name = o.parent?.name ? `${o.parent.name}` : `${kind.toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
      meshes.push(o);
      i++;
    });
    const layer = { id, name, kind, wrap, inner, object, meshes, visible: true, units, zUp, transform: { dx: 0, dy: 0, dz: 0, rotY: 0, ...transform } };
    this.layers.set(id, layer);
    this.applyLayerTransform(id);
    this.emit('layers');
    this.requestRender();
    return layer;
  }

  applyLayerTransform(id, patch) {
    const L = this.layers.get(id);
    if (!L) return;
    if (patch) Object.assign(L, patch);
    L.inner.scale.setScalar(L.units || 1);
    L.inner.rotation.set(L.zUp ? -Math.PI / 2 : 0, 0, 0);
    const t = L.transform;
    L.wrap.position.set(t.dx || 0, t.dy || 0, t.dz || 0);
    L.wrap.rotation.set(0, THREE.MathUtils.degToRad(t.rotY || 0), 0);
    L.wrap.updateMatrixWorld(true);
    this.requestRender();
  }

  removeLayer(id) {
    const L = this.layers.get(id);
    if (!L) return;
    if (this.selected && this.selected.userData.layerId === id) this.select(null);
    this.world.remove(L.wrap);
    L.wrap.traverse((o) => {
      if (o.geometry) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); }
      const ms = Array.isArray(o.userData.baseMat || o.material) ? (o.userData.baseMat || o.material) : [o.userData.baseMat || o.material];
      ms.forEach((m) => { if (m && m !== MAT_DEFAULT) { m.map?.dispose(); m.dispose?.(); } });
    });
    this.layers.delete(id);
    this.emit('layers');
    this.requestRender();
  }
  clear() { [...this.layers.keys()].forEach((id) => this.removeLayer(id)); this.clearMeasures(); this.setSection(false); }

  setLayerVisible(id, v) {
    const L = this.layers.get(id);
    if (!L) return;
    L.visible = v;
    L.wrap.visible = v;
    this.emit('layers');
    this.requestRender();
  }

  meshes({ visibleOnly = true, layerIds = null } = {}) {
    const out = [];
    for (const L of this.layers.values()) {
      if (layerIds && !layerIds.includes(L.id)) continue;
      if (visibleOnly && !L.visible) continue;
      for (const m of L.meshes) if (!visibleOnly || m.visible) out.push(m);
    }
    return out;
  }
  findByKey(key) {
    const id = key.split(':')[0];
    return this.layers.get(id)?.meshes.find((m) => m.userData.key === key) || null;
  }

  // ---------- materials / selection ----------
  _mat(m) {
    if (this.overrides.has(m)) return this.overrides.get(m);
    if (m === this.selected) return MAT_SEL;
    if (this.xray) return MAT_XRAY;
    return m.userData.baseMat;
  }
  refresh(m) { if (m) m.material = this._mat(m); this.requestRender(); }
  refreshAll() { for (const L of this.layers.values()) for (const m of L.meshes) m.material = this._mat(m); this.requestRender(); }

  select(mesh) {
    const prev = this.selected;
    this.selected = mesh || null;
    if (prev) this.refresh(prev);
    if (mesh) this.refresh(mesh);
    this.emit('select', mesh);
  }
  setXray(on) { this.xray = on; this.refreshAll(); }
  highlightPair(a, b) {
    this.overrides.clear();
    if (a) this.overrides.set(a, MAT_A);
    if (b) this.overrides.set(b, MAT_B);
    this.xray = true;
    this.refreshAll();
  }
  clearHighlights() { this.overrides.clear(); this.xray = false; this.refreshAll(); this.clearLabels('clash'); }
  isolate(meshes) {
    const keep = new Set(meshes);
    for (const L of this.layers.values()) for (const m of L.meshes) m.visible = keep.has(m);
    this.requestRender();
  }
  showAll() { for (const L of this.layers.values()) for (const m of L.meshes) m.visible = true; this.requestRender(); }

  // ---------- camera ----------
  boundsOf(objs) {
    const box = new THREE.Box3();
    const list = objs ? (Array.isArray(objs) ? objs : [objs]) : this.meshes();
    for (const o of list) box.expandByObject(o);
    return box;
  }
  fit(objs, { dir, dur = 0.7 } = {}) {
    const box = this.boundsOf(objs);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const d = dir ? dir.clone().normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    if (!isFinite(d.x) || d.lengthSq() < 0.5) d.set(1, 0.8, 1).normalize();
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.camera.near = Math.max(0.01, radius / 2000);
    this.camera.far = Math.max(1000, radius * 60);
    this.camera.updateProjectionMatrix();
    this.animateTo(center.clone().add(d.multiplyScalar(dist)), center, dur);
    if (!objs) this.buildGrid(Math.max(size.x, size.z) * 1.6, box.min.y);
  }
  view(name) {
    const dirs = { top: new THREE.Vector3(0, 1, 0.0001), iso: new THREE.Vector3(1, 0.8, 1), front: new THREE.Vector3(0, 0.15, 1), right: new THREE.Vector3(1, 0.15, 0), back: new THREE.Vector3(0, 0.15, -1), left: new THREE.Vector3(-1, 0.15, 0) };
    this.fit(null, { dir: dirs[name] || dirs.iso });
  }
  animateTo(pos, target, dur = 0.7) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    if (dur <= 0) { this.camera.position.copy(pos); this.controls.target.copy(target); this.requestRender(); return Promise.resolve(); }
    let t = 0;
    return new Promise((res) => {
      this.addTicker((dt) => {
        t = Math.min(1, t + dt / dur);
        const k = ease(t);
        this.camera.position.lerpVectors(p0, pos, k);
        this.controls.target.lerpVectors(t0, target, k);
        if (t >= 1) { res(); return false; }
        return true;
      });
    });
  }
  getCamera() { return { pos: this.camera.position.toArray(), target: this.controls.target.toArray(), fov: this.camera.fov }; }
  setCamera(s, dur = 0.8) { return this.animateTo(new THREE.Vector3(...s.pos), new THREE.Vector3(...s.target), dur); }

  buildGrid(size = 200, y = 0) {
    this.grid.clear();
    size = Math.max(20, size);
    const step = niceStep(size / 30);
    const n = Math.ceil(size / step);
    const minor = new THREE.GridHelper(n * step, n, 0x0e3a4c, 0x0b2534);
    const major = new THREE.GridHelper(n * step, Math.max(1, Math.round(n / 5)), 0x00b8c8, 0x145a6c);
    [minor, major].forEach((g, i) => { g.material.transparent = true; g.material.opacity = i ? 0.45 : 0.35; g.material.depthWrite = false; g.position.y = y - 0.02 - i * 0.001; g.userData.helper = true; this.grid.add(g); });
    const c = this.boundsOf().getCenter(new THREE.Vector3());
    if (isFinite(c.x)) this.grid.position.set(Math.round(c.x / step) * step, 0, Math.round(c.z / step) * step);
    this.gridStep = step;
    this.requestRender();
  }

  // ---------- picking ----------
  _bindPointer() {
    let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 6 || dt > 600 || e.button > 0) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (this.mode === 'measure') { if (hit) this._measureClick(hit.point); return; }
      this.select(hit ? hit.object : null);
    });
    el.addEventListener('dblclick', (e) => { const hit = this.pick(e.clientX, e.clientY); if (hit) this.fit(hit.object); });
  }
  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.firstHitOnly = !this.section.on;
    const hits = this.raycaster.intersectObjects(this.meshes().filter((m) => m.visible && m.parent?.visible !== false), false);
    const box = this.section.box;
    return hits.find((h) => !this.section.on || box.containsPoint(h.point)) || null;
  }

  // ---------- measure ----------
  setMode(mode) { this.mode = mode; if (mode !== 'measure') this.pendingPt = null; this.emit('mode', mode); }
  _marker(p, color = 0xf7ef00) {
    const r = Math.max(0.05, (this.gridStep || 5) * 0.04);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(p); m.renderOrder = 999; m.userData.helper = true;
    this.fx.add(m);
    return m;
  }
  _measureClick(p) {
    if (!this.pendingPt) { this.pendingPt = { p: p.clone(), m: this._marker(p) }; this.requestRender(); return; }
    const a = this.pendingPt.p, b = p.clone();
    const m2 = this._marker(b);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf7ef00, depthTest: false }));
    line.renderOrder = 998;
    this.fx.add(line);
    const d = a.distanceTo(b);
    const dh = Math.hypot(b.x - a.x, b.z - a.z), dv = b.y - a.y;
    const lab = this.addLabel(a.clone().lerp(b, 0.5), `${d.toFixed(3)} m  ·  H ${dh.toFixed(3)}  ·  V ${dv >= 0 ? '+' : ''}${dv.toFixed(3)}`, 'measure');
    const rec = { a: a.toArray(), b: b.toArray(), d, dh, dv, objs: [this.pendingPt.m, m2, line], lab };
    this.measures.push(rec);
    this.pendingPt = null;
    this.emit('measure', rec);
    this.requestRender();
  }
  clearMeasures() {
    for (const m of this.measures) { m.objs.forEach((o) => { this.fx.remove(o); o.geometry.dispose(); }); }
    if (this.pendingPt) { this.fx.remove(this.pendingPt.m); this.pendingPt = null; }
    this.measures = [];
    this.clearLabels('measure');
    this.emit('measure');
  }

  addLabel(pos, text, kind = 'info') {
    const el = h('div', { class: `v-label ${kind}` }, text);
    this.labelsEl.append(el);
    const l = { pos: pos.clone(), el, kind };
    this.labels.push(l);
    this.requestRender();
    return l;
  }
  clearLabels(kind) {
    this.labels = this.labels.filter((l) => { if (!kind || l.kind === kind) { l.el.remove(); return false; } return true; });
  }
  _updateLabels() {
    if (!this.labels.length) return;
    const w = this.host.clientWidth, hh = this.host.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(this.camera);
      const vis = v.z < 1 && v.z > -1;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * hh}px) translate(-50%, -130%)`;
      l.el.style.left = '0'; l.el.style.top = '0';
    }
  }

  // ---------- section box ----------
  setSection(on, box) {
    this.section.on = !!on;
    if (box) this.section.box.copy(box);
    if (this.section.helper) { this.fx.remove(this.section.helper); this.section.helper.geometry.dispose(); this.section.helper = null; }
    if (this.section.on) {
      const b = this.section.box;
      const P = this.clipPlanes;
      P[0].set(new THREE.Vector3(1, 0, 0), -b.min.x);
      P[1].set(new THREE.Vector3(-1, 0, 0), b.max.x);
      P[2].set(new THREE.Vector3(0, 1, 0), -b.min.y);
      P[3].set(new THREE.Vector3(0, -1, 0), b.max.y);
      P[4].set(new THREE.Vector3(0, 0, 1), -b.min.z);
      P[5].set(new THREE.Vector3(0, 0, -1), b.max.z);
      this.renderer.clippingPlanes = P;
      const helper = new THREE.Box3Helper(b.clone(), 0xff2fd0);
      helper.userData.helper = true;
      this.section.helper = helper;
      this.fx.add(helper);
    } else {
      this.renderer.clippingPlanes = [];
    }
    this.requestRender();
  }

  // ---------- info ----------
  info(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const va = meshVolumeArea(mesh);
    const L = this.layers.get(mesh.userData.layerId);
    return { name: mesh.name, layer: L?.name || '—', tag: mesh.userData.tag, cat: mesh.userData.cat, size, center: c, ...va, tris: (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3 };
  }

  // ---------- HUD / capture ----------
  setHud(title, sub = '') {
    this.hudEl.innerHTML = '';
    if (!title) { this.hudEl.style.opacity = 0; return; }
    this.hudEl.append(title, sub ? h('small', {}, sub) : '');
    this.hudEl.style.opacity = 1;
  }
  setCorner(lines) { this.cornerEl.innerHTML = ''; lines.forEach(([k, v]) => this.cornerEl.append(h('div', {}, `${k} `, h('b', {}, v)))); }

  snapshot(width = 360) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = width; c.height = Math.round(width * src.height / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.78);
  }

  startRecording(fps = 30) {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    if (!mime) throw new Error('This browser cannot record video (MediaRecorder unsupported).');
    const stream = this.renderer.domElement.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this._force++;
    rec.start(250);
    this._rec = { rec, chunks, mime };
    return mime;
  }
  stopRecording() {
    const R = this._rec;
    if (!R) return Promise.resolve(null);
    this._rec = null;
    this._force = Math.max(0, this._force - 1);
    return new Promise((res) => { R.rec.onstop = () => res(new Blob(R.chunks, { type: R.mime.split(';')[0] })); R.rec.stop(); });
  }
  get recording() { return !!this._rec; }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.clear();
    this.renderer.dispose();
    this.host.remove();
  }
}
