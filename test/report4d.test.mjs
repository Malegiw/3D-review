import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/progress4d.js';
import { weeklyFacts, weeklyReportHtml } from '../src/engine/report4d.js';

const day = (i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
function reports(n) {
  const r = {};
  for (let i = 0; i < n; i++) r[day(i)] = {
    rows: [
      { pkg: 'A', pkgName: 'Alpha', area: 'ONPLOT', desc: 'a1', unit: 'm3', bq: 100, pct: Math.min(100, i * 5) },
      { pkg: 'B', pkgName: 'Beta', area: 'OFFPLOT', desc: 'b1', unit: 'm', bq: 1000, pct: Math.max(0, Math.min(100, (i - 7) * 4)) },
    ],
    manpower: { today: 10 + i }, concerns: i === 12 ? ['Hujan'] : [],
  };
  return r;
}
test('weekly facts: week number, gain over 7 days, quantities, issues, manpower', () => {
  const m = buildModel(reports(21), { baseline: { A: { start: day(0), finish: day(15) }, B: { start: day(5), finish: day(25) } } });
  const f = weeklyFacts(m, 13);
  assert.equal(f.week, 2);
  assert.equal(f.from, day(7));
  const a = f.pkgs.find((p) => p.id === 'A');
  assert.equal(Math.round(a.wk), 35);                      // 65 % − 30 %
  const act = f.acts.find((x) => x.desc === 'a1');
  assert.equal(Math.round(act.qty), 35);                   // 35 % of 100 m3
  assert.deepEqual(f.issues, ['Hujan']);
  assert.equal(f.mpPeak, 23);
  assert.ok(f.plan > 0 && f.spi > 0);
  assert.ok(f.look.some((l) => l.name === 'Beta'));
  assert.ok(f.forecast);
});
test('weekly report html is self-contained and escapes text', () => {
  const r = reports(10); r[day(9)].concerns = ['<script>x</script>'];
  const html = weeklyReportHtml(buildModel(r), 9, { project: 'P & Q', simulated: true });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('P &amp; Q'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('DATA SIMULASI'));
  assert.ok(!/src="http/.test(html));
});
