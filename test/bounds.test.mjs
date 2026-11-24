import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { robustBounds } from '../src/engine/bounds.js';
const b = (x, z) => new THREE.Box3(new THREE.Vector3(x - 2, 0, z - 2), new THREE.Vector3(x + 2, 3, z + 2));
test('two sites far apart: frame the main one', () => {
  const boxes = [];
  for (let i = 0; i < 80; i++) boxes.push(b(-1800 + (i % 10) * 20, 700 + Math.floor(i / 10) * 20));
  for (let i = 0; i < 15; i++) boxes.push(b(2800 + i * 5, 450));
  const r = robustBounds(boxes);
  assert.equal(r.dropped, 15);
  assert.ok(r.box.max.x < -1500);
});
test('one compact site is kept whole', () => {
  const boxes = Array.from({ length: 40 }, (_, i) => b((i % 8) * 30, Math.floor(i / 8) * 30));
  assert.equal(robustBounds(boxes).dropped, 0);
});
