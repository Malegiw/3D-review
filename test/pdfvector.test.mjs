import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPaths, stitch, classify, textItems, tagInside } from '../src/engine/pdfvector.js';

test('extracts circles, rectangles, polygon and tags from sample plot plan', async () => {
  const data = new Uint8Array(fs.readFileSync(new URL('./fixtures/sample-plotplan.pdf', import.meta.url)));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList();
  const paths = stitch(extractPaths(ol, pdfjs.OPS, vp.transform));
  const shapes = classify(paths, { minSize: 6, pageW: vp.width, pageH: vp.height });
  const kinds = shapes.reduce((a, s) => ((a[s.kind] = (a[s.kind] || 0) + 1), a), {});
  console.log('page', vp.width.toFixed(1), vp.height.toFixed(1), 'paths', paths.length, kinds);
  const circles = shapes.filter((s) => s.kind === 'circle');
  assert.equal(circles.length, 3, 'three tanks');
  const m = 72 / 25.4 * 1000 / 500; // pt per metre at 1:500
  const rs = circles.map((c) => +(c.r / m).toFixed(2)).sort();
  assert.deepEqual(rs, [6, 8, 8]);
  const rects = shapes.filter((s) => s.kind === 'rect');
  assert.ok(rects.length >= 7, `rects ${rects.length}`);
  // control room 30 x 18 m
  assert.ok(rects.some((r) => Math.abs((r.bbox[2] - r.bbox[0]) / m - 30) < 0.05 && Math.abs((r.bbox[3] - r.bbox[1]) / m - 18) < 0.05));
  const texts = textItems(await page.getTextContent(), vp.transform);
  const t101 = circles.find((c) => tagInside(c, texts) === 'T-101');
  assert.ok(t101, 'tag T-101 found inside a circle');
  // y-down viewport: T-101 at plan y=60 m above origin(120pt) => viewport y = H - (120 + 60m)
  assert.ok(Math.abs(t101.cy - (vp.height - (120 + 60 * m))) < 0.5);
});

test('stitches loose segments into a closed rectangle', () => {
  const seg = (a, b) => ({ pts: [a, b], closed: false, curved: false });
  const out = stitch([seg([0, 0], [10, 0]), seg([10, 0], [10, 5]), seg([0, 5], [10, 5]), seg([0, 5], [0, 0])]);
  assert.equal(out.length, 1);
  assert.equal(out[0].closed, true);
  const s = classify(out, { minSize: 1 });
  assert.equal(s[0].kind, 'rect');
});
