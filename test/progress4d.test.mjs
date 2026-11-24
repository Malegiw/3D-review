import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReport, groupLines, num, dateFromName, packageOfHeading } from '../src/engine/dailyreport.js';
import { buildModel, pctAt, stateOf, toLong, reportsFromCSV, buildProgressXlsx, slimReport, activitiesAt } from '../src/engine/progress4d.js';

// A report in the layout pdf.js hands out (rows already joined left to right).
const day = (date, tank, mcc) => [
  'DAILY ACTIVITY REPORT',
  `PROJECT : EPC DEMO WATERFLOOD Date : Monday, ${date}`,
  'GRAND TOTAL MANPOWER 152 152 12.906 1.170 14.046',
  'TODAY ACTIVITIES',
  'No DESCRIPTION UNIT BQ VOLUME YESTERDAY TODAY TOTAL VOLUME REMAINING PERCENT REMARK',
  '1 2 3 4 5 6 7=5+6 8=4-7 9=7:4X%',
  'A MENO OFFPLOT',
  'Main Line Header Segment 1',
  'Coating Flow line 12” Meter 550,00 550,00 - 550,00 - 100,0% Complete',
  'Meno CTI-05',
  'Stringing Flow Line 6” Joint 70,00 70,00 - 70,00 - 100,0% Complete',
  'Pigging Main Header Pipe Line 12" (Segmen 1, 2 and 3) Line 1,00 1,00 - 1,00 - 100,0% Complete',
  'B MENO ONPLOT',
  'SURGE TANK',
  `Erection and Fitup First Shell Sheet 6,00 ${tank.y} ${tank.t} ${tank.tot} ${tank.rem} ${tank.pct}% Shell 1`,
  'Page 1 of 4',
  'Install Nozzle 8" N16, N17 Joint 2,00 1,90 - 1,90 0,10 95,0%',
  'MCC ROOM',
  `${mcc}`,
  'Install Brickwall Side 4,00 4,00 - 4,00 - 100,0% Complete',
  'CONCERN',
  'NO. DESCRIPTION',
  'Site Clearing of Distribution line segmen 1 need to speed up',
  '1',
  'Attachment: Photograph',
];

test('num: Indonesian number format', () => {
  assert.equal(num('1.000,00'), 1000);
  assert.equal(num('617,00'), 617);
  assert.equal(num('-'), 0);
  assert.equal(num('66,67'), 66.67);
});

test('groupLines: joins pdf.js items of one visual row left to right', () => {
  const l = groupLines([{ s: 'Titik', x: 300, y: 100.4 }, { s: 'Piling', x: 20, y: 100 }, { s: '90,00', x: 360, y: 99.8 }, { s: 'Next row', x: 20, y: 120 }]);
  assert.deepEqual(l, ['Piling Titik 90,00', 'Next row']);
});

test('parseReport: date, manpower, packages, rows, concerns', () => {
  const r = parseReport(day('02 November 2026', { y: '3,00', t: '2,00', tot: '5,00', rem: '1,00', pct: '83,3' }, 'Beam B1 (Rebar, Formwork, Pouring Concrete) Spot 4,00 4,00 - 4,00 - 100,0% Complete'));
  assert.equal(r.date, '2026-11-02');
  assert.equal(r.manpower.today, 152);
  assert.equal(r.project, 'EPC DEMO WATERFLOOD');
  const by = Object.groupBy(r.rows, (x) => x.pkg);
  assert.deepEqual(Object.keys(by), ['HDR-S1', 'CTI-05', 'OFF-TEST', 'TANK', 'MCC']);
  assert.equal(by['OFF-TEST'][0].pkgName, 'Main header 12" · test & crossings'); // row under a well pad heading, re-homed
  assert.equal(by.TANK[0].pct, 83.3);
  assert.equal(by.TANK[0].total, 5);
  assert.equal(by.TANK.length, 2, 'a page footer inside the table does not break the row after it');
  assert.equal(by.TANK[0].area, 'ONPLOT');
  assert.equal(by['HDR-S1'][0].area, 'OFFPLOT');
  assert.equal(r.concerns.length, 1);
  assert.match(r.concerns[0], /speed up/);
});

