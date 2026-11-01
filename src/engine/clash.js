// Clash detection — sweep-and-prune broad phase + BVH triangle tests (three-mesh-bvh).
// Types: Hard (triangles intersect), Containment (one solid fully inside another), Clearance (gap < tolerance).
import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';

const IDENTITY = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _v = new THREE.Vector3();

function worldData(mesh, origin, cache) {
  let d = cache.get(mesh);
  if (d) return d;
  mesh.updateWorldMatrix(true, false);
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  const pos = src.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const m = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z).multiply(mesh.matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(m);
    arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  if (src.index) geo.setIndex(src.index.clone());
  const bvh = new MeshBVH(geo);
  geo.boundsTree = bvh;
  geo.computeBoundingBox();
  d = { geo, bvh, box: geo.boundingBox };
  cache.set(mesh, d);
  return d;
}

const _seg = new THREE.Line3();
const _e = new THREE.Line3();
const _cp = new THREE.Vector3();
const _x1 = new ExtendedTriangle(), _x2 = new ExtendedTriangle();
const ext = (t, tmp) => { if (t.isExtendedTriangle) { if (t.needsUpdate) t.update(); return t; } tmp.copy(t); tmp.needsUpdate = true; tmp.update(); return tmp; };
const nearEdge = (tri, seg, eps) => {
  for (const [p, q] of [[tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]]) {
    _e.set(p, q);
    if (_e.closestPointToPoint(seg.start, true, _cp).distanceTo(seg.start) <= eps && _e.closestPointToPoint(seg.end, true, _cp).distanceTo(seg.end) <= eps) return true;
  }
  return false;
};
/** Surfaces that only meet — face on face, edge on edge, end to end — are contact, not interference. */
function isTouch(t1, t2, seg, eps) {
  const n1 = t1.plane.normal, n2 = t2.plane.normal;
  if (Math.abs(n1.dot(n2)) > 0.9995 && Math.abs(t1.plane.distanceToPoint(t2.a)) <= eps) return true;
  if (seg.distance() <= eps) return true;
  return nearEdge(t1, seg, eps) || nearEdge(t2, seg, eps);
}
/** Hard test that ignores contact: true only when a triangle of A passes through the interior of a face of B. */
function penetrates(A, B, eps, stats) {
  let real = false;
  A.bvh.bvhcast(B.bvh, IDENTITY, {
    intersectsTriangles: (ta, tb) => {
      const t1 = ext(ta, _x1), t2 = ext(tb, _x2);
      if (!t1.intersectsTriangle(t2, _seg, true)) return false;
      if (isTouch(t1, t2, _seg, eps)) { stats.touch = true; return false; }
      real = true;
      return true;
    },
  });
  return real;
}

/** Depth of a point inside a closed mesh (0 when outside or on the surface). */
const _hit = {};
function insideDepth(D, p) {
  _ray.origin.copy(p);
  _ray.direction.set(0.5773, 0.5774, 0.5773).normalize();
  let count = 0;
  D.bvh.shapecast({
    intersectsBounds: (box) => _ray.intersectsBox(box),
    intersectsTriangle: (tri) => { if (_ray.intersectTriangle(tri.a, tri.b, tri.c, false, _v)) count++; return false; },
  });
  if (count % 2 === 0) return 0;
  const r = D.bvh.closestPointToPoint(p, _hit);
  return r ? r.distance : 0;
}

function pointInside(insideD, outerD) {
  // ray parity test from one vertex of inner mesh against outer mesh
  const p = insideD.geo.attributes.position;
  _ray.origin.fromBufferAttribute(p, 0);
  _ray.direction.set(0.5773, 0.5774, 0.5773).normalize();
  let count = 0;
  outerD.bvh.shapecast({
    intersectsBounds: (box) => _ray.intersectsBox(box),
    intersectsTriangle: (tri) => { if (_ray.intersectTriangle(tri.a, tri.b, tri.c, false, _v)) count++; return false; },
  });
  return count % 2 === 1;
}

/**
 * @param {object} o
 * @param {THREE.Mesh[]} o.setA
 * @param {THREE.Mesh[]} o.setB
 * @param {'hard'|'clearance'} o.mode
 * @param {number} o.tolerance  metres (clearance distance)
 * @param {boolean} o.ignoreSameLayer   skip pairs from the same layer (model vs model of different files)
 * @param {boolean} o.ignoreSameItem    skip pairs inside one item (pipe branch, equipment) — parts that touch by design
 * Parts of one component (tube + its end caps) never clash with each other, and each component pair is reported once.
 */
