#!/usr/bin/env node
// NEXUS 3D — native model converter (NWD / NWC / DWFx / DWF / SKP / RVT / IFC … → compressed GLB).
// Pipeline: Autodesk APS OSS upload → Model Derivative (SVF) → svf-utils (glTF) → gltf-transform (GLB + meshopt).
//
// Usage:
//   APS_CLIENT_ID=… APS_CLIENT_SECRET=… node tools/aps-convert.mjs <file-or-https-url> [more…] [--out ../public/models] [--no-compress]
//   node tools/aps-convert.mjs --pack <model.gltf|.glb> <out.glb>        (local packing only, no APS)
//
// Output: <out>/<slug>.glb and an updated <out>/index.json that the app lists under Models → From repository.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SVFReader, GLTFWriter, TwoLeggedAuthenticationProvider } from 'svf-utils';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const BASE = 'https://developer.api.autodesk.com';
const NATIVE = ['nwd', 'nwc', 'nwf', 'dwfx', 'dwf', 'skp', 'rvt', 'ifc', 'dwg', 'fbx', 'iam', 'ipt', 'step', 'stp', '3dm'];
const UNIT_MAP = { m: 'm', meter: 'm', meters: 'm', mm: 'mm', millimeter: 'mm', cm: 'cm', centimeter: 'cm', ft: 'ft', foot: 'ft', feet: 'ft', in: 'in', inch: 'in', 'decimal-ft': 'ft' };
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model';

// ---------- APS REST ----------
async function getToken(id, secret) {
  const res = await fetch(`${BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'data:read data:write data:create bucket:create bucket:read viewables:read' }),
  });
  if (!res.ok) throw new Error(`APS auth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function api(tok, method, url, body, headers = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
    method, headers: { Authorization: `Bearer ${tok}`, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  return res;
}
async function ensureBucket(tok, bucketKey) {
  const res = await api(tok, 'POST', '/oss/v2/buckets', { bucketKey, policyKey: 'transient' });
  if (res.ok || res.status === 409) return bucketKey;
  throw new Error(`Bucket create failed: ${res.status} ${await res.text()}`);
}
async function upload(tok, bucketKey, objectKey, buf) {
  const MIN = 5 * 1024 * 1024;
  const partSize = Math.max(MIN, Math.ceil(buf.length / 25));
  const parts = Math.max(1, Math.ceil(buf.length / partSize));
  const enc = encodeURIComponent(objectKey);
  const r1 = await api(tok, 'GET', `/oss/v2/buckets/${bucketKey}/objects/${enc}/signeds3upload?parts=${parts}&minutesExpiration=60`);
  if (!r1.ok) throw new Error(`Signed upload URL failed: ${r1.status} ${await r1.text()}`);
  const { uploadKey, urls } = await r1.json();
  for (let i = 0; i < parts; i++) {
    const chunk = buf.subarray(i * partSize, Math.min(buf.length, (i + 1) * partSize));
    const put = await fetch(urls[i], { method: 'PUT', body: chunk });
    if (!put.ok) throw new Error(`Upload part ${i + 1}/${parts} failed: ${put.status}`);
    log(`  uploaded part ${i + 1}/${parts}`);
  }
  const r2 = await api(tok, 'POST', `/oss/v2/buckets/${bucketKey}/objects/${enc}/signeds3upload`, { uploadKey });
  if (!r2.ok) throw new Error(`Upload complete failed: ${r2.status} ${await r2.text()}`);
  return (await r2.json()).objectId;
}
async function translate(tok, urn, rootFilename) {
  const body = { input: { urn }, output: { formats: [{ type: 'svf', views: ['2d', '3d'] }] } };
  if (rootFilename) Object.assign(body.input, { compressedUrn: true, rootFilename });
  const res = await api(tok, 'POST', '/modelderivative/v2/designdata/job', body, { 'x-ads-force': 'true' });
  if (!res.ok) throw new Error(`Translate job failed: ${res.status} ${await res.text()}`);
}
async function waitManifest(tok, urn, maxMin = 50) {
  const t0 = Date.now();
  for (;;) {
    const res = await api(tok, 'GET', `/modelderivative/v2/designdata/${urn}/manifest`);
    if (res.ok) {
      const m = await res.json();
      log(`  translation ${m.status} ${m.progress}`);
      if (m.status === 'success') return m;
      if (m.status === 'failed' || m.status === 'timeout') throw new Error(`Translation ${m.status}: ${JSON.stringify(m.derivatives?.map((d) => d.messages)).slice(0, 800)}`);
    } else if (res.status !== 202 && res.status !== 404) throw new Error(`Manifest error ${res.status}`);
    if (Date.now() - t0 > maxMin * 60000) throw new Error('Translation timed out');
    await sleep(10000);
  }
}
function svfViewables(manifest) {
  const out = [];
  const walk = (d) => {
    if (d.type === 'resource' && d.role === 'graphics' && d.mime === 'application/autodesk-svf') out.push(d.guid);
    (d.children || []).forEach(walk);
  };
  (manifest.derivatives || []).forEach((d) => (d.children || []).forEach(walk));
  return out;
}

// ---------- glTF → GLB ----------
export async function pack(inPath, outPath, { compress = true } = {}) {
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(inPath);
  const steps = [dedup(), weld(), prune()];
  if (compress) steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16 }));
  await doc.transform(...steps);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, await io.writeBinary(doc));
  return fs.statSync(outPath).size;
}

