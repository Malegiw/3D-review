// Object identity of merged models.
// A plant model with 100k+ objects is merged by the converter into a few hundred blocks (tools/merge-raw.mjs) and a
// list is written next to the GLB: for every block, which objects it holds, in triangle order, with their names and
// layers. These helpers map a picked triangle back to its object, search by name and cut one object out as geometry.
import * as THREE from 'three';

export const OBJECTS_FILE = /\.objects\.json\.gz$/i;

/** Parsed object list stored with a model record, or null (not a merged model, or this browser cannot unzip it). */
export async function readObjects(files) {
  const f = (files || []).find((x) => OBJECTS_FILE.test(x.name));
  if (!f || typeof DecompressionStream === 'undefined') return null;
  try {
    const table = JSON.parse(await new Response(f.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text());
    return table?.v === 1 && Array.isArray(table.chunks) ? table : null;
  } catch (e) { console.warn('object list unreadable', e); return null; }
}

/**
 * Link the block meshes of a loaded model to the object list. A block is only linked when its triangle count equals
 * the list's, so a model that was edited afterwards never shows wrong names. Returns how many blocks were linked.
 */
export function attachObjects(meshes, table) {
  const byName = new Map(table.chunks.map((c) => [c.n, c]));
  let linked = 0;
  for (const m of meshes) {
    const c = byName.get(m.userData?.name || m.name);
    const idx = m.geometry?.index;
    if (!c || !idx) continue;
    const start = new Uint32Array(c.c.length + 1);
    for (let k = 0; k < c.c.length; k++) start[k + 1] = start[k] + c.c[k];
    if (start[c.c.length] * 3 !== idx.count) continue;
    m.userData.objs = { start, nm: c.nm, ly: c.ly, table };
    linked++;
  }
  return linked;
}

/** Position (in the block's list) of the object that owns triangle `face`. */
export function objectAt(objs, face) {
  const s = objs.start;
  let lo = 0, hi = s.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= face) lo = mid; else hi = mid - 1; }
  return lo;
}
export const objectName = (objs, k) => objs.table.names[objs.nm[k]] || '';
export const objectLayer = (objs, k) => objs.table.layers[objs.ly[k]] || '';

/** One object as its own small geometry (block-local coordinates, compact vertex numbering). */
export function objectGeometry(mesh, k) {
  const o = mesh.userData.objs, src = mesh.geometry, pos = src.attributes.position, nor = src.attributes.normal, idx = src.index;
  const from = o.start[k] * 3, to = o.start[k + 1] * 3;
  const remap = new Map(), order = [], ni = new Uint32Array(to - from);
  for (let i = from; i < to; i++) {
    const v = idx.getX(i);
    let r = remap.get(v);
    if (r === undefined) { r = order.length; order.push(v); remap.set(v, r); }
    ni[i - from] = r;
  }
  const p = new Float32Array(order.length * 3), n = nor ? new Float32Array(order.length * 3) : null;
  for (let j = 0; j < order.length; j++) {
    const v = order[j];
    p[3 * j] = pos.getX(v); p[3 * j + 1] = pos.getY(v); p[3 * j + 2] = pos.getZ(v);
    if (n) { n[3 * j] = nor.getX(v); n[3 * j + 1] = nor.getY(v); n[3 * j + 2] = nor.getZ(v); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (n) g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); else g.computeVertexNormals();
  g.setIndex(new THREE.BufferAttribute(ni, 1));
  return g;
}

/**
 * Objects whose name (or layer) contains `q`, across the given block meshes. Name matches come first.
 * @returns {{ total: number, items: { mesh: THREE.Mesh, k: number, byLayer: boolean }[] }}
 */
export function searchObjects(meshes, q, limit = 60) {
  const s = String(q || '').trim().toLowerCase();
  const out = { total: 0, items: [] };
  if (!s) return out;
  const layerHits = [], nameHits = [];
  for (const mesh of meshes) {
    const o = mesh.userData.objs;
    if (!o) continue;
    const t = o.table;
    if (!t._hit) t._hit = { names: t.names.map((x) => x.toLowerCase()), layers: t.layers.map((x) => x.toLowerCase()) };
    // match each distinct name / layer once, then walk the objects with plain array lookups
    const nameOk = (i) => t._hit.names[i].includes(s);
    const layerOk = (i) => t._hit.layers[i].includes(s);
    const cacheN = (t._cacheN ||= new Map()), cacheL = (t._cacheL ||= new Map());
    if (cacheN.size > 20) { cacheN.clear(); cacheL.clear(); }
    let mn = cacheN.get(s), ml = cacheL.get(s);
    if (!mn) { mn = Uint8Array.from(t._hit.names, (_, i) => (nameOk(i) ? 1 : 0)); cacheN.set(s, mn); }
    if (!ml) { ml = Uint8Array.from(t._hit.layers, (_, i) => (layerOk(i) ? 1 : 0)); cacheL.set(s, ml); }
    for (let k = 0; k < o.nm.length; k++) {
      const byName = mn[o.nm[k]] === 1;
      if (!byName && ml[o.ly[k]] !== 1) continue;
      out.total++;
      if (byName) {
        if (nameHits.length >= 20000) continue;
        const low = t._hit.names[o.nm[k]];
        nameHits.push({ mesh, k, byLayer: false, rank: low === s ? 0 : low.startsWith(s) ? 1 : 2, len: low.length, low });
      } else if (layerHits.length < limit) layerHits.push({ mesh, k, byLayer: true });
    }
  }
  // best matches first: the exact tag, then names that start with it, shorter names before longer ones
  nameHits.sort((x, y) => x.rank - y.rank || x.len - y.len || (x.low < y.low ? -1 : x.low > y.low ? 1 : 0));
  out.items = nameHits.slice(0, limit).map(({ mesh, k, byLayer }) => ({ mesh, k, byLayer }));
  for (const h of layerHits) { if (out.items.length >= limit) break; out.items.push(h); }
  return out;
}
