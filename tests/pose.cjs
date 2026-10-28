'use strict';
// Counting logic on synthetic skeletons. Real iPhone video is still unvalidated.
const assert = require('assert');
const { PoseSwingDetector } = require('../dist/pose-swing.js');
const { STEP, ASPECT, TOP, BOTTOM, skeleton, wave } = require('./skeleton.cjs');

function rig(options) {
 const log = { swings: [], cal: [], rejects: [], params: null };
 const d = new PoseSwingDetector({
  onSwing: t => log.swings.push(t), onCalibration: (n, of) => log.cal.push(n + '/' + of),
  onReject: r => log.rejects.push(r), onCalibrated: p => { log.params = p }
 }, options);
 let now = 0; const statuses = new Set();
 const run = (ms, frame) => { const end = now + ms; for (; now < end; now += STEP) { const r = d.update(frame(now), now, ASPECT); statuses.add(r.status) } };
 const swing = (ms, o = {}) => { const t0 = now; run(ms, t => skeleton({ s: wave(t - t0, o.period ?? 1400, o.top ?? TOP, o.bottom ?? BOTTOM), ...o.skel })) };
 const hold = (ms, s = TOP, skel = {}) => run(ms, () => skeleton({ s, ...skel }));
 return { d, log, run, swing, hold, statuses, get now() { return now } };
}
function calibrated() { const r = rig(); r.d.startCalibration(); r.hold(500); r.swing(1400 * 3 + 100); r.hold(400); assert(r.log.params, 'calibrated'); r.d.startPlay(); r.log.swings.length = 0; return r }

