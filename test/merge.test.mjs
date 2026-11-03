// Heavy-model path of the NWD converter: merging ~20k+ objects into chunks must not change the geometry, and the object
// list written next to the GLB must still point at the right triangles after compression.
// Needs the converter's own dependencies (cd tools && npm install); skipped when they are not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tools = null;
try {
  const { mergeRaw } = await import('../tools/merge-raw.mjs');
  const { pack } = await import('../tools/aps-convert.mjs');
  const { NodeIO } = await import('../tools/node_modules/@gltf-transform/core/dist/index.js');
  const { ALL_EXTENSIONS } = await import('../tools/node_modules/@gltf-transform/extensions/dist/index.js');
  const { MeshoptDecoder } = await import('../tools/node_modules/meshoptimizer/meshopt_decoder.mjs');
  await MeshoptDecoder.ready;
  tools = { mergeRaw, pack, NodeIO, ALL_EXTENSIONS, MeshoptDecoder };
} catch { /* converter dependencies not installed */ }

// ---- a raw GLB in the layout nwd2glb writes: one node per object (name, mesh, column-major matrix, extras.layer) ----
function makeRaw({ nodes: N, meshes: M, seed = 1 }) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bin = []; let len = 0;
  const views = [], accessors = [], meshes = [];
  const add = (arr, target) => {
    while (len % 4) { bin.push(Buffer.alloc(1)); len++; }
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    views.push({ buffer: 0, byteOffset: len, byteLength: b.length, target }); bin.push(b); len += b.length;
    return views.length - 1;
  };
  const cube = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const cubeIdx = [0,2,1,0,3,2, 4,5,6,4,6,7, 0,1,5,0,5,4, 2,3,7,2,7,6, 1,2,6,1,6,5, 3,0,4,3,4,7];
  const meshPos = [];
  for (let k = 0; k < M; k++) {
    const sx = 0.1 + rnd() * 2, sy = 0.1 + rnd() * 2, sz = 0.1 + rnd() * 2, ox = rnd() * 50 - 25, oy = rnd() * 5, oz = rnd() * 50 - 25;
    const pos = new Float32Array(24), nrm = new Float32Array(24), hasN = k % 5 === 0, mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
    cube.forEach((c, v) => {
      const p = [ox + c[0] * sx, oy + c[1] * sy, oz + c[2] * sz];
      pos.set(p, v * 3);
      const d = [c[0] - 0.5, c[1] - 0.5, c[2] - 0.5], l = Math.hypot(...d);
      nrm.set([d[0] / l, d[1] / l, d[2] / l], v * 3);
      for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], p[q]); mx[q] = Math.max(mx[q], p[q]); }
    });
    const pv = add(pos, 34962), iv = add(new Uint32Array(cubeIdx), 34963), nv = hasN ? add(nrm, 34962) : -1;
    const aPos = accessors.length; accessors.push({ bufferView: pv, componentType: 5126, count: 8, type: 'VEC3', min: mn, max: mx });
    const aIdx = accessors.length; accessors.push({ bufferView: iv, componentType: 5125, count: cubeIdx.length, type: 'SCALAR' });
    const attributes = { POSITION: aPos };
    if (hasN) { attributes.NORMAL = accessors.length; accessors.push({ bufferView: nv, componentType: 5126, count: 8, type: 'VEC3' }); }
    meshes.push({ primitives: [{ attributes, indices: aIdx, material: k % 6 }] });
    meshPos.push(Array.from(pos));
  }
  const nodes = [], truth = [];
  for (let i = 0; i < N; i++) {
    const th = rnd() * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    let sx = 1, sy = 1, sz = 1; const r = rnd();
    if (r < 0.1) sx = -1; else if (r < 0.15) { sy = 2; sz = 3; } // mirrored / non-uniform instances
    const m = [c * sx, 0, -sn * sx, 0, 0, sy, 0, 0, sn * sz, 0, c * sz, 0, rnd() * 236, rnd() * 20, rnd() * 300, 1];
    const mesh = Math.floor(rnd() * M), name = `P-${i}`;
    nodes.push({ name, mesh, matrix: m, extras: { layer: `LAYER-${i % 7}`, class: 'Pipe' } });
    truth.push({ name, mesh, m, layer: `LAYER-${i % 7}` });
  }
  const materials = Array.from({ length: 6 }, (_, i) => ({ name: `NW-${i}`, pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] } }));
  const json = { asset: { version: '2.0', extras: { nexus: { units: 'm', zUp: false } } }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews: views, buffers: [{ byteLength: len + ((4 - (len % 4)) % 4) }] };
  while (len % 4) { bin.push(Buffer.alloc(1)); len++; }
  let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const hdr = Buffer.alloc(20); hdr.writeUInt32LE(0x46546C67, 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + len, 8); hdr.writeUInt32LE(js.length, 12); hdr.writeUInt32LE(0x4E4F534A, 16);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(len, 0); bh.writeUInt32LE(0x004E4942, 4);
  return { glb: Buffer.concat([hdr, js, bh, ...bin]), truth, meshPos, cubeIdx };
}

