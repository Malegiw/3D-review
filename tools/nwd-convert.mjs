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
import zlib from 'node:zlib';
import { pack, updateIndex, slug } from './aps-convert.mjs';
import { mergeRaw, MERGE_ABOVE } from './merge-raw.mjs';

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

const MAX_GLB_MB = 95; // GitHub rejects files above 100 MB

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
    let input = raw, merged = false, objects = null;
    if (report.objects > MERGE_ABOVE && process.env.NWD_MERGE !== '0') {
      log(`  ${quiet ? 'heavy model' : `${report.objects} objects`} → merging into chunks (object names are kept in a side file)…`);
      input = path.join(tmp, 'merged.glb');
      const r = await mergeRaw(raw, input, { log });
      merged = true; objects = r.objects;
      log(`  merged into ${r.chunks} chunks in ${mmss((Date.now() - t1) / 1000)}`);
    }
    log('  compressing…');
    const t2 = Date.now();
    // merged models: keep triangle order (meshopt's reorder would scramble the per-object ranges)
    const size = await pack(input, path.join(outDir, file), { compress, keepOrder: merged });
    log(`  compressed in ${mmss((Date.now() - t2) / 1000)}`);
    if (size > MAX_GLB_MB * 1048576) {
      await fsp.rm(path.join(outDir, file), { force: true });
      throw new Error(`The GLB is ${(size / 1048576).toFixed(0)} MB, above the ${MAX_GLB_MB} MB limit for files in a GitHub repository. Export a smaller part of the model (one area or discipline) from Navisworks.`);
    }
    let objectsFile = null;
    if (objects) {
      objectsFile = file.replace(/\.glb$/, '.objects.json.gz');
      await fsp.writeFile(path.join(outDir, objectsFile), zlib.gzipSync(JSON.stringify(objects), { level: 9 }));
      log(`  object list → ${objectsFile} (${(fs.statSync(path.join(outDir, objectsFile)).size / 1048576).toFixed(1)} MB, ${objects.names.length} names)`);
    }
    log(quiet ? '  converted 1 model' : `  → ${file} (${(size / 1048576).toFixed(1)} MB)`);
    entries.push({ name: name.replace(/^\d{10,}-/, '').replace(/\.[^.]+$/, ''), file, source: name, size, units: 'm', zUp: !!report.zUp, origin: report.origin, objects: report.objects, ...(merged ? { merged: true, objectsFile } : {}), engine: 'nwd-reader', converted: new Date().toISOString() });
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