test('parseReport: thousands separators and the unit stay out of the description', () => {
  const r = parseReport(['TODAY ACTIVITIES', 'Main Line Header Segment 2', 'Coating Flow line 12” Meter 1.000,00 1.000,00 - 1.000,00 - 100,0% Complete']);
  assert.equal(r.rows[0].bq, 1000);
  assert.equal(r.rows[0].unit, 'Meter');
  assert.equal(r.rows[0].desc, 'Coating Flow line 12”');
});

test('packageOfHeading: known headings and unknown ALL-CAPS headings', () => {
  assert.equal(packageOfHeading('Meno CTI-27').id, 'CTI-27');
  assert.equal(packageOfHeading('WATER INJECTION PUMP UNIT 1,Unit 2, Unit 3').id, 'WIP');
  assert.equal(packageOfHeading('PIPE LINE 12" to Meno GS').id, 'PIPE-ON');
  assert.equal(packageOfHeading('FLARE KNOCK OUT DRUM').name, 'Flare Knock Out Drum');
  assert.equal(packageOfHeading('Fit up and weld pipe'), null);
});

test('dateFromName', () => {
  assert.equal(dateFromName('Daily Activity Report EPC Meno Waterflood Project 28 Okt 2026.pdf'), '2026-10-28');
  assert.equal(dateFromName('report_2026-11-21.pdf'), '2026-11-21');
  assert.equal(dateFromName('report.pdf'), null);
});

function twoDays() {
  const a = parseReport(day('02 November 2026', { y: '3,00', t: '2,00', tot: '5,00', rem: '1,00', pct: '83,3' }, 'Beam B1 (Rebar, Formwork, Pouring Concrete) Spot 4,00 2,00 - 2,00 2,00 50,0%'));
  const b = parseReport(day('03 November 2026', { y: '5,00', t: '1,00', tot: '6,00', rem: '-', pct: '100,0' }, 'Beam B1 (Rebar, Formwork and Pouring Concrete) Spot 4,00 2,00 2,00 4,00 - 100,0%'));
  return { '2026-11-02': slimReport(a), '2026-11-03': slimReport(b) };
}

test('buildModel: series per activity, a reworded row continues the same activity', () => {
  const m = buildModel(twoDays());
  assert.deepEqual(m.dates, ['2026-11-02', '2026-11-03']);
  const mcc = m.pkgs.find((p) => p.id === 'MCC');
  assert.equal(mcc.acts.length, 2, 'Beam B1 reworded on day 2 is still one activity');
  assert.equal(mcc.acts[0].renamed, 1);
  assert.deepEqual(Array.from(mcc.acts[0].pct), [50, 100]);
  assert.ok(m.overall[1] > m.overall[0]);
  assert.equal(pctAt(mcc.curve, 0.5), (mcc.curve[0] + mcc.curve[1]) / 2);
  assert.equal(pctAt(mcc.curve, -3), mcc.curve[0]);
  assert.equal(pctAt(mcc.curve, 99), mcc.curve[1]);
  assert.equal(m.manpower[0], 152);
  assert.equal(m.concerns['2026-11-02'].length, 1);
});

test('buildModel: new rows count 0 % before they appear; dropped rows keep their last value', () => {
  const r = twoDays();
  r['2026-11-03'].rows = r['2026-11-03'].rows.filter((x) => !/Brickwall/.test(x.desc));
  r['2026-11-03'].rows.push({ pkg: 'MCC', pkgName: 'MCC room', area: 'ONPLOT', hint: '', summary: false, sub: '', desc: 'Roof slab', unit: 'Spot', bq: 1, pct: 20 });
  const m = buildModel(r);
  const mcc = m.pkgs.find((p) => p.id === 'MCC');
  const brick = mcc.acts.find((a) => /Brickwall/.test(a.desc)), roof = mcc.acts.find((a) => a.desc === 'Roof slab');
  assert.equal(brick.pct[1], 100);
  assert.equal(brick.dropped, true);
  assert.deepEqual(Array.from(roof.pct), [0, 20]);
});

