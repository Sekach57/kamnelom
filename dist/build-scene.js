'use strict';
// Build mode scene and controls (#/build). Draft: repetitions come from buttons, not from the camera.
// Needs build.js and gnome.js. Camera, detectors, saving and points are not connected yet (docs/BUILD_MODE.md).
(() => {
 const $ = id => document.getElementById(id), canvas = $('buildWorld');
 if (!canvas || typeof BuildWorld === 'undefined') return;
 const c = canvas.getContext('2d'), W = 800, H = 400, CELL = 24, GX = 450, GY = 340, GS = .5; // grid origin = bottom left corner, gnome scale
 const MOUNT_PILE = 235, SITE_PILE = 375, PILE_BLOCK = 14, CARRY_FROM = 255, CARRY_TO = 400, DIG_X_MIN = 70, DUR_FLY = .4;
 const EXERCISE = Object.fromEntries(Object.entries(BUILD_JOBS).map(([k, v]) => [k, v.exercise]));
 // Palettes: base, light edge, dark edge, texture style.
 const LOOK = {
  rubble: { base: '#7b7570', light: '#9d968f', dark: '#4f4a47', style: 'rubble' }, sandstone: { base: '#d3b178', light: '#e8cf9b', dark: '#a9844f', style: 'strata' },
  brick: { base: '#b0553a', light: '#cf7455', dark: '#7a3524', style: 'brick' }, stone: { base: '#6f7280', light: '#8d90a0', dark: '#474a57', style: 'ashlar' },
  marble: { base: '#e6e4ea', light: '#ffffff', dark: '#b4b1bd', style: 'marble' }, obsidian: { base: '#2a2438', light: '#5a4d7a', dark: '#15111f', style: 'glass' }
 };
 const VEINS = Object.fromEntries(['rubble', 'sandstone', 'brick', 'stone', 'marble', 'obsidian'].map((m, i) => [m, [24 + i * 27, 322]])); // ore along the floor of the mine gallery, in the order of hardness
 const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) };
 const S = { world: new BuildWorld(), job: 'dig', material: 'stone', shape: 'block', facing: 'r', tool: 'draw', gnome: { x: 380, dir: 1, bob: 0 }, repAt: -10, repJob: 'dig',
  fx: [], parts: [], fly: [], landing: {}, hover: null, auto: false, nextAuto: 0, toast: '', toastUntil: 0, shake: 0, last: 0, running: false };
 const now = () => performance.now() / 1000;
 const toast = text => { S.toast = text; S.toastUntil = now() + 3; $('buildToast').textContent = text };
 const cellPx = (x, y, h = 1) => [GX + x * CELL, GY - (y + h) * CELL]; // top left of a piece

 // --- drawing blocks ---
 function texture(x, y, w, h, m, seed) {
  const L = LOOK[m];
  if (L.style === 'brick') { c.fillStyle = L.dark; const rows = Math.round(h / 6); for (let r = 0; r < rows; r++) { c.fillRect(x, y + r * 6, w, 1); const off = r % 2 ? 6 : 0; for (let bx = off; bx < w; bx += 12) c.fillRect(x + bx, y + r * 6, 1, 6) } }
  else if (L.style === 'strata') { for (let r = 0; r < h; r += 5) { c.fillStyle = hash(seed + r) > .5 ? L.light : L.dark; c.globalAlpha *= .55; c.fillRect(x, y + r + 2, w, 2); c.globalAlpha /= .55 } }
  else if (L.style === 'ashlar') { c.fillStyle = L.dark; for (let r = 12; r < h; r += 12) c.fillRect(x, y + r, w, 1); c.fillRect(x + 8 + hash(seed) * 8, y, 1, 12); c.fillStyle = L.light; c.fillRect(x + 3, y + 4, 4, 1) }
  else if (L.style === 'rubble') { for (let i = 0; i < Math.round(w * h / 40); i++) { c.fillStyle = [L.light, L.dark, '#625c58'][i % 3]; c.fillRect(x + 1 + hash(seed + i) * (w - 5), y + 1 + hash(seed + i + 50) * (h - 5), 3 + (i % 3), 2 + (i % 2)) } }
  else if (L.style === 'marble') { c.strokeStyle = '#8e8aa0'; c.lineWidth = 1; c.beginPath(); for (let i = 0; i < Math.max(1, Math.round(h / 24)) + 1; i++) { const sy = y + 4 + i * 20; c.moveTo(x + 2, sy + 6); c.lineTo(x + w * .45, sy + 1); c.lineTo(x + w - 3, sy + 12) } c.stroke() }
  else { c.fillStyle = L.light; c.globalAlpha *= .6; c.beginPath(); c.moveTo(x + 4, y + h - 4); c.lineTo(x + 10, y + h - 4); c.lineTo(x + w - 4, y + 4); c.lineTo(x + w - 10, y + 4); c.fill(); c.globalAlpha /= .6 }
 }
 function block(x, y, w, h, m, seed = 0) {
  const L = LOOK[m]; x = Math.round(x); y = Math.round(y);
  c.fillStyle = L.base; c.fillRect(x, y, w, h); texture(x, y, w, h, m, seed);
  c.fillStyle = L.light; c.fillRect(x, y, w, 2); c.fillRect(x, y, 2, h); c.fillStyle = L.dark; c.fillRect(x, y + h - 2, w, 2); c.fillRect(x + w - 2, y, 2, h);
 }
 // Outline of a piece inside its box, used both for clipping and for the dashed ghost border.
 function outline(shape, facing, x, y, w, h) {
  c.beginPath();
  if (shape === 'stairs') {
   const p = [[0, h], [w, h], [w, 0], [w / 2, 0], [w / 2, h / 2], [0, h / 2]];
   p.forEach(([px, py], i) => { const X = x + (facing === 'l' ? w - px : px), Y = y + py; i ? c.lineTo(X, Y) : c.moveTo(X, Y) }); c.closePath();
  } else c.rect(x, y, w, h);
 }
 // alpha < 1 draws a ghost (planned piece).
 function piece(shape, m, facing, x, y, alpha = 1, seed = 0) {
  const h = BUILD_SHAPES[shape].h * CELL, L = LOOK[m]; c.save(); c.globalAlpha = alpha;
  if (shape === 'stairs') { c.save(); outline(shape, facing, x, y, CELL, h); c.clip(); block(x, y, CELL, h, m, seed); c.restore() }
  else { block(x, y, CELL, h, m, seed); if (shape === 'door') { c.fillStyle = L.dark; c.fillRect(x + 4, y + 6, CELL - 8, h - 6); c.fillRect(x + 6, y + 4, CELL - 12, 2); c.fillStyle = L.base; c.fillRect(x + 6, y + 8, CELL - 12, h - 10); c.fillStyle = L.light; c.fillRect(x + 6, y + 8, CELL - 12, 2); c.fillStyle = '#d8a24e'; c.fillRect(x + CELL - 10, y + h / 2, 3, 4) } }
  if (alpha < 1) { c.globalAlpha = .8; c.strokeStyle = '#ffffff'; c.setLineDash([3, 3]); c.lineWidth = 1; outline(shape, facing, x + .5, y + .5, CELL - 1, h - 1); c.stroke(); c.setLineDash([]) }
  c.restore();
 }
 // Pile slots: a small pyramid, five blocks in the bottom row.
 function slot(i) { let row = 0, n = 5; while (i >= n) { i -= n; row++; n-- } return [i * PILE_BLOCK + row * PILE_BLOCK / 2, row] }
 const pileTop = (x0, pile) => { const n = Math.min(S.world.total(pile), 15), [dx, row] = slot(Math.max(0, n - 1)); return [x0 + dx + PILE_BLOCK / 2, GY - (row + 1) * PILE_BLOCK] }
 function pile(x0, p) {
  let i = 0; const total = S.world.total(p);
  for (const m in BUILD_MATERIALS) for (let k = 0; k < p[m] && i < 15; k++, i++) { const [dx, row] = slot(i); block(x0 + dx, GY - (row + 1) * PILE_BLOCK, PILE_BLOCK, PILE_BLOCK, m, i) }
  if (total > 15) { c.fillStyle = '#f6eddd'; c.font = 'bold 11px system-ui,sans-serif'; c.textAlign = 'left'; c.fillText('+' + (total - 15), x0 + 2, GY - 5 * PILE_BLOCK - 4) }
 }

 // --- scene ---
 function backdrop(t) {
  c.fillStyle = '#282633'; c.fillRect(0, 0, W, H);
  for (const [pts, col] of [[[[0, 250], [90, 190], [180, 230], [280, 160], [380, 220], [500, 170], [600, 215], [700, 175], [800, 210], [800, 340], [0, 340]], '#2f2c3a'], [[[0, 300], [120, 245], [260, 285], [380, 250], [520, 290], [660, 255], [800, 285], [800, 340], [0, 340]], '#363244']]) {
   c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.fill();
  }
  // the mountain with a face of ore veins
  c.fillStyle = '#4a4553'; c.beginPath(); [[0, 340], [0, 50], [38, 36], [78, 86], [112, 104], [134, 148], [152, 200], [166, 252], [176, 300], [182, 340]].forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.fill();
  c.fillStyle = '#5a5463'; c.beginPath(); [[0, 50], [38, 36], [78, 86], [60, 120], [20, 100], [0, 130]].forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.fill();
  c.fillStyle = '#3b3744'; for (let i = 0; i < 14; i++) c.fillRect(hash(i) * 150, 90 + hash(i + 9) * 240, 6 + hash(i + 3) * 10, 3);
  c.fillStyle = '#2d2a35'; c.fillRect(0, 296, 181, GY - 296); c.fillStyle = '#25222b'; c.fillRect(0, 296, 181, 4); // the gallery
  for (const x of [8, 78, 150]) { c.fillStyle = '#765239'; c.fillRect(x, 296, 7, GY - 296); c.fillStyle = '#916445'; c.fillRect(x - 2, 294, 11, 5) }
  for (const m in VEINS) {
   const [vx, vy] = VEINS[m], sel = S.job === 'dig' && S.material === m; c.fillStyle = '#403c4a'; c.fillRect(vx - 12, vy - 20, 24, 24);
   for (let i = 0; i < 4; i++) block(vx - 10 + (i % 2) * 10, vy - 18 + Math.floor(i / 2) * 10, 9, 9, m, i + vx);
   if (sel) { c.strokeStyle = '#f7d36d'; c.lineWidth = 2; c.setLineDash([4, 3]); c.lineDashOffset = -t * 12; c.strokeRect(vx - 14, vy - 22, 28, 28); c.setLineDash([]) }
  }
  // field: grass over soil
  c.fillStyle = '#6c5146'; c.fillRect(0, GY, W, H - GY); c.fillStyle = '#58783f'; c.fillRect(0, GY, W, 7); c.fillStyle = '#6f9150'; c.fillRect(0, GY, W, 2);
  for (let i = 0; i < 70; i++) { c.fillStyle = ['#75554a', '#62494a', '#443b42'][i % 3]; c.fillRect(hash(i) * W, GY + 14 + hash(i + 90) * 44, 3 + Math.floor(hash(i + 8) * 10), 2) }
  for (let i = 0; i < 40; i++) { c.fillStyle = '#4a6a34'; c.fillRect(hash(i + 300) * W, GY - 2, 2, 3) }
 }
 function site(t) {
  const gw = BUILD_GRID.w * CELL, gh = BUILD_GRID.h * CELL;
  c.fillStyle = '#3d3640'; c.fillRect(GX - 6, GY, gw + 12, 8);
  c.strokeStyle = '#ffffff12'; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i <= BUILD_GRID.w; i++) { c.moveTo(GX + i * CELL + .5, GY - gh); c.lineTo(GX + i * CELL + .5, GY) }
  for (let j = 0; j <= BUILD_GRID.h; j++) { c.moveTo(GX, GY - j * CELL + .5); c.lineTo(GX + gw, GY - j * CELL + .5) }
  c.stroke();
  for (const key in S.world.cells) {
   const cell = S.world.cells[key], [px, py] = cellPx(cell.x, cell.y, BUILD_SHAPES[cell.shape].h), seed = cell.x * 7 + cell.y * 13;
   const hidden = (S.landing[key] ?? 0) > t; piece(cell.shape, cell.material, cell.facing, px, py, cell.built && !hidden ? 1 : .38, seed);
   if (S.world.building === key) { const k = S.world.placeProgress / S.world.need('place'); c.fillStyle = '#f7d36d'; c.fillRect(px, py - 5, Math.round(CELL * k), 3) }
  }
  if (S.hover && S.tool === 'draw') { const { x, y } = S.hover, h = BUILD_SHAPES[S.shape].h; if (y + h <= BUILD_GRID.h) { const [px, py] = cellPx(x, y, h); piece(S.shape, S.material, S.facing, px, py, .22) } }
  else if (S.hover) { const [px, py] = cellPx(S.hover.x, S.hover.y); c.strokeStyle = '#f67f82'; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2) }
 }
 function gnomeTarget() {
  const w = S.world;
  if (S.job === 'dig') return [Math.max(DIG_X_MIN, VEINS[S.material][0] + 42), -1];
  if (S.job === 'haul') return w.carrying ? [CARRY_FROM + (CARRY_TO - CARRY_FROM) * (w.haulProgress / BUILD_JOBS.haul.reps), 1] : [CARRY_FROM, -1];
  const cell = w.cells[w.building] || w.target(); return cell ? [GX + cell.x * CELL - 38, 1] : [GX - 70, 1];
 }
 function dwarf(t, dt) {
  const g = S.gnome, [tx, dir] = gnomeTarget(), d = tx - g.x, step = 150 * dt, walking = Math.abs(d) > 2;
  if (walking) { g.x += Math.sign(d) * Math.min(Math.abs(d), step); g.dir = Math.sign(d) } else { g.x = tx; g.dir = dir }
  if (!walking && S.job === 'haul') g.dir = S.world.carrying ? 1 : -1;
  g.bob = walking ? Math.abs(Math.sin(t * 14)) * 2 : 0;
  const ex = EXERCISE[S.job], phase = S.repJob === S.job ? t - S.repAt : -1, pose = gnomePose(ex, phase);
  c.save(); c.translate(Math.round(g.x), Math.round(GY + 2 - g.bob)); c.scale(g.dir * GS, GS); drawGnome(c, typeof myLook !== 'undefined' ? myLook : undefined, pose); c.restore();
  if (S.world.carrying) { // the block rests on the hands of the gnome
   const hand = ((pose.dx || 0) + (pose.hand ? pose.hand[0] : 51)) * GS; block(g.x + g.dir * (hand + 3) - 11, GY - 27 - g.bob, 22, 22, S.world.carrying, 3);
  }
 }
 const burst = (x, y, color, n = 8, power = 70) => { for (let i = 0; i < n; i++) S.parts.push({ x, y, vx: (Math.random() - .5) * power, vy: -Math.random() * power * .9, life: .5 + Math.random() * .4, age: 0, size: 2 + Math.floor(Math.random() * 3), color }) }
 function effects(t, dt) {
  for (const f of S.fx.slice()) if (t >= f.at) { S.fx.splice(S.fx.indexOf(f), 1); impact(f.ev, t) }
  for (const f of S.fly.slice()) {
   const k = (t - f.t0) / DUR_FLY; if (k >= 1) { S.fly.splice(S.fly.indexOf(f), 1); burst(f.to[0], f.to[1], LOOK[f.material].light, 6, 50); if (f.key) delete S.landing[f.key]; continue }
   const x = f.from[0] + (f.to[0] - f.from[0]) * k, y = f.from[1] + (f.to[1] - f.from[1]) * k - Math.sin(k * Math.PI) * 40; block(x - 11, y - 11, 22, 22, f.material, 5);
  }
  for (const p of S.parts.slice()) { p.age += dt; if (p.age > p.life) { S.parts.splice(S.parts.indexOf(p), 1); continue } p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt; c.fillStyle = p.color; c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size) }
 }
 // The moment the tool lands: sparks, and finished blocks fly to their place.
 function impact(ev, t) {
  const g = S.gnome;
  if (ev.type === 'dig') { const [vx, vy] = VEINS[ev.material]; burst(vx + 10, vy - 8, LOOK[ev.material].light, ev.done ? 12 : 5); S.shake = ev.done ? 3 : 1; if (ev.done) S.fly.push({ from: [vx, vy - 10], to: pileTop(MOUNT_PILE, S.world.mountain), material: ev.material, t0: t }) }
  else if (ev.type === 'haul' && ev.done) S.fly.push({ from: [g.x + g.dir * 30, GY - 30], to: pileTop(SITE_PILE, S.world.site), material: ev.material, t0: t });
  else if (ev.type === 'place') {
   const cell = ev.cell, [px, py] = cellPx(cell.x, cell.y, BUILD_SHAPES[cell.shape].h), to = [px + CELL / 2, py + BUILD_SHAPES[cell.shape].h * CELL / 2];
   if (ev.done) { S.fly.push({ from: [g.x + g.dir * 24, GY - 36], to, material: cell.material, t0: t, key: ev.key }); S.landing[ev.key] = t + DUR_FLY }
   else burst(to[0], to[1] + CELL / 2, LOOK[cell.material].light, 3, 40);
  }
 }

 // --- controls ---
 const jobText = { dig: 'Свинги', haul: 'Отжимания', place: 'Приседания' };
 function refresh() {
  const w = S.world, name = BUILD_MATERIALS[S.material].name;
  for (const b of document.querySelectorAll('[data-job]')) {
   const j = b.dataset.job, why = w.why(j); b.setAttribute('aria-pressed', String(j === S.job)); b.classList.toggle('blocked', !!why); b.title = why || '';
   b.querySelector('small').textContent = jobText[j] + (j === 'dig' ? ' · ' + BUILD_MATERIALS[S.material].dig + ' на блок' : j === 'haul' ? ' · ' + BUILD_JOBS.haul.reps + ' на блок' : ' · ' + BUILD_JOBS.place.repsPerBlock + ' на блок');
  }
  const why = w.why(S.job); $('buildReason').textContent = why || ''; $('buildRep').disabled = !!why;
  const need = w.need(S.job, S.material), done = w.progress(S.job, S.material);
  $('buildBar').style.width = (need ? Math.round(done / need * 100) : 0) + '%';
  $('buildProgress').textContent = (S.job === 'dig' ? name + ': ' : S.job === 'haul' && w.carrying ? BUILD_MATERIALS[w.carrying].name + ': ' : '') + done + ' / ' + need;
  for (const b of document.querySelectorAll('[data-material]')) b.setAttribute('aria-pressed', String(b.dataset.material === S.material));
  for (const b of document.querySelectorAll('[data-shape]')) b.setAttribute('aria-pressed', String(b.dataset.shape === S.shape));
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool));
  $('buildFacing').hidden = S.shape !== 'stairs'; $('buildFacing').textContent = S.facing === 'r' ? 'Подъём вправо ↗' : '↖ Подъём влево';
  for (const m in BUILD_MATERIALS) { const r = $('pile-' + m); if (r) { r.children[1].textContent = w.mountain[m] + (w.carrying === m ? ' (+1 в пути)' : ''); r.children[2].textContent = w.site[m] } }
  $('buildReps').textContent = 'Повторов: копать ' + w.reps.dig + ', тащить ' + w.reps.haul + ', строить ' + w.reps.place;
 }
 function rep() {
  const t = now(), ev = S.world.rep(S.job, S.material);
  if (ev.type === 'blocked') { toast(ev.reason); S.auto = false; $('buildAuto').checked = false; refresh(); return false }
  S.repAt = t; S.repJob = S.job; S.fx.push({ at: t + GNOME_TIMING[EXERCISE[S.job]].hit, ev });
  if (ev.type === 'place' && ev.done) S.landing[ev.key] = Infinity; // the cell stays a ghost until the block lands
  refresh(); return true;
 }
 // Demo autopilot: place if possible, otherwise haul, otherwise dig what the blueprint is short of.
 function autoJob() {
  const w = S.world;
  if (!w.why('place') && (w.building || w.target())) return 'place'; if (!w.why('haul')) return 'haul';
  const short = w.ghosts().find(g => w.site[g.material] + (w.carrying === g.material ? 1 : 0) < BUILD_SHAPES[g.shape].blocks); if (short) S.material = short.material; return 'dig';
 }
 function setJob(j) { S.job = j; refresh() }
 function frame(ts) {
  const t = ts / 1000, dt = Math.min(t - S.last, .1); S.last = t;
  if (S.auto && t >= S.nextAuto) { if (!S.world.ghosts().length && !S.world.building) { S.auto = false; $('buildAuto').checked = false; toast('Автопилоту нечего делать: нарисуй чертёж.') } else { S.job = autoJob(); rep(); S.nextAuto = t + .5 } }
  c.save(); if (S.shake > .05) { c.translate(Math.round(Math.sin(t * 99) * S.shake), Math.round(Math.cos(t * 83) * S.shake * .6)); S.shake *= .86 }
  backdrop(t); pile(MOUNT_PILE, S.world.mountain); pile(SITE_PILE, S.world.site); site(t); dwarf(t, dt); effects(t, dt); c.restore();
  if (S.toast && now() > S.toastUntil) { S.toast = ''; $('buildToast').textContent = '' }
  if (active()) requestAnimationFrame(frame); else S.running = false;
 }
 const active = () => /^#\/build/.test(location.hash) && !document.hidden;
 function start() { if (S.running || !active()) return; S.running = true; S.last = performance.now() / 1000; requestAnimationFrame(frame) }
 window.addEventListener('hashchange', start); document.addEventListener('visibilitychange', start);

 // build the controls
 const mats = $('buildMaterials'), piles = $('buildPiles');
 for (const [m, v] of Object.entries(BUILD_MATERIALS)) {
  const b = document.createElement('button'); b.dataset.material = m; b.className = 'swatch'; b.innerHTML = '<i style="background:' + LOOK[m].base + ';border-color:' + LOOK[m].light + '"></i><span>' + v.name + '</span><small>' + v.dig + ' свингов</small>';
  b.onclick = () => { S.material = m; refresh() }; mats.appendChild(b);
  const r = document.createElement('tr'); r.id = 'pile-' + m; r.innerHTML = '<td>' + v.name + '</td><td>0</td><td>0</td>'; piles.appendChild(r);
 }
 for (const b of document.querySelectorAll('[data-job]')) b.onclick = () => setJob(b.dataset.job);
 for (const b of document.querySelectorAll('[data-shape]')) b.onclick = () => { S.shape = b.dataset.shape; S.tool = 'draw'; refresh() };
 for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => { S.tool = b.dataset.tool; refresh() };
 $('buildFacing').onclick = () => { S.facing = S.facing === 'r' ? 'l' : 'r'; refresh() };
 $('buildRep').onclick = rep;
 $('buildAuto').onchange = () => { S.auto = $('buildAuto').checked; S.nextAuto = 0 };
 $('buildReset').onclick = () => { if (!confirm('Убрать всю стройку и все блоки?')) return; S.world = new BuildWorld(); S.landing = {}; S.fly = []; S.fx = []; S.auto = false; $('buildAuto').checked = false; refresh() };
 $('buildSample').onclick = () => { // a small hut: floor, two walls, a door, stairs and a roof
  const w = S.world, put = (x, y, m, s, f) => w.plan(x, y, m, s, f);
  for (let x = 1; x <= 7; x++) if (x !== 4) put(x, 0, 'stone', 'block'); put(4, 0, 'marble', 'door');
  for (const x of [1, 7]) for (const y of [1, 2]) put(x, y, 'brick', 'block');
  for (let x = 0; x <= 8; x++) put(x, 3, x % 2 ? 'sandstone' : 'rubble', 'block'); put(0, 0, 'stone', 'stairs', 'r'); put(8, 0, 'stone', 'stairs', 'l');
  refresh(); toast('Заготовка нарисована. Копай, тащи и строй, или включи автопилот.');
 };
 function cellAt(e) {
  const r = canvas.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width, py = (e.clientY - r.top) * H / r.height, x = Math.floor((px - GX) / CELL), y = Math.floor((GY - py) / CELL);
  return x >= 0 && x < BUILD_GRID.w && y >= 0 && y < BUILD_GRID.h ? { x, y } : null;
 }
 canvas.addEventListener('pointermove', e => { S.hover = cellAt(e) });
 canvas.addEventListener('pointerleave', () => { S.hover = null });
 canvas.addEventListener('pointerdown', e => {
  const p = cellAt(e); S.hover = p; if (!p) return;
  const r = S.tool === 'erase' ? S.world.erase(p.x, p.y) : S.world.plan(p.x, p.y, S.material, S.shape, S.facing);
  if (!r.ok) toast(r.reason); else if (r.removed === 'built') toast('Разобрано: блоки вернулись на стройку.');
  refresh();
 });
 refresh(); start();
})();
