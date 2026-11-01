// Domain vocabulary: deliverable workflow, disciplines, plot plan categories, materials.

export const DOC_STATUS = [
  { v: 'NOT STARTED', w: 0, c: 'var(--st-not)', l: 'Not started' },
  { v: 'IN PROGRESS', w: 30, c: 'var(--st-prog)', l: 'In progress' },
  { v: 'IFR', w: 60, c: 'var(--st-ifr)', l: 'IFR · Issued for Review' },
  { v: 'IFA', w: 80, c: 'var(--st-ifa)', l: 'IFA · Issued for Approval' },
  { v: 'IFC', w: 100, c: 'var(--st-ifc)', l: 'IFC · Issued for Construction' },
  { v: 'AFC', w: 100, c: 'var(--st-afc)', l: 'AFC · Approved for Construction' },
  { v: 'AS-BUILT', w: 100, c: 'var(--st-asb)', l: 'As-Built' },
  { v: 'ON HOLD', w: 0, c: 'var(--st-hold)', l: 'On hold' },
];
export const statusOf = (v) => DOC_STATUS.find((s) => s.v === v) || DOC_STATUS[0];

export const REVIEW_CODES = [
  { v: '', l: '—' },
  { v: 'A', l: 'A · Approved' },
  { v: 'B', l: 'B · Approved w/ comments' },
  { v: 'C', l: 'C · Revise & resubmit' },
  { v: 'D', l: 'D · Rejected' },
];
export const DISCIPLINES = ['General', 'Process', 'Civil', 'Structure', 'Piping', 'Mechanical', 'Electrical', 'Instrument', 'HSE', 'Architecture'];
export const DOC_TYPES = ['Drawing', 'Calculation', 'Specification', 'Datasheet', 'Report', 'MTO', 'Procedure', 'Plot Plan', '3D Model', 'Other'];
export const PHASES = ['FEED', 'DED', 'Procurement', 'Construction', 'Commissioning', 'As-Built'];

export function isOverdue(d, today = new Date().toISOString().slice(0, 10)) {
  const s = statusOf(d.status);
  return !!d.planDate && d.planDate < today && s.w < 100 && s.v !== 'ON HOLD';
}

export function docStats(docs) {
  const total = docs.length;
  const byStatus = Object.fromEntries(DOC_STATUS.map((s) => [s.v, 0]));
  let wsum = 0, done = 0, overdue = 0;
  for (const d of docs) {
    const s = statusOf(d.status);
    byStatus[s.v]++;
    wsum += s.w;
    if (s.w >= 100) done++;
    if (isOverdue(d)) overdue++;
  }
  return { total, byStatus, progress: total ? wsum / total : 0, done, overdue };
}

// Plot plan → 3D categories. kind drives the geometry generator.
// mat: only true solids count as material in MTO; envelopes (tanks, buildings, racks drawn as solid boxes) are 'other'.
export const CATS = {
  equipment: { label: 'Equipment / Skid', color: '#ff2fd0', h: 3, kind: 'solid', mat: 'other' },
  vessel: { label: 'Horizontal Vessel', color: '#c77dff', h: 0, kind: 'hvessel', mat: 'other' },
  tank: { label: 'Tank (vertical)', color: '#00f0ff', h: 10, kind: 'tank', mat: 'other' },
  building: { label: 'Building / Shelter', color: '#f7ef00', h: 4.5, kind: 'solid', mat: 'other' },
  piperack: { label: 'Pipe Rack', color: '#ff9f1c', h: 6, kind: 'rack', mat: 'other' },
  structure: { label: 'Steel Structure', color: '#ff6b3d', h: 4, kind: 'solid', mat: 'other' },
  foundation: { label: 'Foundation / Pad', color: '#9aa3b8', h: 0.5, kind: 'solid', mat: 'concrete' },
  paving: { label: 'Road / Paving', color: '#4a5070', h: 0.2, kind: 'solid', mat: 'concrete' },
  bund: { label: 'Bund / Dike Wall', color: '#5ad1ff', h: 1.2, kind: 'wall', t: 0.3, mat: 'concrete' },
  pit: { label: 'Pit / Basin', color: '#6b5bff', h: 2, kind: 'pit', mat: 'other' },
  pipe: { label: 'Pipe / Line', color: '#3dff9a', h: 0.3, kind: 'pipe', mat: 'other' },
  fence: { label: 'Fence', color: '#8a93b0', h: 2.4, kind: 'wall', t: 0.06, mat: 'other', ghost: true },
  existing: { label: 'Existing Facility', color: '#55607a', h: 3, kind: 'solid', mat: 'other' },
};
export const CAT_ORDER = ['paving', 'foundation', 'pit', 'bund', 'fence', 'existing', 'building', 'structure', 'equipment', 'vessel', 'tank', 'piperack', 'pipe'];

