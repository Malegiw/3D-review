#!/usr/bin/env node
// NEXUS 3D — NWD / NWC → GLB without Autodesk (nwd-reader + nwd2glb), then meshopt-compressed like the APS path.
// nwd-reader is PolyForm Noncommercial 1.0.0 (https://github.com/1817716374/nwd-reader): commercial use needs a
// licence from its author. This script only calls the nwd2glb binary built from it.
//
// Usage: NWD2GLB=/path/to/nwd2glb node tools/nwd-convert.mjs <file.nwd> [...] --out <dir> [--no-compress]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pack, updateIndex, slug } from './aps-convert.mjs';

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const compress = !args.includes('--no-compress');
if (!compress) args.splice(args.indexOf('--no-compress'), 1);
const outDir = path.resolve(flag('--out') || 'converted/glb');
const bin = process.env.NWD2GLB || 'nwd2glb';
if (!args.length) { console.log('Usage: NWD2GLB=… node tools/nwd-convert.mjs <file.nwd> [...] --out <dir>'); process.exit(1); }

await fsp.mkdir(outDir, { recursive: true });
const entries = [];
let failed = 0;
for (const src of args) {
  const name = path.basename(src);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nwd-'));
  const raw = path.join(tmp, 'raw.glb');
  try {
    log(`${name} · ${(fs.statSync(src).size / 1048576).toFixed(1)} MB`);
    const report = JSON.parse(execFileSync(bin, [src, raw], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').pop());
    log(`  read ${report.objects} objects, ${report.triangles} triangles, ${report.sizeMetres.map((v) => v.toFixed(1)).join(' × ')} m`);
    const file = `${slug(name)}.glb`;
    const size = await pack(raw, path.join(outDir, file), { compress });
    log(`  → ${file} (${(size / 1048576).toFixed(1)} MB)`);
    entries.push({ name: name.replace(/^\d{10,}-/, '').replace(/\.[^.]+$/, ''), file, source: name, size, units: 'm', zUp: !!report.zUp, origin: report.origin, objects: report.objects, engine: 'nwd-reader', converted: new Date().toISOString() });
  } catch (e) {
    failed++;
    console.error(`ERROR ${name}: ${(e.stderr || e.message || e).toString().trim()}`);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
if (entries.length) await updateIndex(outDir, entries);
log(`done · ${entries.length} converted · ${failed} failed`);
process.exit(failed && !entries.length ? 1 : 0);
