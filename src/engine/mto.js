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

/**
 * Build MTO rows for meshes. densities: { concrete, steel, other } in kg/m³.
 * overrides: Map(meshKey -> materialKey)
 */
export async function runMTO(meshes, { densities = {}, overrides = new Map(), layerName = () => '', onProgress } = {}) {
  const dens = { concrete: MATERIALS.concrete.density, steel: MATERIALS.steel.density, other: 0, ...densities };
  const rows = [];
  const box = new THREE.Box3(), size = new THREE.Vector3();
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const va = meshVolumeArea(m);
    box.setFromObject(m).getSize(size);
    const mat = overrides.get(m.userData.key) || m.userData.material || guessMaterial(m.name, m.userData.cat);
    const closed = m.isInstancedMesh ? true : openEdges(m.geometry) === 0;
    const weight = va.volume * (dens[mat] || 0);
    rows.push({
      key: m.userData.key, layer: layerName(m.userData.layerId), name: m.name, tag: m.userData.tag || '', cat: m.userData.cat || '',
      material: mat, L: size.x, W: size.z, H: size.y, area: va.area, volume: va.volume, density: dens[mat] || 0, weight, closed,
    });
    if (i % 40 === 0) { onProgress?.(i / meshes.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  onProgress?.(1);
  const summary = {};
  for (const r of rows) {
    const s = summary[r.material] ||= { material: r.material, count: 0, volume: 0, area: 0, weight: 0, open: 0 };
    s.count++; s.volume += r.volume; s.area += r.area; s.weight += r.weight; if (!r.closed) s.open++;
  }
  return { rows, summary: Object.values(summary) };
}
