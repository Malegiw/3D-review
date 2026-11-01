// Model import: open formats load directly in the browser; Autodesk/SketchUp natives go through the APS pipeline.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';

MeshoptDecoder.ready?.catch?.(() => {}); // strict CSP without wasm: only meshopt-compressed GLBs are affected

export const OPEN_FORMATS = ['glb', 'gltf', 'fbx', 'obj', 'dae', 'stl', 'ply'];
export const NATIVE_FORMATS = {
  nwd: 'Navisworks Document', nwc: 'Navisworks Cache', nwf: 'Navisworks File Set',
  dwfx: 'Autodesk DWFx', dwf: 'Autodesk DWF', skp: 'SketchUp', rvt: 'Revit', ifc: 'IFC', dwg: 'AutoCAD DWG',
  '3dm': 'Rhino', step: 'STEP', stp: 'STEP', iam: 'Inventor', ipt: 'Inventor',
};
export const ACCEPT = [...OPEN_FORMATS, 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'ktx2', ...Object.keys(NATIVE_FORMATS)].map((e) => `.${e}`).join(',');
const PRIORITY = ['glb', 'gltf', 'fbx', 'dae', 'obj', 'stl', 'ply'];
export const ext = (n) => (n.split('.').pop() || '').toLowerCase();

const DEFAULT_MAT = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, metalness: 0.25, roughness: 0.6 });
let draco;
function getDraco() {
  if (!draco) draco = new DRACOLoader(); // three r18x bundles decoder URLs via import.meta.url
  return draco;
}

/** files: [{name, blob}] — returns { object, main } or throws { native: true } for proprietary formats */
export async function loadModelFiles(files) {
  const byExt = (e) => files.find((f) => ext(f.name) === e);
  const main = PRIORITY.map(byExt).find(Boolean);
  if (!main) {
    const nat = files.find((f) => NATIVE_FORMATS[ext(f.name)]);
    if (nat) { const err = new Error(`${NATIVE_FORMATS[ext(nat.name)]} (.${ext(nat.name)}) must be converted first`); err.native = ext(nat.name); err.file = nat.name; throw err; }
    throw new Error('No supported 3D file found. Use GLB, glTF, FBX, OBJ, DAE, STL or PLY.');
  }
  const urls = new Map(files.map((f) => [f.name.split(/[\\/]/).pop().toLowerCase(), URL.createObjectURL(f.blob)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') && [...urls.values()].includes(url)) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]).toLowerCase();
    return urls.get(base) || url;
  });
  const mainUrl = urls.get(main.name.split(/[\\/]/).pop().toLowerCase());
  const e = ext(main.name);
  let object;
  try {
    if (e === 'glb' || e === 'gltf') {
      const l = new GLTFLoader(manager).setDRACOLoader(getDraco()).setMeshoptDecoder(MeshoptDecoder);
      const g = await l.loadAsync(mainUrl);
      object = g.scene;
      object.userData.nexus = g.asset?.extras?.nexus || null; // converter metadata: removed origin, units
    } else if (e === 'fbx') {
      object = await new FBXLoader(manager).loadAsync(mainUrl);
    } else if (e === 'dae') {
      object = (await new ColladaLoader(manager).loadAsync(mainUrl)).scene;
    } else if (e === 'obj') {
      const l = new OBJLoader(manager);
      const mtl = byExt('mtl');
      if (mtl) { const mats = await new MTLLoader(manager).loadAsync(urls.get(mtl.name.toLowerCase())); mats.preload(); l.setMaterials(mats); }
      object = await l.loadAsync(mainUrl);
    } else if (e === 'stl' || e === 'ply') {
      const geo = await (e === 'stl' ? new STLLoader(manager) : new PLYLoader(manager)).loadAsync(mainUrl);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      object = new THREE.Mesh(geo, DEFAULT_MAT);
      object.name = main.name.replace(/\.[^.]+$/, '');
    }
  } finally {
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 4000);
  }
  // tidy materials: OBJ/STL often come without lighting-friendly materials
  object.traverse((o) => {
    if (!o.isMesh) return;
    const fix = (m) => {
      if (!m) return DEFAULT_MAT;
      if (m.isMeshBasicMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial) {
        return new THREE.MeshStandardMaterial({ color: m.color || 0x8fa3b8, map: m.map || null, metalness: 0.2, roughness: 0.65, transparent: m.transparent, opacity: m.opacity, side: m.side });
      }
      return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
  return { object, main: main.name, format: e };
}

/** Units guess from raw extents: plant models > 3 km across are almost certainly millimetres. */
export function guessUnits(object) {
  const s = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  const m = Math.max(s.x, s.y, s.z);
  if (m > 3000) return 'mm';
  return 'm';
}
/** Z-up guess: STL / many CAD exports are Z-up; glTF/FBX/DAE are normalised to Y-up by their loaders. */
export function guessZUp(format) { return format === 'stl' || format === 'ply'; }
