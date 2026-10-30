import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree } from 'three-mesh-bvh';
import { meshVolumeArea, openEdges, runMTO } from '../src/engine/mto.js';
import { runClash } from '../src/engine/clash.js';
import { buildPlotModel } from '../src/engine/plotbuild.js';
import { samplePlan } from '../src/core/store.js';
import { buildXlsx, parseCSV } from '../src/core/xlsx.js';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

const tag = (o, layerId) => { let i = 0; o.updateMatrixWorld(true); const out = []; o.traverse((m) => { if (m.isMesh && !m.userData.helper) { m.userData.layerId = layerId; m.userData.key = `${layerId}:${i++}`; out.push(m); } }); return out; };

test('MTO: box and cylinder volumes are exact, world transform respected', async () => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
  box.position.set(500000, 20, -9000000); // UTM-like coordinates
  box.scale.set(1.5, 1, 1);
  const va = meshVolumeArea(box);
  assert.ok(Math.abs(va.volume - 36) < 1e-6, `box vol ${va.volume}`);
  assert.ok(Math.abs(va.area - 2 * (3 * 3 + 3 * 4 + 3 * 4)) < 1e-6, `box area ${va.area}`);
  assert.equal(openEdges(box.geometry), 0);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 256));
  assert.ok(Math.abs(meshVolumeArea(cyl).volume - Math.PI * 2) / (Math.PI * 2) < 0.001);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  assert.ok(openEdges(plane.geometry) > 0, 'plane is open');
  plane.userData.key = 'x:0'; box.userData.key = 'x:1';
  box.name = 'FDN-PED-01'; box.updateMatrixWorld();
  const r = await runMTO([box], {});
  assert.equal(r.rows[0].material, 'concrete');
  assert.ok(Math.abs(r.rows[0].weight - 36 * 2400) < 1e-3);
});

test('Clash: hard, clearance and containment', async () => {
  const mk = (x, w, layer, name) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 1)); m.position.x = x; m.name = name; m.userData = { layerId: layer, key: `${layer}:${name}` }; m.updateMatrixWorld(); return m; };
  const a = mk(0, 1, 'A', 'a'), b = mk(0.9, 1, 'B', 'b'), c = mk(1.1, 1, 'B', 'c'), d = mk(0, 0.2, 'B', 'inner');
  d.scale.set(1, 0.2, 0.2); d.updateMatrixWorld();
  const hard = await runClash({ setA: [a], setB: [b, c, d], mode: 'hard' });
  const types = hard.results.map((r) => `${r.bName}:${r.type}`).sort();
  assert.deepEqual(types, ['b:Hard', 'inner:Containment']);
  const cl = await runClash({ setA: [a], setB: [c], mode: 'clearance', tolerance: 0.2 });
  assert.equal(cl.results.length, 1);
  assert.ok(Math.abs(cl.results[0].distance - 0.1) < 1e-4, `gap ${cl.results[0].distance}`);
});

test('Sample: plot plan vs contractor model finds the designed clashes', async () => {
  const plan = samplePlan('p1');
  const plot = buildPlotModel(plan);
  const pm = tag(plot, 'pp');
  assert.equal(pm.length, plan.objects.length);
  const buf = fs.readFileSync(new URL('../public/samples/sample-contractor-model.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const wrap = new THREE.Group(); wrap.scale.setScalar(0.001); wrap.add(gltf.scene); // mm → m
  const cm = tag(wrap, 'm1');
  const res = await runClash({ setA: pm, setB: cm, mode: 'hard', ignoreSameLayer: true });
  const pairs = res.results.map((r) => `${r.aName.includes('PIPE') || r.aName.includes('CT') ? r.bName : r.aName} x ${r.aName.includes('PIPE') || r.aName.includes('CT') ? r.aName : r.bName}`);
  console.log('hard clashes:', pairs);
  assert.ok(pairs.some((p) => p.includes('BUND-01') && p.includes('P-1001')), 'pipe through bund wall');
  assert.ok(pairs.some((p) => p.includes('PR-01') && p.includes('CT-600')), 'cable tray into rack column');
  const clr = await runClash({ setA: pm, setB: cm, mode: 'clearance', tolerance: 0.5, ignoreSameLayer: true });
  console.log('clearance 500mm:', clr.results.filter((r) => r.type === 'Clearance').map((r) => `${r.aName}/${r.bName} ${(r.distance * 1000).toFixed(0)}mm`));
  assert.ok(clr.results.some((r) => r.type === 'Clearance' && /T-102/.test(r.aName + r.bName)), 'pipe end near T-102');
  // MTO of contractor model: pedestal 0.6x0.6x0.8 = 0.288 m3 each
  const mto = await runMTO(cm, {});
  const ped = mto.rows.find((r) => r.name.startsWith('FDN-PED-01'));
  assert.ok(Math.abs(ped.volume - 0.288) < 1e-4, `ped ${ped.volume}`);
  assert.equal(ped.material, 'concrete');
  const conc = mto.summary.find((s) => s.material === 'concrete');
  assert.ok(Math.abs(conc.volume - (4 * 0.288 + 11 * 4 * 0.3)) < 1e-3, `concrete ${conc.volume}`);
});

test('XLSX writer produces a valid workbook; CSV parser handles ; and quotes', () => {
  const blobParts = buildXlsx([{ name: 'Deliverables', title: 'Test', columns: [{ header: 'Doc', key: 'a' }, { header: 'Qty', key: 'b', type: 'n' }], rows: [{ a: 'X & <Y>', b: 1.5 }, { a: 'Z', b: 2 }] }]);
  return blobParts.arrayBuffer().then((ab) => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nx-')), 't.xlsx');
    fs.writeFileSync(out, Buffer.from(ab));
    const head = fs.readFileSync(out).subarray(0, 2).toString();
    assert.equal(head, 'PK', 'xlsx is a zip container');
    const rows = parseCSV('Doc No;Title;Status\n"A-01";"Pipe ""10in""";IFR\nB-02;Rack;IFC\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'Pipe "10in"');
    assert.equal(rows[1]['doc no'], 'B-02');
  });
});
