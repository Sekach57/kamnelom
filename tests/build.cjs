'use strict';
const assert = require('assert');
const { BuildWorld, BUILD_GRID, BUILD_MATERIALS, BUILD_SHAPES, BUILD_JOBS } = require('../dist/build.js');
const { EXERCISE_WEIGHT } = require('../dist/gnome.js');
const reps = (w, job, n, material) => { let last; for (let i = 0; i < n; i++) last = w.rep(job, material); return last };

// The numbers from docs/BUILD_MODE.md.
assert.deepEqual(Object.fromEntries(Object.entries(BUILD_MATERIALS).map(([k, v]) => [k, v.dig])), { rubble: 4, sandstone: 6, brick: 8, stone: 10, marble: 16, obsidian: 25 });
assert.deepEqual(Object.fromEntries(Object.entries(BUILD_SHAPES).map(([k, v]) => [k, v.blocks])), { block: 1, stairs: 1, door: 2 });
assert.deepEqual([BUILD_JOBS.dig.exercise, BUILD_JOBS.haul.exercise, BUILD_JOBS.place.exercise], ['swing', 'pushup', 'squat']);
for (const j of Object.values(BUILD_JOBS)) assert(j.exercise in EXERCISE_WEIGHT, 'every job uses a known exercise');
assert.equal(BUILD_JOBS.haul.reps, 5); assert.equal(BUILD_JOBS.place.repsPerBlock, 20);

// Digging: each material takes its own number of swings; one rep early gives nothing.
for (const [m, { dig }] of Object.entries(BUILD_MATERIALS)) {
 const w = new BuildWorld(); const e = reps(w, 'dig', dig - 1, m);
 assert.equal(w.mountain[m], 0, m + ': not a rep early'); assert.equal(e.done, false); assert.equal(e.progress, dig - 1);
 const last = w.rep('dig', m); assert.equal(last.done, true); assert.equal(w.mountain[m], 1); assert.equal(w.digProgress[m], 0);
 reps(w, 'dig', dig, m); assert.equal(w.mountain[m], 2, m + ': the next block starts from zero');
}
assert.equal(new BuildWorld().rep('dig', 'gold').type, 'blocked', 'unknown material');

// Hauling needs a block at the mountain; the block is in the gnome's hands until the fifth push-up.
let w = new BuildWorld();
assert.equal(w.why('haul'), 'Nothing to haul: dig first.'); assert.equal(w.rep('haul').type, 'blocked'); assert.equal(w.reps.haul, 0, 'a blocked rep is not counted');
reps(w, 'dig', 10, 'stone');
let e = reps(w, 'haul', 4); assert.equal(e.done, false); assert.equal(w.mountain.stone, 0, 'taken from the pile when the carry starts'); assert.equal(w.site.stone, 0); assert.equal(w.carrying, 'stone');
e = w.rep('haul'); assert.equal(e.done, true); assert.equal(w.site.stone, 1); assert.equal(w.carrying, null); assert.equal(w.reps.haul, 5);

// Placing needs a plan and blocks at the site; a block costs 20 squats.
w = new BuildWorld(); assert.match(w.why('place'), /blueprint/);
assert.deepEqual(w.plan(2, 0, 'stone', 'block'), { ok: true }); assert.match(w.why('place'), /Stone/, 'tells what is missing');
w.site.stone = 1; assert.equal(w.why('place'), null);
e = reps(w, 'place', 19); assert.equal(e.done, false); assert.equal(w.site.stone, 0); assert.equal(w.cells['2,0'].built, false);
e = w.rep('place'); assert.equal(e.done, true); assert.equal(w.cells['2,0'].built, true); assert.equal(w.building, null);
assert.match(w.why('place'), /blueprint/, 'nothing left to build');

// A door is two blocks and 40 squats; stairs are one block.
w = new BuildWorld(); w.plan(5, 0, 'marble', 'door'); w.site.marble = 1;
assert.match(w.why('place'), /Marble/, 'one block is not enough for a door'); w.site.marble = 2;
reps(w, 'place', 39); assert.equal(w.cells['5,0'].built, false); assert.equal(w.site.marble, 0); assert.equal(w.rep('place').done, true);
w = new BuildWorld(); w.plan(1, 0, 'brick', 'stairs', 'l'); assert.equal(w.cells['1,0'].facing, 'l'); w.site.brick = 1; reps(w, 'place', 20); assert.equal(w.cells['1,0'].built, true);

// Progress survives switching jobs and materials.
w = new BuildWorld(); reps(w, 'dig', 6, 'stone'); reps(w, 'dig', 2, 'marble'); reps(w, 'dig', 4, 'stone');
assert.equal(w.mountain.stone, 1); assert.equal(w.digProgress.marble, 2);
reps(w, 'haul', 2); assert.equal(w.carrying, 'stone'); reps(w, 'dig', 1, 'brick'); reps(w, 'haul', 3); assert.equal(w.site.stone, 1);

// The blueprint is built bottom row first, left to right, and skips what the site cannot afford yet.
w = new BuildWorld(); w.plan(4, 2, 'stone', 'block'); w.plan(1, 0, 'marble', 'block'); w.plan(0, 0, 'stone', 'block');
assert.deepEqual(w.ghosts().map(c => c.x + ',' + c.y), ['0,0', '1,0', '4,2']);
w.site.marble = 1; assert.equal(w.target().material, 'marble', 'stone is missing, so the affordable marble goes first');
reps(w, 'place', 20); assert.equal(w.cells['1,0'].built, true); assert.equal(w.cells['0,0'].built, false);

