#!/usr/bin/env node
// NEXUS 3D — NWD / NWC → GLB without Autodesk (nwd-reader + nwd2glb), then meshopt-compressed like the APS path.
// nwd-reader is PolyForm Noncommercial 1.0.0 (https://github.com/1817716374/nwd-reader): commercial use needs a
// licence from its author. This script only calls the nwd2glb binary built from it.
//
// Usage: NWD2GLB=/path/to/nwd2glb node tools/nwd-convert.mjs <file.nwd> [...] --out <dir> [--no-compress]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { pack, updateIndex, slug } from './aps-convert.mjs';

const quiet = !!process.env.NEXUS_QUIET; // public repo: keep model details out of the (public) Actions log
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const compress = !args.includes('--no-compress');
if (!compress) args.splice(args.indexOf('--no-compress'), 1);
const outDir = path.resolve(flag('--out') || 'converted/glb');
const bin = process.env.NWD2GLB || 'nwd2glb';
if (!args.length) { console.log('Usage: NWD2GLB=… node tools/nwd-convert.mjs <file.nwd> [...] --out <dir>'); process.exit(1); }

// Runs nwd2glb with a time limit and a heartbeat (elapsed · CPU time · memory), so a stuck file is visible in the Actions log
// and fails after NWD_TIMEOUT_MIN minutes (default 30) instead of holding the single converter slot for hours.
const TIMEOUT_MIN = Number(process.env.NWD_TIMEOUT_MIN) || 30;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function procStats(pid) {
  try {
    const rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] || 0) / 1048576;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // fields after "(comm)": state is f[0], utime f[11], stime f[12]
    return { rss, cpu: (Number(f[11]) + Number(f[12])) / 100 };
  } catch { return null; }
}
function runNwd2glb(src, raw) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(bin, [src, raw], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const beat = setInterval(() => {
      const s = procStats(child.pid);
      log(`  reading… ${mmss((Date.now() - t0) / 1000)}${s ? ` · CPU ${mmss(s.cpu)} · memory ${s.rss.toFixed(1)} GB` : ''}`);
    }, 60000);
    const kill = setTimeout(() => {
      if (done) return;
      const s = procStats(child.pid);
      child.kill('SIGKILL');
      const e = new Error(`nwd2glb did not finish within ${TIMEOUT_MIN} min${s ? ` (CPU ${mmss(s.cpu)}, memory ${s.rss.toFixed(1)} GB)` : ''}. The model is too heavy for the free GitHub runner: export FBX/IFC from Navisworks or split the model by area.`);
      e.timeout = true;
      reject(e);
    }, TIMEOUT_MIN * 60000);
    const end = () => { done = true; clearInterval(beat); clearTimeout(kill); };
    child.on('error', (e) => { end(); reject(e); });
    child.on('close', (code) => {
      end();
      if (code === 0) resolve(out.trim().split('\n').pop());
      else { const e = new Error(err.trim() || `nwd2glb exited with code ${code}`); e.stderr = err; reject(e); }
    });
  });
}

