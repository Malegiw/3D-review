// In-app model conversion: upload native file → GitHub Actions (Autodesk APS) → download GLB → add to project.
// Jobs live in IndexedDB, so a conversion keeps going on GitHub even if the app is closed and resumes on next open.
import { db } from './db.js';
import { uid, toast } from './ui.js';
import { state } from './app.js';
import { GitHubRepo } from '../engine/github.js';
import { encryptBlob, decryptBlob } from './crypto.js';

export const NATIVE_EXT = ['nwd', 'nwc', 'nwf', 'dwfx', 'dwf', 'skp', 'rvt', 'ifc', 'dwg'];
const ACTIVE = new Set(['uploading', 'queued', 'running', 'downloading']);
const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));

export async function getConverter() { return (await db.meta('converter')) || null; }
export async function setConverter(cfg) { await db.meta('converter', cfg); }
export async function repoClient(cfg) {
  const c = cfg || await getConverter();
  return c?.repo && c?.token ? new GitHubRepo(c) : null;
}

async function save(job) { job.updated = Date.now(); await db.put('jobs', job); emit('nexus:jobs', job); return job; }
export async function projectJobs(projectId) { return (await db.byProject('jobs', projectId)).sort((a, b) => b.created - a.created); }

export async function startConversion(projectId, file) {
  const gh = await repoClient();
  if (!gh) throw new Error('Set up the converter first.');
  const cfg = await getConverter();
  const ext = (file.name.split('.').pop() || 'nwd').toLowerCase().replace(/[^a-z0-9]/g, '');
  // public repo: random name + client-side AES-256-GCM, so neither the name nor the model is readable on GitHub
  const encrypted = !!cfg?.encrypted;
  const sourceName = encrypted ? `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('')}.${ext}` : `${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
  const uploadName = encrypted ? `${sourceName}.nxe` : sourceName;
  const job = await save({ id: uid('j'), projectId, file: file.name, uploadName, sourceName, encrypted, size: file.size, status: 'uploading', step: encrypted ? 'Encrypting and uploading' : 'Uploading to GitHub', created: Date.now() });
  try {
    if (encrypted && !cfg.key) throw new Error('Encryption key missing on this device — open converter settings.');
    const payload = encrypted ? await encryptBlob(file, cfg.key) : file;
    job.sha = await gh.uploadModel(payload, uploadName);
    Object.assign(job, { status: 'queued', step: 'Waiting for GitHub Actions to start', queuedAt: Date.now() });
  } catch (e) {
    Object.assign(job, { status: 'failed', message: e.message });
  }
  await save(job);
  ensurePoller(true);
  return job;
}

export async function retryJob(job) {
  Object.assign(job, { status: job.runId ? 'running' : 'queued', message: '', step: 'Checking again', queuedAt: Date.now() });
  await save(job);
  ensurePoller(true);
}
export async function removeJob(job) { await db.del('jobs', job.id); emit('nexus:jobs', job); }

function failureMessage(steps) {
  const bad = steps.find((s) => s.conclusion === 'failure');
  if (!bad) return 'Conversion did not finish. Open the run on GitHub for the log.';
  if (/credential/i.test(bad.name)) return 'This format (DWFx/SKP/RVT/IFC/NWF) needs Autodesk keys: add APS_CLIENT_ID and APS_CLIENT_SECRET under Settings → Secrets → Actions, re-run the job on GitHub, then press Retry. NWD and NWC files don’t need them.';
  if (/install nwd reader/i.test(bad.name)) return 'Building the NWD reader failed on GitHub. Re-run the job; if it repeats, open the run log.';
  if (/convert nwd/i.test(bad.name)) return 'The NWD reader could not read this file (possibly a newer Navisworks version). Open the run log, or export FBX from Navisworks.';
  if (/install/i.test(bad.name)) return 'Installing the converter failed on GitHub. Re-run the job.';
  if (/autodesk/i.test(bad.name)) return 'Autodesk could not translate this file (see the run log). Check the APS keys and that the file opens in Navisworks/SketchUp.';
  return `Failed at “${bad.name}”. Open the run on GitHub for the log.`;
}

async function advance(gh, job) {
  if (job.status === 'uploading') {
    if (Date.now() - job.created > 10 * 60000) Object.assign(job, { status: 'failed', message: 'Upload was interrupted. Start the conversion again.' });
    return save(job);
  }
  if (!job.runId) {
    const run = await gh.runForCommit(job.sha);
    if (!run) {
      if (Date.now() - (job.queuedAt || job.created) > 5 * 60000) Object.assign(job, { status: 'failed', message: 'GitHub Actions did not start. Check that Actions are enabled and the converter is installed on the default branch.' });
      return save(job);
    }
    Object.assign(job, { runId: run.id, runUrl: run.html_url, status: 'running' });
  }
  const run = await gh.run(job.runId);
  job.runUrl = run.html_url;
  if (run.status !== 'completed') {
    let steps = [];
    try { steps = await gh.steps(job.runId); } catch { /* ignore */ }
    const cur = steps.find((s) => s.status === 'in_progress');
    job.step = run.status === 'queued' ? 'Queued on GitHub' : cur ? cur.name.replace(/^Run /, '') : 'Running';
    job.status = 'running';
    return save(job);
  }
  if (run.conclusion !== 'success') {
    let steps = [];
    try { steps = await gh.steps(job.runId); } catch { /* ignore */ }
    Object.assign(job, { status: 'failed', message: run.conclusion === 'cancelled' ? 'The run was cancelled on GitHub.' : failureMessage(steps) });
    await save(job);
    toast(`${job.file}: ${job.message}`, 'err', 'CONVERSION FAILED');
    return job;
  }
  Object.assign(job, { status: 'downloading', step: 'Downloading GLB' });
  await save(job);
  const outs = await gh.findOutputs(job.sourceName || job.uploadName);
  if (!outs.length) {
    Object.assign(job, { status: 'failed', message: 'The converter finished but produced no 3D model (2D-only file?).' });
    return save(job);
  }
  const ids = [];
  const cfg = await getConverter();
  const base = job.file.replace(/\.[^.]+$/, '');
  for (const [i, o] of outs.entries()) {
    let blob = await gh.download(o.path);
    const enc = o.encrypted || /\.nxe$/i.test(o.file);
    if (enc) blob = await decryptBlob(blob, cfg?.key);
    const rec = {
      id: uid('m'), projectId: job.projectId, name: enc || !o.name ? `${base}${outs.length > 1 ? ` (${i + 1})` : ''}` : o.name, source: job.file,
      files: [{ name: enc ? o.file.replace(/\.nxe$/i, '') : o.file, blob }], units: o.units || 'm', zUp: !!o.zUp,
      transform: { dx: 0, dy: 0, dz: 0, rotY: 0 }, visible: true, created: Date.now(),
    };
    await db.put('models', rec);
    ids.push(rec.id);
  }
  Object.assign(job, { status: 'done', step: 'Added to project', modelIds: ids, sizeOut: outs.reduce((n, o) => n + (o.size || 0), 0) });
  await save(job);
  emit('nexus:model-added', { projectId: job.projectId, modelIds: ids });
  toast(`${job.file} converted and added to the 3D review.`, 'ok', 'MODEL READY');
  return job;
}

let timer = null;
let busy = false;
export async function pollJobs() {
  if (busy) return;
  busy = true;
  try {
    const jobs = (await db.all('jobs')).filter((j) => ACTIVE.has(j.status));
    if (!jobs.length) return false;
    const gh = await repoClient();
    if (!gh) return false;
    for (const j of jobs) {
      try { await advance(gh, j); } catch (e) { j.step = `Retrying… (${e.message.slice(0, 80)})`; await save(j); }
    }
    return (await db.all('jobs')).some((j) => ACTIVE.has(j.status));
  } finally { busy = false; }
}
export function ensurePoller(now = false) {
  clearTimeout(timer);
  const tick = async () => {
    const more = await pollJobs().catch(() => true);
    if (more) timer = setTimeout(tick, state.pollMs || 10000);
  };
  timer = setTimeout(tick, now ? 1500 : 0);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ensurePoller(); });
