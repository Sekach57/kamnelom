'use strict';
const assert = require('assert');
const { BuildWorld, BUILD_GRID, BUILD_MATERIALS, BUILD_SHAPES, BUILD_JOBS, BUILD_FACINGS } = require('../dist/build.js');
const { EXERCISE_WEIGHT } = require('../dist/gnome.js');
const reps = (w, job, n, material) => { let last; for (let i = 0; i < n; i++) last = w.rep(job, material); return last };

// The numbers from docs/BUILD_MODE.md.
assert.deepEqual(Object.fromEntries(Object.entries(BUILD_MATERIALS).map(([k, v]) => [k, v.dig])), { rubble: 4, sandstone: 6, brick: 8, stone: 10, marble: 16, obsidian: 25 });
assert.deepEqual(Object.fromEntries(Object.entries(BUILD_SHAPES).map(([k, v]) => [k, v.blocks])), { block: 1, stairs: 1, door: 2 });
assert.deepEqual([BUILD_JOBS.dig.exercise, BUILD_JOBS.haul.exercise, BUILD_JOBS.place.exercise], ['swing', 'pushup', 'squat']);
for (const j of Object.values(BUILD_JOBS)) assert(j.exercise in EXERCISE_WEIGHT, 'every job uses a known exercise');
assert.equal(BUILD_JOBS.haul.reps, 5); assert.equal(BUILD_JOBS.place.repsPerBlock, 20);
assert(BUILD_GRID.w > 1 && BUILD_GRID.d > 1 && BUILD_GRID.h > 1, 'the plot has width, depth and height');
assert.deepEqual(BUILD_FACINGS, ['n', 'e', 's', 'w']);

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
assert.deepEqual(w.plan(2, 0, 3, 'stone', 'block'), { ok: true }); assert.match(w.why('place'), /Stone/, 'tells what is missing');
w.site.stone = 1; assert.equal(w.why('place'), null);
e = reps(w, 'place', 19); assert.equal(e.done, false); assert.equal(w.site.stone, 0); assert.equal(w.cells['2,0,3'].built, false);
e = w.rep('place'); assert.equal(e.done, true); assert.equal(w.cells['2,0,3'].built, true); assert.equal(w.building, null);
assert.match(w.why('place'), /blueprint/, 'nothing left to build');

// A door is two blocks and 40 squats; stairs are one block and remember the way they rise.
w = new BuildWorld(); w.plan(5, 0, 4, 'marble', 'door', 'e'); w.site.marble = 1;
assert.match(w.why('place'), /Marble/, 'one block is not enough for a door'); w.site.marble = 2;
reps(w, 'place', 39); assert.equal(w.cells['5,0,4'].built, false); assert.equal(w.site.marble, 0); assert.equal(w.rep('place').done, true); assert.equal(w.cells['5,0,4'].facing, 'e');
w = new BuildWorld(); w.plan(1, 0, 1, 'brick', 'stairs', 'w'); assert.equal(w.cells['1,0,1'].facing, 'w'); w.site.brick = 1; reps(w, 'place', 20); assert.equal(w.cells['1,0,1'].built, true);
w = new BuildWorld(); w.plan(1, 0, 1, 'brick', 'stairs', 'up'); assert.equal(w.cells['1,0,1'].facing, 's', 'an unknown facing falls back to south');

// Progress survives switching jobs and materials.
w = new BuildWorld(); reps(w, 'dig', 6, 'stone'); reps(w, 'dig', 2, 'marble'); reps(w, 'dig', 4, 'stone');
assert.equal(w.mountain.stone, 1); assert.equal(w.digProgress.marble, 2);
reps(w, 'haul', 2); assert.equal(w.carrying, 'stone'); reps(w, 'dig', 1, 'brick'); reps(w, 'haul', 3); assert.equal(w.site.stone, 1);

