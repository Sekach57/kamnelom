const assert = require('assert'), harness = require('./harness.cjs');
// Demo game logic: no camera involved. Damage per rep: squat 1, swing 2, push-up 3; the boulder has 20 HP.
for (const [exercise, reps, damage] of [['squat', 20, 1], ['swing', 10, 2], ['pushup', 7, 3]]) {
 const h = harness(), run = h.run, advance = ms => { for (let i = 0; i < ms; i += 100) { h.time += 100; run(`tick(${h.time})`) } };
 run(`exercise='${exercise}'`); run("mode='demo';lastDemo=Infinity;sync()");
 for (let i = 0; i < reps - 1; i++) { run(`swing(${h.time})`); advance(1000) }
 assert.equal(run('broken'), 0, exercise + ': not broken one rep early'); assert.equal(run('hp'), 20 - (reps - 1) * damage > 0 ? 20 - (reps - 1) * damage : 0);
 run(`swing(${h.time})`); advance(1000); assert.equal(run('count'), reps); assert.equal(run('broken'), 1, exercise + ': ' + reps + ' reps break one rock'); assert.equal(run('hp'), 20, 'new rock after destruction'); assert.equal(run('pendingHit'), false);
 run("$('pause').onclick()"); const e = run('elapsed'); advance(3000); assert.equal(run('elapsed'), e); run(`swing(${h.time})`); assert.equal(run('count'), reps, 'paused: no counting');
 run("$('reset').onclick()"); assert.equal(run('count'), 0); assert.equal(run('broken'), 0); assert.equal(run('mode'), 'idle'); assert.equal(run('hp'), 20);
 // The hit lands later for heavier exercises.
 run(`exercise='${exercise}'`); run("mode='demo';lastDemo=Infinity"); run(`swing(${h.time})`); advance(200); const early = run('hp'); advance(500); assert(early === 20 || exercise === 'squat', exercise + ' impact is not instant'); assert.equal(run('hp'), 20 - damage);
}
console.log('PASS: squat 20 / swing 10 / push-up 7 reps break a boulder (damage 1/2/3); heavier exercises hit later; pause freezes timer/count; reset clears session.');
