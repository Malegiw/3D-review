// 4D build-sequence reveal: the whole model "constructs itself" as overall progress advances — no mapping needed.
// Meshes are ranked into construction order (civil → structure → equipment → piping → electrical, then a sweep
// across the site); each grows out of the ground (scale-y about y=0) when its turn comes.
import * as THREE from 'three';
import { CAT_ORDER } from '../core/domain.js';
import { classify, layerOfName, routeOrder } from './automap.js';

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
  const s = `${m.userData?.name || m.name || ''} ${layerName} ${m.userData.tag || ''}`;
  const c0 = classify(m.userData?.name || m.name);
  if (c0 === 'concrete' || c0 === 'drainage') return 1;
  if (c0 === 'support') return 2;
  if (c0 === 'equipment') return 4;
  if (c0 === 'pipe') return 5;
  for (const [re, p] of PHASES) if (re.test(s)) return p;
  const c = CAT_ORDER.indexOf(m.userData.cat);
  if (c < 0) return 3.5;
  return c <= 4 ? 0.5 + c * 0.25 : c <= 8 ? 3 + (c - 5) * 0.4 : c <= 10 ? 4 : c === 11 ? 2.4 : 5;
}

const ease = (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2); // easeOutBack
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function createSequence(viewer) {
  let list = [], sig = '', active = false, driven = [];
  const base = new Map();       // mesh → { sy, vis }
  const box = new THREE.Box3();

  function collect(skip) {
    const metas = [];
    for (const L of viewer.layers.values()) for (const m of L.meshes) {
      if (m.userData.ground || skip?.(m)) continue;
      if (classify(m.userData?.name || m.name) === 'existing') continue; // what is already there stays put
      const g = m.geometry; if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox.clone().applyMatrix4(m.matrixWorld);
      metas.push({ m, b, c: b.getCenter(new THREE.Vector3()), ph: phaseOf(m, L.name || L.id || '') });
    }
    if (!metas.length) return [];
    box.makeEmpty(); metas.forEach((x) => box.union(x.b));
    const o = box.min;
    metas.forEach((x) => { x.d = Math.hypot(x.c.x - o.x, x.c.z - o.z); });
    // pipes are laid along their route, not swept across the site
    const pipes = metas.filter((x) => x.ph === 5);
    if (pipes.length > 1) { const r = routeOrder(pipes.map((x) => x.c)); pipes.forEach((x, i) => { x.d = r[i]; }); }
    metas.sort((a, b) => a.ph - b.ph || a.d - b.d);
    return metas;
  }

  return {
    get count() { return list.length; },
    get active() { return active; },
    /** (Re)build the ordered list. skip(mesh)→true leaves a mesh alone (e.g. it is mapped by hand). */
    prepare(skip, groups = []) {
      this.reset();
      list = collect(skip);
      // groups: [{ meshes, frac() }] — meshes revealed by their own package progress, in route order
      if (!list.length) box.makeEmpty();
      driven = groups.filter((g) => g.meshes.length).map((g) => {
        const metas = g.meshes.map((m) => { const b = (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox)).clone().applyMatrix4(m.matrixWorld); return { m, b, c: b.getCenter(new THREE.Vector3()) }; });
        const r = routeOrder(metas.map((x) => x.c)); metas.forEach((x, i) => { x.d = r[i]; }); metas.sort((a, b) => a.d - b.d);
        for (const x of metas) base.set(x.m, { sy: x.m.scale.y, vis: x.m.visible });
        metas.forEach((x) => box.expandByPoint(x.c));
        return { metas, frac: g.frac };
      });
      for (const x of list) base.set(x.m, { sy: x.m.scale.y, vis: x.m.visible });
      active = list.length > 0 || driven.length > 0;
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
      for (const g of driven) {
        const gn = g.metas.length, gs = Math.max(1, gn * 0.15), gp = clamp01(g.frac()) * (gn + gs);
        g.metas.forEach((x, i) => {
          const b = base.get(x.m), k = clamp01((gp - i) / gs);
          if (k <= 0) { x.m.visible = false; return; }
          x.m.visible = b.vis; x.m.scale.y = Math.max(0.0001, ease(k) * b.sy); x.m.updateMatrixWorld(true);
          if (k < 1) growing.push(x);
        });
      }
      viewer.requestRender();
      return growing;
    },
    reset() {
      for (const [m, b] of base) { m.scale.y = b.sy; m.visible = b.vis; m.updateMatrixWorld(true); }
      base.clear(); list = []; driven = []; active = false;
      viewer.requestRender();
    },
    bounds() { return box.clone(); },
  };
}