// The blueprint is built from the lowest layer up, back to front, left to right, and skips what the site cannot afford yet.
w = new BuildWorld(); w.plan(4, 2, 0, 'stone', 'block'); w.plan(3, 0, 5, 'stone', 'block'); w.plan(1, 0, 2, 'marble', 'block'); w.plan(0, 0, 2, 'stone', 'block'); w.plan(7, 1, 0, 'stone', 'block');
assert.deepEqual(w.ghosts().map(c => [c.x, c.y, c.z].join()), ['0,0,2', '1,0,2', '3,0,5', '7,1,0', '4,2,0'], 'layer, then depth, then x');
w.site.marble = 1; assert.equal(w.target().material, 'marble', 'stone is missing, so the affordable marble goes first');
reps(w, 'place', 20); assert.equal(w.cells['1,0,2'].built, true); assert.equal(w.cells['0,0,2'].built, false);

// Haul picks the material the plan is short of; with no plan, the biggest pile.
w = new BuildWorld(); w.mountain.stone = 3; w.mountain.brick = 1; assert.equal(w.haulMaterial(), 'stone');
w.plan(0, 0, 0, 'brick', 'block'); assert.equal(w.haulMaterial(), 'brick'); w.site.brick = 1; assert.equal(w.haulMaterial(), 'stone', 'brick is already covered');

// Planning rules in 3D: cells at the same x and y but another z are different cells; ghosts are replaced, built pieces are not overwritten.
w = new BuildWorld(); w.plan(3, 0, 0, 'stone', 'block'); w.plan(3, 0, 1, 'stone', 'block'); assert.equal(Object.keys(w.cells).length, 2, 'depth makes a separate cell');
w.plan(3, 0, 0, 'marble', 'block'); assert.equal(w.cells['3,0,0'].material, 'marble', 'a ghost is replaced'); assert.equal(Object.keys(w.cells).length, 2);
w.plan(3, 0, 0, 'brick', 'door'); assert.equal(w.cells['3,0,0'].shape, 'door'); assert.equal(Object.keys(w.cells).length, 2);
assert.equal(w.occupant(3, 1, 0).shape, 'door', 'the door covers the layer above it'); assert.equal(w.occupant(3, 1, 1), null, 'but not the next row');
w.plan(3, 1, 0, 'stone', 'block'); assert.equal(Object.keys(w.cells).length, 2, 'a block planned above a door replaces the door');
w = new BuildWorld(); w.plan(3, 0, 2, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 20);
assert.equal(w.plan(3, 0, 2, 'marble', 'block').ok, false, 'built cell is occupied'); assert.equal(w.plan(3, 0, 2, 'marble', 'door').ok, false, 'a door cannot overlap a built cell');
assert.equal(w.cells['3,0,2'].material, 'stone'); assert.equal(w.plan(3, 1, 2, 'marble', 'block').ok, true, 'a block can sit on top of a built one');
const { w: GW, d: GD, h: GH } = BUILD_GRID;
for (const [x, y, z, s] of [[-1, 0, 0, 'block'], [GW, 0, 0, 'block'], [0, -1, 0, 'block'], [0, GH, 0, 'block'], [0, GH - 1, 0, 'door'], [0, 0, -1, 'block'], [0, 0, GD, 'block'], [1.5, 0, 0, 'block'], [0, 0, 'x', 'block']]) assert.equal(new BuildWorld().plan(x, y, z, 'stone', s).ok, false, `out of the plot ${x},${y},${z},${s}`);
assert.equal(new BuildWorld().plan(GW - 1, GH - 2, GD - 1, 'stone', 'door').ok, true, 'a door fits below the top layer, in the far corner');
assert.equal(new BuildWorld().plan(0, 0, 0, 'lava', 'block').ok, false); assert.equal(new BuildWorld().plan(0, 0, 0, 'stone', 'tower').ok, false);

