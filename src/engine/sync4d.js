// 4D data on GitHub: one gzipped JSON per project in data/4d/, so every device (and every teammate with the repo)
// sees the same reports, baseline, weights and mapping. Pure helpers; the view does the GitHub calls.
export const SYNC_DIR = 'data/4d';
export const SYNC_FIELDS = ['reports', 'baseline', 'baselineSrc', 'weights', 'weighting', 'removed', 'map', 'demo'];

export const syncName = (project) => `${String(project.code || project.name || 'project').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project'}.4d.json.gz`;

async function streamBytes(blob, stream) { return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer()); }

/** rec → gzipped JSON bytes */
export async function pack4d(rec, project) {
  const body = { format: 'review3d-4d', version: 1, saved: new Date().toISOString(), project: { name: project.name || '', code: project.code || '' } };
  for (const k of SYNC_FIELDS) if (rec[k] != null) body[k] = rec[k];
  return streamBytes(new Blob([JSON.stringify(body)]), new CompressionStream('gzip'));
}

/** gzipped (or plain) JSON bytes / Blob → the stored fields, validated */
export async function unpack4d(data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const bytes = head[0] === 0x1f && head[1] === 0x8b ? await streamBytes(blob, new DecompressionStream('gzip')) : new Uint8Array(await blob.arrayBuffer());
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (body.format !== 'review3d-4d' || !body.reports || typeof body.reports !== 'object') throw new Error('This file is not 4D data saved by Review 3D.');
  const out = {};
  for (const k of SYNC_FIELDS) if (body[k] != null) out[k] = body[k];
  return { fields: out, saved: body.saved, project: body.project || {} };
}
