// 4D build-sequence reveal: the whole model "constructs itself" as overall progress advances — no mapping needed.
// Meshes are ranked into construction order (civil → structure → equipment → piping → electrical, then a sweep
// across the site); each grows out of the ground (scale-y about y=0) when its turn comes.
import * as THREE from 'three';
import { CAT_ORDER } from '../core/domain.js';

const PHASES = [
  [/paving|road|gravel|grading|site|fence|drain|ditch|bund|dike/i, 0],
  [/found|pile|footing|pedestal|slab|pit|sump|concrete|cellar/i, 1],
  [/steel|struct|rack|support|frame|column|beam|platform|stair|ladder/i, 2],
  [/build|shelter|room|kiosk|control|mcc|substation/i, 3],
  [/tank|vessel|separator|scrubber|surge|pump|compressor|exchanger|equip|skid|filter/i, 4],
  [/pipe|pipeline|header|line|valve|flange|spool|fitting/i, 5],
  [/cable|tray|elec|power|light|pole|instrument|telecom|cctv|panel/i, 6],
];
export function phaseOf(m, layerName = '') {
  const s = `${m.name || ''} ${layerName} ${m.userData.tag || ''}`;
  for (const [re, p] of PHASES) if (re.test(s)) return p;
  const c = CAT_ORDER.indexOf(m.userData.cat);
  if (c < 0) return 3.5;
  return c <= 4 ? 0.5 + c * 0.25 : c <= 8 ? 3 + (c - 5) * 0.4 : c <= 10 ? 4 : c === 11 ? 2.4 : 5;
}

const ease = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2); // easeOutBack
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function createSequence(viewer) {
  let list = [], sig = '', active = false;
  const base = new Map();       // mesh → { sy, vis }
  const box = new THREE.Box3();

  function collect(skip) {
    const metas = [];
    for (const L of viewer.layers.values()) for (const m of L.meshes) {
      if (m.userData.ground || skip?.(m)) continue;
      const g = m.geometry; if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox.clone().applyMatrix4(m.matrixWorld);
      metas.push({ m, b, c: b.getCenter(new THREE.Vector3()), ph: phaseOf(m, L.name || L.id || '') });
    }
    if (!metas.length) return [];
    box.makeEmpty(); metas.forEach((x) => box.union(x.b));
    const o = box.min;
    metas.forEach((x) => { x.d = Math.hypot(x.c.x - o.x, x.c.z - o.z); });
    metas.sort((a, b) => a.ph - b.ph || a.d - b.d);
    return metas;
  }

  return {
    get count() { return list.length; },
    get active() { return active; },
    /** (Re)build the ordered list. skip(mesh)→true leaves a mesh alone (e.g. it is mapped by hand). */
    prepare(skip) {
      this.reset();
      list = collect(skip);
      for (const x of list) base.set(x.m, { sy: x.m.scale.y, vis: x.m.visible });
      active = list.length > 0;
      sig = list.length + ':' + list.map((x) => x.m.userData.key).slice(0, 3).join();
      return list.length;
    },
    /** Reveal progress 0..1 → returns the metas currently growing (for camera follow). */
    set(frac) {
      if (!active) return [];
      const n = list.length, span = Math.max(3, n * 0.08);
      const p = clamp01(frac) * (n + span);
      const growing = [];
      for (let i = 0; i < n; i++) {
        const { m } = list[i], b = base.get(m);
        const k = clamp01((p - i) / span);
        if (k <= 0) { m.visible = false; continue; }
        m.visible = b.vis;
        m.scale.y = Math.max(0.0001, ease(k) * b.sy);
        m.updateMatrixWorld(true);
        if (k < 1) growing.push(list[i]);
      }
      viewer.requestRender();
      return growing;
    },
    reset() {
      for (const [m, b] of base) { m.scale.y = b.sy; m.visible = b.vis; m.updateMatrixWorld(true); }
      base.clear(); list = []; active = false;
      viewer.requestRender();
    },
    bounds() { return box.clone(); },
  };
}