export async function runClash({ setA, setB, mode = 'hard', tolerance = 0, ignoreSameLayer = false, ignoreSameItem = true, onProgress, shouldStop } = {}) {
  const tol = mode === 'clearance' ? Math.max(0, tolerance) : 0;
  const touchEps = mode === 'hard' ? Math.max(0.0005, tolerance || 0) : 0.0005; // contact / penetration below this is ignored
  let touches = 0;
  const cache = new Map();
  const allMeshes = [...new Set([...setA, ...setB])].filter((m) => !m.isInstancedMesh && m.geometry?.attributes?.position?.count > 2);
  const inA = new Set(setA), inB = new Set(setB);
  // origin for float precision
  const big = new THREE.Box3();
  const boxes = new Map();
  for (const m of allMeshes) { const b = new THREE.Box3().setFromObject(m); boxes.set(m, b); big.union(b); }
  const origin = big.isEmpty() ? new THREE.Vector3() : big.getCenter(new THREE.Vector3());
  const items = allMeshes.map((m) => {
    const b = boxes.get(m).clone();
    if (tol) b.expandByScalar(tol / 2);
    return { m, b };
  }).sort((p, q) => p.b.min.x - q.b.min.x);

  // sweep & prune
  const pairs = [];
  const active = [];
  for (const it of items) {
    for (let k = active.length - 1; k >= 0; k--) if (active[k].b.max.x < it.b.min.x) active.splice(k, 1);
    for (const o of active) {
      const ok = (inA.has(it.m) && inB.has(o.m)) || (inB.has(it.m) && inA.has(o.m));
      if (!ok || it.m === o.m) continue;
      if (ignoreSameLayer && it.m.userData.layerId === o.m.userData.layerId) continue;
      const ua = it.m.userData, ub = o.m.userData;
      if (ua.comp && ua.comp === ub.comp) continue;
      if (ignoreSameItem && ua.item && ua.item === ub.item) continue;
      if (it.b.max.y < o.b.min.y || it.b.min.y > o.b.max.y || it.b.max.z < o.b.min.z || it.b.min.z > o.b.max.z) continue;
      pairs.push([o.m, it.m]);
    }
    active.push(it);
  }

  const results = [];
  const found = new Set();
  const compKey = (m) => m.userData.comp || m.userData.key;
  const nameOf = (m) => m.userData.name || m.name;
  const t1 = { point: new THREE.Vector3() }, t2 = { point: new THREE.Vector3() };
  let last = performance.now();
  for (let i = 0; i < pairs.length; i++) {
    if (shouldStop?.()) break;
    const [ma, mb] = pairs[i];
    const ka = compKey(ma), kb = compKey(mb);
    const pk = ka < kb ? `${ka}\n${kb}` : `${kb}\n${ka}`;
    if (found.has(pk)) continue; // this component pair is already reported
    const A = worldData(ma, origin, cache), B = worldData(mb, origin, cache);
    let type = null, dist = 0;
    const pt = new THREE.Vector3();
    const stats = { touch: false };
    let hard = false;
    if (A.bvh.intersectsGeometry(B.geo, IDENTITY)) {
      if (mode !== 'hard') hard = true;
      else {
        // cheapest first: a shared region thinner than the tolerance is contact; a point deep inside both is
        // interference; only the ambiguous rest needs the triangle-by-triangle crossing test
        const ib = A.box.clone().intersect(B.box);
        const sz = ib.getSize(new THREE.Vector3());
        if (Math.min(sz.x, sz.y, sz.z) <= touchEps * 2) stats.touch = true;
        else {
          const c = ib.getCenter(new THREE.Vector3());
          if (insideDepth(A, c) > touchEps && insideDepth(B, c) > touchEps) hard = true;
          else if (penetrates(A, B, touchEps, stats)) hard = true;
          else stats.touch = true;
        }
      }
    }
    if (hard) {
      type = 'Hard';
      const ib = A.box.clone().intersect(B.box);
      ib.getCenter(pt);
    } else if (stats.touch && mode === 'hard') {
      touches++;
    } else if (A.box.containsBox(B.box) && pointInside(B, A)) {
      type = 'Containment'; B.box.getCenter(pt);
    } else if (B.box.containsBox(A.box) && pointInside(A, B)) {
      type = 'Containment'; A.box.getCenter(pt);
    } else if (tol > 0) {
      const r = A.bvh.closestPointToGeometry(B.geo, IDENTITY, t1, t2, 0, tol);
      if (r && r.distance <= tol) { type = 'Clearance'; dist = r.distance; pt.copy(t1.point).lerp(t2.point, 0.5); }
    }
    if (type) {
      pt.add(origin);
      found.add(pk);
      results.push({
        n: results.length + 1, type, distance: dist,
        aKey: ma.userData.key, bKey: mb.userData.key, aComp: ka, bComp: kb, aName: nameOf(ma), bName: nameOf(mb),
        aLayer: ma.userData.layerId, bLayer: mb.userData.layerId,
        point: pt.toArray().map((x) => +x.toFixed(4)), status: 'New', note: '',
      });
    }
    if (performance.now() - last > 30) { onProgress?.((i + 1) / pairs.length, results.length); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
  }
  for (const d of cache.values()) d.geo.dispose();
  onProgress?.(1, results.length);
  return { results, pairsTested: pairs.length, meshes: allMeshes.length, touches };
}
