// Batched display for large layers.
// A contractor model can hold tens of thousands of separate objects; drawing each as its own Mesh costs one draw
// call per object and makes orbiting sluggish (16k calls for a typical E3D export). Here every layer above a size
// threshold is drawn by one BatchedMesh per material instead. The original meshes stay in the scene graph on render
// layer 1 — invisible to the camera but still used for picking, bounds, clash, MTO and highlighting.
import * as THREE from 'three';

export const BATCH_MIN = 400;          // smaller layers keep plain meshes
export const HIDDEN_LAYER = 1;         // render layer of the originals once batched

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

/** Float32 copy of position / normal / index so every geometry in a batch has identical attribute formats. */
function plainGeometry(src) {
  const pos = src.attributes.position;
  const n = pos.count;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = pos.getX(i); p[i * 3 + 1] = pos.getY(i); p[i * 3 + 2] = pos.getZ(i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const nor = src.attributes.normal;
  if (nor) {
    const q = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { q[i * 3] = nor.getX(i); q[i * 3 + 1] = nor.getY(i); q[i * 3 + 2] = nor.getZ(i); }
    g.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  } else g.computeVertexNormals();
  const idx = src.index;
  if (idx) {
    const a = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) a[i] = idx.getX(i);
    g.setIndex(new THREE.BufferAttribute(a, 1));
  } else {
    const a = new Uint32Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    g.setIndex(new THREE.BufferAttribute(a, 1));
  }
  return g;
}

/**
 * Build batches for a layer. Returns { batches, dispose } and stores { batch, id } on each mesh as userData._b.
 * @param {THREE.Object3D} parent  the layer's inner group (batches inherit its units / axis / offset transform)
 * @param {THREE.Mesh[]} meshes
 */
export function batchLayer(parent, meshes) {
  parent.updateMatrixWorld(true);
  _inv.copy(parent.matrixWorld).invert();
  // group by material
  const byMat = new Map();
  for (const m of meshes) {
    if (m.isInstancedMesh || m.isSkinnedMesh || Array.isArray(m.material) || !m.geometry?.attributes?.position) continue;
    const mat = m.userData.baseMat || m.material;
    // textured or vertex-coloured meshes keep their own draw call (the batch carries position + normal only)
    if (mat.map || mat.vertexColors || m.geometry.attributes.color || m.geometry.morphAttributes?.position) continue;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(m);
  }
  const plain = new Map(); // source geometry → plain copy
  const batches = [];
  for (const [mat, list] of byMat) {
    let verts = 0, idx = 0;
    const geos = new Map();
    for (const m of list) {
      let g = plain.get(m.geometry);
      if (!g) { g = plainGeometry(m.geometry); plain.set(m.geometry, g); }
      if (!geos.has(g)) { geos.set(g, -1); verts += g.attributes.position.count; idx += g.index.count; }
    }
    const batch = new THREE.BatchedMesh(list.length, Math.max(3, verts), Math.max(3, idx), mat);
    batch.name = `batch:${mat.name || mat.uuid}`;
    batch.userData.helper = true;
    batch.userData.batch = true;
    batch.userData.baseMat = mat;
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = !!mat.transparent;
    for (const g of geos.keys()) geos.set(g, batch.addGeometry(g));
    for (const m of list) {
      const gid = geos.get(plain.get(m.geometry));
      const id = batch.addInstance(gid);
      m.updateWorldMatrix(true, false);
      _m.multiplyMatrices(_inv, m.matrixWorld);
      batch.setMatrixAt(id, _m);
      batch.setVisibleAt(id, m.visible);
      m.userData._b = { batch, id };
      m.layers.set(HIDDEN_LAYER);
    }
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    parent.add(batch);
    batches.push(batch);
  }
  for (const g of plain.values()) g.dispose(); // BatchedMesh copied the data
  return {
    batches,
    dispose() { for (const b of batches) { b.removeFromParent(); b.dispose(); } },
  };
}

/** Keep a batched mesh's instance in step with its original (visibility and highlight state). */
export function syncInstance(m, { highlighted = false } = {}) {
  const b = m.userData._b;
  if (!b) return false;
  const show = m.visible && !highlighted;
  if (b.batch.getVisibleAt(b.id) !== show) b.batch.setVisibleAt(b.id, show);
  if (highlighted) m.layers.enable(0); else m.layers.disable(0);
  return true;
}
