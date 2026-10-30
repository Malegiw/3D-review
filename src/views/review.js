// 3D review workspace: federated plot plan + contractor models, Navisworks-style tools.
import * as THREE from 'three';
import { h, icon, toast, modal, formDialog, confirmDialog, pickFiles, download, fmt, uid } from '../core/ui.js';
import { db } from '../core/db.js';
import { MATERIALS, UNIT_SCALE, CATS, guessMaterial } from '../core/domain.js';
import { buildXlsx } from '../core/xlsx.js';
import { state } from '../core/app.js';
import { Viewer } from '../engine/viewer.js';
import { buildPlotModel } from '../engine/plotbuild.js';
import { getGround } from '../engine/ground.js';
import { loadModelFiles, guessUnits, guessZUp, ACCEPT, NATIVE_FORMATS, ext } from '../engine/loaders.js';
import { runClash } from '../engine/clash.js';
import { runMTO } from '../engine/mto.js';
import { playBuildUp, playOrbit, playTour } from '../engine/motion.js';
import { NATIVE_EXT, getConverter, startConversion, projectJobs, retryJob, removeJob } from '../core/jobs.js';
import { openConverterSetup } from './converter-setup.js';

const STATUS = ['New', 'Active', 'Reviewed', 'Approved', 'Resolved'];
const STATUS_C = { New: 'var(--red)', Active: 'var(--orange)', Reviewed: 'var(--cyan)', Approved: 'var(--violet)', Resolved: 'var(--green)' };

