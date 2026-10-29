'use strict';
// Build screen (#/build): the dwarf digs ore out of the boulder, hauls blocks on push-ups and builds on a plot of floor on squats.
// The plot is a real 3D grid (width x depth x height): you can walk the camera all the way round it, draw ghosts on the floor or on
// any face of a block, and watch it grow. It runs on the quarry's own engine and dwarf (scene3d.js) with a calmer picture
// (finer pixels, many colours, almost no dither) so blocks stay readable. Game state lives in build.js (BuildWorld); this file is view and controls.
// Repetitions come from buttons for now: the camera and the pose detectors are not connected to this screen yet.
(() => {
 const $ = id => document.getElementById(id), canvas = $('buildWorld3d');
 if (!canvas || typeof BuildWorld === 'undefined') return;
 const EX = Object.fromEntries(Object.entries(BUILD_JOBS).map(([k, v]) => [k, v.exercise])); // job -> exercise
 const MATS = Object.keys(BUILD_MATERIALS), G = BUILD_GRID;
 const C = .42, S = 1.6; // plot cell size and dwarf scale, world units
 const MIN_GAP = .8; // seconds between counted reps, as in the quarry
 // ---- layout, world units (x right, z towards the viewer at azimuth 0). The plot is in the middle; the boulder and the piles sit around it.
 const PLOT = [-1.2, 0]; // centre of the plot on the floor (the camera orbits the point x = view.x, z = 0)
 const O = [PLOT[0] - G.w * C / 2, PLOT[1] - G.d * C / 2]; // its back left corner
 const P = {
  dig: [2.2, -.6], boulderDist: 2.4, // he stands here and faces the boulder on his right
  mountain: [3.4, 1.9], sitePile: [-4.6, 3.0], // piles of finished blocks
  haul: [2.4, 3.0], // where he does push-ups, facing the site pile
  place: [-4.5, -.2] // where he squats, left of the plot
 };
 const DIG_YAW = Math.PI / 2, rock = [P.dig[0] + P.boulderDist * Math.sin(DIG_YAW), P.dig[1] + P.boulderDist * Math.cos(DIG_YAW)];
 const cellOrigin = (x, y, z) => [O[0] + x * C, y * C, O[1] + z * C]; // corner of a cell
 const cellCenter = (x, y, z, h = 1) => [O[0] + (x + .5) * C, (y + h / 2) * C, O[1] + (z + .5) * C];
 const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
 const spot = w => [(w[0] - P.dig[0]) / S, (w[1] - P.dig[1]) / S]; // gnome spots are in his own units, relative to his root
 const SPOTS = { swing: [0, 0], pushup: spot(P.haul), squat: spot(P.place) };
 const YAW = { swing: DIG_YAW, pushup: yawTo(P.haul, P.sitePile), squat: Math.PI / 2 };
 const HANDS = 1.15; // how far in front of the lying dwarf the block he pushes rests
 const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }, FACE_NAME = { n: 'NORTH', e: 'EAST', s: 'SOUTH', w: 'WEST' };

 const state = { world: new BuildWorld(), job: 'dig', material: 'stone', shape: 'block', facing: 's', tool: 'draw', auto: false, nextAuto: 0, lastRep: -9, hover: null, toastUntil: 0,
  az: -.5, azT: -.5, el: .62, zoom: 1 };
 const pending = { swing: [], pushup: [], squat: [] }; // outcomes of counted reps, shown when the blow lands
 const fliers = []; // blocks in the air: { obj, from, to, t0, dur, land }
 const landing = new Set(); // keys of built cells that are still in the air
 const vis = { mountain: {}, site: {} }; // piles as drawn: they change when a block lands, the world already counted it
 let api = null, T = null, site = null, floor = null, cellMeshes = new Map(), pileMeshes = {}, carry = null, preview = null, soloId = 'me', last = 0, running = false, failed = false, gid = null;
 const now = () => performance.now() / 1000;
 const toast = text => { const e = $('bToast'); e.textContent = text; state.toastUntil = now() + 3.2 };

 // ---- block textures: 16 x 16 pixel art per material, nearest filtered like the quarry's tiles ----
 const LOOK = {
  rubble: { base: '#7d766f', a: '#a39b92', b: '#4d4743', kind: 'speck' }, sandstone: { base: '#cfae74', a: '#e6cd98', b: '#a37f4a', kind: 'strata' },
  brick: { base: '#b0533a', a: '#d6c3a4', b: '#7a3322', kind: 'brick' }, stone: { base: '#6c7080', a: '#8c90a0', b: '#454856', kind: 'ashlar' },
  marble: { base: '#e4e2ea', a: '#ffffff', b: '#9a96ab', kind: 'marble' }, obsidian: { base: '#2c2540', a: '#6a5a96', b: '#140f22', kind: 'glass' }
 };
 const h = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) };
 function paint(m) {
  const L = LOOK[m], c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'), R = (a, b, w, hh, col) => { x.fillStyle = col; x.fillRect(a, b, w, hh) };
  R(0, 0, 16, 16, L.base);
  if (L.kind === 'speck') for (let i = 0; i < 46; i++) R(h(i + 1) * 15 | 0, h(i + 90) * 15 | 0, 1 + (i % 3 === 0), 1, i % 2 ? L.a : L.b);
  else if (L.kind === 'strata') for (let j = 0; j < 16; j += 3) { R(0, j, 16, 1, h(j + 5) > .5 ? L.a : L.b); if (j % 2) R(h(j) * 12 | 0, j + 1, 3, 1, L.b) }
  else if (L.kind === 'brick') { for (let j = 0; j < 16; j += 4) { R(0, j, 16, 1, L.a); const o = (j / 4) % 2 ? 4 : 0; for (let i = o; i < 16; i += 8) R(i, j, 1, 4, L.a) } R(2, 6, 3, 1, L.b); R(10, 10, 3, 1, L.b) }
  else if (L.kind === 'ashlar') { R(0, 7, 16, 1, L.b); R(0, 15, 16, 1, L.b); R(5, 0, 1, 8, L.b); R(11, 8, 1, 8, L.b); R(1, 1, 3, 1, L.a); R(7, 9, 3, 1, L.a); R(0, 0, 16, 1, L.a) }
  else if (L.kind === 'marble') { for (let i = 0; i < 12; i++) R(2 + i, 3 + (i * 7 % 5), 1, 1, L.b); for (let i = 0; i < 9; i++) R(8 + i % 8, 9 + (i * 3 % 5), 1, 1, L.b); R(0, 0, 16, 1, L.a) }
  else { for (let i = 0; i < 8; i++) R(3 + i, 12 - i, 1, 1, L.a); R(11, 3, 2, 1, L.a); R(1, 14, 2, 1, L.b) }
  const t = new T.CanvasTexture(c); t.magFilter = t.minFilter = T.NearestFilter; t.generateMipmaps = false; t.colorSpace = T.SRGBColorSpace; return t;
 }
 const solid = {}, ghost = {}, geoCache = {};
 const solidMat = m => solid[m] ||= new T.MeshStandardMaterial({ map: paint(m), roughness: .95 });
 const ghostMat = m => ghost[m] ||= new T.MeshBasicMaterial({ color: LOOK[m].base, transparent: true, opacity: .5, depthWrite: false });
 const edgeMat = () => edgeMat.m ||= new T.LineBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: .8, depthWrite: false });
 const geo = (w, hh, d) => geoCache[w + '|' + hh + '|' + d] ||= new T.BoxGeometry(w, hh, d);

 // A piece in cell coordinates: the cell's back left bottom corner is the origin (size c). facing: the way stairs rise / a door faces.
 function piece(shape, m, facing, isGhost, c = C) {
  const g = new T.Group(), mat = isGhost ? ghostMat(m) : solidMat(m), [fx, fz] = DIRS[facing] || DIRS.s;
  const box = (w, hh, d, x, y, z, mt = mat) => { const o = new T.Mesh(geo(w, hh, d), mt); o.position.set(x, y, z); g.add(o); if (isGhost) { const e = new T.LineSegments(new T.EdgesGeometry(geo(w, hh, d)), edgeMat()); e.position.copy(o.position); g.add(e) } return o };
  if (shape === 'block') box(c, c, c, c / 2, c / 2, c / 2);
  else if (shape === 'stairs') { box(c, c / 2, c, c / 2, c / 4, c / 2); box(fx ? c / 2 : c, c / 2, fz ? c / 2 : c, c / 2 + fx * c / 4, c * .75, c / 2 + fz * c / 4) }
  else { // door: a slab with a darker raised panel and a brass handle on the side it faces
   const along = fz ? 'x' : 'z', thick = c * .45, wide = c * .96; // a door facing n/s is a slab in the x-y plane, facing e/w in the z-y plane
   box(along === 'x' ? wide : thick, c * 2, along === 'x' ? thick : wide, c / 2, c, c / 2);
   if (!isGhost) {
    const dark = new T.MeshStandardMaterial({ map: solidMat(m).map, color: '#8a8a95', roughness: 1 }), gold = new T.MeshStandardMaterial({ color: '#d8a24e', roughness: .5 }), off = thick / 2 + .008;
    for (const side of [1, -1]) {
     const dx = fx * side * off, dz = fz * side * off;
     box(along === 'x' ? c * .6 : .02, c * 1.5, along === 'x' ? .02 : c * .6, c / 2 + dx, c * 1.02, c / 2 + dz, dark);
     box(along === 'x' ? c * .08 : .03, c * .08, along === 'x' ? .03 : c * .08, c / 2 + dx * 1.05 + (along === 'x' ? c * .2 : 0), c, c / 2 + dz * 1.05 + (along === 'x' ? 0 : c * .2), gold);
    }
   }
  }
  return g;
 }

 // ---- scene content ----
 function pileObj(p) { // a pyramid of small cubes: 3 x 3, then 2 x 2, then one on top (14), sorted by material
  const g = new T.Group(), size = .24, slots = [];
  for (const [n, y] of [[3, 0], [2, 1], [1, 2]]) for (let i = 0; i < n * n; i++) slots.push([(i % n - (n - 1) / 2) * size, y * size, (Math.floor(i / n) - (n - 1) / 2) * size]);
  let i = 0;
  for (const m of MATS) for (let k = 0; k < (p[m] || 0) && i < slots.length; k++, i++) { const o = piece('block', m, 's', false, size), [x, y, z] = slots[i]; o.position.set(x - size / 2, y, z - size / 2); g.add(o) }
  return g;
 }
 function syncPiles() {
  for (const k of ['mountain', 'sitePile']) {
   const p = k === 'mountain' ? vis.mountain : vis.site, sig = MATS.map(m => p[m] || 0).join(), at = k === 'mountain' ? P.mountain : P.sitePile;
   if (pileMeshes[k]?.sig === sig) continue;
   if (pileMeshes[k]) api.scene.remove(pileMeshes[k].obj);
   const obj = pileObj(p); obj.position.set(at[0], 0, at[1]); api.scene.add(obj); pileMeshes[k] = { sig, obj };
  }
 }
 function syncCells() {
  const w = state.world, seen = new Set();
  for (const key in w.cells) {
   const c = w.cells[key], ghostNow = !c.built || landing.has(key), prog = w.building === key ? w.placeProgress / w.need('place') : 0;
   const sig = [c.material, c.shape, c.facing, ghostNow].join();
   seen.add(key); let e = cellMeshes.get(key);
   if (!e || e.sig !== sig) {
    if (e) site.remove(e.obj);
    const obj = piece(c.shape, c.material, c.facing, ghostNow); obj.position.set(c.x * C, c.y * C, c.z * C); obj.userData.cell = key; site.add(obj); e = { sig, obj }; cellMeshes.set(key, e);
   }
   e.obj.scale.setScalar(ghostNow && prog > 0 ? 1 + prog * .06 : 1); // the ghost swells a little as squats go in
  }
  for (const [key, e] of cellMeshes) if (!seen.has(key)) { site.remove(e.obj); cellMeshes.delete(key) }
 }
 function setCarry(m) {
  if (carry && carry.m === m) return;
  if (carry) { api.scene.remove(carry.obj); carry = null }
  if (m) { const obj = piece('block', m, 's', false, S * .17); api.scene.add(obj); carry = { m, obj } }
 }
 function putCarry() { // the block rests in front of his hands while he does push-ups
  if (!carry) return;
  const ux = Math.sin(YAW.pushup), uz = Math.cos(YAW.pushup), c = S * .17;
  carry.obj.position.set(P.haul[0] + ux * HANDS * S * .8 - c / 2, .06, P.haul[1] + uz * HANDS * S * .8 - c / 2);
 }
 function fly(obj, from, to, dur, land) { api.scene.add(obj); fliers.push({ obj, from, to, t0: now(), dur, land }) }
 function flyBlock(m, from, to, dur, land, size = .3) { const obj = piece('block', m, 's', false, size); obj.children.forEach(o => o.position.sub(new T.Vector3(size / 2, size / 2, size / 2))); fly(obj, from, to, dur, land) }
 function resync() { for (const m of MATS) { vis.mountain[m] = state.world.mountain[m]; vis.site[m] = state.world.site[m] } syncPiles() }

 // The blow lands: show the outcome of the oldest counted rep for this exercise.
 function impact(g, ex) {
  const item = pending[ex].shift(); if (!item) return ex === 'swing'; // an uncounted blow (none expected here): chip the rock only when digging
  const e = item.ev;
  if (e.type === 'dig') {
   if (e.done) flyBlock(e.material, [rock[0], 1.6, rock[1]], [P.mountain[0], .5, P.mountain[1]], .55, () => { vis.mountain[e.material]++; syncPiles() });
   refreshUi(); return true; // the quarry's own hit effect: the boulder shakes and sheds shards
  }
  if (e.type === 'haul') {
   if (e.done) { const c = S * .17, from = carry ? carry.obj.position.clone() : new T.Vector3(P.haul[0], .1, P.haul[1]); setCarry(null); flyBlock(e.material, [from.x, .15, from.z], [P.sitePile[0], .6, P.sitePile[1]], .5, () => { vis.site[e.material]++; syncPiles() }, c * 1.2) }
   refreshUi(); return false;
  }
  if (e.type === 'place') {
   if (e.done) { const c = e.cell; flyBlock(c.material, [P.place[0], 1.1, P.place[1]], cellCenter(c.x, c.y, c.z, BUILD_SHAPES[c.shape].h), .55, () => { landing.delete(e.key); syncCells(); refreshUi() }, .26) }
   syncCells(); refreshUi(); return false;
  }
  return false;
 }

 // ---- one counted repetition ----
 function rep(t = now()) {
  if (!api || t - state.lastRep < MIN_GAP) return false;
  const w = state.world, ev = w.rep(state.job, state.material);
  if (ev.type === 'blocked') { toast(ev.reason); state.auto = false; refreshUi(); return false }
  state.lastRep = t; const ex = EX[state.job]; pending[ex].push({ ev });
  if (ev.type === 'haul' && ev.progress === 1) { vis.mountain[ev.material]--; syncPiles(); setCarry(ev.material); putCarry() }
  if (ev.type === 'place') { if (ev.progress === 1) { for (const m of MATS) vis.site[m] = w.site[m]; syncPiles() } if (ev.done) landing.add(ev.key); syncCells() }
  api.hit(soloId, ex, 1); refreshUi(); return true;
 }

 // ---- autopilot (demo): stay on a job while it is useful; switch only when it is not ----
 function autoJob() {
  const w = state.world, blocks = w.ghosts().reduce((a, c) => a + BUILD_SHAPES[c.shape].blocks, 0) + (w.building ? 1 : 0);
  const stock = w.total(w.mountain) + w.total(w.site) + (w.carrying ? 1 : 0), needDig = blocks > stock;
  const useful = j => j === 'place' ? !w.why('place') : j === 'haul' ? !w.why('haul') : needDig || w.digProgress[state.material] > 0;
  if (w.building) return 'place'; if (w.carrying) return 'haul';
  if (useful(state.job)) return state.job;
  for (const j of ['place', 'haul', 'dig']) if (useful(j)) return j;
  return state.job;
 }
 function autoMaterial() { const w = state.world, g = w.ghosts().find(c => w.site[c.material] + w.mountain[c.material] < BUILD_SHAPES[c.shape].blocks); if (g) state.material = g.material }

 // ---- controls ----
 const JOB_NOTE = { dig: m => BUILD_MATERIALS[m].dig + ' swings a block', haul: () => BUILD_JOBS.haul.reps + ' push-ups a block', place: () => BUILD_JOBS.place.repsPerBlock + ' squats a block' };
 function setJob(j) { state.job = j; if (api) api.setExercise(soloId, EX[j]); refreshUi() }
 function refreshUi() {
  const w = state.world, why = w.why(state.job);
  for (const b of document.querySelectorAll('[data-job]')) { const j = b.dataset.job, blocked = !!w.why(j); b.setAttribute('aria-pressed', String(j === state.job)); b.classList.toggle('blocked', blocked); b.querySelector('small').textContent = JOB_NOTE[j](state.material) }
  for (const b of document.querySelectorAll('[data-material]')) b.setAttribute('aria-pressed', String(b.dataset.material === state.material));
  for (const b of document.querySelectorAll('[data-shape]')) b.setAttribute('aria-pressed', String(state.tool === 'draw' && b.dataset.shape === state.shape));
  $('bFacing').textContent = FACE_NAME[state.facing];
  document.querySelector('[data-tool="erase"]').setAttribute('aria-pressed', String(state.tool === 'erase'));
  $('bReason').textContent = why || ''; $('bRep').disabled = !!why;
  const need = w.need(state.job, state.material), done = w.progress(state.job, state.material);
  $('bProg').textContent = done; $('bProgLabel').textContent = 'OF ' + need + ' · ' + (state.job === 'dig' ? BUILD_MATERIALS[state.material].name.toUpperCase() : state.job === 'haul' ? 'HAUL' : 'BUILD');
  $('bBar').style.width = (need ? Math.round(done / need * 100) : 0) + '%';
  $('bMount').textContent = w.total(w.mountain) + (w.carrying ? ' +1' : ''); $('bSite').textContent = w.total(w.site);
  $('bDug').textContent = w.reps.dig; $('bHauled').textContent = w.reps.haul; $('bBuilt').textContent = w.reps.place;
  $('bAuto').setAttribute('aria-pressed', String(state.auto));
 }
 const mats = $('bMaterials');
 for (const m of MATS) {
  const b = document.createElement('button'); b.className = 'pick'; b.dataset.material = m; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = '<i class="sw" style="--c:' + LOOK[m].base + '"></i><b>' + BUILD_MATERIALS[m].name.toUpperCase() + '</b><small>' + BUILD_MATERIALS[m].dig + ' swings</small>';
  b.onclick = () => { state.material = m; refreshUi() }; mats.appendChild(b);
 }
 for (const b of document.querySelectorAll('[data-job]')) b.onclick = () => setJob(b.dataset.job);
 for (const b of document.querySelectorAll('[data-shape]')) b.onclick = () => { state.shape = b.dataset.shape; state.tool = 'draw'; refreshUi() };
 document.querySelector('[data-tool="erase"]').onclick = () => { state.tool = state.tool === 'erase' ? 'draw' : 'erase'; refreshUi() };
 $('bTurn').onclick = () => { state.facing = BUILD_FACINGS[(BUILD_FACINGS.indexOf(state.facing) + 1) % 4]; refreshUi() };
 $('bRotL').onclick = () => { state.azT -= Math.PI / 4 };
 $('bRotR').onclick = () => { state.azT += Math.PI / 4 };
 $('bRep').onclick = () => rep();
 $('bAuto').onclick = () => { state.auto = !state.auto; state.nextAuto = 0; refreshUi() };
 let armed = 0;
 $('bReset').onclick = () => { // two taps within 3 s (frames may ignore confirm())
  const b = $('bReset'); if (now() > armed) { armed = now() + 3; b.textContent = 'SURE?'; setTimeout(() => { if (now() > armed) b.textContent = 'CLEAR' }, 3100); return }
  armed = 0; b.textContent = 'CLEAR'; state.world = new BuildWorld(); state.auto = false; for (const k in pending) pending[k].length = 0; landing.clear(); setCarry(null); for (const f of fliers.splice(0)) api.scene.remove(f.obj); resync(); syncCells(); refreshUi();
 };
 $('bSample').onclick = () => { // a small house on the plot: floor, four walls with a door, a stair, a roof and a pillar
  const w = state.world, put = (x, y, z, m, s, f) => w.plan(x, y, z, m, s, f), x0 = 2, x1 = 7, z0 = 2, z1 = 7;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) put(x, 0, z, 'stone', 'block');
  for (let y = 1; y <= 2; y++) for (let i = x0; i <= x1; i++) for (const [x, z] of [[i, z0], [i, z1], [x0, i], [x1, i]]) put(x, y, z, 'brick', 'block');
  put(4, 1, z1, 'marble', 'door', 's'); put(8, 1, z1, 'stone', 'stairs', 'w'); put(8, 0, z1 + 1, 'stone', 'stairs', 'n');
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) if (x < x0 || x > x1 || z < z0 || z > z1 || (x + z) % 2) put(x, 3, z, (x + z) % 2 ? 'sandstone' : 'rubble', 'block');
  put(1, 0, 1, 'obsidian', 'block'); put(1, 1, 1, 'obsidian', 'block'); put(1, 2, 1, 'marble', 'block');
  syncCells(); refreshUi(); toast('A house is drawn. Dig, haul and build, or switch AUTO on. Drag to look around.');
 };

 // ---- looking round, and picking a cell with the pointer ----
 const ray = () => ray.r ||= new T.Raycaster();
 function cellAt(e, erase) {
  if (!api) return null;
  const r = canvas.getBoundingClientRect(), ndc = new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
  const rc = ray(); rc.setFromCamera(ndc, api.camera);
  const targets = [floor]; site.traverse(o => { if (o.isMesh && o !== floor) targets.push(o) });
  const hit = rc.intersectObjects(targets, false)[0]; if (!hit) return null;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld), p = hit.point.clone().addScaledVector(n, (erase ? -1 : 1) * C * .25), l = site.worldToLocal(p);
  const x = Math.floor(l.x / C), y = Math.floor(l.y / C), z = Math.floor(l.z / C);
  return x >= 0 && x < G.w && y >= 0 && y < G.h && z >= 0 && z < G.d ? { x, y, z } : null;
 }
 let drag = null;
 canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: state.azT, el: state.el, moved: false }; try { canvas.setPointerCapture(e.pointerId) } catch { } });
 canvas.addEventListener('pointermove', e => {
  if (drag) {
   const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
   if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; state.hover = null; canvas.style.cursor = 'grabbing' }
   if (drag.moved) { state.azT = drag.az - dx * .008; state.az = state.azT; state.el = Math.min(1.2, Math.max(.25, drag.el + dy * .005)) }
  } else state.hover = cellAt(e, state.tool === 'erase');
 });
 canvas.addEventListener('pointerup', e => {
  const d = drag; drag = null; canvas.style.cursor = '';
  if (!d || d.moved) return;
  const erase = state.tool === 'erase', c = cellAt(e, erase); state.hover = c; if (!c) return;
  const r = erase ? state.world.erase(c.x, c.y, c.z) : state.world.plan(c.x, c.y, c.z, state.material, state.shape, state.facing);
  if (!r.ok) toast(r.reason); else if (r.removed === 'built') { toast('Taken apart: the blocks went back to the site.'); for (const m of MATS) vis.site[m] = state.world.site[m]; syncPiles() }
  syncCells(); refreshUi();
 });
 canvas.addEventListener('pointercancel', () => { drag = null; canvas.style.cursor = '' });
 canvas.addEventListener('pointerleave', () => { if (!drag) state.hover = null });
 canvas.addEventListener('wheel', e => { e.preventDefault(); state.zoom = Math.min(1.8, Math.max(.6, state.zoom * (e.deltaY > 0 ? .92 : 1.08))) }, { passive: false });
 function syncPreview() {
  const c = state.hover, want = c && [state.tool, state.shape, state.material, state.facing, c.x, c.y, c.z].join();
  if (preview && preview.sig === want) return;
  if (preview) { site.remove(preview.obj); preview = null }
  if (!c) return;
  const erase = state.tool === 'erase', obj = erase ? new T.LineSegments(new T.EdgesGeometry(geo(C, C, C)), new T.LineBasicMaterial({ color: '#ff4d4d', depthWrite: false })) : piece(state.shape, state.material, state.facing, true);
  if (erase) obj.position.set(c.x * C + C / 2, c.y * C + C / 2, c.z * C + C / 2); else obj.position.set(c.x * C, c.y * C, c.z * C);
  obj.traverse(o => { o.raycast = () => { } }); site.add(obj); preview = { sig: want, obj };
 }

 // ---- frame loop: only while the Build screen is visible ----
 const visible = () => !canvas.closest('[data-view][hidden]') && !document.hidden;
 function update(t, dt) {
  for (let i = fliers.length - 1; i >= 0; i--) {
   const f = fliers[i], k = Math.min(1, (t - f.t0) / f.dur);
   f.obj.position.set(f.from[0] + (f.to[0] - f.from[0]) * k, f.from[1] + (f.to[1] - f.from[1]) * k + Math.sin(k * Math.PI) * .9, f.from[2] + (f.to[2] - f.from[2]) * k);
   if (k >= 1) { api.scene.remove(f.obj); fliers.splice(i, 1); f.land && f.land() }
  }
  if (!drag?.moved) state.az += (state.azT - state.az) * (1 - Math.exp(-dt * 9));
  const v = api.opts.view, asp = canvas.clientWidth / Math.max(1, canvas.clientHeight); // everything fits at any shape of screen
  api.opts.az = state.az; api.opts.elev = state.el; v.zoom = Math.min(1.1, Math.max(7.2, 6.2 / asp) * asp / 14.5) * state.zoom; v.y = asp < 1 ? .5 : .9;
  putCarry(); syncPreview();
  if (!fliers.length && !pending.swing.length && !pending.pushup.length && !pending.squat.length) { let drift = false; for (const m of MATS) if (vis.mountain[m] !== state.world.mountain[m] || vis.site[m] !== state.world.site[m]) drift = true; if (drift && !state.world.building && !state.world.carrying) resync() }
  if (state.auto && t >= state.nextAuto && t - state.lastRep >= MIN_GAP) {
   if (!state.world.ghosts().length && !state.world.building) { state.auto = false; toast('Nothing to do: draw a blueprint first.'); refreshUi() }
   else { autoMaterial(); const j = autoJob(); if (j !== state.job) setJob(j); if (rep(t)) state.nextAuto = t + .15 }
  }
  if (state.toastUntil && t > state.toastUntil) { $('bToast').textContent = ''; state.toastUntil = 0 }
 }
 function frame(ts) {
  const t = ts / 1000, dt = Math.min(t - last, .1); last = t;
  if (!visible()) { running = false; return }
  try { update(t, dt); api.resize(); api.render(dt) } catch (e) { console.error('build frame failed', e); running = false; failed = true; toast('The 3D view stopped: ' + e.message); return }
  requestAnimationFrame(frame);
 }
 function boot() {
  if (api || failed) return true;
  const M = window.Scene3D; if (!M || !window.stageReady || !window.stageReady()) return false;
  try {
   gid = typeof stageGnomeId === 'function' ? stageGnomeId : () => 'me'; soloId = gid();
   // a calmer picture than the quarry's: fine pixels, many colours, almost no dither; the camera is free (opts.az / opts.elev change every frame)
   api = M.create(canvas, { mode: 'solo', elev: state.el, az: state.az, slabRot: 0, slabAt: [.3, 0, 0], slabScale: [1.6, 1.25], flames: [[-5.0, -3.7], [5.4, -3.7]], rockAt: [rock[0], 0, rock[1]], gnomeRoot: [P.dig[0], P.dig[1], 0], spots: SPOTS, yawFor: YAW,
    view: { x: .3, y: .9, zoom: 1 }, levels: 32, dither: .05, edge: .01, pixelH: 400, minK: 1, beforeHit: (g, ex) => impact(g, ex) });
   T = api.THREE; api.setGnomes([soloId]); api.setHp(1);
   site = new T.Group(); site.position.set(O[0], 0, O[1]); api.scene.add(site);
   floor = new T.Mesh(new T.PlaneGeometry(G.w * C, G.d * C), new T.MeshStandardMaterial({ color: '#4b4058', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.set(G.w * C / 2, .01, G.d * C / 2); site.add(floor); // the plot: also what the pointer hits
   const grid = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: '#a89cc0', transparent: true, opacity: .35, depthWrite: false })), pts = [];
   for (let i = 0; i <= G.w; i++) pts.push(i * C, .02, 0, i * C, .02, G.d * C);
   for (let j = 0; j <= G.d; j++) pts.push(0, .02, j * C, G.w * C, .02, j * C);
   grid.geometry.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); grid.raycast = () => { }; site.add(grid);
   const rim = new T.Mesh(geo(G.w * C + .16, .06, G.d * C + .16), new T.MeshStandardMaterial({ color: '#2a2233', roughness: 1 })); rim.position.set(G.w * C / 2, -.02, G.d * C / 2); rim.raycast = () => { }; site.add(rim);
   resync(); syncCells(); refreshUi(); return true;
  } catch (e) { failed = true; console.error('build scene failed', e); toast('3D view unavailable: ' + e.message); return true }
 }
 function start() { if (running || !visible()) return; if (!boot()) { setTimeout(start, 250); return } if (failed) return; running = true; last = performance.now() / 1000; requestAnimationFrame(frame) }
 window.addEventListener('hashchange', () => setTimeout(start, 0)); document.addEventListener('visibilitychange', start); window.addEventListener('stage-ready', start);
 window.buildDebug = () => ({ state, vis, pending, api, P, cellAt, syncCells, resync }); // for tests and diagnostics
 refreshUi(); start();
})();
