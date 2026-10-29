'use strict';
// Build mode logic (docs/BUILD_MODE.md): materials, shapes, two piles (at the mountain and at the site) and a blueprint.
// Pure state: no DOM, camera or timers, so it runs in Node tests. One call to rep() is one counted repetition.
// Grid: x to the right, y up (row 0 stands on the ground). A door is anchored at its bottom cell and covers two rows.
const BUILD_GRID = { w: 14, h: 10 };
// dig = swings needed to dig one block (hardness). Hauling and placing do not depend on the material.
const BUILD_MATERIALS = {
 rubble: { name: 'Rubble', dig: 4 }, sandstone: { name: 'Sandstone', dig: 6 }, brick: { name: 'Brick', dig: 8 },
 stone: { name: 'Stone', dig: 10 }, marble: { name: 'Marble', dig: 16 }, obsidian: { name: 'Obsidian', dig: 25 }
};
const BUILD_SHAPES = {
 block: { name: 'Block', blocks: 1, h: 1 }, stairs: { name: 'Stairs', blocks: 1, h: 1 }, door: { name: 'Door', blocks: 2, h: 2 }
};
// Each job is bound to one exercise. haul: reps per block; place: reps per block of the shape.
const BUILD_JOBS = {
 dig: { name: 'Dig', exercise: 'swing' },
 haul: { name: 'Haul', exercise: 'pushup', reps: 5 },
 place: { name: 'Build', exercise: 'squat', repsPerBlock: 20 }
};
const BUILD_VERSION = 1;
const buildKey = (x, y) => x + ',' + y;
const buildZero = () => Object.fromEntries(Object.keys(BUILD_MATERIALS).map(m => [m, 0]));
const buildCount = v => Number.isInteger(v) && v >= 0 ? Math.min(v, 1e6) : 0;
const buildFail = reason => ({ ok: false, reason });

