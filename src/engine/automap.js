// Auto-mapping of work packages to model objects, from layer / node names and position.
// Pure functions: they take plain descriptors {key, name, x, z} so they can be unit-tested without WebGL.

/** Strip the merge suffix of a converted node name: "MGNO-8_-WI-D3CS2F-0-113 (77) · 2" → "MGNO-8_-WI-D3CS2F-0-113 (77)". */
export const layerOfName = (n) => String(n || '').replace(/\s·\s*\d+$/, '').trim();

export function classify(name) {
  const s = layerOfName(name);
  if (/existing|kelapasawit|kelapa sawit|kaca|^pipe existing/i.test(s)) return 'existing';
  if (/support/i.test(s)) return 'support';
  if (/^m[gn][gn]?[o0]-\d+/i.test(s)) return 'pipe';
  if (/concrete|foundation|pedestal/i.test(s)) return 'concrete';
  if (/drain/i.test(s)) return 'drainage';
  if (/^equipment/i.test(s)) return 'equipment';
  return 'other';
}

/** Principal axis (in plan) of a point set → scalar position along the route for each point. */
export function routeOrder(pts) {
  const n = pts.length;
  if (n < 2) return pts.map(() => 0);
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, mz = pts.reduce((a, p) => a + p.z, 0) / n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { const dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(th), uz = Math.sin(th);
  return pts.map((p) => (p.x - mx) * ux + (p.z - mz) * uz);
}

/**
 * Rules → { [pkgId]: [{key}] }.  Main-header segments 1..4 are the pipe nodes split in four equal lengths along the
 * route (which end is segment 1 is a guess: `reverse` flips it).  Summary packages take whole classes.
 * Returns { map, notes } — notes explain what was (not) done so the UI can say it.
 */
export function autoMap(descs, pkgs, { reverse = false } = {}) {
  const map = {}, notes = [];
  const has = (id) => pkgs.some((p) => p.id === id);
  const by = (c) => descs.filter((d) => classify(d.name) === c);
  const pipes = by('pipe');
  if (pipes.length) {
    const pos = routeOrder(pipes);
    const lo = Math.min(...pos), hi = Math.max(...pos), span = Math.max(1e-9, hi - lo);
    const segs = pkgs.filter((p) => /^HDR-S\d+$/.test(p.id)).sort((a, b) => a.id.localeCompare(b.id));
    const k = segs.length;
    if (k) {
      pipes.forEach((d, i) => {
        let f = (pos[i] - lo) / span; if (reverse) f = 1 - f;
        const si = Math.min(k - 1, Math.floor(f * k));
        (map[segs[si].id] ||= []).push({ key: d.key });
      });
      notes.push(`${pipes.length} pipe nodes → ${k} header segments (split by route length)`);
    }
  }
  const sup = by('support');
  if (sup.length && has('OFF-PILING')) { map['OFF-PILING'] = sup.map((d) => ({ key: d.key })); notes.push(`${sup.length} support nodes → pipe support piling`); }
  return { map, notes };
}
