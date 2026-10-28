'use strict';
// Squats and push-ups on synthetic skeletons: counting logic only, not validation on real people.
const assert = require('assert'), { PoseSwingDetector } = require('../dist/pose-swing.js'), { STEP, squatSkeleton, pushupSkeleton } = require('./skeleton.cjs');
const cos = (t, period, a, b) => (a + b) / 2 + (a - b) / 2 * Math.cos(2 * Math.PI * t / period); // starts at a (up), dips to b
const kinds = {
 squat: { make: (v, o) => squatSkeleton({ drop: -v, ...o }), up: 0, down: -.7, partial: -.12, period: 2200, loss: { visibility: .1 } },
 pushup: { make: (v, o) => pushupSkeleton({ h: v, ...o }), up: 1.6, down: .45, partial: 1.3, period: 1800, loss: { wrists: 'none' } }
};
for (const [name, k] of Object.entries(kinds)) {
 const log = { swings: [], cal: [], params: null }, d = new PoseSwingDetector({ onSwing: t => log.swings.push(t), onCalibration: (n, of) => log.cal.push(n + '/' + of), onCalibrated: p => { log.params = p } }, { exercise: name });
 let now = 0; const run = (ms, f) => { const end = now + ms; for (; now < end; now += STEP) d.update(f(now), now, 4 / 3) };
 const rep = (n, o = {}) => { const t0 = now; run(k.period * n, t => k.make(cos(t - t0, k.period, k.up, o.down ?? k.down), o.skel)) }, hold = (ms, v = k.up, skel) => run(ms, () => k.make(v, skel));
 d.startCalibration(); hold(500); rep(3); rep(0.1); hold(400); assert.deepEqual(log.cal, ['1/3', '2/3', '3/3'], name + ' calibration progress'); assert(log.params && log.swings.length === 0, name + ' trials excluded');
 d.startPlay(); for (let i = 0; i < 5; i++) rep(1); hold(400); assert.equal(log.swings.length, 5, name + ': five full reps');
 const n = log.swings.length; for (let i = 0; i < 4; i++) rep(1, { down: k.partial }); hold(400); assert.equal(log.swings.length, n, name + ': shallow reps are not counted');
 hold(3000, k.down); assert.equal(log.swings.length, n, name + ': going down alone is not a rep'); hold(400, k.up); assert.equal(log.swings.length, n + 1, name + ': coming back up completes it');
 // Lost body points: no counting, specific status, and the unfinished cycle is dropped.
 const m = log.swings.length; hold(300, k.up); hold(500, k.down); run(1500, () => k.make(k.down, k.loss)); assert(['body_weak', 'hands_lost'].includes(d.status), name + ' status ' + d.status); hold(500, k.up); assert.equal(log.swings.length, m, name + ': nothing counted through a long loss');
 rep(1); assert.equal(log.swings.length, m + 1, name + ': counting resumes');
 // Camera moved sideways or the person walked away: suppressed with a status, then resumes.
 const c = log.swings.length; run(3000, t => k.make(cos(t, k.period, k.up, k.down), { [name === 'squat' ? 'cx' : 'cx']: .8 })); assert.equal(d.status, 'camera_moved', name + ' lateral move'); assert.equal(log.swings.length, c);
 hold(1500); rep(1); assert(log.swings.length > c, name + ': resumes after returning');
}
assert.throws(() => new PoseSwingDetector({}, { exercise: 'burpee' }), /unknown exercise/);
console.log('PASS: squat and push-up calibration 1/3-3/3, full reps counted, shallow reps/jitter-free holds ignored, lost points and sideways camera moves suppress counting.');
