const assert = require('assert'), harness = require('./harness.cjs'), h = harness(), run = h.run;
// Demo game logic: no camera involved.
function advance(ms) { for (let i = 0; i < ms; i += 100) { h.time += 100; run(`tick(${h.time})`) } }
run("mode='demo';lastDemo=Infinity;sync()"); for (let i = 0; i < 20; i++) { run(`swing(${h.time})`); advance(1000) }
assert.equal(run('count'), 20); assert.equal(run('broken'), 1); assert.equal(run('hp'), 20, 'new rock after destruction'); assert.equal(run('pendingHit'), false);
run("$('pause').onclick()"); const e = run('elapsed'); advance(3000); assert.equal(run('elapsed'), e); run(`swing(${h.time})`); assert.equal(run('count'), 20);
run("$('reset').onclick()"); assert.equal(run('count'), 0); assert.equal(run('broken'), 0); assert.equal(run('mode'), 'idle'); assert.equal(run('hp'), 20);
console.log('PASS: 20 swings produce 20 hits, one destroyed rock and a new rock; pause freezes timer/count; reset clears session.');