// Taking apart: built pieces return their blocks for free; a ghost under construction returns the blocks already taken.
w = new BuildWorld(); w.plan(0, 0, 4, 'marble', 'door'); w.site.marble = 2; reps(w, 'place', 40);
assert.equal(w.site.marble, 0); const r = w.erase(0, 1, 4); assert.deepEqual([r.ok, r.removed], [true, 'built'], 'the upper layer finds the door'); assert.equal(w.site.marble, 2); assert.equal(Object.keys(w.cells).length, 0);
w = new BuildWorld(); w.plan(0, 0, 0, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 7);
assert.equal(w.site.stone, 0); assert.equal(w.erase(0, 0, 0).removed, 'plan'); assert.equal(w.site.stone, 1, 'blocks come back'); assert.equal(w.building, null); assert.equal(w.placeProgress, 0);
w.plan(0, 0, 0, 'stone', 'block'); reps(w, 'place', 3); w.plan(0, 0, 0, 'obsidian', 'block'); assert.equal(w.site.stone, 1, 'replacing a ghost under construction also refunds'); assert.equal(w.building, null);
assert.equal(new BuildWorld().erase(2, 2, 2).ok, false);

// Saving: a round trip keeps everything; damaged data is cleaned instead of trusted.
w = new BuildWorld(); reps(w, 'dig', 7, 'stone'); w.mountain.marble = 2; w.plan(0, 0, 0, 'stone', 'block'); w.plan(2, 0, 3, 'brick', 'stairs', 'w'); w.plan(5, 0, 6, 'marble', 'door', 'e'); w.plan(5, 2, 6, 'obsidian', 'block'); w.site.stone = 1; w.site.marble = 2;
reps(w, 'place', 20); reps(w, 'haul', 2);
const copy = BuildWorld.from(JSON.parse(JSON.stringify(w)));
assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(w)));
assert.equal(copy.carrying, 'marble'); assert.equal(copy.haulProgress, 2); assert.equal(copy.cells['0,0,0'].built, true); assert.equal(copy.cells['2,0,3'].facing, 'w');
w = new BuildWorld(); w.plan(0, 0, 0, 'stone', 'block'); w.site.stone = 1; reps(w, 'place', 5); const mid = BuildWorld.from(JSON.parse(JSON.stringify(w)));
assert.equal(mid.building, '0,0,0'); assert.equal(mid.placeProgress, 5); reps(mid, 'place', 15); assert.equal(mid.cells['0,0,0'].built, true, 'construction resumes after a reload');
assert.equal(BuildWorld.from(null).total(BuildWorld.from(undefined).mountain), 0); assert.equal(BuildWorld.from({ version: 1, mountain: { stone: 5 } }).mountain.stone, 0, 'the old flat save format is ignored');
const dirty = BuildWorld.from({ version: 2, mountain: { stone: -4, marble: 'x', brick: 3.5, rubble: 7, lava: 9 }, digProgress: { stone: 99 }, carrying: 'lava', haulProgress: 3, building: '9,9,9', placeProgress: 4,
 cells: [{ x: 0, y: 0, z: 0, material: 'stone', shape: 'block', built: true }, { x: 99, y: 0, z: 0, material: 'stone', shape: 'block' }, { x: 1, y: 0, z: 0, material: 'lava', shape: 'block' }, { x: 2, y: 0, z: 0, material: 'stone', shape: 'tower' }, { x: 3, y: 0, material: 'stone', shape: 'block' }, null, 'x'] });
assert.deepEqual([dirty.mountain.stone, dirty.mountain.marble, dirty.mountain.brick, dirty.mountain.rubble], [0, 0, 0, 7]); assert.equal(dirty.digProgress.stone, 9, 'progress never exceeds one block');
assert.equal(dirty.carrying, null); assert.equal(dirty.building, null); assert.deepEqual(Object.keys(dirty.cells), ['0,0,0'], 'a cell without a depth is dropped too');
assert(!('lava' in dirty.mountain));

console.log('PASS: build mode (3D plot): material hardness 4/6/8/10/16/25, haul 5, place 20 per block (door 40), piles, 3D blueprint order, progress kept across jobs, take apart, save and load.');
