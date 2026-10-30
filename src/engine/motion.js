// Motion sequences: plot plan build-up, 360° orbit, viewpoint fly-through (all recordable).
import * as THREE from 'three';
import { CAT_ORDER } from '../core/domain.js';

const easeOutBack = (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Build-up: neon blueprint fades in, a scan beam sweeps the plan, objects extrude out of the ground
 * in construction order (civil → buildings → equipment → tanks → rack → pipes) while the camera
 * swoops from plan view into a three-quarter orbit.
 */
export function playBuildUp(viewer, layer, { duration = 9, onDone } = {}) {
  const meshes = layer.meshes.slice();
  const ground = [];
  layer.object.traverse((o) => { if (o.userData.ground) ground.push(o); });
  const box = viewer.boundsOf(meshes.length ? meshes : [layer.object]);
  if (box.isEmpty()) { onDone?.(); return { stop() {} }; }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 10);
  const order = (m) => { const i = CAT_ORDER.indexOf(m.userData.cat); return i < 0 ? 5 : i; };
  meshes.sort((a, b) => order(a) - order(b) || a.position.distanceTo(center) - b.position.distanceTo(center));
  const base = new Map(meshes.map((m) => [m, m.scale.y]));
  meshes.forEach((m) => { m.scale.y = 0.0001; m.visible = true; });
  ground.forEach((g) => { g.material.opacity = 0; });

  // scan beam
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(span * 0.006 + 0.1, Math.max(4, size.y * 1.2), span * 1.15),
    new THREE.MeshBasicMaterial({ color: 0xff2fd0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  beam.userData.helper = true;
  beam.position.set(box.min.x, size.y * 0.6, center.z);
  viewer.fx.add(beam);

  const ctrl = viewer.controls;
  ctrl.enabled = false;
  const fov = THREE.MathUtils.degToRad(viewer.camera.fov / 2);
  const topDist = (span * 0.62) / Math.tan(fov);
  const camTop = center.clone().add(new THREE.Vector3(0, topDist, topDist * 0.002)); // north up
  const r = span * 0.95;
  const camIso = (ang, lift = 0.55) => center.clone().add(new THREE.Vector3(Math.cos(ang) * r, r * lift, Math.sin(ang) * r));
  viewer.camera.far = Math.max(viewer.camera.far, topDist * 4);
  viewer.camera.updateProjectionMatrix();

  const T = duration;
  const tScan = [0.4, 0.3 * T];
  const tBuild = [0.18 * T, 0.72 * T];
  const tCam = [0.12 * T, 0.75 * T];
  const per = Math.min(1.1, (tBuild[1] - tBuild[0]) * 0.35);
  const n = Math.max(1, meshes.length);
  let t = 0;
  let stopped = false;
  let lastPhase = '';
  const phase = (p, title, sub) => { if (lastPhase !== p) { lastPhase = p; viewer.setHud(title, sub); } };

  const finish = () => {
    meshes.forEach((m) => { m.scale.y = base.get(m); });
    ground.forEach((g) => { g.material.opacity = 1; });
    viewer.fx.remove(beam);
    beam.geometry.dispose();
    ctrl.enabled = true;
    viewer.setHud('');
    viewer.requestRender();
  };

  viewer.addTicker((dt) => {
    if (stopped) { finish(); return false; }
    t += dt;
    // ground fade
    const gk = clamp01(t / 1.2);
    ground.forEach((g) => { g.material.opacity = gk; });
    // scan sweep
    const sk = clamp01((t - tScan[0]) / (tScan[1] - tScan[0]));
    beam.position.x = box.min.x - span * 0.05 + sk * (size.x + span * 0.1);
    beam.material.opacity = sk > 0 && sk < 1 ? 0.55 : 0;
    // build
    meshes.forEach((m, i) => {
      const start = tBuild[0] + (i / n) * (tBuild[1] - tBuild[0] - per);
      const k = clamp01((t - start) / per);
      m.scale.y = Math.max(0.0001, easeOutBack(k) * base.get(m));
    });
    // camera
    const ck = easeInOut(clamp01((t - tCam[0]) / (tCam[1] - tCam[0])));
    const orbitAng = -Math.PI * 0.75 + Math.max(0, t - tCam[1]) * 0.18;
    const iso = camIso(orbitAng - (1 - ck) * 0.6);
    if (t < tCam[0]) viewer.camera.position.copy(camTop);
    else viewer.camera.position.lerpVectors(camTop, iso, ck);
    ctrl.target.copy(center);
    viewer.camera.lookAt(center);
    // HUD
    if (t < tScan[1]) phase('scan', 'SCANNING PLOT PLAN', `${n} OBJECTS DETECTED`);
    else if (t < tBuild[1]) phase('build', 'EXTRUDING GEOMETRY', `BUILD ${Math.min(n, Math.round(((t - tBuild[0]) / (tBuild[1] - tBuild[0])) * n))} / ${n}`);
    else phase('done', 'MODEL ONLINE', `${(size.x).toFixed(0)} m × ${(size.z).toFixed(0)} m · ${n} OBJECTS`);
    if (lastPhase === 'build') viewer.hudEl.querySelector('small') && (viewer.hudEl.querySelector('small').textContent = `BUILD ${Math.min(n, Math.max(0, Math.round(((t - tBuild[0]) / (tBuild[1] - tBuild[0])) * n)))} / ${n}`);
    if (t >= T) { finish(); onDone?.(); return false; }
    return true;
  });
  return { stop() { stopped = true; } };
}

/** 360° orbit around everything visible. */
export function playOrbit(viewer, { duration = 12, onDone } = {}) {
  const box = viewer.boundsOf();
  if (box.isEmpty()) { onDone?.(); return { stop() {} }; }
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.z, 10) * 0.95;
  const start = Math.atan2(viewer.camera.position.z - c.z, viewer.camera.position.x - c.x);
  let t = 0, stopped = false;
  viewer.controls.enabled = false;
  viewer.setHud('ORBIT SCAN', '360° REVIEW');
  viewer.addTicker((dt) => {
    t += dt;
    const k = t / duration;
    const a = start + k * Math.PI * 2;
    viewer.camera.position.set(c.x + Math.cos(a) * r, c.y + r * (0.45 + 0.1 * Math.sin(k * Math.PI * 2)), c.z + Math.sin(a) * r);
    viewer.controls.target.copy(c);
    viewer.camera.lookAt(c);
    if (stopped || t >= duration) { viewer.controls.enabled = true; viewer.setHud(''); onDone?.(); return false; }
    return true;
  });
  return { stop() { stopped = true; } };
}

/** Fly through saved viewpoints (Catmull-Rom path through camera positions). */
export function playTour(viewer, viewpoints, { secPer = 3.2, onDone } = {}) {
  if (viewpoints.length < 2) { onDone?.(); return { stop() {} }; }
  const P = new THREE.CatmullRomCurve3(viewpoints.map((v) => new THREE.Vector3(...v.camera.pos)), false, 'centripetal');
  const Tg = new THREE.CatmullRomCurve3(viewpoints.map((v) => new THREE.Vector3(...v.camera.target)), false, 'centripetal');
  const dur = secPer * (viewpoints.length - 1);
  let t = 0, stopped = false;
  viewer.controls.enabled = false;
  viewer.addTicker((dt) => {
    t += dt;
    const k = easeInOut(clamp01(t / dur));
    const idx = Math.min(viewpoints.length - 1, Math.round(k * (viewpoints.length - 1)));
    viewer.setHud(viewpoints[idx].name.toUpperCase(), `VIEW ${idx + 1} / ${viewpoints.length}`);
    viewer.camera.position.copy(P.getPoint(k));
    viewer.controls.target.copy(Tg.getPoint(k));
    viewer.camera.lookAt(viewer.controls.target);
    if (stopped || t >= dur) { viewer.controls.enabled = true; viewer.setHud(''); onDone?.(); return false; }
    return true;
  });
  return { stop() { stopped = true; } };
}