// 1. Calibration: three trial swings, visible progress, nothing counted as a game swing.
{
 const r = rig(); r.d.startCalibration(); r.hold(500); r.swing(1400 * 3 + 100); r.hold(300);
 assert.deepEqual(r.log.cal, ['1/3', '2/3', '3/3'], 'progress 1/3 2/3 3/3');
 assert.equal(r.log.swings.length, 0, 'trial swings are not game swings');
 assert(r.log.params && Math.abs(r.log.params.amp - 1.2) < .25, 'amplitude learned from trials, got ' + (r.log.params && r.log.params.amp));
 assert(r.log.params.hi > r.log.params.lo, 'hysteresis band');
}
// 2. Normal cycles: one full swing = one count, regardless of how torso-normalised size differs.
for (const torso of [.18, .25, .33]) {
 const r = rig(); r.d.startCalibration(); r.hold(400, TOP, { torso }); r.swing(4500, { skel: { torso } }); r.hold(300, TOP, { torso }); r.d.startPlay();
 for (let i = 0; i < 6; i++) r.swing(1400, { skel: { torso } }); r.hold(300, TOP, { torso });
 assert.equal(r.log.swings.length, 6, 'six cycles at torso ' + torso);
}
// 3. Incomplete cycles never count: hands drop only part way, or stay at the bottom.
{
 const r = calibrated();
 for (let i = 0; i < 4; i++) r.swing(1400, { bottom: .5 });
 assert.equal(r.log.swings.length, 0, 'shallow swings are not counted');
 r.hold(300, TOP); r.hold(3000, BOTTOM); assert.equal(r.log.swings.length, 0, 'down alone is not a swing');
 r.hold(300, TOP); assert.equal(r.log.swings.length, 1, 'return to the top completes it');
}
// 4. Jitter near the top or bottom is ignored, in play and in calibration.
{
 const r = calibrated(); let k = 0; const noise = () => Math.sin(k++ * 12.9898) * .07;
 r.run(6000, () => skeleton({ s: TOP + noise() })); r.run(6000, () => skeleton({ s: .6 + noise() })); r.run(6000, () => skeleton({ s: BOTTOM + noise() }));
 assert.equal(r.log.swings.length, 0, 'jitter is not a swing');
 const c = rig(); c.d.startCalibration(); c.run(8000, () => skeleton({ s: .5 + Math.sin(k++ * 4.1) * .08 }));
 assert.deepEqual(c.log.cal, [], 'jitter does not advance calibration');
}
// 5. Wrist dropout. One hidden wrist keeps the cycle going; no usable wrist never invents a swing.
{
 const r = calibrated();
 r.swing(1400, { skel: { wrists: 'left' } }); r.swing(1400, { skel: { wrists: 'right' } }); r.swing(1400);
 assert.equal(r.log.swings.length, 3, 'a single visible wrist is enough');
 assert(r.d.status === 'ok');
 // Both wrists lost for longer than the loss limit while at the bottom: the cycle is discarded.
 r.hold(300, TOP); r.run(600, t => skeleton({ s: wave(t, 1400) })); r.hold(500, BOTTOM);
 r.run(1200, () => skeleton({ s: BOTTOM, wrists: 'none' })); assert.equal(r.d.status, 'hands_lost');
 r.hold(600, TOP); assert.equal(r.log.swings.length, 3 + 0, 'cycle interrupted by a long loss is not completed by guessing');
 r.swing(1400); assert.equal(r.log.swings.length, 4, 'counting resumes with a fresh cycle');
}
// 6. Wrong confidence: confident-looking coordinates with low visibility must not count.
{
 const r = calibrated();
 for (let i = 0; i < 4; i++) r.swing(1400, { skel: { visibility: .2 } });
 assert.equal(r.log.swings.length, 0, 'low-visibility wrists produce no swings'); assert.equal(r.d.status, 'hands_lost');
 const o = calibrated(); o.run(1000, () => skeleton({ s: 1.4, hipY: .5 }).map(p => p)); // sanity: valid frames
 o.run(500, () => { const lm = skeleton({ s: BOTTOM }); lm[15].y = lm[16].y = 1.2; return lm }); assert.equal(o.d.status, 'hands_outside', 'wrists below the frame');
 const h = calibrated(); h.run(300, () => { const lm = skeleton({ s: TOP }); lm[23].y = lm[24].y = 1.1; return lm }); assert.equal(h.d.status, 'out_of_frame');
 const n = calibrated(); n.run(300, () => null); assert.equal(n.d.status, 'no_person');
 const f = calibrated(); f.run(300, () => skeleton({ s: TOP, torso: .05 })); assert.equal(f.d.status, 'too_far');
}
// 7. Pause: reset in the middle of a cycle discards it.
{
 const r = calibrated(); r.hold(200, TOP); r.hold(600, BOTTOM); r.d.reset(); r.hold(3000, BOTTOM); r.hold(200, TOP);
 assert.equal(r.log.swings.length, 0, 'unfinished cycle is dropped on pause'); r.swing(1400); assert.equal(r.log.swings.length, 1);
 // A gap in frames (page hidden without reset) is not bridged either.
 const g = calibrated(); g.hold(200, TOP); g.hold(500, BOTTOM); g.run(2000, () => null); g.hold(300, TOP);
 assert.equal(g.log.swings.length, 0);
}
// 8. Camera or person moved: counting is suppressed with an explicit status, then resumes.
{
 const r = calibrated(); r.swing(1400); assert.equal(r.log.swings.length, 1);
 r.run(3000, t => skeleton({ s: wave(t, 1400), torso: .13, cx: .5 })); assert(r.statuses.has('camera_moved'), 'size change is reported');
 assert.equal(r.log.swings.length, 1, 'no counting while the view changed');
 r.hold(1000, TOP); r.swing(1400); r.swing(1400); assert(r.log.swings.length >= 2, 'counting resumes after returning');
 const s = calibrated(); s.run(3000, t => skeleton({ s: wave(t, 1400), cx: .8, hipY: .75 })); assert.equal(s.d.status, 'camera_moved'); assert.equal(s.log.swings.length, 0, 'shifted view does not count');
}
// 9. Calibration rejects unusable trials with a reason, and does not complete.
{
 const r = rig(); r.d.startCalibration(); r.hold(300, .6); for (let i = 0; i < 4; i++) r.swing(1400, { top: .6, bottom: .3 });
 assert.equal(r.log.cal.length, 0, 'too small amplitude is not progress'); assert(r.log.rejects.includes('small'), 'reason reported');
 const f = rig(); f.d.startCalibration(); for (let i = 0; i < 6; i++) f.swing(300, { period: 300 });
 assert.equal(f.log.cal.length, 0, 'flailing too fast is not progress'); assert(f.log.rejects.includes('fast'), 'reason reported');
 assert.throws(() => new PoseSwingDetector().startPlay(), /not calibrated/);
}
console.log('PASS: calibration 1/3-3/3 excluded from game; cycles at several torso sizes; incomplete cycles, jitter, wrist dropout, low confidence, pause and camera move do not count. Synthetic skeletons only: real iPhone video is still unvalidated.');
