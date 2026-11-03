// Heavy NWD models: merge the per-object nodes of nwd2glb's raw GLB into a few hundred chunks, and keep a compact
// list of which triangles of which chunk belong to which original object (name, layer) so the app can still search,
// pick and highlight single objects.
//
// A model with ~200k objects as one mesh each is 100+ MB of JSON, takes ~40 min to post-process and is unusable on a
// tablet (one draw call each). Above the threshold the instances are baked into world space and merged per
// (layer, material, grid cell).
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';

export const MERGE_ABOVE = Number(process.env.NWD_MERGE_ABOVE) || 20000;
export const CELL_M = Number(process.env.NWD_CELL_M) || 40;
export const MAX_CHUNKS = Number(process.env.NWD_MAX_CHUNKS) || 3000;

export function readGlb(file) {
  const b = fs.readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // own, 4-byte aligned copy
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(Buffer.from(ab, 20, jl).toString('utf8'));
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: ab.slice(28 + jl, 28 + jl + bl) };
}

/**
 * raw nwd2glb GLB (one node per object, own mesh each) → merged GLB written to outPath.
 * Returns { chunks, triangles, objects } where `objects` is the identity list:
 *   { v: 1, layers: [layer…], names: [object name…], chunks: [{ n: chunk node name, c: [triangles per object…], nm: [name index…], ly: [layer index…] }] }
 * Objects appear in each chunk in the order their triangles are stored (start of object k = sum of c[0..k-1]).
 */