// Haul picks the material the plan is short of; with no plan, the biggest pile.
w = new BuildWorld(); w.mountain.stone = 3; w.mountain.brick = 1; assert.equal(w.haulMaterial(), 'stone');
w.plan(0, 0, 'brick', 'block'); assert.equal(w.haulMaterial(), 'brick'); w.site.brick = 1; assert.equal(w.haulMaterial(), 'stone', 'brick is already covered');

// Planning rules: replace ghosts, never overwrite built pieces, stay inside the grid.
w = new BuildWorld(); w.plan(3, 0, 'stone', 'block'); w.plan(3, 0, 'marble', 'block'); assert.equal(w.cells['3,0'].material, 'marble', 'a ghost is replaced');
w.plan(3, 0, 'brick', 'door'); assert.equal(w.cells['3,0'].shape, 'door'); assert.equal(Object.keys(w.cells).length, 1);
assert.equal(w.occupant(3, 1).shape, 'door', 'the door covers the cell above it'); w.plan(3, 1, 'stone', 'block'); assert.equal(Object.keys(w.cells).length, 1, 'a block planned above a door replaces the door');
w = new BuildWorld(); w.plan(3, 0, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 20);
assert.equal(w.plan(3, 0, 'marble', 'block').ok, false, 'built cell is occupied'); assert.equal(w.plan(3, 0, 'marble', 'door').ok, false, 'a door cannot overlap a built cell');
assert.equal(w.cells['3,0'].material, 'stone');
for (const [x, y, s] of [[-1, 0, 'block'], [BUILD_GRID.w, 0, 'block'], [0, -1, 'block'], [0, BUILD_GRID.h, 'block'], [0, BUILD_GRID.h - 1, 'door'], [1.5, 0, 'block']]) assert.equal(new BuildWorld().plan(x, y, 'stone', s).ok, false, `out of grid ${x},${y},${s}`);
assert.equal(new BuildWorld().plan(0, BUILD_GRID.h - 2, 'stone', 'door').ok, true, 'a door fits below the top row');
assert.equal(new BuildWorld().plan(0, 0, 'lava', 'block').ok, false); assert.equal(new BuildWorld().plan(0, 0, 'stone', 'tower').ok, false);

// Taking apart: built pieces return their blocks for free; a ghost under construction returns the blocks already taken.
w = new BuildWorld(); w.plan(0, 0, 'marble', 'door'); w.site.marble = 2; reps(w, 'place', 40);
assert.equal(w.site.marble, 0); const r = w.erase(0, 1); assert.deepEqual([r.ok, r.removed], [true, 'built'], 'the upper cell finds the door'); assert.equal(w.site.marble, 2); assert.equal(Object.keys(w.cells).length, 0);
w = new BuildWorld(); w.plan(0, 0, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 7);
assert.equal(w.site.stone, 0); assert.equal(w.erase(0, 0).removed, 'plan'); assert.equal(w.site.stone, 1, 'blocks come back'); assert.equal(w.building, null); assert.equal(w.placeProgress, 0);
w.plan(0, 0, 'stone', 'block'); reps(w, 'place', 3); w.plan(0, 0, 'obsidian', 'block'); assert.equal(w.site.stone, 1, 'replacing a ghost under construction also refunds'); assert.equal(w.building, null);
assert.equal(new BuildWorld().erase(2, 2).ok, false);

// Saving: a round trip keeps everything; damaged data is cleaned instead of trusted.
w = new BuildWorld(); reps(w, 'dig', 7, 'stone'); w.mountain.marble = 2; w.plan(0, 0, 'stone', 'block'); w.plan(2, 0, 'brick', 'stairs', 'l'); w.plan(5, 0, 'marble', 'door'); w.site.stone = 1; w.site.marble = 2;
reps(w, 'place', 20); reps(w, 'haul', 2); reps(w, 'place', 0);
const copy = BuildWorld.from(JSON.parse(JSON.stringify(w)));
assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(w)));
assert.equal(copy.carrying, 'marble'); assert.equal(copy.haulProgress, 2); assert.equal(copy.cells['0,0'].built, true);
w = new BuildWorld(); w.plan(0, 0, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 5); const mid = BuildWorld.from(JSON.parse(JSON.stringify(w)));
assert.equal(mid.building, '0,0'); assert.equal(mid.placeProgress, 5); reps(mid, 'place', 15); assert.equal(mid.cells['0,0'].built, true, 'construction resumes after a reload');
assert.equal(BuildWorld.from(null).total(BuildWorld.from(undefined).mountain), 0); assert.equal(BuildWorld.from({ version: 99, mountain: { stone: 5 } }).mountain.stone, 0, 'unknown version is ignored');
const dirty = BuildWorld.from({ version: 1, mountain: { stone: -4, marble: 'x', brick: 3.5, rubble: 7, lava: 9 }, digProgress: { stone: 99 }, carrying: 'lava', haulProgress: 3, building: '9,9', placeProgress: 4,
 cells: [{ x: 0, y: 0, material: 'stone', shape: 'block', built: true }, { x: 99, y: 0, material: 'stone', shape: 'block' }, { x: 1, y: 0, material: 'lava', shape: 'block' }, { x: 2, y: 0, material: 'stone', shape: 'tower' }, null, 'x'] });
assert.deepEqual([dirty.mountain.stone, dirty.mountain.marble, dirty.mountain.brick, dirty.mountain.rubble], [0, 0, 0, 7]); assert.equal(dirty.digProgress.stone, 9, 'progress never exceeds one block');
assert.equal(dirty.carrying, null); assert.equal(dirty.building, null); assert.deepEqual(Object.keys(dirty.cells), ['0,0']);
assert(!('lava' in dirty.mountain));

console.log('PASS: build mode: material hardness 4/6/8/10/16/25, haul 5, place 20 per block (door 40), piles, blueprint order, progress kept across jobs, take apart, save and load.');
