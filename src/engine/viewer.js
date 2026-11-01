// Review 3D viewer engine — federated model review (Navisworks-style) on Three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { h } from '../core/ui.js';
import { groupVolumeArea } from './mto.js';
import { view3d, getTheme } from '../core/theme.js';
import { batchLayer, syncInstance, BATCH_MIN } from './batch.js';
import { indexLayer, displayName, parseName, toSite } from './groups.js';
import { MeasureTool } from './measure.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const MAT_SEL = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00a8c0, emissiveIntensity: 0.9, metalness: 0.1, roughness: 0.35 });
const MAT_A = new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0xff1040, emissiveIntensity: 0.7, roughness: 0.4 });
const MAT_B = new THREE.MeshStandardMaterial({ color: 0x3dff9a, emissive: 0x10c060, emissiveIntensity: 0.6, roughness: 0.4 });
const MAT_XRAY = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.05, depthWrite: false });
const MAT_PICK = new THREE.MeshStandardMaterial({ color: 0xf2621a, emissive: 0x8a2f00, emissiveIntensity: 0.6, roughness: 0.4, transparent: true, opacity: 0.85 });
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
    this.palette = view3d();
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

    this.hemi = new THREE.HemisphereLight(0xbfe9ff, 0x2a1038, 1.1);
    this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
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
    this.selected = null;     // primary mesh of the selection (kept for older callers)
    this.selection = [];      // all meshes of the selected component / item
    this.selSet = new Set();
    this.selectRes = 'component'; // part | component | item
    this.mode = 'select';
    this.xray = false;
    this.overrides = new Map();
    this.pickHi = new Set();
    this.labels = [];
    this.tickers = new Set();
    this.listeners = {};
    this.section = { on: false, box: new THREE.Box3(), helper: null };
    this.clipPlanes = Array.from({ length: 6 }, () => new THREE.Plane());
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll(); // batched originals live on render layer 1
    this._dirty = true;
    this._force = 0;
    this._timer = new THREE.Timer();

    this.measure = new MeasureTool(this);
    this._bindPointer();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.host);
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this.buildGrid(200);
    this._onTheme = () => this.setTheme(getTheme());
    window.addEventListener('r3d:theme', this._onTheme);
    this.setTheme(getTheme());
  }

  /** Apply the 3D palette of a UI theme (background, grid, lights, highlight colours). */
  setTheme(id) {
    const p = this.palette = view3d(id);
    const [top, bottom] = p.bg;
    if (top === bottom) { this.scene.background = new THREE.Color(top); }
    else {
      const c = document.createElement('canvas');
      c.width = 2; c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, top); grad.addColorStop(1, bottom);
      g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background?.dispose?.();
      this.scene.background = tex;
    }
    this.hemi.color.set(p.hemi[0]); this.hemi.groundColor.set(p.hemi[1]); this.hemi.intensity = p.hemi[2];
    this.sun.intensity = p.sun;
    this.scene.environmentIntensity = p.env;
    MAT_SEL.color.set(p.sel); MAT_SEL.emissive.set(p.selEmissive);
    MAT_PICK.color.set(p.sel); MAT_PICK.emissive.set(p.selEmissive);
    MAT_XRAY.color.set(p.xray); MAT_XRAY.opacity = id === 'cloud' ? 0.08 : 0.05;
    this.scene.traverse((o) => {
      if (o.userData?.edge && o.material) { o.material.color.set(p.edge); o.material.opacity = p.edgeOpacity; }
    });
    if (this.section?.helper) this.section.helper.material.color.set(p.box);
    this.buildGrid(this._gridSize || 200, this._gridY || 0);
  }

  on(type, fn) { (this.listeners[type] ||= new Set()).add(fn); return () => this.listeners[type].delete(fn); }
  emit(type, data) { this.listeners[type]?.forEach((fn) => fn(data)); }
  requestRender() { this._dirty = true; }

  mount(parent) { parent.append(this.host); this.resize(); this.requestRender(); }
  resize() {
    const w = this.host.clientWidth || 1, hh = this.host.clientHeight || 1;
    this.renderer.setSize(w, hh, false);
    this.camera.aspect = w / hh;
    this._applyInset();
    this.requestRender();
  }
  /** Keep the view centre in the part of the canvas not covered by panels (px from the right / bottom edge). */
  setInset({ right = 0, bottom = 0 } = {}) {
    this.inset = { right, bottom };
    this._applyInset();
    this.requestRender();
    this.measure?.draw();
  }
  _applyInset() {
    const w = this.host.clientWidth || 1, hh = this.host.clientHeight || 1;
    const { right = 0, bottom = 0 } = this.inset || {};
    if (right || bottom) this.camera.setViewOffset(w, hh, Math.round(right / 2), Math.round(bottom / 2), w, hh);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
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
    const { comps, items } = indexLayer(id, meshes);
    const layer = { id, name, kind, wrap, inner, object, meshes, comps, items, visible: true, units, zUp, origin: object.userData?.nexus?.origin || null, transform: { dx: 0, dy: 0, dz: 0, rotY: 0, ...transform } };
    this.layers.set(id, layer);
    this.applyLayerTransform(id);
    if (kind === 'import') {
      // static geometry: matrices only change through the layer wrapper
      object.traverse((o) => { o.matrixAutoUpdate = false; });
      if (meshes.length >= BATCH_MIN) {
        try { layer.batch = batchLayer(inner, meshes); } catch (e) { console.warn('batching failed, drawing meshes individually', e); }
      }
    }
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
    if (this.selection.some((m) => m.userData.layerId === id)) this.select(null);
    L.batch?.dispose();
    this.world.remove(L.wrap);
    L.wrap.traverse((o) => {
      if (o.geometry) { o.geometry.disposeBoundsTree?.(); o.geometry.dispose(); }
      const ms = Array.isArray(o.userData.baseMat || o.material) ? (o.userData.baseMat || o.material) : [o.userData.baseMat || o.material];
      ms.forEach((m) => { if (m && m !== MAT_DEFAULT && m !== MAT_SEL && m !== MAT_A && m !== MAT_B && m !== MAT_XRAY && m !== MAT_PICK) { m.map?.dispose(); m.dispose?.(); } });
    });
    this.layers.delete(id);
    this.emit('layers');
    this.requestRender();
  }
  clear() { [...this.layers.keys()].forEach((id) => this.removeLayer(id)); this.measure?.clear(); this.setSection(false); }

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

  // ---------- grouping ----------
  /** Meshes that form the component / item / part a mesh belongs to. */
  groupOf(mesh, res = this.selectRes) {
    if (!mesh) return [];
    const L = this.layers.get(mesh.userData.layerId);
    if (!L || res === 'part') return [mesh];
    const g = res === 'item' ? L.items?.get(mesh.userData.item) : L.comps?.get(mesh.userData.comp);
    return g ? g.meshes : [mesh];
  }

  // ---------- materials / selection ----------
  _look(m) {
    const hi = this.overrides.get(m) || (this.pickHi.has(m) ? MAT_PICK : null) || (this.selSet.has(m) ? MAT_SEL : null);
    if (m.userData._b) {
      m.material = hi || m.userData.baseMat;
      syncInstance(m, { highlighted: !!hi });
    } else {
      m.material = hi || (this.xray ? MAT_XRAY : m.userData.baseMat);
    }
  }
  refresh(m) { if (m) this._look(m); this.requestRender(); }
  refreshAll() {
    for (const L of this.layers.values()) {
      L.batch?.batches.forEach((b) => { b.material = this.xray ? MAT_XRAY : b.userData.baseMat; });
      for (const m of L.meshes) this._look(m);
    }
    this.requestRender();
  }

  /** Select the component (default), item or part under a mesh; null clears. `add` extends the selection. */
  select(mesh, { add = false, res } = {}) {
    const group = mesh ? this.groupOf(mesh, res) : [];
    this.selectMeshes(add ? [...new Set([...this.selection, ...group])] : group);
  }
  selectMeshes(list) {
    const prev = this.selection;
    this.selection = list.filter(Boolean);
    this.selSet = new Set(this.selection);
    for (const m of prev) this._look(m);
    for (const m of this.selection) this._look(m);
    this.selected = this.selection[0] || null;
    this.requestRender();
    this.emit('select', this.selected);
  }
  highlightPick(list) {
    const prev = [...this.pickHi];
    this.pickHi = new Set(list || []);
    for (const m of prev) this._look(m);
    for (const m of this.pickHi) this._look(m);
    this.requestRender();
  }
  setXray(on) { this.xray = on; this.refreshAll(); }
  highlightPair(a, b) {
    const prev = [...this.overrides.keys()];
    this.overrides.clear();
    for (const m of [].concat(a || [])) this.overrides.set(m, MAT_A);
    for (const m of [].concat(b || [])) this.overrides.set(m, MAT_B);
    prev.forEach((m) => this._look(m));
    this.xray = true;
    this.refreshAll();
  }
  clearHighlights() {
    const prev = [...this.overrides.keys()];
    this.overrides.clear();
    prev.forEach((m) => this._look(m));
    this.xray = false;
    this.refreshAll();
    this.clearLabels('clash');
  }
  setVisible(list, v) {
    for (const m of list) { m.visible = v; this._look(m); }
    if (!v && this.selection.some((m) => !m.visible)) this.selectMeshes(this.selection.filter((m) => m.visible));
    this.requestRender();
    this.emit('visibility');
  }
  isolate(meshes) {
    const keep = new Set(meshes);
    for (const L of this.layers.values()) for (const m of L.meshes) { m.visible = keep.has(m); this._look(m); }
    this.requestRender();
    this.emit('visibility');
  }
  showAll() {
    for (const L of this.layers.values()) for (const m of L.meshes) { if (!m.visible) { m.visible = true; this._look(m); } }
    this.requestRender();
    this.emit('visibility');
  }
  hiddenCount() { let n = 0; for (const L of this.layers.values()) for (const m of L.meshes) if (!m.visible) n++; return n; }

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
  fitBox(box, { dur = 0.6 } = {}) {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.3);
    const d = this.camera.position.clone().sub(this.controls.target).normalize();
    if (!isFinite(d.x) || d.lengthSq() < 0.5) d.set(1, 0.8, 1).normalize();
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.camera.near = Math.min(this.camera.near, Math.max(0.01, radius / 2000));
    this.camera.updateProjectionMatrix();
    return this.animateTo(center.clone().add(d.multiplyScalar(dist)), center, dur);
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
    this._gridSize = size; this._gridY = y;
    const p = this.palette || view3d();
    size = Math.max(20, size);
    const step = niceStep(size / 30);
    const n = Math.ceil(size / step);
    const minor = new THREE.GridHelper(n * step, n, p.gridMinor, p.gridMinor);
    const major = new THREE.GridHelper(n * step, Math.max(1, Math.round(n / 5)), p.gridMajor, p.gridMajor);
    [minor, major].forEach((g, i) => { g.material.transparent = true; g.material.opacity = p.gridOpacity[i]; g.material.depthWrite = false; g.position.y = y - 0.02 - i * 0.001; g.userData.helper = true; this.grid.add(g); });
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
    el.addEventListener('pointermove', (e) => { if (this.mode === 'measure' && !down) this.measure.onMove(e); });
    el.addEventListener('pointerleave', () => { if (this.mode === 'measure') { this.measure.hover = null; this.measure.draw(); } });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      down = null;
      if (moved > 8 || dt > 650 || e.button > 0) return;
      if (this.mode === 'measure') { this.measure.onTap(e); return; }
      const hit = this.pick(e.clientX, e.clientY);
      this.select(hit ? hit.object : null, { add: e.shiftKey || e.ctrlKey || e.metaKey });
    });
    el.addEventListener('dblclick', (e) => {
      if (this.mode === 'measure') return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this.fit(this.groupOf(hit.object));
    });
  }
  pick(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.firstHitOnly = !this.section.on;
    const hits = this.raycaster.intersectObjects(this.meshes(), false);
    const box = this.section.box;
    return hits.find((h) => !this.section.on || box.containsPoint(h.point)) || null;
  }

  // ---------- modes ----------
  setMode(mode) {
    this.mode = mode;
    this.measure.setActive(mode === 'measure');
    this.renderer.domElement.style.cursor = mode === 'measure' ? 'crosshair' : '';
    this.emit('mode', mode);
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
    const M = this.measure;
    if (M && (M.items.length || M.pending || M.hover || M.svg.firstChild)) M.draw();
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
      const helper = new THREE.Box3Helper(b.clone(), this.palette.box);
      helper.userData.helper = true;
      this.section.helper = helper;
      this.fx.add(helper);
    } else {
      this.renderer.clippingPlanes = [];
    }
    this.requestRender();
  }

  // ---------- info ----------
  /** Properties of a selection (one or more meshes forming a component / item). */
  info(meshes) {
    const list = [].concat(meshes).filter(Boolean);
    const box = new THREE.Box3();
    let tris = 0;
    for (const m of list) { box.expandByObject(m); tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const first = list[0];
    const L = this.layers.get(first?.userData.layerId);
    const va = groupVolumeArea(list);
    const name = displayName(first);
    const { type, owner } = parseName(name);
    const bottom = toSite(new THREE.Vector3(c.x, box.min.y, c.z), L);
    const top = toSite(new THREE.Vector3(c.x, box.max.y, c.z), L);
    return {
      name, type, owner, layer: L?.name || '—', source: first?.userData.layer || '', tag: first?.userData.tag, cat: first?.userData.cat,
      parts: list.length, size, center: toSite(c, L), bottom, top, ...va, tris,
    };
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
    window.removeEventListener('r3d:theme', this._onTheme);
    this.measure?.clear();
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.clear();
    this.renderer.dispose();
    this.host.remove();
  }
}