// ---------- Heavy models: merge instances into a few thousand chunks ----------
// A plant model has hundreds of thousands of objects (E3D: 220k objects → 196k tiny meshes). As separate meshes it is
// 100+ MB of JSON, takes ~40 min to post-process, and is unusable on a tablet (one draw call each). Above MERGE_ABOVE
// objects the instances are baked into world space and merged per (layer, material, 40 m grid cell). Per-object names are
// lost; the layer name stays in each chunk's name and extras. Set NWD_MERGE=0 to disable.
const MERGE_ABOVE = Number(process.env.NWD_MERGE_ABOVE) || 20000;
const CELL_M = Number(process.env.NWD_CELL_M) || 40;
const MAX_CHUNKS = Number(process.env.NWD_MAX_CHUNKS) || 3000;
const MAX_GLB_MB = 95; // GitHub rejects files above 100 MB
function readGlb(file) {
  const b = fs.readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); // own, 4-byte aligned copy
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('Not a GLB file');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(Buffer.from(ab, 20, jl).toString('utf8'));
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: ab.slice(28 + jl, 28 + jl + bl) };
}
/** raw nwd2glb GLB (one node per object, own mesh each) → merged GLB written to outPath. Returns { chunks, triangles }. */
function mergeRaw(rawPath, outPath) {
  const { json, bin } = readGlb(rawPath);
  const { nodes, meshes, accessors, bufferViews } = json;
  const view = (ai, Ctor, comps) => { const a = accessors[ai], bv = bufferViews[a.bufferView]; return new Ctor(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * comps); };
  // per object: layer, material, normals?, world position of its box centre (x/z), vertex and index counts
  const info = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.mesh == null || !n.matrix) continue;
    const prim = meshes[n.mesh].primitives[0];
    const pa = accessors[prim.attributes.POSITION], ia = accessors[prim.indices];
    const m = n.matrix, c = [0, 1, 2].map((k) => (pa.min[k] + pa.max[k]) / 2);
    info.push({ i, layer: n.extras?.layer ?? '', material: prim.material ?? 0, hasN: prim.attributes.NORMAL != null, verts: pa.count, inds: ia.count,
      wx: m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], wz: m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14] });
  }
  // Start fine (layer × material × 40 m cell); if that gives more than MAX_CHUNKS meshes, drop the layer and/or use larger cells.
  const keyOf = (o, byLayer, cell) => `${byLayer ? o.layer : ''}\u0001${o.material}\u0001${o.hasN ? 1 : 0}\u0001${Math.floor(o.wx / cell)}\u0001${Math.floor(o.wz / cell)}`;
  const levels = [[true, CELL_M], [false, CELL_M], [false, CELL_M * 2], [false, CELL_M * 4], [false, CELL_M * 8], [false, CELL_M * 16]];
  let level = levels.length - 1;
  for (let l = 0; l < levels.length; l++) {
    if (new Set(info.map((o) => keyOf(o, levels[l][0], levels[l][1]))).size <= MAX_CHUNKS) { level = l; break; }
  }
  const [byLayer, cell] = levels[level];
  const groups = new Map(), list = [];
  for (const o of info) {
    const key = keyOf(o, byLayer, cell);
    let g = groups.get(key);
    if (!g) { g = { layer: byLayer ? o.layer : '', material: o.material, hasN: o.hasN, verts: 0, inds: 0, nodes: [] }; groups.set(key, g); list.push(g); }
    g.verts += o.verts; g.inds += o.inds; g.nodes.push(o.i);
  }
  log(`  grouping by ${byLayer ? 'layer · ' : ''}material · ${cell} m cells → ${list.length} chunks`);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('NWD');
  const mats = new Map();
  const material = (mi) => {
    if (mats.has(mi)) return mats.get(mi);
    const s = json.materials?.[mi] || {}, p = s.pbrMetallicRoughness || {};
    const mat = doc.createMaterial(s.name || `NW-${mi}`).setBaseColorFactor(p.baseColorFactor || [0.62, 0.66, 0.72, 1])
      .setMetallicFactor(p.metallicFactor ?? 0.15).setRoughnessFactor(p.roughnessFactor ?? 0.7).setDoubleSided(!!s.doubleSided);
    if (s.alphaMode) mat.setAlphaMode(s.alphaMode);
    mats.set(mi, mat);
    return mat;
  };
  const perLayer = new Map();
  let triangles = 0;
  for (const g of list) {
    const pos = new Float32Array(g.verts * 3), nrm = g.hasN ? new Float32Array(g.verts * 3) : null, idx = new Uint32Array(g.inds);
    let vo = 0, io = 0;
    for (const i of g.nodes) {
      const n = nodes[i], m = n.matrix, prim = meshes[n.mesh].primitives[0];
      const P = view(prim.attributes.POSITION, Float32Array, 3), I = view(prim.indices, Uint32Array, 1), cnt = P.length / 3;
      for (let v = 0; v < cnt; v++) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], o = 3 * (vo + v);
        pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      // columns c0,c1,c2 of the 3×3 part: inverse-transpose · n = (n.x·(c1×c2) + n.y·(c2×c0) + n.z·(c0×c1)) / det
      const a = [m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8]];
      const det = m[0] * a[0] + m[1] * a[1] + m[2] * a[2], flip = det < 0, sgn = flip ? -1 : 1;
      if (nrm) {
        const N = view(prim.attributes.NORMAL, Float32Array, 3);
        const b = [m[9] * m[2] - m[10] * m[1], m[10] * m[0] - m[8] * m[2], m[8] * m[1] - m[9] * m[0]];
        const c = [m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4]];
        for (let v = 0; v < cnt; v++) {
          const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2], o = 3 * (vo + v);
          let x = nx * a[0] + ny * b[0] + nz * c[0], y = nx * a[1] + ny * b[1] + nz * c[1], z = nx * a[2] + ny * b[2] + nz * c[2];
          const l = Math.hypot(x, y, z) || 1;
          nrm[o] = sgn * x / l; nrm[o + 1] = sgn * y / l; nrm[o + 2] = sgn * z / l;
        }
      }
      for (let t = 0; t < I.length; t += 3) { // mirrored instances: reverse the winding so faces keep pointing outwards
        idx[io + t] = I[t] + vo;
        idx[io + t + 1] = I[t + (flip ? 2 : 1)] + vo;
        idx[io + t + 2] = I[t + (flip ? 1 : 2)] + vo;
      }
      vo += cnt; io += I.length;
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
      .setMaterial(material(g.material));
    if (nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer));
    const k = (perLayer.get(g.layer) || 0) + 1;
    perLayer.set(g.layer, k);
    const name = `${g.layer || 'Model'} · ${k}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras({ layer: g.layer, objects: g.nodes.length, merged: true }));
    triangles += idx.length / 3;
    g.nodes = null;
  }
  if (json.asset?.extras) doc.getRoot().getAsset().extras = { ...json.asset.extras, nexus: { ...json.asset.extras.nexus, merged: true } };
  return new NodeIO().write(outPath, doc).then(() => ({ chunks: list.length, triangles }));
}

await fsp.mkdir(outDir, { recursive: true });
const entries = [];
let failed = 0;
for (const src of args) {
  const name = path.basename(src);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nwd-'));
  const raw = path.join(tmp, 'raw.glb');
  try {
    if (!quiet) log(`${name} · ${(fs.statSync(src).size / 1048576).toFixed(1)} MB`);
    const t0 = Date.now();
    const report = JSON.parse(await runNwd2glb(src, raw));
    log(`  read in ${mmss((Date.now() - t0) / 1000)}${quiet ? '' : ` · ${report.objects} objects, ${report.triangles} triangles, ${report.sizeMetres.map((v) => v.toFixed(1)).join(' × ')} m`}`);
    const file = `${slug(name)}.glb`;
    const t1 = Date.now();
    let input = raw, merged = false;
    if (report.objects > MERGE_ABOVE && process.env.NWD_MERGE !== '0') {
      log(`  ${quiet ? 'heavy model' : `${report.objects} objects`} → merging into chunks (per-object names are dropped)…`);
      input = path.join(tmp, 'merged.glb');
      const r = await mergeRaw(raw, input);
      merged = true;
      log(`  merged into ${r.chunks} chunks in ${mmss((Date.now() - t1) / 1000)}`);
    }
    log('  compressing…');
    const t2 = Date.now();
    const size = await pack(input, path.join(outDir, file), { compress });
    log(`  compressed in ${mmss((Date.now() - t2) / 1000)}`);
    if (size > MAX_GLB_MB * 1048576) {
      await fsp.rm(path.join(outDir, file), { force: true });
      throw new Error(`The GLB is ${(size / 1048576).toFixed(0)} MB, above the ${MAX_GLB_MB} MB limit for files in a GitHub repository. Export a smaller part of the model (one area or discipline) from Navisworks.`);
    }
    log(quiet ? '  converted 1 model' : `  → ${file} (${(size / 1048576).toFixed(1)} MB)`);
    entries.push({ name: name.replace(/^\d{10,}-/, '').replace(/\.[^.]+$/, ''), file, source: name, size, units: 'm', zUp: !!report.zUp, origin: report.origin, objects: report.objects, ...(merged ? { merged: true } : {}), engine: 'nwd-reader', converted: new Date().toISOString() });
  } catch (e) {
    failed++;
    console.error(`ERROR ${quiet ? 'model' : name}: ${(e.stderr || e.message || e).toString().trim()}`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
if (entries.length) await updateIndex(outDir, entries);
log(`done · ${entries.length} converted · ${failed} failed`);
process.exit(failed && !entries.length ? 1 : 0);
