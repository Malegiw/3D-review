// Measure tool: snapped point-to-point distance, point coordinates and shortest distance between two objects.
// Drawn as a screen-space overlay (crisp at any zoom, same size on phone and laptop):
//   – solid line between the points, dashed horizontal and vertical legs (the H / V components),
//   – snap marker: square = vertex, triangle = on an edge, circle = on a face,
//   – a live rubber band from the first point while the pointer moves (mouse / pen).
import * as THREE from 'three';
import { h } from '../core/ui.js';
import { toSite } from './groups.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs = {}) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

const _inv = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const _line = new THREE.Line3();
const _sphere = new THREE.Sphere();

let seq = 0;

export class MeasureTool {
  constructor(viewer) {
    this.v = viewer;
    this.mode = 'distance';   // distance | point | min
    this.units = 'm';
    this.snap = true;
    this.items = [];
    this.pending = null;      // first pick { w, site, layerId, kind, mesh }
    this.hover = null;
    this.active = false;
    this.svg = S('svg', { class: 'm-overlay', 'aria-hidden': 'true' });
    this.labels = h('div', { class: 'm-labels' });
    viewer.host.append(this.svg, this.labels);
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn(this)); }

  setActive(on) {
    this.active = on;
    if (!on) { this.pending = null; this.hover = null; this._clearPick(); }
    this.draw();
  }
  setMode(mode) { this.mode = mode; this.pending = null; this.hover = null; this._clearPick(); this.draw(); this.emit(); }
  setUnits(u) { this.units = u; this.draw(); this.emit(); }

  // ---------- formatting ----------
  fmt(d, signed = false) {
    const s = signed && d > 0 ? '+' : '';
    if (this.units === 'mm') return `${s}${Math.round(d * 1000).toLocaleString('en-US')} mm`;
    return `${s}${d.toFixed(3)} m`;
  }

  // ---------- picking with snap ----------
  /** Screen-space snap around a ray hit: vertex → edge → face. */
  snapAt(cx, cy, touch = false) {
    const v = this.v;
    const hit = v.pick(cx, cy);
    if (!hit) return null;
    const mesh = hit.object;
    const out = { w: hit.point.clone(), kind: 'face', mesh, layerId: mesh.userData.layerId };
    if (!this.snap) return out;
    const rect = v.renderer.domElement.getBoundingClientRect();
    const px = touch ? 24 : 14;
    const dist = v.camera.position.distanceTo(hit.point);
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2)) * dist) / rect.height;
    const radius = px * worldPerPx;
    const geo = mesh.geometry;
    mesh.updateWorldMatrix(true, false);
    const mw = mesh.matrixWorld;
    _inv.copy(mw).invert();
    const scale = mw.getMaxScaleOnAxis() || 1;
    _sphere.center.copy(hit.point).applyMatrix4(_inv);
    _sphere.radius = radius / scale;
    const toScreen = (w, target) => {
      _p.copy(w).project(v.camera);
      target.x = (_p.x * 0.5 + 0.5) * rect.width + rect.left;
      target.y = (-_p.y * 0.5 + 0.5) * rect.height + rect.top;
      return target;
    };
    let best = null, bestD = px;
    let bestEdge = null, bestEdgeD = px * 0.75;
    const scr = { x: 0, y: 0 };
    const seen = new Set();
    let budget = 3000;
    const consider = (local) => {
      const w = local.clone().applyMatrix4(mw);
      const key = `${w.x.toFixed(4)},${w.y.toFixed(4)},${w.z.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      toScreen(w, scr);
      const d = Math.hypot(scr.x - cx, scr.y - cy);
      if (d < bestD) { bestD = d; best = w; }
    };
    const visit = (a, b, c) => {
      if (--budget < 0) return true;
      consider(a); consider(b); consider(c);
      for (const [p0, p1] of [[a, b], [b, c], [c, a]]) {
        _line.set(_a.copy(p0).applyMatrix4(mw), _b.copy(p1).applyMatrix4(mw));
        // closest point on the edge to the cursor ray, measured on screen
        _line.closestPointToPoint(hit.point, true, _c);
        toScreen(_c, scr);
        const d = Math.hypot(scr.x - cx, scr.y - cy);
        if (d < bestEdgeD) { bestEdgeD = d; bestEdge = _c.clone(); }
      }
      return false;
    };
    if (geo.boundsTree) {
      geo.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(_sphere),
        intersectsTriangle: (tri) => visit(tri.a, tri.b, tri.c),
      });
    } else if (hit.face) {
      const pos = geo.attributes.position;
      visit(_q.fromBufferAttribute(pos, hit.face.a).clone(), new THREE.Vector3().fromBufferAttribute(pos, hit.face.b), new THREE.Vector3().fromBufferAttribute(pos, hit.face.c));
    }
    if (best) { out.w = best; out.kind = 'vertex'; }
    else if (bestEdge) { out.w = bestEdge; out.kind = 'edge'; }
    return out;
  }

  _site(pt) { return toSite(pt.w, this.v.layers.get(pt.layerId)); }

  // ---------- input from the viewer ----------
  onMove(e) {
    if (!this.active || e.pointerType === 'touch') return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this.mode === 'min') { this.hover = null; this.draw(); return; }
      this.hover = this.snapAt(e.clientX, e.clientY, false);
      this.draw();
    });
  }

  onTap(e) {
    const touch = e.pointerType === 'touch';
    if (this.mode === 'min') return this._tapObject(e);
    const p = this.snapAt(e.clientX, e.clientY, touch);
    if (!p) return;
    p.site = this._site(p);
    if (this.mode === 'point') {
      this._add({ kind: 'point', a: p });
      return;
    }
    if (!this.pending) { this.pending = p; this.draw(); this.emit(); return; }
    const a = this.pending;
    this.pending = null;
    this._add({ kind: 'distance', a, b: p });
  }

  _tapObject(e) {
    const v = this.v;
    const hit = v.pick(e.clientX, e.clientY);
    if (!hit) return;
    const group = v.groupOf(hit.object, 'component');
    if (!this.pending) {
      this.pending = { group, mesh: hit.object, w: hit.point.clone(), layerId: hit.object.userData.layerId };
      v.highlightPick(group);
      this.draw(); this.emit();
      return;
    }
    const A = this.pending.group;
    this.pending = null;
    const r = shortestBetween(A, group);
    this._clearPick();
    if (!r) return;
    const la = r.meshA.userData.layerId, lb = r.meshB.userData.layerId;
    const a = { w: r.pa, kind: 'surface', layerId: la, mesh: r.meshA };
    const b = { w: r.pb, kind: 'surface', layerId: lb, mesh: r.meshB };
    a.site = this._site(a); b.site = this._site(b);
    this._add({ kind: 'min', a, b, names: [nameOf(A[0]), nameOf(group[0])] });
  }

  _clearPick() { this.v.highlightPick?.(null); }

  _add(rec) {
    rec.id = ++seq;
    if (rec.b) {
      const a = rec.a.w, b = rec.b.w;
      rec.d = a.distanceTo(b);
      rec.dh = Math.hypot(b.x - a.x, b.z - a.z);
      rec.dv = b.y - a.y;
      rec.de = rec.b.site.e - rec.a.site.e;
      rec.dn = rec.b.site.n - rec.a.site.n;
    }
    this.items.push(rec);
    this.draw();
    this.emit();
    this.v.requestRender();
  }

  remove(id) { this.items = this.items.filter((x) => x.id !== id); this.draw(); this.emit(); }
  clear() { this.items = []; this.pending = null; this.hover = null; this._clearPick(); this.draw(); this.emit(); }
  undo() { if (this.pending) { this.pending = null; this._clearPick(); } else this.items.pop(); this.draw(); this.emit(); }

  focus(id) {
    const r = this.items.find((x) => x.id === id);
    if (!r) return;
    const box = new THREE.Box3().expandByPoint(r.a.w);
    if (r.b) box.expandByPoint(r.b.w);
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 2);
    box.expandByScalar(size * 0.6);
    this.v.fitBox(box);
  }

  // ---------- drawing ----------
  draw() {
    const v = this.v;
    const svg = this.svg;
    while (svg.firstChild) svg.firstChild.remove();
    const labels = [];
    const w = v.host.clientWidth, hh = v.host.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    const proj = (p) => { _p.copy(p).project(v.camera); return { x: (_p.x * 0.5 + 0.5) * w, y: (-_p.y * 0.5 + 0.5) * hh, ok: _p.z > -1 && _p.z < 1 }; };
    const dot = (p, cls = '') => { const s = proj(p); if (s.ok) svg.append(S('circle', { cx: s.x, cy: s.y, r: 4.5, class: `m-dot ${cls}` })); return s; };
    const seg = (p, q, cls) => { const s = proj(p), t = proj(q); if (s.ok && t.ok) svg.append(S('line', { x1: s.x, y1: s.y, x2: t.x, y2: t.y, class: cls })); return [s, t]; };
    this.items.forEach((r, i) => {
      const tag = `M${i + 1}`;
      if (r.kind === 'point') {
        const s = dot(r.a.w, 'pt');
        if (s.ok) labels.push([s.x, s.y, `${tag}  E ${r.a.site.e.toFixed(3)}  N ${r.a.site.n.toFixed(3)}  EL ${r.a.site.el.toFixed(3)}`, 'pt']);
        return;
      }
      const a = r.a.w, b = r.b.w;
      const corner = new THREE.Vector3(b.x, a.y, b.z);
      if (r.dh > 1e-4 && Math.abs(r.dv) > 1e-4) { seg(a, corner, 'm-leg'); seg(corner, b, 'm-leg v'); }
      const [s, t] = seg(a, b, `m-line ${r.kind === 'min' ? 'min' : ''}`);
      dot(a); dot(b);
      if (s.ok && t.ok) labels.push([(s.x + t.x) / 2, (s.y + t.y) / 2, `${tag}  ${this.fmt(r.d)}`, r.kind]);
    });
    // pending + rubber band
    if (this.pending && this.mode !== 'min') {
      dot(this.pending.w, 'pending');
      if (this.hover) {
        const [s, t] = seg(this.pending.w, this.hover.w, 'm-line live');
        if (s.ok && t.ok) labels.push([(s.x + t.x) / 2, (s.y + t.y) / 2, this.fmt(this.pending.w.distanceTo(this.hover.w)), 'live']);
      }
    }
    if (this.hover && this.active) {
      const s = proj(this.hover.w);
      if (s.ok) {
        const k = this.hover.kind;
        if (k === 'vertex') svg.append(S('rect', { x: s.x - 6, y: s.y - 6, width: 12, height: 12, class: 'm-snap' }));
        else if (k === 'edge') svg.append(S('path', { d: `M${s.x} ${s.y - 7}L${s.x + 7} ${s.y + 5}L${s.x - 7} ${s.y + 5}Z`, class: 'm-snap' }));
        else svg.append(S('circle', { cx: s.x, cy: s.y, r: 6, class: 'm-snap' }));
      }
    }
    // labels as HTML (crisp text, theme fonts)
    this.labels.replaceChildren(...labels.map(([x, y, text, kind]) => h('div', { class: `m-label ${kind}`, style: { transform: `translate(${x}px, ${y}px) translate(-50%, -140%)` } }, text)));
  }
}

const nameOf = (m) => m?.userData?.name || m?.name || 'Object';

/** Shortest distance between two groups of meshes (world space). */
export function shortestBetween(A, B) {
  let best = null;
  const t1 = {}, t2 = {};
  const m = new THREE.Matrix4();
  for (const ma of A) {
    const bvh = ma.geometry.boundsTree;
    if (!bvh) continue;
    ma.updateWorldMatrix(true, false);
    const inv = ma.matrixWorld.clone().invert();
    for (const mb of B) {
      if (ma === mb) continue;
      mb.updateWorldMatrix(true, false);
      m.multiplyMatrices(inv, mb.matrixWorld);
      const r = bvh.closestPointToGeometry(mb.geometry, m, t1, t2);
      if (!r) continue;
      const pa = t1.point.clone().applyMatrix4(ma.matrixWorld);
      const pb = t2.point.clone().applyMatrix4(mb.matrixWorld);
      const d = pa.distanceTo(pb);
      if (!best || d < best.d) best = { d, pa, pb, meshA: ma, meshB: mb };
    }
  }
  return best;
}
