const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const harness = require('./harness.cjs'), { skeleton, wave, TOP } = require('./skeleton.cjs');
(async () => {
 // Record a synthetic session in the app (numbers only), export it, and replay it offline.
 const h = harness(), run = h.run; run('setDebug(true)');
 await run('openCamera()'); h.landmarks = skeleton({ s: TOP }); h.advance(600); run("$('checkSwing').onclick()"); h.advance(3100);
 let t0 = h.time; h.advance(1400 * 3 + 200, t => skeleton({ s: wave(t - t0, 1400) })); h.landmarks = skeleton({ s: TOP }); h.advance(1800);
 t0 = h.time; h.advance(1400 * 4, t => skeleton({ s: wave(t - t0, 1400) })); h.advance(400, () => skeleton({ s: TOP }));
 const json = run('recExport()'), data = JSON.parse(json);
 assert(data.frames.length > 100 && data.events.some(e => e.type === 'calibrated') && data.events.some(e => e.type === 'swing' && e.counted), 'recording has frames and events');
 assert(!/data:image|base64/.test(json), 'recording holds numbers only'); assert.equal(data.frames[5].p.length, 8);
 const live = run('count'), file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kamnelom-')), 'rec.json'); fs.writeFileSync(file, json);
 const out = spawnSync(process.execPath, ['tools/replay.cjs', file], { encoding: 'utf8' }).stdout;
 assert(out.includes('Свингов после калибровки: ' + live), 'replay matches the live count ' + live + '\n' + out); assert(live >= 3);
 console.log('PASS: numbers-only recording exports frames/events; offline replay reproduces the live count.');
})().catch(e => { console.error(e); process.exitCode = 1 });
