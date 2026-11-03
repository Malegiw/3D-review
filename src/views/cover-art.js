// Small isometric gathering-station drawing used as the cover of a project card until the project has a real model.
// Colours come from CSS variables (.art in theme.css) so it follows the theme.
let seq = 0;

const S = 14; // px per metre-ish unit
const P = (x, y, z = 0) => [(x - y) * 0.866 * S, (x + y) * 0.5 * S - z * S];
const pts = (...ps) => ps.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');

function box(x, y, w, d, hgt, z0 = 0, cls = 'blk') {
  const z1 = z0 + hgt;
  return `<g class="${cls}">
    <polygon class="l" points="${pts(P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x, y + d, z1))}"/>
    <polygon class="r" points="${pts(P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x + w, y, z1))}"/>
    <polygon class="t" points="${pts(P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1))}"/>
  </g>`;
}

function tank(cx, cy, r, hgt, id) {
  const [px, py] = P(cx, cy, 0);
  const rx = 1.2247 * S * r, ry = 0.7071 * S * r, top = py - hgt * S;
  return `<g class="tank">
    <path d="M${(px - rx).toFixed(1)} ${top.toFixed(1)}V${py.toFixed(1)}A${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${(px + rx).toFixed(1)} ${py.toFixed(1)}V${top.toFixed(1)}Z" fill="url(#cg${id})"/>
    <ellipse class="t" cx="${px.toFixed(1)}" cy="${top.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/>
  </g>`;
}

export function coverArt() {
  const id = ++seq;
  const wrap = document.createElement('span');
  wrap.className = 'art-wrap';
  wrap.innerHTML = `<svg class="art" viewBox="-116 -52 252 196" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><linearGradient id="cg${id}" x1="0" x2="1"><stop offset="0" style="stop-color:var(--art-tank-l)"/><stop offset=".55" style="stop-color:var(--art-tank-m)"/><stop offset="1" style="stop-color:var(--art-tank-r)"/></linearGradient></defs>
    ${box(0, 0, 10, 8, 0.3, 0, 'ground')}
    ${box(6.9, 0.9, 2.4, 2.4, 1.2, 0.3, 'hot')}
    ${tank(2.6, 2.4, 1.35, 2.4, id).replace('<g class="tank">', '<g class="tank" transform="translate(0,-4)">')}
    ${tank(5.3, 2.2, 1.0, 1.8, id).replace('<g class="tank">', '<g class="tank" transform="translate(0,-4)">')}
    ${tank(2.9, 5.5, 0.95, 1.5, id).replace('<g class="tank">', '<g class="tank" transform="translate(0,-4)">')}
    ${box(1, 4.3, 8.2, 0.35, 0.18, 1.4, 'rack')}
    ${box(1.2, 4.3, 0.2, 0.35, 1.1, 0.3, 'rack')}${box(4.9, 4.3, 0.2, 0.35, 1.1, 0.3, 'rack')}${box(8.6, 4.3, 0.2, 0.35, 1.1, 0.3, 'rack')}
    ${box(6.2, 6.0, 2.8, 1.5, 0.7, 0.3, 'blk')}
  </svg>`;
  return wrap;
}