export const MATERIALS = {
  concrete: { label: 'Concrete', density: 2400, color: '#9aa3b8' },
  steel: { label: 'Steel', density: 7850, color: '#ff9f1c' },
  other: { label: 'Other / Unclassified', density: 0, color: '#6c7795' },
};

const STEEL_RX = /\b(pipe|pp|line|beam|col(umn)?|brace|bracing|steel|str|plate|pl|hss|chs|shs|rhs|wf|ipe|hea|heb|unp|angle|grating|stair|ladder|handrail|platform|tray|ct-|rack|skid|vessel|tank|support|shoe|flange|valve|elbow|tee|reducer)/i;
const CONC_RX = /\b(conc|concrete|fdn|foundation|footing|pile ?cap|pedestal|ped|slab|pad|paving|road|wall|bund|dike|pit|basin|sump|grout|rc|kerb|curb)/i;
// E3D / PDMS owner types (the chain after " of ") say more than the primitive name ("CYLINDER 1 of BRANCH /P-101").
// Equipment and piping are modelled as solid envelopes (a tank is a full cylinder, a pipe a solid rod at OD), so their
// volume is not a material quantity: they count as Other, like plot plan envelopes. Steel = structural members.
const OWNER_ENVELOPE = /\b(EQUIPMENT|SUBEQUIPMENT|EQUI|SUBE|NOZZ|NOZZLE|BRANCH|BRAN|PIPE|INSTRUMENT|VALVE)\b/i;
const OWNER_STEEL = /\b(GENSEC|SCTN|SECTION|STEEL|HANDRAIL|STAIR|SPIRALSTAIR|LADDER|GRATING|PLATFORM|GUARDRAIL|PIPERACK|PIPE-?RACK|SUPPORT|HANGER|CABLETRAY)/i;
const OWNER_CONC = /\b(FDN|FOUND|FOUNDATION|FOOTING|PEDESTAL|SLAB|PAVE|PAVING|ROAD|BUND|BUNDWALL|DIKE|PIT|SUMP|KERB|CURB|CONC|CONCRETE)/i;
export function guessMaterial(name = '', cat = '') {
  if (cat && CATS[cat]) return CATS[cat].mat;
  const i = name.indexOf(' of ');
  if (i > 0) {
    const chain = name.slice(i + 4);
    if (OWNER_CONC.test(chain)) return 'concrete';
    if (OWNER_STEEL.test(chain)) return 'steel';
    if (OWNER_ENVELOPE.test(chain)) return 'other';
    if (/^(GENSEC|SCTN|BEAM|COLUMN|BRACE|JOIST)\b/i.test(name)) return 'steel';
    return 'other';
  }
  if (CONC_RX.test(name)) return 'concrete';
  if (STEEL_RX.test(name)) return 'steel';
  return 'other';
}

export const UNIT_SCALE = { m: 1, mm: 0.001, cm: 0.01, ft: 0.3048, in: 0.0254 };
