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
  if (!dropped || dropped > valid.length * maxDropped) return all();
  valid.forEach((b, i) => { if (keep[i]) box.union(b); });
  return { box, dropped };
}
