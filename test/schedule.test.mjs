import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXER, parseMSPDI, parseSchedule, scheduleToBaseline } from '../src/engine/schedule.js';
import { buildModel } from '../src/engine/progress4d.js';

const XER = ['ERMHDR\t19.12', '%T\tPROJWBS', '%F\twbs_id\tparent_wbs_id\twbs_short_name\twbs_name', '%R\t1\t\tP\tProject', '%R\t2\t1\tFDN\tFoundations',
  '%T\tTASK', '%F\ttask_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_start_date\ttarget_end_date',
  '%R\t10\t2\tFDN-10\tExcavation foundation\tTT_Task\t2026-11-01 08:00\t2026-11-05 17:00',
  '%R\t11\t2\tFDN-20\tConcrete pour K-300\tTT_Task\t2026-11-04 08:00\t2026-11-12 17:00', '%E'].join('\n');
const XML = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Tasks>
<Task><UID>0</UID><Name>Root</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary><Start>2026-11-01T08:00:00</Start><Finish>2026-11-12T17:00:00</Finish></Task>
<Task><UID>1</UID><Name>Foundations</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Start>2026-11-01T08:00:00</Start><Finish>2026-11-12T17:00:00</Finish></Task>
<Task><UID>2</UID><Name>Excavation foundation</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Start>2026-11-01T08:00:00</Start><Finish>2026-11-05T17:00:00</Finish></Task>
<Task><UID>3</UID><Name>Concrete pour K-300 &amp; curing</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Start>2026-11-04T08:00:00</Start><Finish>2026-11-12T17:00:00</Finish></Task>
</Tasks></Project>`;
const reports = {};
for (let i = 0; i < 12; i++) {
  const d = `2026-11-${String(i + 1).padStart(2, '0')}`;
  reports[d] = { rows: [
    { pkg: 'FDN', pkgName: 'Foundations', area: 'ONPLOT', desc: 'Excavation foundation', unit: 'm3', bq: 100, rate: 100000, pct: Math.min(100, i * 25) },
    { pkg: 'FDN', pkgName: 'Foundations', area: 'ONPLOT', desc: 'Concrete pour K-300', unit: 'm3', bq: 50, rate: 1800000, pct: Math.max(0, Math.min(100, (i - 3) * 12)) },
    { pkg: 'EL', pkgName: 'Electrical', area: 'ONPLOT', desc: 'Cable tray', unit: 'm', bq: 100, rate: 500000, pct: i * 5 },
  ], concerns: [] };
}
test('P6 XER: tasks with WBS path', () => {
  const { tasks } = parseXER(XER);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks[0].wbs, ['Project', 'Foundations']);
  assert.equal(tasks[1].finish, '2026-11-12');
});
test('MS Project XML: summary tasks become the WBS path, entities decoded', () => {
  const { tasks } = parseMSPDI(XML);
  const c = tasks.find((t) => t.name.startsWith('Concrete'));
  assert.equal(c.name, 'Concrete pour K-300 & curing');
  assert.deepEqual(c.wbs, ['Foundations']);
  assert.ok(parseSchedule('plan.xml', XML) && parseSchedule('plan.xer', XER));
});
test('schedule → activity-level baseline, value weighting', () => {
  const m0 = buildModel(reports);
  for (const src of [parseXER(XER), parseMSPDI(XML)]) {
    const r = scheduleToBaseline(src, m0.pkgs);
    assert.equal(r.matchedActs, 2);
    assert.deepEqual(Object.keys(r.baseline), ['FDN']);
    assert.equal(r.baseline.FDN.start, '2026-11-01');
    assert.equal(r.baseline.FDN.finish, '2026-11-12');
    const m = buildModel(reports, { baseline: r.baseline });
    const p = m.pkgs.find((x) => x.id === 'FDN');
    assert.equal(p.bl.acts, 2);
    assert.ok(p.plan[4] > 0 && p.plan[11] === 100);
  }
  const mv = buildModel(reports, { weighting: 'value' });
  assert.equal(mv.weighting, 'value');
  assert.equal(mv.totalValue, 100 * 100000 + 50 * 1800000 + 100 * 500000);
  const f = mv.pkgs.find((x) => x.id === 'FDN');
  // day 5: excavation 100 %, concrete 12 % → value weighted (10M·100 + 90M·12) / 100M = 20.8 %
  assert.ok(Math.abs(f.curve[4] - 20.8) < 0.01);
  assert.equal(buildModel(reports, { weighting: 'count' }).pkgs.find((x) => x.id === 'FDN').curve[4], 56);
});
