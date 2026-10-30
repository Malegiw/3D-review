#!/usr/bin/env node
// NXE1 encryption for models kept in a PUBLIC converter repository (see src/core/crypto.js for the format).
// Key: env NEXUS_KEY (base64, 32 bytes) — the repository secret set by the NEXUS app.
//   node tools/nxe.mjs decrypt-dir <srcDir> <dstDir>   *.nxe → dst/<name without .nxe>
//   node tools/nxe.mjs encrypt-out <plainDir> <dstDir> plainDir/*.glb → dst/<name>.glb.nxe + sanitized dst/index.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = Buffer.from('NXE1');
export function keyFromEnv() {
  const k = Buffer.from(String(process.env.NEXUS_KEY || '').trim(), 'base64');
  if (k.length !== 32) throw new Error('NEXUS_KEY secret is missing or not a 32-byte base64 key.');
  return k;
}
export function encrypt(buf, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, ct, c.getAuthTag()]);
}
export function decrypt(buf, key) {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('not an NXE1 file');
  const iv = buf.subarray(4, 16), tag = buf.subarray(buf.length - 16), ct = buf.subarray(16, buf.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

const isMain = process.argv[1]?.endsWith('nxe.mjs');
if (isMain) {
  const [cmd, src, dst] = process.argv.slice(2);
  try {
    const key = keyFromEnv();
    fs.mkdirSync(dst, { recursive: true });
    if (cmd === 'decrypt-dir') {
      let n = 0;
      for (const f of fs.readdirSync(src).filter((x) => x.toLowerCase().endsWith('.nxe'))) {
        fs.writeFileSync(path.join(dst, f.slice(0, -4)), decrypt(fs.readFileSync(path.join(src, f)), key));
        n++;
      }
      console.log(`decrypted ${n} file(s)`);
    } else if (cmd === 'encrypt-out') {
      const idxPath = path.join(dst, 'index.json');
      let idx = { models: [] };
      try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { /* new */ }
      let plainIdx = { models: [] };
      try { plainIdx = JSON.parse(fs.readFileSync(path.join(src, 'index.json'), 'utf8')); } catch { /* none */ }
      let n = 0;
      for (const f of fs.readdirSync(src).filter((x) => x.toLowerCase().endsWith('.glb'))) {
        const out = `${f}.nxe`;
        const enc = encrypt(fs.readFileSync(path.join(src, f)), key);
        fs.writeFileSync(path.join(dst, out), enc);
        const meta = plainIdx.models.find((m) => m.file === f) || {};
        // only non-identifying fields leave the runner in clear text
        const entry = { file: out, source: meta.source, size: enc.length, units: meta.units || 'm', zUp: !!meta.zUp, encrypted: true, converted: meta.converted || new Date().toISOString() };
        idx.models = idx.models.filter((m) => m.file !== out);
        idx.models.push(entry);
        n++;
      }
      idx.updated = new Date().toISOString();
      fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
      console.log(`encrypted ${n} model(s)`);
    } else {
      console.log('Usage: node tools/nxe.mjs decrypt-dir <src> <dst> | encrypt-out <plainDir> <dst>');
      process.exit(2);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}