export async function renderReview(main, project) {
  const viewer = state.viewer ||= new Viewer();
  const root = h('div', { class: 'v3' });
  main.append(root);
  viewer.mount(root);
  let panel = null;
  let motion = null;
  let lastClash = null;
  const offs = [];

  // ---------- layer sync ----------
  async function syncLayers() {
    if (state.viewerProject !== project.id) { viewer.clear(); state.viewerProject = project.id; viewer.layersVer = {}; }
    viewer.layersVer ||= {};
    const plans = (await db.byProject('plotplans', project.id)).filter((p) => p.objects?.length);
    const models = await db.byProject('models', project.id);
    const want = new Map();
    plans.forEach((p) => want.set(`pp_${p.id}`, { rec: p, kind: 'plotplan' }));
    models.forEach((m) => want.set(m.id, { rec: m, kind: 'import' }));
    for (const id of [...viewer.layers.keys()]) if (!want.has(id)) { viewer.removeLayer(id); delete viewer.layersVer[id]; }
    let i = 0;
    const todo = [...want.entries()].filter(([id, w]) => viewer.layersVer[id] !== w.rec.updated || !viewer.layers.has(id));
    for (const [id, w] of todo) {
      i++;
      viewer.setHud('LOADING MODELS', `${i} / ${todo.length} · ${w.rec.name}`);
      try {
        if (w.kind === 'plotplan') {
          let ground = null;
          try { ground = await getGround(w.rec); } catch (e) { console.warn('ground', e); }
          viewer.addLayer({ id, name: w.rec.name, kind: 'plotplan', object: buildPlotModel(w.rec, { groundCanvas: ground }) });
        } else {
          const { object } = await loadModelFiles(w.rec.files);
          viewer.addLayer({ id, name: w.rec.name, kind: 'import', object, units: UNIT_SCALE[w.rec.units] || 1, zUp: !!w.rec.zUp, transform: w.rec.transform || {} });
          viewer.setLayerVisible(id, w.rec.visible !== false);
        }
        viewer.layersVer[id] = w.rec.updated;
      } catch (e) {
        console.error(e);
        toast(`${w.rec.name}: ${e.message}`, 'err', 'LOAD FAILED');
      }
    }
    viewer.setHud('');
    return todo.length;
  }

  const corner = () => {
    const n = viewer.meshes({ visibleOnly: false }).length;
    viewer.setCorner([['LAYERS', String(viewer.layers.size)], ['OBJECTS', fmt.int(n)], ['GRID', `${viewer.gridStep ?? '—'} m`], ['MODE', viewer.mode.toUpperCase()]]);
  };

  // ---------- tool rail & drawer ----------
  const rail = h('div', { class: 'tool-rail', role: 'toolbar', 'aria-label': '3D tools' });
  const drawer = h('section', { class: 'panel drawer', hidden: true });
  root.append(rail, drawer);
  const TOOLS = [
    ['layers', 'layers', 'Models'], ['info', 'info', 'Properties'], ['measure', 'ruler', 'Measure'], ['section', 'section', 'Section box'],
    ['xray', 'xray', 'X-ray'], '-', ['views', 'camera', 'Viewpoints'], ['clash', 'zap', 'Clash detective'], ['mto', 'calc', 'MTO quantities'], ['motion', 'film', 'Motion & video'], '-', ['fit', 'focus', 'Fit all'], ['top', 'map', 'Plan view'],
  ];
  function renderRail() {
    rail.innerHTML = '';
    for (const t of TOOLS) {
      if (t === '-') { rail.append(h('div', { class: 'tool-sep' })); continue; }
      const [id, ic, tip] = t;
      const on = id === panel || (id === 'xray' && viewer.xray && !viewer.overrides.size) || (id === 'measure' && viewer.mode === 'measure');
      rail.append(h('button', { class: `tool ${id === 'clash' || id === 'motion' ? 'mag' : ''} ${on ? 'on' : ''}`, 'data-tip': tip, 'aria-label': tip, 'aria-pressed': on, onclick: () => toolClick(id) }, icon(ic)));
    }
  }
  function toolClick(id) {
    if (id === 'fit') return viewer.fit(null, { dir: new THREE.Vector3(1, 0.8, 1) });
    if (id === 'top') return viewer.view('top');
    if (id === 'xray') { viewer.overrides.clear(); viewer.setXray(!viewer.xray); return renderRail(); }
    if (id === 'measure') {
      const on = viewer.mode !== 'measure';
      viewer.setMode(on ? 'measure' : 'select');
      if (on) openPanel('measure'); else if (panel === 'measure') openPanel(null);
      return renderRail();
    }
    openPanel(panel === id ? null : id);
  }
  function openPanel(id) {
    if (panel === 'clash' && id !== 'clash') viewer.clearHighlights();
    if (panel === 'measure' && id !== 'measure' && viewer.mode === 'measure') viewer.setMode('select');
    panel = id;
    renderRail();
    drawer.hidden = !id;
    if (id) renderPanel();
    corner();
  }
  function shell(title, eyebrow, ...body) {
    drawer.innerHTML = '';
    drawer.append(
      h('div', { class: 'drawer-head' }, h('div', {}, h('div', { class: 'eyebrow' }, eyebrow), h('h3', { style: { marginTop: '6px' } }, title)),
        h('button', { class: 'btn sm icon ghost', 'aria-label': 'Close panel', onclick: () => openPanel(null) }, icon('x'))),
      h('div', { class: 'drawer-body' }, body));
  }
  function renderPanel() {
    ({ layers: pLayers, info: pInfo, measure: pMeasure, section: pSection, views: pViews, clash: pClash, mto: pMTO, motion: pMotion }[panel] || (() => {}))();
  }

  // ---------- Models / layers ----------
  async function importFiles() {
    const files = await pickFiles({ accept: ACCEPT, multiple: true });
    if (!files.length) return;
    const natives = files.filter((f) => NATIVE_EXT.includes(ext(f.name)));
    if (natives.length && natives.length === files.length) return convertFiles(natives);
    const recFiles = files.map((f) => ({ name: f.name, blob: f }));
    const nat = natives[0];
    let object, format;
    try {
      viewer.setHud('PARSING MODEL', files.map((f) => f.name).join(', '));
      ({ object, format } = await loadModelFiles(recFiles));
    } catch (e) {
      viewer.setHud('');
      if (e.native || nat) return convertFiles(natives.length ? natives : null);
      return toast(e.message, 'err');
    }
    viewer.setHud('');
    const units = guessUnits(object), zUp = guessZUp(format);
    const v = await formDialog({ title: 'Model import', eyebrow: files[0].name, submitLabel: 'Add to project', fields: [
      { id: 'name', label: 'Layer name', value: files[0].name.replace(/\.[^.]+$/, ''), required: true, span: true },
      { id: 'units', label: 'Model units', type: 'select', options: Object.keys(UNIT_SCALE), value: units },
      { id: 'zUp', label: 'Up axis', type: 'select', options: [{ v: '0', l: 'Y-up (glTF/FBX/DAE)' }, { v: '1', l: 'Z-up (CAD / STL)' }], value: zUp ? '1' : '0' },
    ] });
    if (!v) return;
    const rec = { id: uid('m'), projectId: project.id, name: v.name, files: recFiles, units: v.units, zUp: v.zUp === '1', transform: { dx: 0, dy: 0, dz: 0, rotY: 0 }, visible: true, created: Date.now() };
    await db.put('models', rec);
    viewer.addLayer({ id: rec.id, name: rec.name, kind: 'import', object, units: UNIT_SCALE[rec.units], zUp: rec.zUp });
    viewer.layersVer[rec.id] = rec.updated;
    viewer.fit();
    toast(`${rec.name} added (${fmt.int(viewer.layers.get(rec.id).meshes.length)} objects).`, 'ok');
    renderPanel(); corner();
  }
  async function convertFiles(list) {
    const cfg = await getConverter();
    if (!cfg?.repo || !cfg?.token) return converterHelp(list?.[0]?.name || 'model.nwd');
    if (!list) list = await pickFiles({ accept: NATIVE_EXT.map((x) => `.${x}`).join(','), multiple: true });
    if (!list?.length) return;
    openPanel('layers');
    for (const f of list) {
      toast(`Uploading ${f.name} (${fmt.bytes(f.size)}) to the converter…`, 'info', 'CONVERTER');
      try {
        const job = await startConversion(project.id, f);
        if (job.status === 'failed') toast(job.message, 'err', 'UPLOAD FAILED');
        else toast(`${f.name} is converting on GitHub. It appears here automatically when ready — you can keep working.`, 'ok', 'CONVERTING');
      } catch (e) { toast(e.message, 'err'); }
    }
  }
  function converterHelp(name) {
    const e = ext(name);
    modal({
      title: `${NATIVE_FORMATS[e] || e.toUpperCase()} needs the converter`, eyebrow: 'NATIVE FORMAT', wide: true,
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('p', { class: 'dim2', style: { margin: 0 } }, `.${e} is a closed Autodesk/Trimble format, so it is translated by Autodesk first. Set up the converter once (about 10 minutes), then NWD, NWC, DWFx, DWF, SKP, RVT and IFC files convert from this button and land in the 3D review automatically.`),
        h('div', { class: 'note' }, h('b', {}, 'No setup? '), 'Navisworks Manage/Simulate: Output → Export Scene → FBX, then import the FBX here. SketchUp: File → Export → 3D Model → glTF/DAE/FBX.'),
        h('p', { class: 'mono dim', style: { margin: 0, fontSize: '12px' } }, 'Direct formats: GLB · glTF(+bin) · FBX · OBJ(+mtl) · DAE · STL · PLY')),
      actions: [{ label: 'Later' }, { label: 'Set up converter', kind: 'primary', icon: 'gear', onClick: () => { setTimeout(openConverterSetup, 50); } }],
    });
  }
  async function fromRepo() {
    let list;
    try { const r = await fetch('./models/index.json', { cache: 'no-store' }); if (!r.ok) throw new Error(); list = (await r.json()).models || []; } catch { return toast('No converted models in the repository yet (models/index.json not found).', 'warn'); }
    if (!list.length) return toast('Repository model list is empty.', 'warn');
    const v = await formDialog({ title: 'Model from repository', eyebrow: 'GITHUB · CONVERTED', submitLabel: 'Load', fields: [{ id: 'f', label: 'Model', type: 'select', options: list.map((m) => ({ v: m.file, l: `${m.name} · ${m.source || ''} · ${fmt.bytes(m.size)}` })), span: true }] });
    if (!v) return;
    const meta = list.find((m) => m.file === v.f);
    viewer.setHud('DOWNLOADING', meta.name);
    try {
      const blob = await (await fetch(`./models/${meta.file}`)).blob();
      const rec = { id: uid('m'), projectId: project.id, name: meta.name, files: [{ name: meta.file.split('/').pop(), blob }], units: meta.units || 'm', zUp: !!meta.zUp, transform: { dx: 0, dy: 0, dz: 0, rotY: 0 }, visible: true, created: Date.now() };
      await db.put('models', rec);
      await syncLayers();
      viewer.fit();
      renderPanel(); corner();
    } catch (e) { toast(e.message, 'err'); } finally { viewer.setHud(''); }
  }
  async function layerSettings(L) {
    const rec = await db.get('models', L.id);
    const v = await formDialog({ title: 'Layer settings', eyebrow: L.name, fields: [
      { id: 'name', label: 'Name', value: rec.name, span: true },
      { id: 'units', label: 'Units', type: 'select', options: Object.keys(UNIT_SCALE), value: rec.units },
      { id: 'zUp', label: 'Up axis', type: 'select', options: [{ v: '0', l: 'Y-up' }, { v: '1', l: 'Z-up' }], value: rec.zUp ? '1' : '0' },
      { id: 'dx', label: 'Offset East X (m)', type: 'number', value: rec.transform?.dx || 0 },
      { id: 'dz', label: 'Offset North (m)', type: 'number', value: -(rec.transform?.dz || 0) },
      { id: 'dy', label: 'Offset Elevation (m)', type: 'number', value: rec.transform?.dy || 0 },
      { id: 'rotY', label: 'Rotation about vertical (°)', type: 'number', value: rec.transform?.rotY || 0 },
    ] });
    if (!v) return;
    Object.assign(rec, { name: v.name, units: v.units, zUp: v.zUp === '1', transform: { dx: v.dx || 0, dy: v.dy || 0, dz: -(v.dz || 0), rotY: v.rotY || 0 } });
    await db.put('models', rec);
    L.name = rec.name;
    viewer.applyLayerTransform(L.id, { units: UNIT_SCALE[rec.units], zUp: rec.zUp, transform: rec.transform });
    viewer.layersVer[L.id] = rec.updated;
    renderPanel();
  }
  async function centerLayer(L) {
    const rec = await db.get('models', L.id);
    const c = viewer.boundsOf(L.meshes).getCenter(new THREE.Vector3());
    const t = rec.transform || { dx: 0, dy: 0, dz: 0, rotY: 0 };
    t.dx = (t.dx || 0) - c.x; t.dz = (t.dz || 0) - c.z;
    rec.transform = t;
    await db.put('models', rec);
    viewer.applyLayerTransform(L.id, { transform: t });
    viewer.layersVer[L.id] = rec.updated;
    viewer.fit();
    toast('Layer moved so its centre sits at the plot plan origin. Fine-tune with the offsets.', 'ok');
  }
  const JOB_C = { uploading: 'var(--cyan)', queued: 'var(--yellow)', running: 'var(--cyan)', downloading: 'var(--cyan)', done: 'var(--green)', failed: 'var(--red)' };
  const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h`; };
  async function pLayers() {
    const jobs = await projectJobs(project.id);
    const list = [...viewer.layers.values()];
    const tree = h('div', { class: 'tree' });
    const drawTree = (q = '') => {
      tree.innerHTML = '';
      const ql = q.toLowerCase();
      const all = viewer.meshes({ visibleOnly: false }).filter((m) => !ql || m.name.toLowerCase().includes(ql) || (m.userData.tag || '').toLowerCase().includes(ql));
      all.slice(0, 300).forEach((m) => tree.append(h('button', { class: m === viewer.selected ? 'on' : '', onclick: () => { viewer.select(m); viewer.fit(m); } }, m.name)));
      if (all.length > 300) tree.append(h('div', { class: 'mono dim', style: { padding: '8px 10px', fontSize: '11px' } }, `+${all.length - 300} more — refine the search`));
      if (!all.length) tree.append(h('div', { class: 'mono dim', style: { padding: '8px 10px', fontSize: '11px' } }, 'No objects.'));
    };
    shell('Models', 'FEDERATED MODEL',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm primary', onclick: importFiles }, icon('upload'), 'Import model'),
        h('button', { class: 'btn sm mag', onclick: () => convertFiles(null) }, icon('zap'), 'Convert NWD · DWFx · SKP'),
        h('button', { class: 'btn sm icon ghost', 'aria-label': 'Converter settings', title: 'Converter settings', onclick: openConverterSetup }, icon('gear')),
        h('button', { class: 'btn sm ghost', onclick: fromRepo }, icon('github'), 'From repository')),
      jobs.length ? h('div', { class: 'clist' }, h('div', { class: 'lbl' }, 'Conversions'), jobs.slice(0, 8).map((j) => h('div', { class: 'citem', style: { cursor: 'default', gridTemplateColumns: 'auto 1fr', borderColor: j.status === 'failed' ? 'var(--red)' : null } },
        h('span', { class: `chip ${['done', 'failed'].includes(j.status) ? '' : 'dot'}`, style: { '--c': JOB_C[j.status] } }, j.status === 'running' || j.status === 'queued' ? 'converting' : j.status),
        h('div', { class: 'nm' }, j.file,
          h('small', { style: { whiteSpace: 'normal' } }, j.status === 'failed' ? j.message : j.status === 'done' ? `Added · ${fmt.bytes(j.sizeOut || 0)} GLB · ${ago(j.created)} ago` : `${j.step || '…'} · ${ago(j.created)}`),
          h('div', { class: 'btn-row', style: { marginTop: '6px', gap: '6px' } },
            j.runUrl ? h('a', { class: 'btn sm ghost', href: j.runUrl, target: '_blank', rel: 'noopener' }, 'GitHub run') : null,
            j.status === 'failed' && j.sha ? h('button', { class: 'btn sm', onclick: () => retryJob(j) }, 'Retry') : null,
            ['done', 'failed'].includes(j.status) ? h('button', { class: 'btn sm ghost', onclick: () => removeJob(j) }, 'Clear') : null))))) : null,
      list.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, list.map((L) => h('div', { class: 'layer' },
        h('button', { class: 'btn sm icon ghost', 'aria-label': L.visible ? 'Hide layer' : 'Show layer', onclick: async () => {
          viewer.setLayerVisible(L.id, !L.visible);
          if (L.kind === 'import') { const r = await db.get('models', L.id); if (r) { r.visible = L.visible; await db.put('models', r); viewer.layersVer[L.id] = r.updated; } }
          pLayers();
        } }, icon(L.visible ? 'eye' : 'eyeoff')),
        h('div', { class: 'nm' }, h('b', {}, L.name), h('span', {}, `${L.kind === 'plotplan' ? 'PLOT PLAN' : 'MODEL'} · ${fmt.int(L.meshes.length)} OBJ${L.kind === 'import' ? ` · ${Object.keys(UNIT_SCALE).find((k) => UNIT_SCALE[k] === L.units) || ''}` : ''}`)),
        L.kind === 'import' ? h('div', { class: 'btn-row', style: { flexWrap: 'nowrap', gap: '4px' } },
          h('button', { class: 'btn sm icon ghost', 'aria-label': 'Layer settings', onclick: () => layerSettings(L) }, icon('gear')),
          h('button', { class: 'btn sm icon ghost', 'aria-label': 'Centre on origin', title: 'Centre on plot plan origin', onclick: () => centerLayer(L) }, icon('target')),
          h('button', { class: 'btn sm icon danger', 'aria-label': 'Remove model', onclick: async () => {
            if (!await confirmDialog(`Remove ${L.name} from this project?`, { danger: true, okLabel: 'Remove' })) return;
            await db.del('models', L.id); viewer.removeLayer(L.id); pLayers(); corner();
          } }, icon('trash'))) : h('span', { class: 'chip', style: { '--c': 'var(--cyan)' } }, 'PDF')))) : h('p', { class: 'dim2', style: { margin: 0 } }, 'No layers yet. Generate a plot plan or import a contractor model.'),
      h('div', { class: 'field' }, h('label', { for: 'tq' }, 'Find object'), h('input', { class: 'inp', id: 'tq', placeholder: 'Tag or name…', oninput: (e) => drawTree(e.target.value) })),
      tree);
    drawTree();
  }

  // ---------- Properties ----------
  function pInfo() {
    const m = viewer.selected;
    if (!m) return shell('Properties', 'SELECTION', h('p', { class: 'dim2', style: { margin: 0 } }, 'Tap an object in the 3D view. Double-tap zooms to it.'));
    const i = viewer.info(m);
    const mtoMat = project.mtoMat?.[m.userData.key] || m.userData.material || guessMaterial(m.name, m.userData.cat);
    shell(i.name, 'PROPERTIES',
      h('dl', { class: 'kv' },
        h('dt', {}, 'Layer'), h('dd', {}, i.layer),
        i.cat ? [h('dt', {}, 'Category'), h('dd', {}, CATS[i.cat]?.label || i.cat)] : null,
        h('dt', {}, 'Size L×W×H'), h('dd', {}, `${fmt.num(i.size.x)} × ${fmt.num(i.size.z)} × ${fmt.num(i.size.y)} m`),
        h('dt', {}, 'Centre E / N'), h('dd', {}, `${fmt.num(i.center.x)} / ${fmt.num(-i.center.z)}`),
        h('dt', {}, 'Elev. bottom / top'), h('dd', {}, `${fmt.num(i.center.y - i.size.y / 2)} / ${fmt.num(i.center.y + i.size.y / 2)}`),
        h('dt', {}, 'Volume'), h('dd', {}, `${fmt.num(i.volume, 3)} m³`),
        h('dt', {}, 'Surface'), h('dd', {}, `${fmt.num(i.area, 2)} m²`),
        h('dt', {}, 'Triangles'), h('dd', {}, fmt.int(i.tris))),
      h('div', { class: 'field' }, h('label', { for: 'mm' }, 'MTO material'), h('select', { class: 'inp', id: 'mm', onchange: async (e) => {
        project.mtoMat = { ...(project.mtoMat || {}), [m.userData.key]: e.target.value };
        await db.put('projects', project);
      } }, Object.entries(MATERIALS).map(([k, v]) => h('option', { value: k, selected: k === mtoMat }, v.label)))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', onclick: () => viewer.fit(m) }, icon('focus'), 'Zoom'),
        h('button', { class: 'btn sm ghost', onclick: () => viewer.isolate([m]) }, 'Isolate'),
        h('button', { class: 'btn sm ghost', onclick: () => { m.visible = false; viewer.select(null); viewer.requestRender(); } }, 'Hide'),
        h('button', { class: 'btn sm ghost', onclick: () => viewer.showAll() }, 'Show all')));
  }
  offs.push(viewer.on('select', () => { if (panel === 'info' || panel === 'layers') renderPanel(); else if (viewer.selected && window.innerWidth > 760 && !panel) openPanel('info'); }));

  // ---------- Measure ----------
  function pMeasure() {
    shell('Measure', 'DISTANCE',
      h('div', { class: 'note' }, 'Tap two points on the model. Shows true distance, horizontal (H) and vertical (V) components in metres.'),
      viewer.measures.length ? h('div', { class: 'clist' }, viewer.measures.map((m, i) => h('div', { class: 'citem', style: { cursor: 'default' } }, h('span', { class: 'id', style: { color: 'var(--yellow)' } }, `M${i + 1}`), h('div', { class: 'nm mono' }, `${fmt.num(m.d, 3)} m`, h('small', {}, `H ${fmt.num(m.dh, 3)} · V ${fmt.num(m.dv, 3)}`)), h('span', {})))) : null,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn sm ghost', onclick: () => { viewer.clearMeasures(); pMeasure(); } }, icon('trash'), 'Clear'), h('button', { class: 'btn sm', onclick: () => toolClick('measure') }, 'Done')));
  }
  offs.push(viewer.on('measure', () => panel === 'measure' && pMeasure()));

  // ---------- Section ----------
  function pSection() {
    const full = viewer.boundsOf();
    if (full.isEmpty()) return shell('Section box', 'CLIPPING', h('p', { class: 'dim2' }, 'Load a model first.'));
    const pad = full.getSize(new THREE.Vector3()).multiplyScalar(0.02);
    full.expandByVector(pad);
    const cur = viewer.section.on ? viewer.section.box.clone() : full.clone();
    const axes = [['x', 'East–West'], ['y', 'Elevation'], ['z', 'North–South']];
    const apply = () => viewer.setSection(true, cur);
    const sliders = axes.map(([a, l]) => {
      const span = full.max[a] - full.min[a];
      const mk = (which) => h('input', { type: 'range', min: 0, max: 1000, value: Math.round(((cur[which][a] - full.min[a]) / span) * 1000), 'aria-label': `${l} ${which}`, oninput: (e) => {
        cur[which][a] = full.min[a] + (e.target.value / 1000) * span;
        if (cur.min[a] > cur.max[a] - span * 0.002) { if (which === 'min') cur.min[a] = cur.max[a] - span * 0.002; else cur.max[a] = cur.min[a] + span * 0.002; }
        apply();
      } });
      return h('div', { class: 'field' }, h('label', {}, l), mk('min'), mk('max'));
    });
    shell('Section box', 'CLIPPING',
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: viewer.section.on, onchange: (e) => { viewer.setSection(e.target.checked, cur); } }), 'Enable section box'),
      sliders,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', disabled: !viewer.selected, onclick: () => { const b = viewer.boundsOf(viewer.selected).expandByScalar(1.5); viewer.setSection(true, b); pSection(); viewer.fit(viewer.selected); } }, 'Box around selection'),
        h('button', { class: 'btn sm ghost', onclick: () => { viewer.setSection(false); pSection(); } }, 'Reset')));
  }

  // ---------- Viewpoints ----------
  async function pViews() {
    const vps = (await db.byProject('viewpoints', project.id)).sort((a, b) => (a.created || 0) - (b.created || 0));
    shell('Viewpoints', 'SAVED VIEWS',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm primary', onclick: async () => {
          const v = await formDialog({ title: 'Save viewpoint', eyebrow: 'VIEWPOINT', fields: [{ id: 'name', label: 'Name', value: `View ${vps.length + 1}`, required: true, span: true }, { id: 'comment', label: 'Review comment', type: 'textarea', span: true }] });
          if (!v) return;
          await db.put('viewpoints', { id: uid('v'), projectId: project.id, name: v.name, comment: v.comment, camera: viewer.getCamera(), thumb: viewer.snapshot(320), section: viewer.section.on ? [viewer.section.box.min.toArray(), viewer.section.box.max.toArray()] : null, created: Date.now() });
          pViews();
        } }, icon('camera'), 'Save current view'),
        vps.length > 1 ? h('button', { class: 'btn sm mag', onclick: () => runMotion('tour', false) }, icon('play'), 'Fly-through') : null),
      vps.length ? h('div', { class: 'vp-grid' }, vps.map((v) => h('div', { class: 'vp', role: 'button', tabindex: 0, onclick: () => { viewer.setCamera(v.camera); viewer.setSection(!!v.section, v.section ? new THREE.Box3(new THREE.Vector3(...v.section[0]), new THREE.Vector3(...v.section[1])) : undefined); if (v.comment) toast(v.comment, 'info', v.name.toUpperCase()); } },
        h('img', { src: v.thumb, alt: v.name }), h('b', {}, v.name),
        h('button', { class: 'btn sm ghost', style: { minHeight: '24px' }, onclick: async (e) => { e.stopPropagation(); await db.del('viewpoints', v.id); pViews(); } }, 'Delete')))) : h('p', { class: 'dim2', style: { margin: 0 } }, 'Save views of areas to discuss with the contractor. Two or more views make a fly-through.'));
  }

  // ---------- Clash ----------
  async function pClash() {
    const tests = (await db.byProject('clashtests', project.id)).sort((a, b) => b.created - a.created);
    const layers = [...viewer.layers.values()];
    const opts = [{ v: 'all', l: 'All visible layers' }, ...layers.map((L) => ({ v: L.id, l: L.name }))];
    const cfg = { a: layers.find((L) => L.kind === 'plotplan')?.id || 'all', b: layers.find((L) => L.kind === 'import')?.id || 'all', mode: 'hard', tol: 50, same: true };
    const prog = h('div', { class: 'progress', hidden: true }, h('i'));
    const sel = (id, val, key) => h('select', { class: 'inp', id, onchange: (e) => { cfg[key] = e.target.value; } }, opts.map((o) => h('option', { value: o.v, selected: o.v === val }, o.l)));
    const results = h('div', { class: 'clist' });
    let current = lastClash && tests.find((t) => t.id === lastClash) || tests[0] || null;

    const drawResults = () => {
      results.innerHTML = '';
      if (!current) return;
      const open = current.results.filter((r) => r.status !== 'Resolved' && r.status !== 'Approved').length;
      results.append(h('div', { class: 'panel-title', style: { margin: '4px 0 2px' } }, h('div', { class: 'lbl' }, `${current.name} · ${current.results.length} clashes · ${open} open`),
        h('button', { class: 'btn sm ghost', onclick: () => exportClash(current) }, icon('download'), 'XLSX')));
      if (!current.results.length) results.append(h('p', { class: 'dim2', style: { margin: 0 } }, `No clashes found (${fmt.int(current.pairsTested)} pairs tested).`));
      current.results.slice(0, 400).forEach((r) => {
        const row = h('div', { class: `citem ${r.n === current.focus ? 'on' : ''}`, onclick: () => focusClash(current, r) },
          h('span', { class: 'id' }, `#${fmt.pad(r.n)}`),
          h('div', { class: 'nm' }, `${r.aName} ✕ ${r.bName}`, h('small', {}, `${r.type.toUpperCase()}${r.type === 'Clearance' ? ` · ${fmt.num(r.distance * 1000, 0)} mm` : ''} · E ${fmt.num(r.point[0], 1)} N ${fmt.num(-r.point[2], 1)} EL ${fmt.num(r.point[1], 2)}`)),
          h('select', { class: 'inp', style: { width: '108px', minHeight: '28px', fontSize: '12px', color: STATUS_C[r.status], borderLeftColor: STATUS_C[r.status] }, 'aria-label': 'Clash status', onclick: (e) => e.stopPropagation(), onchange: async (e) => { r.status = e.target.value; await db.put('clashtests', current); drawResults(); } },
            STATUS.map((s) => h('option', { value: s, selected: s === r.status }, s))));
        results.append(row);
      });
    };
    shell('Clash detective', 'INTERFERENCE CHECK',
      h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr' } },
        h('div', { class: 'field' }, h('label', { for: 'ca' }, 'Selection A'), sel('ca', cfg.a, 'a')),
        h('div', { class: 'field' }, h('label', { for: 'cb' }, 'Selection B'), sel('cb', cfg.b, 'b')),
        h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr 1fr' } },
          h('div', { class: 'field' }, h('label', { for: 'cm' }, 'Type'), h('select', { class: 'inp', id: 'cm', onchange: (e) => { cfg.mode = e.target.value; } }, h('option', { value: 'hard' }, 'Hard'), h('option', { value: 'clearance' }, 'Clearance'))),
          h('div', { class: 'field' }, h('label', { for: 'ct' }, 'Clearance (mm)'), h('input', { class: 'inp mono', id: 'ct', type: 'number', value: cfg.tol, oninput: (e) => { cfg.tol = Number(e.target.value); } }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cfg.same, onchange: (e) => { cfg.same = e.target.checked; } }), 'Ignore clashes inside the same layer')),
      h('button', { class: 'btn primary', onclick: async (e) => {
        const btn = e.currentTarget;
        const pick = (k) => (k === 'all' ? viewer.meshes() : viewer.meshes({ layerIds: [k] }));
        const A = pick(cfg.a), B = cfg.a === cfg.b ? A : pick(cfg.b);
        if (!A.length || !B.length) return toast('Both selections need visible objects.', 'warn');
        btn.disabled = true; prog.hidden = false;
        const t0 = performance.now();
        try {
          const res = await runClash({ setA: A, setB: B, mode: cfg.mode, tolerance: cfg.tol / 1000, ignoreSameLayer: cfg.same, onProgress: (p) => { prog.firstChild.style.width = `${p * 100}%`; } });
          const nm = (k) => (k === 'all' ? 'All' : viewer.layers.get(k)?.name || k);
          const test = { id: uid('c'), projectId: project.id, name: `${cfg.mode === 'hard' ? 'Hard' : `Clearance ${cfg.tol} mm`} · ${nm(cfg.a)} vs ${nm(cfg.b)}`, ...cfg, created: Date.now(), results: res.results, pairsTested: res.pairsTested, seconds: (performance.now() - t0) / 1000 };
          await db.put('clashtests', test);
          lastClash = test.id; current = test;
          toast(`${res.results.length} clashes · ${fmt.int(res.pairsTested)} pairs · ${test.seconds.toFixed(1)} s`, res.results.length ? 'warn' : 'ok', 'CLASH TEST');
          pClash();
        } catch (err) { console.error(err); toast(err.message, 'err'); } finally { btn.disabled = false; prog.hidden = true; }
      } }, icon('zap'), 'Run clash test'),
      prog,
      tests.length > 1 ? h('div', { class: 'field' }, h('label', { for: 'cs' }, 'Saved tests'), h('select', { class: 'inp', id: 'cs', onchange: (e) => { current = tests.find((t) => t.id === e.target.value); lastClash = current.id; viewer.clearHighlights(); drawResults(); } },
        tests.map((t) => h('option', { value: t.id, selected: t === current }, `${fmt.date(t.created)} · ${t.name} (${t.results.length})`)))) : null,
      results,
      current ? h('button', { class: 'btn sm danger', onclick: async () => { await db.del('clashtests', current.id); lastClash = null; viewer.clearHighlights(); pClash(); } }, icon('trash'), 'Delete this test') : null);
    drawResults();
  }
  function focusClash(test, r) {
    const a = viewer.findByKey(r.aKey), b = viewer.findByKey(r.bKey);
    if (!a || !b) return toast('Objects of this clash are no longer loaded (model changed?).', 'warn');
    test.focus = r.n;
    viewer.select(null);
    viewer.highlightPair(a, b);
    viewer.clearLabels('clash');
    viewer.addLabel(new THREE.Vector3(...r.point), `#${fmt.pad(r.n)} ${r.type.toUpperCase()}`, 'clash');
    viewer.fit([a, b]);
    drawer.querySelectorAll('.citem').forEach((el) => el.classList.toggle('on', el.querySelector('.id')?.textContent === `#${fmt.pad(r.n)}`));
  }
  function exportClash(t) {
    const blob = buildXlsx([{
      name: 'Clash Report', title: `${project.code || ''} ${project.name} — ${t.name} (${fmt.date(t.created)})`,
      columns: [
        { header: 'Clash #', key: 'n', type: 'n', dp: 0, width: 9 }, { header: 'Type', key: 'type', width: 12 },
        { header: 'Object A', key: 'aName', width: 30 }, { header: 'Layer A', key: (r) => viewer.layers.get(r.aLayer)?.name || r.aLayer, width: 24 },
        { header: 'Object B', key: 'bName', width: 30 }, { header: 'Layer B', key: (r) => viewer.layers.get(r.bLayer)?.name || r.bLayer, width: 24 },
        { header: 'Distance (mm)', key: (r) => (r.type === 'Clearance' ? r.distance * 1000 : 0), type: 'n', dp: 0, width: 13 },
        { header: 'East (m)', key: (r) => r.point[0], type: 'n', width: 11 }, { header: 'North (m)', key: (r) => -r.point[2], type: 'n', width: 11 }, { header: 'Elev (m)', key: (r) => r.point[1], type: 'n', width: 10 },
        { header: 'Status', key: 'status', width: 11 }, { header: 'Note', key: 'note', width: 30 },
      ],
      rows: t.results,
    }]);
    download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_Clash_${fmt.today()}.xlsx`);
  }

  // ---------- MTO ----------
  let lastMTO = null;
  function pMTO() {
    const dens = { concrete: 2400, steel: 7850, ...(project.densities || {}) };
    const layers = [...viewer.layers.values()];
    let scope = 'all';
    const prog = h('div', { class: 'progress', hidden: true }, h('i'));
    const out = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    const draw = () => {
      out.innerHTML = '';
      if (!lastMTO) return;
      const { rows, summary } = lastMTO;
      const SHORT = { concrete: 'CONC', steel: 'STL', other: 'OTH' };
      out.append(...[h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Material'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Vol m³'), h('th', { class: 'num' }, 'Weight t'))),
        h('tbody', {}, summary.map((s) => h('tr', {}, h('td', {}, h('span', { class: 'chip dot', style: { '--c': MATERIALS[s.material]?.color } }, SHORT[s.material] || s.material)),
          h('td', { class: 'num' }, s.count), h('td', { class: 'num' }, fmt.num(s.volume, 3)), h('td', { class: 'num' }, s.weight ? fmt.num(s.weight / 1000, 2) : '—')))))),
      summary.some((s) => s.open) ? h('div', { class: 'note' }, h('b', {}, `${summary.reduce((n, s) => n + s.open, 0)} open meshes. `), 'Their volume is approximate (surfaces not closed). Area values are still exact.') : null,
      h('div', { class: 'lbl' }, `Largest items · ${rows.length} total`),
      h('div', { class: 'clist' }, rows.slice().sort((a, b) => b.volume - a.volume).slice(0, 60).map((r) => h('div', { class: 'citem', onclick: () => { const m = viewer.findByKey(r.key); if (m) { viewer.select(m); viewer.fit(m); } } },
        h('span', { class: 'chip', style: { '--c': MATERIALS[r.material]?.color } }, SHORT[r.material] || r.material),
        h('div', { class: 'nm' }, r.name, h('small', {}, `${fmt.num(r.L)}×${fmt.num(r.W)}×${fmt.num(r.H)} m${r.closed ? '' : ' · OPEN'}`)),
        h('span', { class: 'mono', style: { fontSize: '12px' } }, `${fmt.num(r.volume, 3)} m³`))))].filter(Boolean));
    };
    shell('MTO quantities', 'MATERIAL TAKE-OFF',
      h('div', { class: 'form-grid', style: { gridTemplateColumns: '1fr 1fr' } },
        h('div', { class: 'field', style: { gridColumn: '1 / -1' } }, h('label', { for: 'ms' }, 'Scope'), h('select', { class: 'inp', id: 'ms', onchange: (e) => { scope = e.target.value; } }, h('option', { value: 'all' }, 'All visible objects'), layers.map((L) => h('option', { value: L.id }, L.name)))),
        h('div', { class: 'field' }, h('label', { for: 'dc' }, 'Concrete kg/m³'), h('input', { class: 'inp mono', id: 'dc', type: 'number', value: dens.concrete, oninput: (e) => { dens.concrete = Number(e.target.value); } })),
        h('div', { class: 'field' }, h('label', { for: 'dsx' }, 'Steel kg/m³'), h('input', { class: 'inp mono', id: 'dsx', type: 'number', value: dens.steel, oninput: (e) => { dens.steel = Number(e.target.value); } }))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; prog.hidden = false;
          project.densities = dens; await db.put('projects', project);
          const meshes = scope === 'all' ? viewer.meshes() : viewer.meshes({ layerIds: [scope] });
          try {
            lastMTO = await runMTO(meshes, { densities: dens, overrides: new Map(Object.entries(project.mtoMat || {})), layerName: (id) => viewer.layers.get(id)?.name || id, onProgress: (p) => { prog.firstChild.style.width = `${p * 100}%`; } });
            draw();
          } finally { btn.disabled = false; prog.hidden = true; }
        } }, icon('calc'), 'Calculate'),
        h('button', { class: 'btn ghost', onclick: () => {
          if (!lastMTO) return toast('Run the calculation first.', 'warn');
          const blob = buildXlsx([{
            name: 'MTO', title: `${project.code || ''} ${project.name} — Material Take-Off from 3D (${fmt.date(fmt.today())})`,
            columns: [
              { header: 'No', key: (r) => lastMTO.rows.indexOf(r) + 1, type: 'n', dp: 0, width: 6 }, { header: 'Layer', key: 'layer', width: 24 }, { header: 'Object / Tag', key: 'name', width: 32 },
              { header: 'Category', key: (r) => CATS[r.cat]?.label || '', width: 18 }, { header: 'Material', key: (r) => MATERIALS[r.material]?.label, width: 14 },
              { header: 'L (m)', key: 'L', type: 'n', width: 9 }, { header: 'W (m)', key: 'W', type: 'n', width: 9 }, { header: 'H (m)', key: 'H', type: 'n', width: 9 },
              { header: 'Area (m²)', key: 'area', type: 'n', width: 11 }, { header: 'Volume (m³)', key: 'volume', type: 'n', dp: 3, width: 12 },
              { header: 'Density (kg/m³)', key: 'density', type: 'n', dp: 0, width: 14 }, { header: 'Weight (kg)', key: 'weight', type: 'n', dp: 0, width: 12 },
              { header: 'Closed solid', key: (r) => (r.closed ? 'YES' : 'NO – approx.'), width: 13 },
            ],
            rows: lastMTO.rows,
          }, {
            name: 'Summary', title: 'Summary by material',
            columns: [{ header: 'Material', key: (s) => MATERIALS[s.material]?.label, width: 22 }, { header: 'Items', key: 'count', type: 'n', dp: 0 }, { header: 'Volume (m³)', key: 'volume', type: 'n', dp: 3, width: 13 }, { header: 'Area (m²)', key: 'area', type: 'n', width: 13 }, { header: 'Weight (t)', key: (s) => s.weight / 1000, type: 'n', dp: 3, width: 12 }, { header: 'Open meshes', key: 'open', type: 'n', dp: 0, width: 12 }],
            rows: lastMTO.summary,
          }]);
          download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_MTO_${fmt.today()}.xlsx`);
        } }, icon('download'), 'XLSX')),
      prog, out,
      h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'Volumes from closed triangle meshes (divergence theorem). Plot plan tanks, vessels, equipment and buildings are envelopes (space, not material), so they count as Other; foundations, paving and bund walls count as concrete. Contractor objects are classified by name; override any object in Properties.'));
    draw();
  }

  // ---------- Motion ----------
  async function runMotion(kind, record, opts = {}) {
    motion?.stop();
    openPanel(window.innerWidth <= 760 ? null : panel);
    let mime = null;
    if (record) { try { mime = viewer.startRecording(); } catch (e) { toast(e.message, 'err'); record = false; } }
    if (record) renderRail();
    await new Promise((res) => {
      if (kind === 'build') {
        const L = viewer.layers.get(opts.layerId) || [...viewer.layers.values()].find((x) => x.kind === 'plotplan');
        if (!L) { toast('Generate a plot plan model first.', 'warn'); return res(); }
        motion = playBuildUp(viewer, L, { duration: opts.duration || 9, onDone: res });
      } else if (kind === 'orbit') motion = playOrbit(viewer, { duration: opts.duration || 12, onDone: res });
      else if (kind === 'tour') db.byProject('viewpoints', project.id).then((v) => { motion = playTour(viewer, v.sort((a, b) => a.created - b.created), { onDone: res }); });
    });
    motion = null;
    if (record) {
      const blob = await viewer.stopRecording();
      if (blob?.size) {
        const extn = mime.includes('mp4') ? 'mp4' : 'webm';
        download(blob, `${(project.code || 'project').replace(/[^\w-]+/g, '_')}_${kind}_${fmt.today()}.${extn}`);
        toast(`Video saved (${fmt.bytes(blob.size)}, ${extn.toUpperCase()}).`, 'ok', 'RECORDED');
      }
    }
    corner();
  }
  function pMotion() {
    const pls = [...viewer.layers.values()].filter((L) => L.kind === 'plotplan');
    const o = { layerId: pls[0]?.id, duration: 9, record: false };
    shell('Motion & video', 'CINEMATICS',
      pls.length ? h('div', { class: 'field' }, h('label', { for: 'ml' }, 'Plot plan layer'), h('select', { class: 'inp', id: 'ml', onchange: (e) => { o.layerId = e.target.value; } }, pls.map((L) => h('option', { value: L.id }, L.name)))) : null,
      h('div', { class: 'field' }, h('label', { for: 'md' }, 'Duration (s)'), h('input', { type: 'range', id: 'md', min: 5, max: 30, value: 9, oninput: (e) => { o.duration = +e.target.value; e.target.nextSibling.textContent = `${e.target.value} s`; } }), h('span', { class: 'mono dim2' }, '9 s')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { o.record = e.target.checked; } }), h('span', { class: 'rec-dot' }), 'Record to video file'),
      h('div', { style: { display: 'grid', gap: '8px' } },
        h('button', { class: 'btn primary', disabled: !pls.length, onclick: () => runMotion('build', o.record, o) }, icon('play'), 'Plot plan build-up'),
        h('button', { class: 'btn mag', onclick: () => runMotion('orbit', o.record, { duration: Math.max(8, o.duration) }) }, icon('orbit'), '360° orbit'),
        h('button', { class: 'btn', onclick: () => runMotion('tour', o.record) }, icon('camera'), 'Viewpoint fly-through'),
        h('button', { class: 'btn ghost', onclick: () => motion?.stop() }, 'Stop')),
      h('p', { class: 'mono dim', style: { margin: 0, fontSize: '11px' } }, 'Video is captured from the 3D canvas at its current size (MP4 on Safari/Chrome, WebM elsewhere). Rotate the phone to landscape for a wide clip.'));
  }

  // ---------- boot ----------
  renderRail();
  const changed = await syncLayers();
  buildIfEmpty();
  function buildIfEmpty() {
    if (!viewer.layers.size) {
      viewer.setHud('NO MODELS LOADED', 'IMPORT A MODEL OR GENERATE A PLOT PLAN');
      openPanel('layers');
    }
  }
  if (state.playPlan && viewer.layers.has(`pp_${state.playPlan}`)) {
    const id = `pp_${state.playPlan}`;
    state.playPlan = null;
    viewer.fit(null, { dur: 0 });
    runMotion('build', false, { layerId: id, duration: 9 });
  } else if (changed || !viewer._fitted) {
    viewer.fit(null, { dir: new THREE.Vector3(1, 0.8, 1), dur: 0 });
  }
  viewer._fitted = true;
  corner();
  offs.push(viewer.on('layers', corner), viewer.on('mode', corner));
  let jobsRaf = 0;
  const onJobs = () => { cancelAnimationFrame(jobsRaf); jobsRaf = requestAnimationFrame(() => { if (panel === 'layers') pLayers(); }); };
  const onModel = async (e) => {
    if (e.detail?.projectId !== project.id) return;
    await syncLayers();
    const ids = e.detail.modelIds || [];
    const meshes = ids.flatMap((id) => viewer.layers.get(id)?.meshes || []);
    viewer.setHud('');
    viewer.fit(meshes.length ? meshes : null);
    if (panel === 'layers') pLayers();
    corner();
  };
  window.addEventListener('nexus:jobs', onJobs);
  window.addEventListener('nexus:model-added', onModel);
  offs.push(() => window.removeEventListener('nexus:jobs', onJobs), () => window.removeEventListener('nexus:model-added', onModel));

  return () => {
    motion?.stop();
    if (viewer.recording) viewer.stopRecording();
    viewer.clearHighlights();
    viewer.setMode('select');
    offs.forEach((f) => f());
    viewer.host.remove();
  };
}
