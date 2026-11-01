import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeBoundsTree } from 'three-mesh-bvh';
import { parseName, indexLayer } from '../src/engine/groups.js';
import { groupVolumeArea } from '../src/engine/mto.js';
import { runClash } from '../src/engine/clash.js';
import { shortestBetween } from '../src/engine/measure.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;

test('E3D names: type and owning item (branch / equipment / structure)', () => {
  assert.deepEqual(parseName('TUBE 3 of BRANCH /P-101/B1'), { type: 'TUBE', owner: 'BRANCH /P-101/B1' });
  assert.equal(parseName('ileave tube of ELBOW 6 of BRANCH 1 of PIPE 8 of ZONE /Z').owner, 'BRANCH 1 of PIPE 8 of ZONE /Z');
  assert.equal(parseName('PANEL 1 of FRMWORK 1 of STRUCTURE /GROUND').owner, 'STRUCTURE /GROUND');
  assert.deepEqual(parseName('T-101'), { type: '', owner: '' });
  const mk = (n) => { const m = new THREE.Mesh(new THREE.BoxGeometry()); m.userData.name = n; return m; };
  const meshes = [mk('CYLINDER 1 of EQUIPMENT /T-1'), mk('CYLINDER 1 of EQUIPMENT /T-1'), mk('BOX 2 of EQUIPMENT /T-1'), mk('TUBE 1 of BRANCH /P-1')];
  const { comps, items } = indexLayer('L', meshes);
  assert.equal(comps.size, 3);
  assert.equal(items.size, 2);
  assert.equal(items.get('L#EQUIPMENT /T-1').meshes.length, 3);
});

test('Component volume: open tube + end caps is a closed solid; a bare tube is open', () => {
  const r = 0.2, hgt = 12;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hgt, 48, 1, true));
  const cap = (y, flip) => { const g = new THREE.CircleGeometry(r, 48); g.rotateX(flip ? Math.PI / 2 : -Math.PI / 2); const m = new THREE.Mesh(g); m.position.y = y; m.updateMatrixWorld(); return m; };
  tube.position.set(500000, 3, -9000000); tube.updateMatrixWorld();
  const top = cap(hgt / 2, false), bot = cap(-hgt / 2, true);
  top.position.add(tube.position); bot.position.add(tube.position); top.updateMatrixWorld(); bot.updateMatrixWorld();
  const solid = groupVolumeArea([tube, top, bot]);
  const exact = Math.PI * r * r * hgt * (48 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 48);
  assert.ok(solid.closed, 'tube + caps closed');
  assert.ok(Math.abs(solid.volume - exact) / exact < 1e-4, `vol ${solid.volume} vs ${exact}`);
  assert.equal(groupVolumeArea([tube]).closed, false);
});

test('Clash: touching faces are contact, flush overlap and crossing are hard', async () => {
  const box = (x, y, w, name, item) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 1)); m.position.set(x, y, 0); m.name = name; m.userData = { layerId: 'L', key: `L:${name}`, comp: `L|${name}`, item }; m.updateMatrixWorld(); return m; };
  const a = box(0, 0, 1, 'a', 'A');
  const touch = box(1, 0, 1, 'touch', 'B');      // shares the x = 0.5 face
  const stacked = box(0, 1, 1, 'stacked', 'C');  // sits on top
  const flush = box(0.9, 0, 1, 'flush', 'D');    // 100 mm overlap, faces flush
  const r = await runClash({ setA: [a], setB: [touch, stacked, flush], mode: 'hard', tolerance: 0.005 });
  assert.deepEqual(r.results.map((x) => x.bName).sort(), ['flush']);
  assert.equal(r.touches, 2);
  // crossing: a thin bar passing through a block
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.1)); bar.name = 'bar'; bar.userData = { layerId: 'L', key: 'L:bar', comp: 'L|bar', item: 'E' }; bar.updateMatrixWorld();
  const c = await runClash({ setA: [a], setB: [bar], mode: 'hard', tolerance: 0.005 });
  assert.equal(c.results.length, 1);
  // same item is ignored by default
  const same = box(0.5, 0, 1, 'same', 'A');
  assert.equal((await runClash({ setA: [a], setB: [same], mode: 'hard' })).results.length, 0);
  assert.equal((await runClash({ setA: [a], setB: [same], mode: 'hard', ignoreSameItem: false })).results.length, 1);
});

test('Measure: shortest distance between two objects', () => {
  const g1 = new THREE.BoxGeometry(1, 1, 1); g1.computeBoundsTree();
  const g2 = new THREE.SphereGeometry(0.5, 32, 16); g2.computeBoundsTree();
  const a = new THREE.Mesh(g1), b = new THREE.Mesh(g2);
  b.position.set(3, 0, 0); a.updateMatrixWorld(); b.updateMatrixWorld();
  const r = shortestBetween([a], [b]);
  assert.ok(Math.abs(r.d - 2) < 0.01, `d ${r.d}`);
});
