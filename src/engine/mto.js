// MTO: volume / surface area / weight per object (divergence theorem on triangle meshes).
import * as THREE from 'three';
import { guessMaterial, MATERIALS } from '../core/domain.js';

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3(), ref = new THREE.Vector3();
const M = new THREE.Matrix4(), IM = new THREE.Matrix4();

function accumulate(geo, matrix, out) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  ref.fromBufferAttribute(pos, idx ? idx.getX(0) : 0).applyMatrix4(matrix);
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(matrix).sub(ref);
    b.fromBufferAttribute(pos, ib).applyMatrix4(matrix).sub(ref);
    c.fromBufferAttribute(pos, ic).applyMatrix4(matrix).sub(ref);
    out.vol += a.dot(cr.crossVectors(b, c)) / 6;
    out.area += cr.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() / 2;
  }
}

/** Volume (m³) and area (m²) in world units. Cached per world matrix. */
export function meshVolumeArea(mesh) {
  mesh.updateWorldMatrix(true, false);
  const key = mesh.matrixWorld.elements.join(',') + '|' + (mesh.geometry.uuid);
  if (mesh.userData._va && mesh.userData._vaKey === key) return mesh.userData._va;
  const out = { vol: 0, area: 0 };
  if (mesh.isInstancedMesh) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, IM);
      M.multiplyMatrices(mesh.matrixWorld, IM);
      accumulate(mesh.geometry, M, out);
    }
  } else {
    accumulate(mesh.geometry, mesh.matrixWorld, out);
  }
  const res = { volume: Math.abs(out.vol), area: out.area, signed: out.vol };
  mesh.userData._va = res;
  mesh.userData._vaKey = key;
  return res;
}

/** Number of boundary (open) edges — 0 means watertight, so the volume is trustworthy. */
export function openEdges(geo, tol = 1e-5) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const vid = new Map();
  const ids = new Int32Array(pos.count);
  const inv = 1 / tol;
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * inv)},${Math.round(pos.getY(i) * inv)},${Math.round(pos.getZ(i) * inv)}`;
    let id = vid.get(k);
    if (id === undefined) { id = vid.size; vid.set(k, id); }
    ids[i] = id;
  }
  const edges = new Map();
  const add = (u, v) => { if (u === v) return; const k = u < v ? u * 4294967296 + v : v * 4294967296 + u; edges.set(k, (edges.get(k) || 0) + 1); };
  for (let i = 0; i + 2 < n; i += 3) {
    const x = ids[idx ? idx.getX(i) : i], y = ids[idx ? idx.getX(i + 1) : i + 1], z = ids[idx ? idx.getX(i + 2) : i + 2];
    add(x, y); add(y, z); add(z, x);
  }
  let open = 0;
  for (const cnt of edges.values()) if (cnt === 1) open++;
  return open;
}

const _va = new THREE.Vector3();
/**
 * Volume, surface and closedness of a group of meshes taken together (a component: tube + end caps, box faces…).
 * Closed when the summed vector area vanishes — for a watertight surface Σ area vectors = 0, and only then is the
 * divergence-theorem volume independent of the reference point. One pass, no edge maps.
 */
export function groupVolumeArea(meshes) {
  const list = [].concat(meshes).filter((m) => m?.geometry?.attributes?.position);
  const bb = new THREE.Box3();
  for (const m of list) { m.updateWorldMatrix(true, false); bb.expandByObject(m); }
  if (bb.isEmpty()) return { volume: 0, area: 0, closed: false };
  bb.getCenter(ref);
  let vol = 0, area = 0;
  const vecArea = new THREE.Vector3();
  const one = (geo, matrix) => {
    const pos = geo.attributes.position;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(matrix).sub(ref);
      b.fromBufferAttribute(pos, ib).applyMatrix4(matrix).sub(ref);
      c.fromBufferAttribute(pos, ic).applyMatrix4(matrix).sub(ref);
      vol += a.dot(cr.crossVectors(b, c)) / 6;
      _va.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      area += _va.length() / 2;
      vecArea.addScaledVector(_va, 0.5);
    }
  };
  for (const m of list) {
    if (m.isInstancedMesh) {
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, IM); M.multiplyMatrices(m.matrixWorld, IM); one(m.geometry, M); }
    } else one(m.geometry, m.matrixWorld);
  }
  // vanishing vector area is necessary but not sufficient (an uncapped tube also sums to zero): confirm that no
  // edge is used by only one triangle, welding vertices of all parts within a size-relative tolerance
  let closed = area > 0 && vecArea.length() <= area * 0.004;
  if (closed) closed = partsClose(list, Math.max(2e-5, bb.getSize(a).length() * 2e-4));
  return { volume: Math.abs(vol), area, closed, signed: vol };
}

const _w = new THREE.Vector3(), _w2 = new THREE.Vector3();
const QSCALE = { Int16Array: 32767, Uint16Array: 65535, Int8Array: 127, Uint8Array: 255 };

/** Edges used by exactly one triangle of a mesh (vertices welded on their stored values), as world-space segments. */
function meshBoundary(m) {
  const pos = m.geometry.attributes.position, idx = m.geometry.index;
  const arr = pos.isInterleavedBufferAttribute ? pos.data.array : pos.array;
  const S = pos.normalized ? QSCALE[arr.constructor.name] || 1 : 0;
  const ids = new Int32Array(pos.count);
  const map = new Map();
  let next = 0;
  for (let i = 0; i < pos.count; i++) {
    let k;
    if (S) k = ((Math.round(pos.getX(i) * S) + 70000) * 140001 + (Math.round(pos.getY(i) * S) + 70000)) * 140001 + (Math.round(pos.getZ(i) * S) + 70000);
    else k = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    let id = map.get(k);
    if (id === undefined) { id = next++; map.set(k, id); }
    ids[i] = id;
  }
  const N = next + 1;
  const edges = new Map();
  const n = idx ? idx.count : pos.count;
  const add = (u, v) => { if (u === v) return; const k = u < v ? u * N + v : v * N + u; const c = edges.get(k); edges.set(k, c === undefined ? 1 : c + 1); };
  for (let i = 0; i + 2 < n; i += 3) {
    const a1 = ids[idx ? idx.getX(i) : i], b1 = ids[idx ? idx.getX(i + 1) : i + 1], c1 = ids[idx ? idx.getX(i + 2) : i + 2];
    add(a1, b1); add(b1, c1); add(c1, a1);
  }
  const out = [];
  let rep = null;
  for (const [k, c] of edges) {
    if (c !== 1) continue;
    if (!rep) { rep = new Map(); for (let i = 0; i < pos.count; i++) if (!rep.has(ids[i])) rep.set(ids[i], i); }
    const u = Math.floor(k / N), v = k - u * N;
    const p = _w.fromBufferAttribute(pos, rep.get(u)).applyMatrix4(m.matrixWorld).clone();
    const q = _w2.fromBufferAttribute(pos, rep.get(v)).applyMatrix4(m.matrixWorld).clone();
    out.push([p, q]);
  }
  return out;
}

/** Closed when every open edge of one part is covered by an open edge of another part (end caps on a tube). */
function partsClose(meshes, tol) {
  const open = [];
  for (const m of meshes) for (const e of meshBoundary(m)) open.push(e);
  if (!open.length) return true;
  if (meshes.length < 2) return false;
  const cell = tol * 4;
  const grid = new Map();
  const keyOf = (v) => `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
  const mids = open.map(([p, q]) => p.clone().add(q).multiplyScalar(0.5));
  mids.forEach((mp, i) => { const k = keyOf(mp); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  const used = new Uint8Array(open.length);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    const [p, q] = open[i];
    const mp = mids[i];
    let found = -1;
    const cx = Math.floor(mp.x / cell), cy = Math.floor(mp.y / cell), cz = Math.floor(mp.z / cell);
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) || []) {
        if (j === i || used[j]) continue;
        const [r, s2] = open[j];
        if ((p.distanceTo(r) <= tol && q.distanceTo(s2) <= tol) || (p.distanceTo(s2) <= tol && q.distanceTo(r) <= tol)) { found = j; break; }
      }
    }
    if (found < 0) return false;
    used[i] = used[found] = 1;
  }
  return true;
}

