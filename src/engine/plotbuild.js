// Plot plan objects (2D, PDF points) → 3D meshes (metres). Y up, north = −Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CATS } from '../core/domain.js';

/** plan → world (metres, centred on page) */
export function makeMapper(plan) {
  const s = plan.scale; // metres per point
  const cx = plan.pageW / 2, cy = plan.pageH / 2;
  return {
    s,
    X: (vx) => (vx - cx) * s,
    Z: (vy) => (vy - cy) * s,
    // shape-space for ExtrudeGeometry (x east, y north)
    sp: ([vx, vy]) => new THREE.Vector2((vx - cx) * s, -(vy - cy) * s),
  };
}

function circleOf(shape) {
  if (shape.kind === 'circle') return { cx: shape.cx, cy: shape.cy, r: shape.r };
  const b = shape.bbox || bbox(shape.pts);
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, r: Math.min(b[2] - b[0], b[3] - b[1]) / 2 };
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
function polyOf(shape, segs = 40) {
  if (shape.kind !== 'circle') return shape.pts;
  return Array.from({ length: segs }, (_, i) => { const a = (i / segs) * Math.PI * 2; return [shape.cx + Math.cos(a) * shape.r, shape.cy + Math.sin(a) * shape.r]; });
}
/** oriented box via PCA: centre (world), length along axis, width, angle (rad, about Y) */
function oriented(shape, map) {
  const pts = polyOf(shape).map(([x, y]) => [map.X(x), map.Z(y)]);
  let mx = 0, mz = 0;
  pts.forEach(([x, z]) => { mx += x; mz += z; });
  mx /= pts.length; mz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  pts.forEach(([x, z]) => { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); });
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  pts.forEach(([x, z]) => {
    const a = (x - mx) * ux + (z - mz) * uz, b = -(x - mx) * uz + (z - mz) * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  });
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  return { x: mx + ca * ux - cb * uz, z: mz + ca * uz + cb * ux, L: a1 - a0, W: b1 - b0, ang: -ang };
}
const boxAt = (w, hgt, d, x, y, z, rotY = 0) => {
  const g = new THREE.BoxGeometry(w, hgt, d);
  g.translate(0, hgt / 2, 0);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
};
function segBox(a, b, t, hgt, y0) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return null;
  const g = new THREE.BoxGeometry(L + t, hgt, t);
  g.translate(0, hgt / 2, 0);
  g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
  g.translate((a[0] + b[0]) / 2, y0, (a[1] + b[1]) / 2);
  return g;
}
const merge = (gs) => { const ok = gs.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g)); ok.forEach((g) => { g.deleteAttribute('uv'); }); return ok.length ? mergeGeometries(ok, false) : null; };

/** Geometry for one plot plan object. Base sits at y = 0 (local); mesh.position.y carries elevation. */
export function objectGeometry(obj, map) {
  const cat = CATS[obj.cat] || CATS.equipment;
  const h = Math.max(0.01, Number(obj.h ?? cat.h) || cat.h);
  const shape = obj.shape;
  switch (cat.kind) {
    case 'tank': {
      const c = circleOf(shape);
      const r = c.r * map.s;
      const shell = new THREE.CylinderGeometry(r, r, h, 56, 1, false);
      shell.translate(0, h / 2, 0);
      const roof = new THREE.ConeGeometry(r, Math.max(0.3, r * 0.18), 56, 1, false);
      roof.translate(0, h + Math.max(0.3, r * 0.18) / 2, 0);
      const g = merge([shell, roof]);
      g.translate(map.X(c.cx), 0, map.Z(c.cy));
      return g;
    }
    case 'hvessel': {
      if (shape.kind === 'circle') {
        const r = shape.r * map.s;
        const g = new THREE.CylinderGeometry(r, r, Math.max(h, 2 * r), 40);
        g.translate(map.X(shape.cx), Math.max(h, 2 * r) / 2, map.Z(shape.cy));
        return g;
      }
      const o = oriented(shape, map);
      const r = o.W / 2, sad = 0.6;
      const body = new THREE.CapsuleGeometry(r, Math.max(0.01, o.L - 2 * r), 8, 32);
      body.rotateZ(Math.PI / 2);
      body.translate(0, r + sad, 0);
      const s1 = boxAt(0.4, sad + r * 0.5, o.W * 0.8, -o.L * 0.3, 0, 0);
      const s2 = boxAt(0.4, sad + r * 0.5, o.W * 0.8, o.L * 0.3, 0, 0);
      const g = merge([body, s1, s2]);
      g.rotateY(o.ang);
      g.translate(o.x, 0, o.z);
      return g;
    }
    case 'rack': {
      const o = oriented(shape, map);
      const col = 0.35, beam = 0.3;
      const n = Math.max(2, Math.round(o.L / 6) + 1);
      const step = (o.L - col) / (n - 1);
      const tiers = h > 4.5 ? [h, h - 2] : [h];
      const parts = [];
      for (let i = 0; i < n; i++) {
        const a = -o.L / 2 + col / 2 + i * step;
        parts.push(boxAt(col, h, col, a, 0, -o.W / 2 + col / 2));
        parts.push(boxAt(col, h, col, a, 0, o.W / 2 - col / 2));
        for (const t of tiers) parts.push(boxAt(col, beam, o.W, a, t - beam, 0));
      }
      parts.push(boxAt(o.L, beam * 0.8, col * 0.7, 0, h - beam, -o.W / 2 + col / 2));
      parts.push(boxAt(o.L, beam * 0.8, col * 0.7, 0, h - beam, o.W / 2 - col / 2));
      const g = merge(parts);
      g.rotateY(o.ang);
      g.translate(o.x, 0, o.z);
      return g;
    }
    case 'wall': {
      const t = obj.t ?? cat.t ?? 0.3;
      const pts = polyOf(shape, 48).map(([x, y]) => [map.X(x), map.Z(y)]);
      const closed = shape.kind !== 'line';
      const segs = [];
      for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) segs.push(segBox(pts[i], pts[(i + 1) % pts.length], t, h, 0));
      return merge(segs);
    }
    case 'pipe': {
      const dia = Math.max(0.02, Number(obj.dia ?? 0.3));
      const pts = polyOf(shape, 48).map(([x, y]) => new THREE.Vector3(map.X(x), dia / 2, map.Z(y)));
      if (shape.kind !== 'line' && pts.length > 2) pts.push(pts[0].clone());
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const L = a.distanceTo(b);
        if (L < 1e-4) continue;
        const g = new THREE.CylinderGeometry(dia / 2, dia / 2, L, 16, 1, false);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        segs.push(g);
      }
      return merge(segs);
    }
    case 'pit': {
      const g = solid(shape, map, h);
      g.translate(0, -h, 0);
      return g;
    }
    default:
      return solid(shape, map, h);
  }
}

