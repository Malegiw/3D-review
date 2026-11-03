// Material take-off result: totals first (what a reviewer asks for), then the detail they can filter.
import { h, icon, fmt } from '../core/ui.js';
import { MATERIALS } from '../core/domain.js';

const LABEL = { concrete: 'Concrete', steel: 'Steel', other: 'Other' };
const tonnes = (kg) => fmt.num(kg / 1000, kg >= 100000 ? 1 : 2);
const PAGE = 40;

function totalsCard(s, material) {
  const color = MATERIALS[material].color;
  return h('div', { class: 'mto-card', style: { '--c': color } },
    h('div', { class: 'mto-card-head' }, h('i', { class: 'mto-dot' }), h('b', {}, LABEL[material])),
    h('div', { class: 'mto-big' }, h('span', {}, s ? fmt.num(s.volume, 2) : '0'), h('small', {}, 'm³')),
    h('div', { class: 'mto-sub' }, s?.weight ? h('span', {}, h('b', {}, tonnes(s.weight)), ' ton') : h('span', {}, '—'), h('span', { class: 'dim' }, s ? `${fmt.int(s.count)} components` : 'none')));
}

/**
 * @param {{rows: any[], summary: any[]}} res  result of runMTO
 * @param {{ onPick: (row) => void, onExport: () => void }} cb
 */
export function mtoResult(res, { onPick, onExport }) {
  const by = Object.fromEntries(res.summary.map((s) => [s.material, s]));
  const totalWeight = res.summary.reduce((n, s) => n + s.weight, 0);
  const openCount = res.summary.reduce((n, s) => n + s.open, 0);
  const other = by.other;

  const state = { view: 'items', filter: 'all', limit: PAGE };
  const detail = h('div', { class: 'mto-detail' });

  const seg = (opts, key, then) => h('div', { class: 'seg mto-seg', role: 'group' }, opts.map(([id, label, n]) => h('button', {
    type: 'button', class: state[key] === id ? 'on' : '', 'aria-pressed': String(state[key] === id),
    onclick: () => { state[key] = id; state.limit = PAGE; then(); },
  }, label, n != null ? h('em', {}, n) : null)));

  function itemRow(r) {
    const solid = r.closed;
    const dims = `${fmt.num(r.L, 1)} × ${fmt.num(r.W, 1)} × ${fmt.num(r.H, 1)} m`;
    return h('button', { type: 'button', class: 'mto-row', onclick: () => onPick(r), style: { '--c': MATERIALS[r.material]?.color } },
      h('i', { class: 'mto-dot' }),
      h('span', { class: 'mto-name' }, h('b', { class: 'no-i18n' }, r.name), h('small', {}, dims, ' · ', h('span', { class: 'no-i18n' }, r.layer))),
      h('span', { class: 'mto-val' },
        solid ? h('b', { class: r.weight ? '' : 'dim' }, `${fmt.num(r.volume, 3)} m³`) : h('b', { class: 'dim' }, `${fmt.num(r.area, 1)} m²`),
        h('small', {}, solid ? (r.weight ? `${fmt.int(r.weight)} kg` : 'not counted as material') : 'surface only')));
  }

  function drawItems() {
    const list = res.rows.filter((r) => state.filter === 'all' || r.material === state.filter).sort((a, b) => b.weight - a.weight || b.volume - a.volume || b.area - a.area); // weighed material first, then the rest by size
    const shown = list.slice(0, state.limit);
    const count = (m) => res.rows.filter((r) => r.material === m).length;
    detail.replaceChildren(
      seg([['all', 'All', res.rows.length], ['concrete', 'Concrete', count('concrete')], ['steel', 'Steel', count('steel')], ['other', 'Other', count('other')]], 'filter', draw),
      list.length ? h('div', { class: 'mto-list' }, shown.map(itemRow)) : h('p', { class: 'mto-none' }, 'Nothing in this group.'),
      list.length > shown.length ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { state.limit += PAGE; draw(); } }, `Show ${Math.min(PAGE, list.length - shown.length)} more`) : null,
      list.length > PAGE ? h('p', { class: 'mto-none' }, `${fmt.int(shown.length)} of ${fmt.int(list.length)}, heaviest first.`) : null);
  }

  function drawLayers() {
    const map = new Map();
    for (const r of res.rows) {
      const g = map.get(r.layer) || { layer: r.layer, count: 0, concrete: 0, steel: 0, weight: 0 };
      g.count++; g.weight += r.weight;
      if (r.material === 'concrete') g.concrete += r.volume;
      if (r.material === 'steel') g.steel += r.volume;
      map.set(r.layer, g);
    }
    const list = [...map.values()].sort((a, b) => b.weight - a.weight || b.count - a.count);
    detail.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl mto-tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Layer'), h('th', { class: 'num' }, 'Concrete m³'), h('th', { class: 'num' }, 'Steel m³'), h('th', { class: 'num' }, 'Weight ton'))),
      h('tbody', {}, list.slice(0, 80).map((g) => h('tr', {},
        h('td', {}, h('span', { class: 'no-i18n' }, g.layer), h('small', { class: 'mto-cnt' }, ` ${fmt.int(g.count)}`)),
        h('td', { class: 'num' }, g.concrete ? fmt.num(g.concrete, 2) : '—'), h('td', { class: 'num' }, g.steel ? fmt.num(g.steel, 2) : '—'),
        h('td', { class: 'num' }, g.weight ? tonnes(g.weight) : '—')))))));
  }

  const tabs = h('div', {});
  function draw() {
    tabs.replaceChildren(seg([['items', 'By object'], ['layers', 'By layer']], 'view', draw));
    (state.view === 'layers' ? drawLayers : drawItems)();
  }

  const root = h('div', { class: 'mto-result' },
    h('div', { class: 'mto-title' }, h('h4', {}, 'Result'), h('button', { class: 'btn ghost sm', type: 'button', onclick: onExport }, icon('download'), 'XLSX')),
    h('div', { class: 'mto-cards' }, totalsCard(by.concrete, 'concrete'), totalsCard(by.steel, 'steel')),
    h('div', { class: 'mto-total' }, h('span', {}, 'Total weight'), h('b', {}, `${tonnes(totalWeight)} ton`)),
    other?.count ? h('p', { class: 'mto-note' }, h('b', {}, `${fmt.int(other.count)} other components`), ' — tanks, vessels, equipment, pipes and buildings are modelled as solid shapes (space, not material), so they are listed but not weighed.') : null,
    openCount ? h('p', { class: 'mto-note warn' }, h('b', {}, `${fmt.int(openCount)} surfaces without a closed volume`), ' — single-sided panels or pipe walls without ends. Only their area is counted.') : null,
    h('h4', {}, 'Breakdown'),
    tabs, detail);
  draw();
  return root;
}