const tf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const bboxOf = (pts) => pts.reduce((b, p) => ({ min: b.min.map((v, i) => Math.min(v, p[i])), max: b.max.map((v, i) => Math.max(v, p[i])) }), { min: [1e30, 1e30, 1e30], max: [-1e30, -1e30, -1e30] });

test('heavy models: merged + compressed GLB keeps every triangle and the object list points at the right ones', { skip: !tools && 'converter dependencies not installed (cd tools && npm install)' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  try {
    const raw = makeRaw({ nodes: 600, meshes: 40, seed: 3 });
    fs.writeFileSync(path.join(dir, 'raw.glb'), raw.glb);
    const r = await tools.mergeRaw(path.join(dir, 'raw.glb'), path.join(dir, 'merged.glb'), { cellM: 40 });
    assert.ok(r.chunks > 1 && r.chunks < 600, `chunks: ${r.chunks}`);
    assert.equal(r.triangles, 600 * 12);
    assert.equal(r.objects.chunks.reduce((n, c) => n + c.nm.length, 0), 600, 'every object is listed once');

    // compress the way the converter does for merged models
    await tools.pack(path.join(dir, 'merged.glb'), path.join(dir, 'out.glb'), { compress: true, keepOrder: true });
    const doc = await new tools.NodeIO().registerExtensions(tools.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': tools.MeshoptDecoder }).read(path.join(dir, 'out.glb'));
    assert.equal(doc.getRoot().getAsset().extras?.nexus?.merged, true);

    const byName = new Map(raw.truth.map((t) => [t.name, t]));
    let checked = 0;
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue;
      const entry = r.objects.chunks.find((c) => c.n === node.getName());
      assert.ok(entry, `object list has chunk ${node.getName()}`);
      const prim = mesh.listPrimitives()[0];
      const pos = prim.getAttribute('POSITION'), I = prim.getIndices().getArray(), W = node.getWorldMatrix();
      assert.equal(I.length / 3, entry.c.reduce((a, b) => a + b, 0), 'triangle count of the chunk survived welding/compression');
      let start = 0;
      entry.c.forEach((count, k) => {
        const pts = new Set();
        for (let t = start * 3; t < (start + count) * 3; t++) pts.add(I[t]);
        const world = [...pts].map((v) => tf(W, pos.getElement(v, [])));
        const got = bboxOf(world);
        const t = byName.get(r.objects.names[entry.nm[k]]);
        assert.ok(t, 'object name resolves');
        assert.equal(r.objects.layers[entry.ly[k]], t.layer);
        const want = bboxOf(raw.meshPos[t.mesh].reduce((a, _, i, arr) => (i % 3 ? a : [...a, tf(t.m, arr.slice(i, i + 3))]), []));
        for (let q = 0; q < 3; q++) {
          assert.ok(Math.abs(got.min[q] - want.min[q]) < 0.02 && Math.abs(got.max[q] - want.max[q]) < 0.02, `${t.name}: triangles ${start}..${start + count} are not this object's (${q})`);
        }
        start += count; checked++;
      });
    }
    assert.equal(checked, 600);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