function solid(shape, map, h) {
  if (shape.kind === 'circle') {
    const r = shape.r * map.s;
    const g = new THREE.CylinderGeometry(r, r, h, 48);
    g.translate(map.X(shape.cx), h / 2, map.Z(shape.cy));
    return g;
  }
  let pts = shape.pts.map((p) => map.sp(p));
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2); // shape (x, y=north) → world (x, z=−north); extrusion → +Y
  return g;
}

const matCache = new Map();
export function catMaterial(cat) {
  if (matCache.has(cat)) return matCache.get(cat);
  const def = CATS[cat] || CATS.equipment;
  const c = new THREE.Color(def.color);
  const m = new THREE.MeshStandardMaterial({
    color: c, emissive: c.clone().multiplyScalar(0.22), metalness: 0.25, roughness: 0.55,
    transparent: !!def.ghost || cat === 'pit', opacity: def.ghost ? 0.35 : cat === 'pit' ? 0.6 : 1, side: def.ghost ? THREE.DoubleSide : THREE.FrontSide,
  });
  matCache.set(cat, m);
  return m;
}
const edgeMat = new THREE.LineBasicMaterial({ color: 0xbff9ff, transparent: true, opacity: 0.55 });

/** Build a Group for the whole plot plan (+ optional neon ground from the PDF raster). */
export function buildPlotModel(plan, { groundCanvas } = {}) {
  const map = makeMapper(plan);
  const group = new THREE.Group();
  group.name = plan.name || 'Plot plan';
  for (const obj of plan.objects || []) {
    let geo;
    try { geo = objectGeometry(obj, map); } catch (e) { console.warn('object failed', obj, e); continue; }
    if (!geo) continue;
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, catMaterial(obj.cat));
    mesh.name = obj.tag || `${(CATS[obj.cat]?.label || obj.cat).toUpperCase()}-${obj.id.slice(-4).toUpperCase()}`;
    mesh.position.y = Number(obj.elev) || 0;
    mesh.userData = { tag: obj.tag || '', cat: obj.cat, objId: obj.id, material: CATS[obj.cat]?.mat };
    if ((geo.attributes.position.count || 0) < 60000) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
      edges.userData.helper = true;
      edges.raycast = () => {};
      mesh.add(edges);
    }
    group.add(mesh);
  }
  if (groundCanvas) {
    const w = plan.pageW * map.s, d = plan.pageH * map.s;
    const tex = new THREE.CanvasTexture(groundCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    ground.renderOrder = -1;
    ground.userData = { helper: true, ground: true };
    ground.raycast = () => {};
    group.add(ground);
  }
  return group;
}

/** Neon blueprint ground: dark lines of the PDF become glowing cyan on transparent. */
export function neonGround(srcCanvas, maxDim = 2048) {
  const k = Math.min(1, maxDim / Math.max(srcCanvas.width, srcCanvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(srcCanvas.width * k); c.height = Math.round(srcCanvas.height * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    const ink = Math.min(1, Math.max(0, (1 - lum) * 1.6));
    d[i] = 20 + 80 * ink; d[i + 1] = 200 + 55 * ink; d[i + 2] = 255;
    d[i + 3] = 18 + 230 * ink;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
