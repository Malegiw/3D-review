// Object list of merged models: which object owns a picked triangle, search ranking, and the safety check that keeps
// wrong names from showing on a model that does not match its list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachObjects, objectAt, searchObjects, objectName, objectLayer } from '../src/engine/objects.js';

const table = {
  v: 1, layers: ['PIPE', 'STEEL'], names: ['P-12', 'P-120', 'P-1', 'B-12', 'P-1200'],
  chunks: [{ n: 'PIPE · 1', c: [12, 12, 24], nm: [1, 0, 4], ly: [0, 0, 0] }, { n: 'STEEL · 1', c: [12, 36], nm: [3, 2], ly: [1, 1] }],
};
const mesh = (name, tris) => ({ name, userData: { name }, geometry: { index: { count: tris * 3 } } });

test('attachObjects links blocks whose triangle count matches the list, and only those', () => {
  const a = mesh('PIPE · 1', 48), b = mesh('STEEL · 1', 48), wrong = mesh('STEEL · 1', 47), unknown = mesh('Other', 10);
  assert.equal(attachObjects([a, b, unknown], table), 2);
  assert.ok(a.userData.objs && b.userData.objs && !unknown.userData.objs);
  assert.equal(attachObjects([wrong], table), 0, 'a changed model is not given names');
  assert.ok(!wrong.userData.objs);
});

test('objectAt finds the owner of a triangle from the cumulative counts', () => {
  const a = mesh('PIPE · 1', 48);
  attachObjects([a], table);
  const o = a.userData.objs;
  const owners = [0, 11, 12, 23, 24, 47].map((f) => objectAt(o, f));
  assert.deepEqual(owners, [0, 0, 1, 1, 2, 2]);
  assert.equal(objectName(o, 2), 'P-1200');
  assert.equal(objectLayer(o, 0), 'PIPE');
});

test('searchObjects lists the exact tag first, then names starting with it, shorter before longer', () => {
  const a = mesh('PIPE · 1', 48), b = mesh('STEEL · 1', 48);
  attachObjects([a, b], table);
  const r = searchObjects([a, b], 'p-12');
  assert.equal(r.total, 3);
  assert.deepEqual(r.items.map((x) => objectName(x.mesh.userData.objs, x.k)), ['P-12', 'P-120', 'P-1200']);
  const byLayer = searchObjects([a, b], 'steel');
  assert.equal(byLayer.total, 2);
  assert.ok(byLayer.items.every((x) => x.byLayer));
  assert.equal(searchObjects([a, b], '').total, 0);
});
