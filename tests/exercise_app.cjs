const assert = require('assert'), harness = require('./harness.cjs'), { makeBroker } = require('./fakepeer.cjs'), { parseRoom } = require('../dist/remote.js'), { squatSkeleton, pushupSkeleton, STEP } = require('./skeleton.cjs'), { gnomeLook } = require('../dist/gnome.js');
const tick = () => new Promise(r => setTimeout(r, 0));
const cos = (t, period, a, b) => (a + b) / 2 + (a - b) / 2 * Math.cos(2 * Math.PI * t / period);
const kinds = { squat: { make: v => squatSkeleton({ drop: -v }), up: 0, down: -.7, period: 2200 }, pushup: { make: v => pushupSkeleton({ h: v }), up: 1.6, down: .45, period: 1800 } };
(async () => {
 for (const [name, k] of Object.entries(kinds)) {
  const h = harness(), run = h.run, tab = { squat: 'exSquat', pushup: 'exPushup' }[name];
  assert.equal(run('exercise'), 'swing'); h.el(tab).onclick(); assert.equal(run('exercise'), name); assert.equal(run('detector.kind'), name);
  assert(h.el('countLabel').textContent.includes(name === 'squat' ? 'SQUATS' : 'PUSH-UPS'), 'labels follow the exercise');
  await run('openCamera()'); assert(h.el('gateMessage').textContent.length > 20); h.landmarks = k.make(k.up); h.advance(600);
  assert(h.el('gateMessage').textContent.includes(name === 'squat' ? 'shoulders and hips' : 'hands'), 'instructions follow the exercise: ' + h.el('gateMessage').textContent);
  run("$('checkSwing').onclick()"); h.advance(3100); assert.equal(run('calibration.state'), 'checking');
  let t0 = h.time; for (let i = 0; i < 200 && run('calibration.state') === 'checking'; i++) { h.landmarks = k.make(cos(h.time - t0, k.period, k.up, k.down)); h.step() }
  assert.equal(run('calibration.state'), 'success', name + ' calibration'); assert.equal(run('count'), 0); h.landmarks = k.make(k.up); h.advance(1800); assert.equal(run('mode'), 'camera');
  t0 = h.time; h.advance(k.period * 4 + 200, t => k.make(cos(t - t0, k.period, k.up, k.down))); h.landmarks = k.make(k.up); h.advance(600);
  assert.equal(run('count'), 4, name + ': four reps = four hits'); assert.equal(run('hp'), 20 - 4 * { squat: 1, pushup: 3 }[name], name + ': damage follows the difficulty');
  // Switching the exercise ends the session and releases the camera.
  h.el('exSwing').onclick(); assert.equal(run('exercise'), 'swing'); assert.equal(run('mode'), 'idle'); assert.equal(run('stream'), null); assert.equal(run('count'), 0); assert.equal(run('detector.kind'), 'swing'); assert(h.stopped > 0);
 }
 // The screen follows the phone's exercise and keeps counting reps from it.
 const broker = makeBroker(), screen = harness({ Peer: broker.Peer }), phone = harness({ Peer: broker.Peer });
 await screen.run('startScreen()'); await phone.run(`joinRoom(${JSON.stringify(parseRoom(screen.el('pairCode').value))})`); for (let i = 0; i < 4; i++) await tick();
 phone.el('exSquat').onclick(); await tick(); phone.run('pushState()'); await tick(); assert.equal(screen.run('exercise'), 'squat', 'screen switches to the phone exercise'); assert(screen.el('countLabel').textContent.includes('SQUATS'));
 // Gnomes: stable per id, varied across ids.
 assert.deepEqual(gnomeLook('p-abc'), gnomeLook('p-abc')); const looks = new Set(Array.from({ length: 200 }, (_, i) => JSON.stringify(gnomeLook('p-' + i)))); assert(looks.size > 190, 'looks are varied: ' + looks.size);
 for (const part of ['head', 'hat', 'torso', 'beard', 'legs']) assert(new Set(Array.from({ length: 300 }, (_, i) => gnomeLook('x' + i)[part])).size === 10, part + ' uses all 10 variants');
 console.log('PASS: squat/push-up selection, labels and instructions, calibration 1/3-3/3, rep counting in the app, exercise switch releases the camera, screen follows phone exercise, gnome looks stable and varied.');
})().catch(e => { console.error(e); process.exitCode = 1 });
