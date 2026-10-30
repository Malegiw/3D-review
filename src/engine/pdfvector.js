// Vector extraction from plot plan PDFs (pdf.js operator list, v5+/v6 path encoding).
// Output coordinates are in viewport space at scale 1 (points, y-down) so they match the rendered page.

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Raw subpaths from an operator list. vpTransform = viewport(scale 1).transform */
export function extractPaths(opList, OPS, vpTransform = [1, 0, 0, 1, 0, 0], { maxPaths = 250000 } = {}) {
  const { fnArray, argsArray } = opList;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const paths = [];
  const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < fnArray.length && paths.length < maxPaths; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      const paintOp = args[0];
      if (!paintOps.has(paintOp)) continue; // clip-only / endPath
      const datas = Array.isArray(args[1]) ? args[1] : [args[1]];
      const M = mul(vpTransform, ctm);
      const closeOp = paintOp === OPS.closeStroke || paintOp === OPS.closeFillStroke || paintOp === OPS.closeEOFillStroke;
      const filled = paintOp !== OPS.stroke && paintOp !== OPS.closeStroke;
      for (const d of datas) {
        if (!d) continue;
        let cur = null;
        let lx = 0, ly = 0;
        const flush = (closed) => {
          if (cur && cur.pts.length > 1) { cur.closed = cur.closed || closed || closeOp; cur.filled = filled; paths.push(cur); }
          cur = null;
        };
        for (let k = 0; k < d.length;) {
          const op = d[k++];
          if (op === DRAW.moveTo) {
            flush(false);
            lx = d[k++]; ly = d[k++];
            cur = { pts: [ap(M, lx, ly)], closed: false, curved: false };
          } else if (op === DRAW.lineTo) {
            lx = d[k++]; ly = d[k++];
            if (!cur) cur = { pts: [], closed: false, curved: false };
            cur.pts.push(ap(M, lx, ly));
          } else if (op === DRAW.curveTo) {
            const x1 = d[k++], y1 = d[k++], x2 = d[k++], y2 = d[k++], x3 = d[k++], y3 = d[k++];
            if (!cur) cur = { pts: [ap(M, lx, ly)], closed: false, curved: false };
            for (let s = 1; s <= 8; s++) {
              const t = s / 8, u = 1 - t;
              const x = u * u * u * lx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
              const y = u * u * u * ly + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
              cur.pts.push(ap(M, x, y));
            }
            cur.curved = true; lx = x3; ly = y3;
          } else if (op === DRAW.quadraticCurveTo) {
            const x1 = d[k++], y1 = d[k++], x2 = d[k++], y2 = d[k++];
            if (!cur) cur = { pts: [ap(M, lx, ly)], closed: false, curved: false };
            for (let s = 1; s <= 6; s++) {
              const t = s / 6, u = 1 - t;
              cur.pts.push(ap(M, u * u * lx + 2 * u * t * x1 + t * t * x2, u * u * ly + 2 * u * t * y1 + t * t * y2));
            }
            cur.curved = true; lx = x2; ly = y2;
          } else if (op === DRAW.closePath) {
            if (cur) { cur.closed = true; const p0 = cur.pts[0]; const pl = cur.pts[cur.pts.length - 1]; if (Math.hypot(p0[0] - pl[0], p0[1] - pl[1]) < 1e-6) cur.pts.pop(); }
            const start = cur?.pts[0];
            flush(true);
            if (start) { /* PDF: current point returns to subpath start */ }
          } else {
            break; // unknown op — stop parsing this path safely
          }
        }
        flush(false);
      }
    }
  }
  return paths;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
export function polyArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(s / 2);
}
function simplify(pts, tol) {
  const out = [];
  for (const p of pts) { if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p); }
  if (out.length > 2 && dist(out[0], out[out.length - 1]) <= tol) out.pop();
  // drop collinear points
  for (let i = out.length - 1; i >= 0 && out.length > 3; i--) {
    const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) < tol * Math.max(dist(a, c), 1e-9)) out.splice(i, 1);
  }
  return out;
}

/** Join open segments that share endpoints (CAD exports often draw rectangles as 4 loose lines). */
export function stitch(paths, tol = 0.35, limit = 60000) {
  const open = paths.filter((p) => !p.closed);
  if (open.length > limit) return paths;
  const closed = paths.filter((p) => p.closed);
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const ends = new Map();
  const addEnd = (k, i) => { const l = ends.get(k); if (l) l.push(i); else ends.set(k, [i]); };
  open.forEach((p, i) => { addEnd(key(p.pts[0]), i); addEnd(key(p.pts[p.pts.length - 1]), i); });
  const used = new Uint8Array(open.length);
  const take = (pt, self) => {
    const l = ends.get(key(pt));
    if (!l) return -1;
    for (const j of l) if (!used[j] && j !== self) return j;
    return -1;
  };
  const out = [...closed];
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = open[i].pts.slice();
    let curved = open[i].curved;
    for (let guard = 0; guard < 400; guard++) {
      const tail = chain[chain.length - 1];
      const j = take(tail, -1);
      if (j < 0) break;
      used[j] = 1;
      const q = open[j].pts;
      const fwd = dist(q[0], tail) <= dist(q[q.length - 1], tail);
      const seg = fwd ? q.slice(1) : q.slice(0, -1).reverse();
      chain = chain.concat(seg);
      curved ||= open[j].curved;
      if (dist(chain[0], chain[chain.length - 1]) <= tol) break;
    }
    const isClosed = chain.length > 3 && dist(chain[0], chain[chain.length - 1]) <= tol;
    if (isClosed) chain.pop();
    out.push({ pts: chain, closed: isClosed, curved, stitched: true });
  }
  return out;
}