test('stateOf and activitiesAt', () => {
  assert.equal(stateOf(0), 'todo');
  assert.equal(stateOf(40), 'wip');
  assert.equal(stateOf(99.6), 'done');
  const m = buildModel(twoDays());
  const list = activitiesAt(m.pkgs.find((p) => p.id === 'MCC'), 1);
  assert.equal(list.length, 2);
  assert.ok(list.every((a) => a.pct === 100));
});

test('CSV long format round-trips', () => {
  const m = buildModel(twoDays());
  const long = toLong(m);
  const head = 'date;package;package_id;area;activity;unit;bq;progress';
  const q = (x) => `"${String(x).replace(/"/g, '""')}"`; // what Excel writes for fields that contain quotes
  const csv = [head, ...long.map((r) => [r.date, q(r.package), r.package_id, r.area, q(r.activity), r.unit, String(r.bq).replace('.', ','), String(r.progress).replace('.', ',')].join(';'))].join('\n');
  const back = buildModel(reportsFromCSV(csv));
  assert.equal(back.count, m.count);
  assert.deepEqual(Array.from(back.overall).map((x) => Math.round(x)), Array.from(m.overall).map((x) => Math.round(x)));
});

test('XLSX export is a zip', async () => {
  const blob = buildProgressXlsx(buildModel(twoDays()), { project: 'Demo' });
  const head = Buffer.from(await blob.arrayBuffer()).subarray(0, 2).toString();
  assert.equal(head, 'PK');
});

import { baselineFromCSV, planAt } from '../src/engine/progress4d.js';
test('weights change the overall, baseline gives a plan curve', async () => {
  const mk = (d, a, b) => ({ date: d, rows: [
    { pkg: 'A', pkgName: 'Alpha', area: 'OFFPLOT', desc: 'a1', unit: 'm', bq: 10, total: a, pct: a, remark: '' },
    { pkg: 'B', pkgName: 'Beta', area: 'OFFPLOT', desc: 'b1', unit: 'm', bq: 10, total: b, pct: b, remark: '' },
    { pkg: 'B', pkgName: 'Beta', area: 'OFFPLOT', desc: 'b2', unit: 'm', bq: 10, total: b, pct: b, remark: '' }] });
  const reps = { '2026-11-01': mk('2026-11-01', 0, 0), '2026-11-03': mk('2026-11-03', 100, 50) };
  const m0 = buildModel(reps);
  assert.ok(Math.abs(m0.overall[1] - (100 + 50 * 2) / 3) < 0.01);                // default: by activity count
  const m1 = buildModel(reps, { weights: { A: 3, B: 1 } });
  assert.ok(Math.abs(m1.overall[1] - (100 * 3 + 50) / 4) < 0.01);                // custom weights
  const { baseline, missing } = baselineFromCSV('package,start,finish\nAlpha,2026-11-01,2026-11-03\nBETA;01/11/2026;10/11/2026\nnope,2026-11-01,2026-11-02', m0.pkgs);
  assert.deepEqual(Object.keys(baseline).sort(), ['A', 'B']);
  assert.equal(missing.length, 1);
  const m2 = buildModel(reps, { baseline });
  assert.equal(Math.round(m2.plan[1]), Math.round((100 * 1 + planAt(Date.parse('2026-11-03'), Date.parse('2026-11-01'), Date.parse('2026-11-10')) * 2) / 3));
  assert.equal(planAt(0, 1, 2), 0); assert.equal(planAt(3, 1, 2), 100);
});