class BuildWorld {
 constructor() { this.reset() }
 reset() {
  this.mountain = buildZero(); this.site = buildZero(); this.cells = {};
  this.digProgress = buildZero(); // progress is kept per material: switching material or job never erases effort
  this.carrying = null; this.haulProgress = 0; // a block taken from the mountain pile, on its way
  this.building = null; this.placeProgress = 0; // key of the ghost being built; its blocks are already taken from the site pile
  this.reps = { dig: 0, haul: 0, place: 0 };
 }
 // --- blueprint ---
 occupant(x, y) {
  for (const key in this.cells) { const c = this.cells[key]; if (c.x === x && y >= c.y && y < c.y + BUILD_SHAPES[c.shape].h) return c }
  return null;
 }
 // Draw a ghost. Overlapping ghosts are replaced; a built cell must be taken apart first.
 plan(x, y, material, shape, facing = 'r') {
  const s = BUILD_SHAPES[shape];
  if (!BUILD_MATERIALS[material]) return buildFail('Unknown material.');
  if (!s) return buildFail('Unknown shape.');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= BUILD_GRID.w || y < 0 || y + s.h > BUILD_GRID.h) return buildFail('Cannot build here.');
  const hit = new Set(); for (let i = 0; i < s.h; i++) { const c = this.occupant(x, y + i); if (c) hit.add(c) }
  for (const c of hit) if (c.built) return buildFail('Cell taken: take it apart first.');
  for (const c of hit) this.drop(c);
  this.cells[buildKey(x, y)] = { x, y, material, shape, facing: facing === 'l' ? 'l' : 'r', built: false };
  return { ok: true };
 }
 // Remove a ghost, or take a built piece apart: its blocks go back to the site pile, no exercise needed.
 erase(x, y) {
  const c = this.occupant(x, y); if (!c) return buildFail('Nothing here.');
  const built = c.built; this.drop(c);
  if (built) this.site[c.material] += BUILD_SHAPES[c.shape].blocks;
  return { ok: true, removed: built ? 'built' : 'plan', material: c.material, shape: c.shape };
 }
 drop(c) { const key = buildKey(c.x, c.y); if (this.building === key) this.cancelBuilding(); delete this.cells[key] }
 cancelBuilding() {
  const c = this.cells[this.building]; if (c) this.site[c.material] += BUILD_SHAPES[c.shape].blocks;
  this.building = null; this.placeProgress = 0;
 }
 // Unbuilt cells, bottom row first, then left to right.
 ghosts() { return Object.values(this.cells).filter(c => !c.built).sort((a, b) => a.y - b.y || a.x - b.x) }
 affordable(c) { return this.site[c.material] >= BUILD_SHAPES[c.shape].blocks }
 target() { return this.ghosts().find(c => this.affordable(c)) || null }
 // --- jobs ---
 total(pile) { return Object.values(pile).reduce((a, b) => a + b, 0) }
 // Material to carry next: what the blueprint is short of at the site first, otherwise the biggest pile.
 haulMaterial() {
  const short = {};
  for (const c of this.ghosts()) short[c.material] = (short[c.material] || 0) + BUILD_SHAPES[c.shape].blocks;
  for (const c of this.ghosts()) if (short[c.material] - this.site[c.material] > 0 && this.mountain[c.material] > 0) return c.material;
  let best = null; for (const m in BUILD_MATERIALS) if (this.mountain[m] > 0 && (best === null || this.mountain[m] > this.mountain[best])) best = m;
  return best;
 }
 // Reps needed for the job in progress (or the next one). material only matters for digging.
 need(job, material) {
  if (job === 'dig') return BUILD_MATERIALS[material]?.dig || 0;
  if (job === 'haul') return BUILD_JOBS.haul.reps;
  const c = this.cells[this.building] || this.target(); return (c ? BUILD_SHAPES[c.shape].blocks : 1) * BUILD_JOBS.place.repsPerBlock;
 }
 progress(job, material) { return job === 'dig' ? this.digProgress[material] || 0 : job === 'haul' ? this.haulProgress : this.placeProgress }
 // null when the job can be done, otherwise a short reason for the player.
 why(job) {
  if (job === 'dig') return null;
  if (job === 'haul') return this.carrying || this.total(this.mountain) > 0 ? null : 'Nothing to haul: dig first.';
  if (job === 'place') {
   if (this.building) return null;
   const g = this.ghosts(); if (!g.length) return 'No blueprint: draw what to build.';
   if (this.target()) return null;
   const need = [...new Set(g.filter(c => !this.affordable(c)).map(c => BUILD_MATERIALS[c.material].name))];
   return 'Not enough blocks at the site (' + need.join(', ') + '). Dig and haul.';
  }
  return 'Unknown job.';
 }
 // One counted repetition. Returns an event: { type: 'dig'|'haul'|'place', done, progress, need, ... } or { type: 'blocked', reason }.
 rep(job, material) {
  if (job === 'dig') {
   if (!BUILD_MATERIALS[material]) return { type: 'blocked', job, reason: 'Pick a material.' };
   const need = BUILD_MATERIALS[material].dig, p = ++this.digProgress[material]; this.reps.dig++;
   if (p < need) return { type: 'dig', material, done: false, progress: p, need };
   this.digProgress[material] = 0; this.mountain[material]++;
   return { type: 'dig', material, done: true, progress: need, need };
  }
  const reason = this.why(job); if (reason) return { type: 'blocked', job, reason };
  if (job === 'haul') {
   if (!this.carrying) { const m = this.haulMaterial(); this.mountain[m]--; this.carrying = m; this.haulProgress = 0 }
   const need = BUILD_JOBS.haul.reps, material = this.carrying, p = ++this.haulProgress; this.reps.haul++;
   if (p < need) return { type: 'haul', material, done: false, progress: p, need };
   this.site[material]++; this.carrying = null; this.haulProgress = 0;
   return { type: 'haul', material, done: true, progress: need, need };
  }
  if (!this.building) { const c = this.target(), key = buildKey(c.x, c.y); this.site[c.material] -= BUILD_SHAPES[c.shape].blocks; this.building = key; this.placeProgress = 0 }
  const key = this.building, c = this.cells[key], need = BUILD_SHAPES[c.shape].blocks * BUILD_JOBS.place.repsPerBlock, p = ++this.placeProgress; this.reps.place++;
  if (p < need) return { type: 'place', key, cell: c, done: false, progress: p, need };
  c.built = true; this.building = null; this.placeProgress = 0;
  return { type: 'place', key, cell: c, done: true, progress: need, need };
 }
 // --- saving ---
 toJSON() {
  return { version: BUILD_VERSION, mountain: { ...this.mountain }, site: { ...this.site }, digProgress: { ...this.digProgress }, carrying: this.carrying, haulProgress: this.haulProgress, building: this.building, placeProgress: this.placeProgress, reps: { ...this.reps }, cells: Object.values(this.cells).map(c => ({ ...c })) };
 }
 // Never trusts the input: unknown materials, shapes and out of grid cells are dropped, counters are clamped.
 static from(raw) {
  const w = new BuildWorld(); if (!raw || typeof raw !== 'object' || raw.version !== BUILD_VERSION) return w;
  for (const m in BUILD_MATERIALS) {
   w.mountain[m] = buildCount(raw.mountain?.[m]); w.site[m] = buildCount(raw.site?.[m]);
   w.digProgress[m] = Math.min(buildCount(raw.digProgress?.[m]), BUILD_MATERIALS[m].dig - 1);
  }
  for (const j in w.reps) w.reps[j] = buildCount(raw.reps?.[j]);
  for (const c of Array.isArray(raw.cells) ? raw.cells : []) {
   if (!c || typeof c !== 'object' || !BUILD_MATERIALS[c.material] || !BUILD_SHAPES[c.shape]) continue;
   const r = w.plan(c.x, c.y, c.material, c.shape, c.facing); if (r.ok && c.built === true) w.cells[buildKey(c.x, c.y)].built = true;
  }
  if (BUILD_MATERIALS[raw.carrying]) { w.carrying = raw.carrying; w.haulProgress = Math.min(buildCount(raw.haulProgress), BUILD_JOBS.haul.reps - 1) }
  const b = w.cells[raw.building]; if (b && !b.built) { w.building = raw.building; w.placeProgress = Math.min(buildCount(raw.placeProgress), BUILD_SHAPES[b.shape].blocks * BUILD_JOBS.place.repsPerBlock - 1) }
  return w;
 }
}
if (typeof module !== 'undefined') module.exports = { BuildWorld, BUILD_GRID, BUILD_MATERIALS, BUILD_SHAPES, BUILD_JOBS, BUILD_VERSION, buildKey };