async function readInput(src) {
  if (/^https?:\/\//i.test(src)) {
    log(`downloading ${src}`);
    const res = await fetch(src, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    const name = decodeURIComponent((cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1] || new URL(src).pathname.split('/').pop() || 'model.nwd');
    return { name, buf: new Uint8Array(await res.arrayBuffer()) };
  }
  return { name: path.basename(src), buf: new Uint8Array(await fsp.readFile(src)) };
}

async function convert(src, outDir, opts) {
  const { APS_CLIENT_ID: id, APS_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('Set APS_CLIENT_ID and APS_CLIENT_SECRET (GitHub → Settings → Secrets → Actions).');
  const { name, buf } = await readInput(src);
  const ext = name.split('.').pop().toLowerCase();
  if (!NATIVE.includes(ext)) log(`warning: .${ext} is not a typical native format — trying anyway`);
  log(`${name} · ${(buf.length / 1048576).toFixed(1)} MB`);
  const tok = await getToken(id, secret);
  const bucket = await ensureBucket(tok, (process.env.APS_BUCKET || `nexus3d-${id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24)}`).slice(0, 63));
  const objectKey = `${Date.now()}-${name.replace(/[^\w.-]+/g, '_')}`;
  log('uploading to APS OSS');
  const objectId = await upload(tok, bucket, objectKey, buf);
  const urn = Buffer.from(objectId).toString('base64url');
  log(`translating (urn ${urn.slice(0, 16)}…)`);
  await translate(tok, urn);
  const manifest = await waitManifest(tok, urn);
  const guids = svfViewables(manifest);
  if (!guids.length) throw new Error('No 3D SVF viewable produced (2D-only file?)');
  const auth = new TwoLeggedAuthenticationProvider(id, secret);
  const results = [];
  for (const [i, guid] of guids.entries()) {
    const reader = await SVFReader.FromDerivativeService(urn, guid, auth);
    const meta = await reader.getMetadata().catch(() => ({}));
    const unitRaw = String(meta?.['distance unit']?.value || '').toLowerCase();
    const up = meta?.['world up vector']?.XYZ || [0, 0, 1];
    const scene = await reader.read({ log: () => {} });
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexus-'));
    await new GLTFWriter({ deduplicate: true, skipUnusedUvs: true, center: false, log: () => {} }).write(scene, tmp);
    const base = slug(name) + (guids.length > 1 ? `-${i + 1}` : '');
    const outFile = path.join(outDir, `${base}.glb`);
    const size = await pack(path.join(tmp, 'output.gltf'), outFile, opts);
    await fsp.rm(tmp, { recursive: true, force: true });
    log(`  → ${outFile} (${(size / 1048576).toFixed(1)} MB, units ${unitRaw || '?'}, up ${up})`);
    results.push({ name: name.replace(/\.[^.]+$/, '') + (guids.length > 1 ? ` (${i + 1})` : ''), file: `${base}.glb`, source: name, size, units: UNIT_MAP[unitRaw] || 'm', zUp: Math.abs(up[2] || 0) > 0.5, converted: new Date().toISOString() });
  }
  return results;
}

async function updateIndex(outDir, entries) {
  const idxPath = path.join(outDir, 'index.json');
  let idx = { models: [] };
  try { idx = JSON.parse(await fsp.readFile(idxPath, 'utf8')); } catch { /* new */ }
  for (const e of entries) { idx.models = idx.models.filter((m) => m.file !== e.file); idx.models.push(e); }
  idx.updated = new Date().toISOString();
  await fsp.writeFile(idxPath, JSON.stringify(idx, null, 2) + '\n');
}

// ---------- CLI ----------
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('aps-convert.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const compress = !args.includes('--no-compress');
  if (!compress) args.splice(args.indexOf('--no-compress'), 1);
  try {
    if (args[0] === '--pack') {
      const size = await pack(args[1], args[2], { compress });
      log(`packed ${args[2]} (${size} bytes)`);
    } else {
      const outDir = path.resolve(flag('--out') || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'models'));
      if (!args.length) { console.log('Usage: node tools/aps-convert.mjs <file-or-url> [...] [--out dir] [--no-compress]'); process.exit(1); }
      await fsp.mkdir(outDir, { recursive: true });
      const all = [];
      for (const src of args) all.push(...await convert(src, outDir, { compress }));
      await updateIndex(outDir, all);
      log(`done · ${all.length} model(s) · index updated`);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}
