// Generates public/samples/sample-contractor-model.glb — a small "EPC" model in millimetres that
// lines up with the sample plot plan and contains a few deliberate clashes for the demo.
// Usage: node tools/make-sample.mjs   (run from repo root after `npm i` in root and tools/)
import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from '../node_modules/three/build/three.module.js';
import fs from 'node:fs';

const W = 1190.5512, H = 841.8898, s = 500 * 0.0254 / 72;
const OX = (120 - W / 2) * s, OZ = (H / 2 - 120) * s;
const X = (xm) => xm + OX;            // plan metres → world X
const Z = (ym) => OZ - ym;            // plan metres → world Z (north = −Z)

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('EPC model');
const mats = {};
const mat = (name, hex, metal = 0.3) => (mats[name] ||= doc.createMaterial(name).setBaseColorFactor([...new THREE.Color(hex).toArray().map((c) => Math.pow(c, 2.2)), 1]).setMetallicFactor(metal).setRoughnessFactor(0.6));

function add(name, geo, material) {
  geo = geo.index ? geo : geo;
  geo.computeVertexNormals();
  const pos = geo.attributes.position.array.slice();
  for (let i = 0; i < pos.length; i++) pos[i] *= 1000; // metres → millimetres
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(geo.attributes.normal.array)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(geo.index.array)).setBuffer(buffer))
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}
const box = (x0, y0, z0, x1, y1, z1) => { // plan metres (x east, y north), z = elevation
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0), Math.abs(y1 - y0));
  g.translate(X((x0 + x1) / 2), (z0 + z1) / 2, Z((y0 + y1) / 2));
  return g;
};
const pipe = (a, b, od) => { // a,b = [x, y, elev] plan metres
  const A = new THREE.Vector3(X(a[0]), a[2], Z(a[1])), B = new THREE.Vector3(X(b[0]), b[2], Z(b[1]));
  const g = new THREE.CylinderGeometry(od / 2, od / 2, A.distanceTo(B), 20);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
};

// 10" process line P-1001 from separator V-201 to tank T-102 — crosses the bund wall low (clash).
const OD = 0.273;
const route = [[33.5, 22, 1.5], [33.5, 22, 5.0], [33.5, 43, 5.0], [60, 43, 5.0], [60, 46.5, 5.0], [60, 46.5, 0.8], [60, 54, 0.8], [57.6, 54, 0.8]];
for (let i = 1; i < route.length; i++) add(`PIPE 10in P-1001-A1 SEG-${String(i).padStart(2, '0')}`, pipe(route[i - 1], route[i], OD), mat('Pipe CS', '#d9c63a', 0.5));

// Cable tray MCC → control room — runs into a pipe rack column (clash).
add('CT-600 MCC-CR CABLE TRAY', box(101.3, 33.1, 3.5, 101.9, 44.9, 3.65), mat('Galvanised', '#c98a3a', 0.6));

// Operating platform beside V-201 + concrete pedestals.
add('STR-PF-01 DECK', box(20, 25, 2.8, 26, 29, 3.0), mat('Steel', '#6f8fb0', 0.5));
[[20.1, 25.1], [25.9, 25.1], [25.9, 28.9], [20.1, 28.9]].forEach(([x, y], i) => {
  add(`STR-PF-01 COL-0${i + 1} HSS200`, box(x - 0.1, y - 0.1, 0.8, x + 0.1, y + 0.1, 2.8), mat('Steel', '#6f8fb0', 0.5));
  add(`FDN-PED-0${i + 1} CONCRETE`, box(x - 0.3, y - 0.3, 0, x + 0.3, y + 0.3, 0.8), mat('Concrete', '#a3a6ad', 0));
});
// Pump skid foundation P-301A/B.
add('FDN-P-301 SLAB CONCRETE', box(39.5, 19.5, -0.35, 50.5, 23.5, -0.05), mat('Concrete', '#a3a6ad', 0));

const io = new NodeIO();
const out = new URL('../public/samples/sample-contractor-model.glb', import.meta.url);
const bin = await io.writeBinary(doc);
fs.writeFileSync(out, bin);
fs.writeFileSync(new URL('../public/samples/sample-contractor-model.json', import.meta.url), JSON.stringify({ glb: Buffer.from(bin).toString('base64') }));
console.log('wrote', out.pathname, fs.statSync(out).size, 'bytes (+ base64 .json fallback)');
