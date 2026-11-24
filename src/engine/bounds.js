// Camera framing that ignores stragglers: a few objects far from the rest (a survey point at 0,0, a mis-placed tag) must not
// decide how far the camera backs off — a plant of 240 m with one object 168 km away would otherwise open as a dot.
import * as THREE from 'three';

const AX = ['x', 'y', 'z'];

/**
 * @param {THREE.Box3[]} boxes  world boxes, one per object
 * @param {{trim?: number, maxDropped?: number}} o  trim = percentile cut on box centres, maxDropped = share of objects that may be
 *        treated as stragglers (more than that means the scene really is spread out, so everything is kept)
 * @returns {{box: THREE.Box3, dropped: number}}
 */
export function robustBounds(boxes, { trim = 0.02, maxDropped = 0.05 } = {}) {
  const valid = boxes.filter((b) => b && !b.isEmpty());
  const box = new THREE.Box3();
  const all = () => { for (const b of valid) box.union(b); return { box, dropped: 0 }; };
  if (valid.length < 12) return all();
  const centres = valid.map((b) => b.getCenter(new THREE.Vector3()));
  const lo = [], hi = [];
  for (const k of AX) {
    const a = Float64Array.from(centres, (c) => c[k]).sort();
    lo.push(a[Math.floor(a.length * trim)]);
    hi.push(a[Math.min(a.length - 1, Math.ceil(a.length * (1 - trim)) - 1)]);
  }
  const keep = centres.map((c) => AX.every((k, i) => {
    const pad = (hi[i] - lo[i]) * 0.5 + 5; // half the core span + 5 m of slack
    return c[k] >= lo[i] - pad && c[k] <= hi[i] + pad;
  }));
  const dropped = keep.reduce((n, k) => n + (k ? 0 : 1), 0);
  if (dropped > valid.length * maxDropped) return mainSite(valid, centres) || all();
  if (!dropped) return mainSite(valid, centres) || all();
  const kv = valid.filter((_, i) => keep[i]);
  const site = mainSite(kv, centres.filter((_, i) => keep[i]));
  if (site) return { box: site.box, dropped: dropped + site.dropped };
  kv.forEach((b) => box.union(b));
  return { box, dropped };
}

/**
 * One file can hold two sites kilometres apart (e.g. a station and a remote tie-in). Group box centres into connected
 * plan cells (gap ≤ ~one cell) and, when one group clearly dominates (≥ 80 % of the objects) and the groups are far
 * apart, frame that group only.
 */
export function mainSite(valid, centres = valid.map((b) => b.getCenter(new THREE.Vector3())), { cell = 250, share = 0.8, minGap = 1000 } = {}) {
  if (valid.length < 12) return null;
  const key = (c) => `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
  const cells = new Map();
  centres.forEach((c, i) => { const k = key(c); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
  const seen = new Set(), groups = [];
  for (const k of cells.keys()) {
    if (seen.has(k)) continue;
    const g = [], st = [k]; seen.add(k);
    while (st.length) {
      const q = st.pop(); g.push(...cells.get(q));
      const [x, z] = q.split(',').map(Number);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const n = `${x + dx},${z + dz}`;
        if (cells.has(n) && !seen.has(n)) { seen.add(n); st.push(n); }
      }
    }
    groups.push(g);
  }
  if (groups.length < 2) return null;
  groups.sort((a, b) => b.length - a.length);
  const main = groups[0];
  if (main.length < valid.length * share) return null;
  const box = new THREE.Box3();
  for (const i of main) box.union(valid[i]);
  const other = new THREE.Box3();
  for (const g of groups.slice(1)) for (const i of g) other.union(valid[i]);
  const gap = Math.max(other.min.x - box.max.x, box.min.x - other.max.x, other.min.z - box.max.z, box.min.z - other.max.z);
  if (gap < minGap) return null;
  return { box, dropped: valid.length - main.length };
}
