import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, autoMap, routeOrder, layerOfName } from '../src/engine/automap.js';

test('classify layer names', () => {
  assert.equal(classify('MGNO-8_-WI-D3CS2F-0-113 (77) · 2'), 'pipe');
  assert.equal(classify('MNGO-12_-WW-B3CS2F-0-101 (74)'), 'pipe');
  assert.equal(classify('MGNO-8_-WI-D3CS2F-0-112_Supports (34)'), 'support');
  assert.equal(classify('PIPE EXISTING (295) · 1'), 'existing');
  assert.equal(classify('kelapasawit · 3'), 'existing');
  assert.equal(classify('EQUIPMENT (238)'), 'equipment');
  assert.equal(classify('Concrete (3)'), 'concrete');
  assert.equal(layerOfName('A (3) · 12'), 'A (3)');
});
test('route order follows the principal axis', () => {
  const r = routeOrder([{ x: 0, z: 0 }, { x: 10, z: 1 }, { x: 20, z: 2 }, { x: 30, z: 3 }]);
  assert.ok(r[0] < r[1] && r[1] < r[2] && r[2] < r[3]);
});
test('pipes are split into header segments along the route', () => {
  const descs = Array.from({ length: 8 }, (_, i) => ({ key: `L:${i}`, name: `MGNO-8_-WI-D3CS2F-0-113 (${i}) · ${i}`, x: i * 100, z: 0 }));
  descs.push({ key: 'S:0', name: 'MGNO-8_-WI-D3CS2F-0-112_Supports (3)', x: 5, z: 0 });
  descs.push({ key: 'E:0', name: 'PIPE EXISTING (2)', x: 5, z: 0 });
  const pkgs = ['HDR-S1', 'HDR-S2', 'HDR-S3', 'HDR-S4', 'OFF-PILING'].map((id) => ({ id }));
  const { map } = autoMap(descs, pkgs);
  assert.deepEqual(map['HDR-S1'].map((x) => x.key), ['L:0', 'L:1']);
  assert.deepEqual(map['HDR-S4'].map((x) => x.key), ['L:6', 'L:7']);
  assert.equal(map['OFF-PILING'].length, 1);
  const rev = autoMap(descs, pkgs, { reverse: true }).map;
  assert.deepEqual(rev['HDR-S1'].map((x) => x.key), ['L:6', 'L:7']);
  assert.ok(!Object.values(map).flat().some((x) => x.key === 'E:0'));
});
