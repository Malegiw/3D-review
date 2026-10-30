// Higher-level data ops: sample project, project backup / restore (.nexus.zip).
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { db } from './db.js';
import { uid } from './ui.js';

const dayOff = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function seedSample() {
  if (await db.meta('seeded')) return null;
  const pid = uid('p');
  await db.put('projects', {
    id: pid, sample: true, code: 'SAMPLE-GS-01', name: 'Demo Gathering Station Upgrade',
    facility: 'Sample GS (demo data)', client: 'Owner', contractor: 'EPC Contractor', phase: 'DED',
    start: dayOff(-60), finish: dayOff(120), description: 'Example project to show the workflow. Delete it any time.', created: Date.now(),
  });
  const D = [
    ['SGS-GEN-PLT-0001', 'Overall Plot Plan', 'General', 'Plot Plan', '1', 'IFC', 'A', -30, -31, 'EPC'],
    ['SGS-PRC-PFD-0001', 'Process Flow Diagram', 'Process', 'Drawing', 'B', 'IFA', 'B', -20, -22, 'EPC'],
    ['SGS-CIV-SPC-0001', 'Civil & Structural Design Basis', 'Civil', 'Specification', '1', 'AFC', 'A', -45, -44, 'Owner Eng.'],
    ['SGS-CIV-DWG-0101', 'Tank Foundation T-101/102/103', 'Civil', 'Drawing', 'A', 'IFR', '', -5, -4, 'EPC'],
    ['SGS-CIV-CAL-0101', 'Tank Foundation Calculation', 'Civil', 'Calculation', 'A', 'IFR', 'C', -5, -6, 'EPC'],
    ['SGS-STR-DWG-0201', 'Pipe Rack PR-01 General Arrangement', 'Structure', 'Drawing', '0', 'IFC', 'A', -12, -12, 'EPC'],
    ['SGS-STR-CAL-0201', 'Pipe Rack Structural Analysis', 'Structure', 'Calculation', '0', 'IFA', 'B', -8, -9, 'EPC'],
    ['SGS-CIV-DWG-0301', 'Control Room & MCC Foundation', 'Civil', 'Drawing', '', 'IN PROGRESS', '', 7, null, 'EPC'],
    ['SGS-PIP-DWG-0401', 'Piping GA — Tank Farm', 'Piping', 'Drawing', '', 'IN PROGRESS', '', 10, null, 'EPC'],
    ['SGS-PIP-MTO-0401', 'Piping Material Take-Off', 'Piping', 'MTO', '', 'NOT STARTED', '', -3, null, 'EPC'],
    ['SGS-ELE-DWG-0501', 'Cable Tray Routing MCC–CR', 'Electrical', 'Drawing', 'A', 'IFR', '', -2, -2, 'EPC'],
    ['SGS-INS-DAT-0601', 'Level Transmitter Datasheet', 'Instrument', 'Datasheet', '', 'ON HOLD', '', 14, null, 'Vendor'],
    ['SGS-HSE-RPT-0001', 'HAZOP Close-out Report', 'HSE', 'Report', '', 'NOT STARTED', '', -1, null, 'Owner Eng.'],
    ['SGS-GEN-3DM-0001', '3D Model Review 60%', 'General', '3D Model', '', 'IN PROGRESS', '', 5, null, 'EPC'],
  ];
  for (const [docNo, title, discipline, type, rev, status, review, p, a, pic] of D) {
    await db.put('deliverables', { id: uid('d'), projectId: pid, docNo, title, discipline, type, rev, status, review, planDate: dayOff(p), actualDate: a == null ? '' : dayOff(a), pic, remarks: '' });
  }
  let pdf = embeddedSample('pdf', 'application/pdf');
  if (!pdf) { try { const r = await fetch('./samples/sample-plotplan.pdf'); if (r.ok) pdf = await r.blob(); } catch { /* offline */ } }
  await db.put('plotplans', { ...samplePlan(pid), pdf });
  const glb = await fetchSampleModel();
  if (glb) await db.put('models', { id: uid('m'), projectId: pid, name: 'EPC Piping & Steel (sample, mm)', files: [{ name: 'sample-contractor-model.glb', blob: glb }], units: 'mm', zUp: false, transform: { dx: 0, dy: 0, dz: 0, rotY: 0 }, visible: true, created: Date.now() });
  await db.meta('seeded', true);
  return pid;
}

// Single-file builds embed the samples as base64 in <script id="nx-samples" type="application/json">.
function embeddedSample(key, type) {
  try {
    const el = document.getElementById('nx-samples');
    const b64 = el && JSON.parse(el.textContent)[key];
    return b64 ? new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type }) : null;
  } catch { return null; }
}

