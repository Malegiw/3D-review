// Object grouping for review: a converted plant model arrives as primitives (a pipe = tube + caps, an equipment =
// dozens of boxes/cylinders). Engineers review components and items, so every mesh gets:
//   part      the mesh itself
//   component meshes that share the original object name (e.g. "TUBE 3 of BRANCH /P-101/B1")
//   item      meshes that share the owner after " of " (e.g. "BRANCH /P-101/B1", "EQUIPMENT /T-101")
import * as THREE from 'three';

/** Original (unsanitised) object name: GLTFLoader keeps it in userData.name. */
export const displayName = (m) => m.userData?.name || m.name || 'Object';

// Hierarchy levels that make a reviewable "item" (E3D / PDMS / Plant 3D naming): a pipe branch, an equipment,
// a structure. Names carry the chain, e.g. "ileave tube of ELBOW 6 of BRANCH 1 of PIPE 8 of ZONE /PHR/EX/PIPE".
const ITEM_LEVEL = /^(BRANCH|EQUIPMENT|SUBEQUIPMENT|STRUCTURE|SUBSTRUCTURE|STRU|EQUI|SUBE|BRAN|HVAC|CABLETRAY|CTRAY|SUPPORT|HANGER)\b/i;

/** "TUBE 3 of BRANCH /P-101/B1" → { type: 'TUBE', owner: 'BRANCH /P-101/B1' } (owner = nearest item level) */
export function parseName(name) {
  const s = String(name || '');
  const parts = s.split(' of ');
  if (parts.length < 2) return { type: '', owner: '' };
  const type = parts[0].trim().replace(/\s*\d+$/, '');
  let k = parts.findIndex((p, i) => i > 0 && ITEM_LEVEL.test(p.trim()));
  if (k < 0) k = 1;
  return { type, owner: parts.slice(k).join(' of ').trim() };
}

/** Assign component / item keys to the meshes of one layer and return the group maps. */
export function indexLayer(layerId, meshes) {
  const comps = new Map();
  const items = new Map();
  for (const m of meshes) {
    const orig = m.userData?.name;
    const name = orig || m.name || 'Object';
    const { owner } = parseName(name);
    const ck = orig ? `${layerId}|${orig}` : `${layerId}|#${m.uuid}`; // without an original name each mesh stands alone
    const ik = owner ? `${layerId}#${owner}` : ck;
    m.userData.comp = ck;
    m.userData.item = ik;
    if (!comps.has(ck)) comps.set(ck, { key: ck, name, owner, meshes: [] });
    comps.get(ck).meshes.push(m);
    if (!items.has(ik)) items.set(ik, { key: ik, name: owner || name, meshes: [], comps: new Set() });
    const it = items.get(ik);
    it.meshes.push(m);
    it.comps.add(ck);
  }
  return { comps, items };
}

/** Site coordinates (E, N, Elev in metres) of a world point picked on a layer, restoring the converter's origin. */
export function toSite(world, layer) {
  if (!layer) return { e: world.x, n: -world.z, el: world.y };
  const local = layer.inner.worldToLocal(world.clone());
  const o = layer.origin || [0, 0, 0];
  const u = layer.units || 1;
  if (layer.zUp) return { e: local.x * u + o[0], n: local.y * u - o[2], el: local.z * u + o[1] };
  return { e: local.x * u + o[0], n: -(local.z * u + o[2]), el: local.y * u + o[1] };
}

/** Combined world bounds of meshes. */
export function boundsOf(meshes) {
  const b = new THREE.Box3();
  for (const m of meshes) b.expandByObject(m);
  return b;
}
