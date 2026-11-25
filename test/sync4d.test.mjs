import test from 'node:test';
import assert from 'node:assert/strict';
import { pack4d, unpack4d, syncName } from '../src/engine/sync4d.js';
test('4D data round-trips through gzip JSON and keeps only known fields', async () => {
  const rec = { reports: { '2026-11-01': { rows: [{ pkg: 'A', desc: 'x', pct: 10 }] } }, baseline: { A: { start: '2026-11-01', finish: '2026-11-09' } }, weighting: 'value', secret: 'no', projectId: 'p1' };
  const bytes = await pack4d(rec, { name: 'Seruni WF', code: 'SRN/WF 01' });
  assert.equal(bytes[0], 0x1f);
  const { fields, project } = await unpack4d(bytes);
  assert.deepEqual(fields.reports, rec.reports);
  assert.equal(fields.weighting, 'value');
  assert.equal(fields.secret, undefined);
  assert.equal(project.code, 'SRN/WF 01');
  assert.equal(syncName({ code: 'SRN/WF 01' }), 'SRN_WF_01.4d.json.gz');
  await assert.rejects(unpack4d(new TextEncoder().encode('{"a":1}')));
});