// Embedded → GLB → base64 JSON copy (for hosts that refuse to serve .glb files).
async function fetchSampleModel() {
  const emb = embeddedSample('glb', 'model/gltf-binary');
  if (emb) return emb;
  try { const r = await fetch('./samples/sample-contractor-model.glb'); if (r.ok) return await r.blob(); } catch { /* fall through */ }
  try {
    const r = await fetch('./samples/sample-contractor-model.json');
    if (r.ok) { const { glb } = await r.json(); return new Blob([Uint8Array.from(atob(glb), (c) => c.charCodeAt(0))], { type: 'model/gltf-binary' }); }
  } catch { /* offline */ }
  return null;
}

/** Sample plot plan (matches public/samples/sample-plotplan.pdf, A3 landscape, 1:500). */
export function samplePlan(projectId) {
  const m = 72 / 25.4 * 1000 / 500, ox = 120, oy = 120, H = 841.8898;
  const P = (x, y) => [ox + x * m, H - (oy + y * m)];
  const rect = (x, y, w, h) => ({ kind: 'rect', pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] });
  const circ = (x, y, r) => { const [cx, cy] = P(x, y); return { kind: 'circle', cx, cy, r: r * m, bbox: [cx - r * m, cy - r * m, cx + r * m, cy + r * m] }; };
  const O = (shape, cat, tag, h, extra = {}) => ({ id: uid('o'), shape, cat, tag, h, elev: 0, ...extra });
  return {
    id: uid('pp'), projectId, name: 'Overall Plot Plan (sample)', pdf: null, page: 1, pageW: 1190.5512, pageH: H,
    scale: 500 * 0.0254 / 72, scaleNote: '1:500', minSize: 6,
    objects: [
      O(rect(0, 0, 150, 90), 'fence', 'FENCE', 2.4),
      O(rect(18, 48, 68, 24), 'bund', 'BUND-01', 1.2),
      O(circ(30, 60, 8), 'tank', 'T-101', 12),
      O(circ(52, 60, 8), 'tank', 'T-102', 12),
      O(circ(74, 60, 6), 'tank', 'T-103', 9),
      O(rect(20, 20, 12, 4), 'vessel', 'V-201', 0),
      O(rect(40, 20, 10, 3), 'equipment', 'P-301A/B', 1.8),
      O(rect(95, 15, 30, 18), 'building', 'CR-01', 4.5),
      O(rect(95, 45, 20, 12), 'building', 'MCC-01', 4),
      O(rect(10, 40, 110, 6), 'piperack', 'PR-01', 6),
      O(rect(94, 13, 32, 22), 'paving', 'PAVE-CR', 0.2),
    ],
  };
}

export async function exportProject(pid) {
  const project = await db.get('projects', pid);
  const out = { format: 'nexus3d-backup', version: 1, exported: new Date().toISOString(), project };
  const files = {};
  for (const s of ['deliverables', 'viewpoints', 'clashtests']) out[s] = await db.byProject(s, pid);
  out.plotplans = [];
  for (const pp of await db.byProject('plotplans', pid)) {
    const { pdf, ...rest } = pp;
    if (pdf) { const path = `files/${pp.id}/plotplan.pdf`; files[path] = new Uint8Array(await pdf.arrayBuffer()); rest.pdfPath = path; }
    out.plotplans.push(rest);
  }
  out.models = [];
  for (const md of await db.byProject('models', pid)) {
    const fl = [];
    for (const f of md.files) { const path = `files/${md.id}/${f.name}`; files[path] = new Uint8Array(await f.blob.arrayBuffer()); fl.push({ name: f.name, path }); }
    out.models.push({ ...md, files: fl });
  }
  files['project.json'] = strToU8(JSON.stringify(out, null, 1));
  return new Blob([zipSync(files, { level: 1 })], { type: 'application/zip' });
}

export async function importProject(file) {
  const z = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!z['project.json']) throw new Error('Not a Review 3D backup (project.json missing).');
  const data = JSON.parse(strFromU8(z['project.json']));
  if (data.format !== 'nexus3d-backup') throw new Error('Unknown backup format.');
  const exists = await db.get('projects', data.project.id);
  const pid = exists ? uid('p') : data.project.id;
  const remap = (r) => ({ ...r, id: exists ? uid(r.id[0]) : r.id, projectId: pid });
  await db.put('projects', { ...data.project, id: pid, name: exists ? `${data.project.name} (restored)` : data.project.name });
  for (const s of ['deliverables', 'viewpoints', 'clashtests']) for (const r of data[s] || []) await db.put(s, remap(r));
  for (const pp of data.plotplans || []) {
    const { pdfPath, ...rest } = pp;
    await db.put('plotplans', { ...remap(rest), pdf: pdfPath && z[pdfPath] ? new Blob([z[pdfPath]], { type: 'application/pdf' }) : null });
  }
  for (const md of data.models || []) {
    await db.put('models', { ...remap(md), files: md.files.map((f) => ({ name: f.name, blob: new Blob([z[f.path]]) })) });
  }
  return pid;
}