/**
 * Build MTO rows per component (meshes sharing the original object name; plain meshes stand alone).
 * densities: { concrete, steel, other } in kg/m³. overrides: Map(componentKey | meshKey -> materialKey)
 * Volume is only counted for closed solids; open surfaces (single-sided panels, tubes without caps) report area only.
 */
export async function runMTO(meshes, { densities = {}, overrides = new Map(), layerName = () => '', onProgress } = {}) {
  const dens = { concrete: MATERIALS.concrete.density, steel: MATERIALS.steel.density, other: 0, ...densities };
  const groups = new Map();
  for (const m of meshes) {
    const k = m.userData.comp || m.userData.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const rows = [];
  const box = new THREE.Box3(), size = new THREE.Vector3();
  let i = 0, last = performance.now();
  for (const [k, list] of groups) {
    const first = list[0];
    const va = groupVolumeArea(list);
    box.makeEmpty();
    for (const m of list) box.expandByObject(m);
    box.getSize(size);
    const name = first.userData.name || first.name;
    const mat = overrides.get(k) || overrides.get(first.userData.key) || first.userData.material || guessMaterial(name, first.userData.cat);
    const volume = va.closed ? va.volume : 0;
    const weight = volume * (dens[mat] || 0);
    rows.push({
      key: first.userData.key, comp: k, layer: layerName(first.userData.layerId), name, parts: list.length, tag: first.userData.tag || '', cat: first.userData.cat || '',
      material: mat, L: size.x, W: size.z, H: size.y, area: va.area, volume, approxVolume: va.volume, density: dens[mat] || 0, weight, closed: va.closed,
    });
    if (++i % 50 === 0 && performance.now() - last > 30) { onProgress?.(i / groups.size); await new Promise((r) => setTimeout(r, 0)); last = performance.now(); }
  }
  onProgress?.(1);
  const summary = {};
  for (const r of rows) {
    const s = summary[r.material] ||= { material: r.material, count: 0, volume: 0, area: 0, weight: 0, open: 0 };
    s.count++; s.volume += r.volume; s.area += r.area; s.weight += r.weight; if (!r.closed) s.open++;
  }
  return { rows, summary: Object.values(summary) };
}