/**
 * Classify into selectable shapes: circle | rect | poly | line.
 * minSize (pt): ignore anything with bbox diagonal smaller than this (hatching, text strokes).
 */
export function classify(paths, { minSize = 6, pageW = Infinity, pageH = Infinity, max = 6000 } = {}) {
  const shapes = [];
  const seen = new Set();
  for (const p of paths) {
    if (p.pts.length < 2) continue;
    const bb = bboxOf(p.pts);
    const w = bb[2] - bb[0], hgt = bb[3] - bb[1];
    const diag = Math.hypot(w, hgt);
    if (diag < minSize) continue;
    if (w > pageW * 0.92 && hgt > pageH * 0.92) continue; // drawing border
    let s = null;
    const closedish = p.closed || (p.pts.length > 3 && dist(p.pts[0], p.pts[p.pts.length - 1]) < Math.max(0.5, diag * 0.01));
    if (closedish && p.pts.length >= 3) {
      if (p.curved && p.pts.length >= 8) {
        let cx = 0, cy = 0;
        p.pts.forEach(([x, y]) => { cx += x; cy += y; });
        cx /= p.pts.length; cy /= p.pts.length;
        const rs = p.pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
        const r = rs.reduce((x, y) => x + y, 0) / rs.length;
        const dev = Math.max(...rs.map((x) => Math.abs(x - r))) / r;
        if (dev < 0.06 && Math.abs(w - hgt) / Math.max(w, hgt) < 0.08) {
          s = { kind: 'circle', cx: (bb[0] + bb[2]) / 2, cy: (bb[1] + bb[3]) / 2, r: (w + hgt) / 4 };
        }
      }
      if (!s) {
        const pts = simplify(p.pts, 0.05);
        if (pts.length < 3) continue;
        const area = polyArea(pts);
        if (area < (minSize * minSize) / 8) continue;
        const rect = pts.length === 4 && [0, 1, 2, 3].every((i) => {
          const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
          const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
          return Math.abs(dot) < 0.02 * dist(a, b) * dist(b, c) + 1e-6;
        });
        s = { kind: rect ? 'rect' : 'poly', pts };
      }
    } else {
      const pts = p.pts.filter((q, i) => i === 0 || dist(q, p.pts[i - 1]) > 0.05);
      if (pts.length < 2) continue;
      s = { kind: 'line', pts };
    }
    const b2 = s.kind === 'circle' ? [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r] : bboxOf(s.pts);
    const k = `${s.kind}|${b2.map((v) => Math.round(v * 2)).join(',')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    s.bbox = b2;
    s.area = s.kind === 'circle' ? Math.PI * s.r * s.r : s.kind === 'line' ? 0 : polyArea(s.pts);
    shapes.push(s);
  }
  // keep the most meaningful shapes if the drawing is huge: closed shapes first, then by size
  shapes.sort((x, y) => (x.kind === 'line') - (y.kind === 'line') || (y.area - x.area) || ((y.bbox[2] - y.bbox[0]) - (x.bbox[2] - x.bbox[0])));
  const out = shapes.slice(0, max);
  out.forEach((s, i) => { s.id = i; });
  return out;
}

/** Text items → [{s, x, y}] in viewport space (used to auto-fill equipment tags). */
export function textItems(textContent, vpTransform) {
  const out = [];
  for (const it of textContent.items || []) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    const M = mul(vpTransform, t);
    // centre of the text run (local box: width × height, baseline at y=0)
    const w = it.width / Math.hypot(t[0], t[1] || 0) || 0;
    const [x, y] = ap(M, w / 2, 0.35);
    out.push({ s: it.str.trim(), x, y });
  }
  return out;
}

// ---------- geometry helpers (shared with the editor) ----------
export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
export function shapeContains(s, x, y, tol) {
  const b = s.bbox;
  if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) return false;
  if (s.kind === 'circle') return Math.hypot(x - s.cx, y - s.cy) <= s.r + tol;
  if (s.kind === 'line') { for (let i = 1; i < s.pts.length; i++) if (distToSeg(x, y, s.pts[i - 1], s.pts[i]) <= tol) return true; return false; }
  return pointInPoly(x, y, s.pts) || s.pts.some((p, i) => distToSeg(x, y, p, s.pts[(i + 1) % s.pts.length]) <= tol);
}
export const TAG_RX = /\b([A-Z]{1,4}-?\d{2,5}[A-Z]?(\/[A-Z])?)\b/;
export function tagInside(s, texts) {
  const hits = texts.filter((t) => shapeContains({ ...s, kind: s.kind === 'line' ? 'poly' : s.kind }, t.x, t.y, 0));
  const tagged = hits.find((t) => TAG_RX.test(t.s));
  return (tagged ? tagged.s.match(TAG_RX)[1] : hits[0]?.s || '').slice(0, 40);
}
