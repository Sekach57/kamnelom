const assert = require('assert'), harness = require('./harness.cjs'), { skeleton, wave, TOP, BOTTOM } = require('./skeleton.cjs');
const stand = () => skeleton({ s: TOP }), swingAt = t0 => t => skeleton({ s: wave(t - t0, 1400) });
const cycles = (h, n, o) => { const t0 = h.time; h.advance(1400 * n + 100, t => skeleton({ s: wave(t - t0, 1400), ...o })); h.landmarks = stand(); h.advance(300) };
(async () => {
 // --- happy path: front camera, model, 1/3-2/3-3/3, green, auto-start, trials excluded ---
 {
  const h = harness(), run = h.run;
  await run('openCamera()'); assert.equal(h.requests[0].video.facingMode.exact, 'user'); assert.equal(h.requests[0].audio, false);
  assert.equal(h.loads, 1, 'model loaded once'); assert.equal(run('calibration.state'), 'positioning'); assert.equal(run('mode'), 'idle');
  assert.equal(h.el('checkSwing').disabled, true, 'button waits until the body is seen');
  h.landmarks = null; h.advance(600); assert.equal(h.el('checkSwing').disabled, true); assert.equal(h.el('gateHint').hidden, false, 'yellow hint when nobody is visible');
  h.landmarks = stand(); h.advance(600); assert.equal(h.el('checkSwing').disabled, false); assert.equal(h.el('gateHint').hidden, true);
  run("$('checkSwing').onclick()"); assert.equal(run('calibration.state'), 'countdown'); h.advance(2900); assert.equal(run('calibration.state'), 'countdown'); h.advance(200);
  assert.equal(run('calibration.state'), 'checking'); assert.equal(run('detector.mode'), 'calibrating');
  const seen = []; const t0 = h.time; for (let i = 0; i < 140 && run('calibration.state') === 'checking'; i++) { h.landmarks = skeleton({ s: wave(h.time - t0, 1400) }); h.step(); seen.push(run('calibration.done')) }
  assert.deepEqual([...new Set(seen)].filter(Boolean), [1, 2, 3], 'progress 1/3, 2/3, 3/3 got ' + JSON.stringify(seen)); assert.equal(run('calibration.state'), 'success'); assert.equal(run('count'), 0, 'trial swings are not game swings'); assert.equal(run('mode'), 'idle');
  h.landmarks = stand(); h.advance(1700); assert.equal(run('mode'), 'camera'); assert.equal(h.el('main').inert, false); assert.equal(run('count'), 0); assert.equal(run('detector.mode'), 'playing');
  cycles(h, 2); assert.equal(run('count'), 2, 'one full cycle = one hit');
  // Hands lost in the game: yellow hint, no hits; the unfinished cycle is dropped.
  const before = run('count'); h.landmarks = skeleton({ s: TOP, wrists: 'none' }); h.advance(1500); assert.equal(h.el('poseHint').hidden, false); assert(h.el('poseHint').textContent.includes('запястья'));
  h.landmarks = stand(); h.advance(600); assert.equal(h.el('poseHint').hidden, true); assert.equal(run('count'), before);
  // Pause: frames are not processed and the cycle is dropped.
  run("$('pause').onclick()"); const p = run('tracker.stats.processed'); h.advance(2000, swingAt(h.time)); assert.equal(run('tracker.stats.processed'), p, 'no inference while paused'); assert.equal(run('count'), before);
  run("$('pause').onclick()"); cycles(h, 1); assert.equal(run('count'), before + 1);
  // Background: paused, no inference.
  h.sandbox.document.hidden = true; h.listeners.visibilitychange(); assert.equal(run('paused'), true); const q = run('tracker.stats.processed'); h.advance(1000, swingAt(h.time)); assert.equal(run('tracker.stats.processed'), q); h.sandbox.document.hidden = false;
  // Close releases the camera.
  run("$('reset').onclick()"); assert.equal(run('stream'), null); assert(h.stopped > 0); assert.equal(run('mode'), 'idle');
 }
 // --- timeout: nothing recognised, red state with a concrete hint and retry from 0/3 ---
 {
  const h = harness(), run = h.run; await run('openCamera()'); h.landmarks = stand(); h.advance(600); run("$('checkSwing').onclick()"); h.advance(3100);
  h.landmarks = skeleton({ s: TOP, wrists: 'none' }); h.advance(41000);
  assert.equal(run('calibration.state'), 'failed'); assert.equal(run('mode'), 'idle'); assert.equal(h.el('checkSwing').hidden, false); assert(h.el('gateMessage').textContent.includes('запястья'), 'specific hint: ' + h.el('gateMessage').textContent);
  assert.equal(run('count'), 0); h.landmarks = stand(); h.advance(300); run("$('checkSwing').onclick()"); assert.equal(run('calibration.done'), 0, 'retry starts from 0/3');
  run("$('closeCalibration').onclick()"); assert.equal(run('stream'), null); assert(h.stopped > 0); assert.equal(h.el('calibrationPanel').hidden, true);
 }
 // --- model fails to load: explicit error with retry, camera stays on, no optical-flow fallback ---
 {
  let fail = true; const h = harness({ loadModel: async () => { if (fail) throw Object.assign(new Error('network'), { stage: 'model' }) } }), run = h.run;
  await run('openCamera()'); assert.equal(run('calibration.state'), 'modelError'); assert.equal(h.el('retryModel').hidden, false); assert.equal(run('mode'), 'idle'); assert.equal(h.stopped, 0, 'camera stays on for the retry');
  h.landmarks = skeleton({ s: TOP }); h.advance(1000); assert.equal(run('tracker.stats.processed'), 0, 'nothing is detected without the model'); assert.equal(run('calibration.state'), 'modelError');
  fail = false; await run("$('retryModel').onclick()"); await new Promise(r => setTimeout(r, 0)); assert.equal(run('calibration.state'), 'positioning'); assert.equal(h.loads, 2); assert.equal(h.el('retryModel').hidden, true);
 }
 // --- inference keeps throwing: stop with a visible error instead of guessing ---
 {
  const h = harness(), run = h.run; await run('openCamera()'); h.landmarks = stand(); h.advance(300); h.detectError = true; h.advance(600); assert.equal(run('calibration.state'), 'modelError'); assert.equal(run('count'), 0);
 }
 // --- cancel while the camera permission is pending; late stream is released ---
 {
  const h = harness(), run = h.run; let resolve; h.sandbox.navigator.mediaDevices.getUserMedia = () => new Promise(r => resolve = r);
  const pending = run('openCamera()'); run("$('closeCalibration').onclick()"); const prior = h.stopped; resolve(h.stream); await pending; assert(h.stopped > prior); assert.equal(run('calibration.state'), 'idle'); assert.equal(run('stream'), null);
 }
 // --- denied permission ---
 {
  const h = harness(), run = h.run; h.sandbox.navigator.mediaDevices.getUserMedia = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e };
  await run('openCamera()'); assert.equal(run('calibration.state'), 'error'); assert.equal(h.el('retryCamera').hidden, false); assert.equal(run('mode'), 'idle');
 }
 console.log('PASS: front camera + local model; 1/3-2/3-3/3 trial progress; green before auto-start; trials excluded; yellow hint on lost hands; pause/background stop inference; timeout red with hint and retry from 0/3; model failure shows retry without fallback; cancel and late camera cleanup.');
})().catch(e => { console.error(e); process.exitCode = 1 });