export function mergeRaw(rawPath, outPath, { log = () => {}, cellM = CELL_M, maxChunks = MAX_CHUNKS } = {}) {
  const { json, bin } = readGlb(rawPath);
  const { nodes, meshes, accessors, bufferViews } = json;
  const view = (ai, Ctor, comps) => { const a = accessors[ai], bv = bufferViews[a.bufferView]; return new Ctor(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * comps); };
  // per object: layer, material, normals?, world position of its box centre (x/z), vertex and index counts
  const info = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.mesh == null || !n.matrix) continue;
    const prim = meshes[n.mesh].primitives[0];
    const pa = accessors[prim.attributes.POSITION], ia = accessors[prim.indices];
    const m = n.matrix, c = [0, 1, 2].map((k) => (pa.min[k] + pa.max[k]) / 2);
    info.push({ i, layer: n.extras?.layer ?? '', material: prim.material ?? 0, hasN: prim.attributes.NORMAL != null, verts: pa.count, inds: ia.count,
      wx: m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], wz: m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14] });
  }
  // Start fine (layer × material × cell); if that gives more than maxChunks meshes, drop the layer and/or use larger cells.
  const keyOf = (o, byLayer, cell) => `${byLayer ? o.layer : ''}\u0001${o.material}\u0001${o.hasN ? 1 : 0}\u0001${Math.floor(o.wx / cell)}\u0001${Math.floor(o.wz / cell)}`;
  const levels = [[true, cellM], [false, cellM], [false, cellM * 2], [false, cellM * 4], [false, cellM * 8], [false, cellM * 16]];
  let level = levels.length - 1;
  for (let l = 0; l < levels.length; l++) {
    if (new Set(info.map((o) => keyOf(o, levels[l][0], levels[l][1]))).size <= maxChunks) { level = l; break; }
  }
  const [byLayer, cell] = levels[level];
  const groups = new Map(), list = [];
  for (const o of info) {
    const key = keyOf(o, byLayer, cell);
    let g = groups.get(key);
    if (!g) { g = { layer: byLayer ? o.layer : '', material: o.material, hasN: o.hasN, verts: 0, inds: 0, nodes: [] }; groups.set(key, g); list.push(g); }
    g.verts += o.verts; g.inds += o.inds; g.nodes.push(o.i);
  }
  log(`  grouping by ${byLayer ? 'layer · ' : ''}material · ${cell} m cells → ${list.length} chunks`);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('NWD');
  const mats = new Map();
  const material = (mi) => {
    if (mats.has(mi)) return mats.get(mi);
    const s = json.materials?.[mi] || {}, p = s.pbrMetallicRoughness || {};
    const mat = doc.createMaterial(s.name || `NW-${mi}`).setBaseColorFactor(p.baseColorFactor || [0.62, 0.66, 0.72, 1])
      .setMetallicFactor(p.metallicFactor ?? 0.15).setRoughnessFactor(p.roughnessFactor ?? 0.7).setDoubleSided(!!s.doubleSided);
    if (s.alphaMode) mat.setAlphaMode(s.alphaMode);
    mats.set(mi, mat);
    return mat;
  };
  const dict = (arr, map, s) => { let k = map.get(s); if (k === undefined) { k = arr.length; arr.push(s); map.set(s, k); } return k; };
  const objects = { v: 1, layers: [], names: [], chunks: [] };
  const layerIdx = new Map(), nameIdx = new Map();
  const perLayer = new Map();
  let triangles = 0;
  for (const g of list) {
    const pos = new Float32Array(g.verts * 3), nrm = g.hasN ? new Float32Array(g.verts * 3) : null, idx = new Uint32Array(g.inds);
    const counts = [], nm = [], ly = [];
    let vo = 0, io = 0;
    for (const i of g.nodes) {
      const n = nodes[i], m = n.matrix, prim = meshes[n.mesh].primitives[0];
      const P = view(prim.attributes.POSITION, Float32Array, 3), I = view(prim.indices, Uint32Array, 1), cnt = P.length / 3;
      for (let v = 0; v < cnt; v++) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], o = 3 * (vo + v);
        pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      // columns c0,c1,c2 of the 3×3 part: inverse-transpose · n = (n.x·(c1×c2) + n.y·(c2×c0) + n.z·(c0×c1)) / det
      const a = [m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8]];
      const det = m[0] * a[0] + m[1] * a[1] + m[2] * a[2], flip = det < 0, sgn = flip ? -1 : 1;
      if (nrm) {
        const N = view(prim.attributes.NORMAL, Float32Array, 3);
        const b = [m[9] * m[2] - m[10] * m[1], m[10] * m[0] - m[8] * m[2], m[8] * m[1] - m[9] * m[0]];
        const c = [m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4]];
        for (let v = 0; v < cnt; v++) {
          const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2], o = 3 * (vo + v);
          const x = nx * a[0] + ny * b[0] + nz * c[0], y = nx * a[1] + ny * b[1] + nz * c[1], z = nx * a[2] + ny * b[2] + nz * c[2];
          const l = Math.hypot(x, y, z) || 1;
          nrm[o] = sgn * x / l; nrm[o + 1] = sgn * y / l; nrm[o + 2] = sgn * z / l;
        }
      }
      for (let t = 0; t < I.length; t += 3) { // mirrored instances: reverse the winding so faces keep pointing outwards
        idx[io + t] = I[t] + vo;
        idx[io + t + 1] = I[t + (flip ? 2 : 1)] + vo;
        idx[io + t + 2] = I[t + (flip ? 1 : 2)] + vo;
      }
      counts.push(I.length / 3);
      nm.push(dict(objects.names, nameIdx, n.name || ''));
      ly.push(dict(objects.layers, layerIdx, n.extras?.layer ?? ''));
      vo += cnt; io += I.length;
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
      .setMaterial(material(g.material));
    if (nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer));
    const k = (perLayer.get(g.layer) || 0) + 1;
    perLayer.set(g.layer, k);
    const name = `${g.layer || 'Model'} · ${k}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras({ layer: g.layer, objects: g.nodes.length, merged: true }));
    objects.chunks.push({ n: name, c: counts, nm, ly });
    triangles += idx.length / 3;
    g.nodes = null;
  }
  if (json.asset?.extras) doc.getRoot().getAsset().extras = { ...json.asset.extras, nexus: { ...json.asset.extras.nexus, merged: true } };
  return new NodeIO().write(outPath, doc).then(() => ({ chunks: list.length, triangles, objects }));
}
