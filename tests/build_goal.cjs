const assert = require('assert'), harness = require('./harness.cjs'), { squatSkeleton } = require('./skeleton.cjs');
// The goal of a session: BOULDER (default) hits the boulder; BUILD sends every real rep to the build screen instead. Synthetic skeletons: logic only.
const cos = (t, period, a, b) => (a + b) / 2 + (a - b) / 2 * Math.cos(2 * Math.PI * t / period);
const k = { make: v => squatSkeleton({ drop: -v }), up: 0, down: -.7, period: 2200 };
async function session(h, reps) { // calibration, then `reps` full squats
 const run = h.run; h.el('exSquat').onclick(); await run('openCamera()'); h.landmarks = k.make(k.up); h.advance(600);
 run("$('checkSwing').onclick()"); h.advance(3100);
 let t0 = h.time; for (let i = 0; i < 200 && run('calibration.state') === 'checking'; i++) { h.landmarks = k.make(cos(h.time - t0, k.period, k.up, k.down)); h.step() }
 assert.equal(run('calibration.state'), 'success'); h.landmarks = k.make(k.up); h.advance(1800); assert.equal(run('mode'), 'camera');
 t0 = h.time; h.advance(k.period * reps + 200, t => k.make(cos(t - t0, k.period, k.up, k.down))); h.landmarks = k.make(k.up); h.advance(600);
}
const spy = h => { // in a browser window.x is the global x; the test sandbox keeps them apart, so set both
 const log = { reps: [], live: [] }, rep = ex => log.reps.push(ex), live = (on, ex) => log.live.push(ex === undefined ? [on] : [on, ex]);
 h.sandbox.window.buildCameraRep = h.sandbox.buildCameraRep = rep; h.sandbox.window.buildLive = h.sandbox.buildLive = live; return log };
(async () => {
 const store = {};
 // Default goal: the boulder takes every rep, the build screen hears nothing.
 let h = harness({ store }), log = spy(h); assert.equal(h.run('goal'), 'boulder'); assert.equal(h.el('goalBoulder').getAttribute, undefined, 'fake element');
 await session(h, 3); assert.equal(h.run('count'), 3); assert.equal(h.run('hp'), 20 - 3, 'boulder mode: damage as before'); assert.deepEqual(log.reps, []); assert.equal(h.run('currentView'), 'play', 'stays on the Play screen');
 // BUILD: practice reps never arrive, real reps go to the build screen, the boulder is untouched, points still count.
 h = harness({ store }); log = spy(h); const points = h.run('repState.pending.squat || 0'); h.el('goalBuild').onclick(); assert.equal(h.run('goal'), 'build'); assert.equal(store['dwarfgym.goal'], 'build', 'the choice is remembered');
 await session(h, 4);
 assert.deepEqual(log.reps, ['squat', 'squat', 'squat', 'squat'], 'four real reps, no practice reps'); assert.deepEqual(log.live[log.live.length - 1], [true, 'squat'], 'the build screen is told the session is live');
 assert.equal(h.run('currentView'), 'build', 'the app moves to the build screen'); assert.equal(h.run('hp'), 20, 'the boulder is not hit'); assert.equal(h.run('count'), 4); assert.equal(h.run('repState.pending.squat') - points, 4, 'reps still count for points');
 // Pause stops counting, exit ends the session and tells the build screen.
 h.el('pause').onclick(); assert.equal(h.run('paused'), true); h.run('swing(' + (h.time + 5000) + ')'); assert.equal(log.reps.length, 4, 'paused: nothing counted');
 h.el('reset').onclick(); assert.equal(h.run('mode'), 'idle'); assert.deepEqual(log.live[log.live.length - 1], [false], 'exit ends the live session');
 // Switching the goal back ends a running session.
 h = harness({ store }); log = spy(h); await session(h, 1); assert.equal(h.run('currentView'), 'build'); h.el('goalBoulder').onclick(); assert.equal(h.run('goal'), 'boulder'); assert.equal(h.run('mode'), 'idle'); assert.equal(h.run('stream'), null);
 // The big-screen modes keep the boulder: BUILD is for this device only.
 h = harness({ store: {} }); log = spy(h); h.run("role='screen'"); h.el('goalBuild').onclick(); assert.equal(h.run('goal'), 'boulder', 'BUILD is refused outside THIS DEVICE mode');
 console.log('PASS: goal BOULDER keeps hitting the boulder; goal BUILD sends real reps (not practice reps) to the build screen, leaves the boulder alone, still counts points, moves to the build screen, pauses and exits cleanly; BUILD refused in big-screen modes.');
})().catch(e => { console.error(e); process.exitCode = 1 });
