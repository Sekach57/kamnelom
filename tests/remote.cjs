const assert = require('assert'), harness = require('./harness.cjs'), { FakePC } = require('./fakertc.cjs'), { packSignal, unpackSignal } = require('../dist/remote.js'), { skeleton, wave, TOP } = require('./skeleton.cjs');
const tick = () => new Promise(r => setTimeout(r, 0));
(async () => {
 // --- signal codes ---
 const sdp = 'v=0\r\n' + 'a=candidate:1 1 udp 2113937151 192.168.1.20 54321 typ host\r\n'.repeat(12) + 'a=fingerprint:sha-256 ' + 'AB:'.repeat(32);
 const code = await packSignal({ type: 'offer', sdp }); assert(code.startsWith('z') && !/[+/=\s]/.test(code), 'url-safe code');
 assert.deepEqual(await unpackSignal(code), { type: 'offer', sdp }); assert.deepEqual(await unpackSignal('https://x.io/kamnelom/#join=' + code), { type: 'offer', sdp }, 'accepts a pasted link'); assert.deepEqual(await unpackSignal(' #answer=' + code + ' \n'), { type: 'offer', sdp });
 for (const bad of ['', 'zzz', 'q123', 'z' + Buffer.from('nope').toString('base64url')]) await assert.rejects(unpackSignal(bad), /bad code|empty/, 'rejects ' + JSON.stringify(bad));

 // --- pairing by room link: the phone joins automatically ---
 const { makeBroker } = require('./fakepeer.cjs'), { parseRoom } = require('../dist/remote.js'), broker = makeBroker();
 const screen = harness({ Peer: broker.Peer }), phone = harness({ Peer: broker.Peer });
 await screen.run('startScreen()'); const url = screen.el('pairCode').value; assert(/#room=kamnelom-[a-z0-9]{10}$/.test(url), 'screen shows a unique room link: ' + url); assert.equal(screen.el('pairQr').hidden, false);
 await phone.run('joinRoom("kamnelom-zzzzzzzzzz")'); assert(phone.el('pairStatus').textContent.includes('Screen not found'), 'unknown room is reported'); assert.equal(phone.run('link'), null);
 await phone.run(`joinRoom(${JSON.stringify(parseRoom(url))})`); await tick(); await tick(); await tick();
 assert.equal(screen.run('link.open'), true); assert.equal(phone.run('link.open'), true); assert.equal(screen.el('pairPanel').hidden, true, 'panel closes after connecting'); assert.equal(phone.el('pairPanel').hidden, true);
 const intruder = harness({ Peer: broker.Peer }); await intruder.run(`joinRoom(${JSON.stringify(parseRoom(url))})`); await tick(); await tick(); await tick(); assert.equal(screen.run('link.conn === link.conn && link.open'), true, 'a second phone does not kick the first'); intruder.run('closeLink()');
 assert.notEqual(parseRoom(url), require('../dist/remote.js').newRoomId(), 'room ids are random');
 assert.equal(screen.run('document.body.dataset.mode'), 'screen'); assert.equal(phone.run('document.body.dataset.mode'), 'phone'); assert(screen.el('linkStatus').textContent.includes('Phone connected'), screen.el('linkStatus').textContent); assert(phone.el('linkStatus').textContent.includes('Connected to the screen')); assert.equal(phone.el('camera').disabled, false, 'phone may start the camera once linked');
 const label = () => screen.el('modeLabel').textContent;

 // --- phone runs the camera flow; the screen mirrors progress and then the game ---
 await phone.run('openCamera()'); phone.landmarks = skeleton({ s: TOP }); phone.advance(600); await tick(); assert(label().includes('GETTING IN FRAME'), label());
 phone.run("$('checkSwing').onclick()"); phone.advance(3100); await tick(); assert(label().includes('PRACTICE 0/3'), label());
 let t0 = phone.time; const seen = new Set(); for (let i = 0; i < 140 && phone.run('calibration.state') === 'checking'; i++) { phone.landmarks = skeleton({ s: wave(phone.time - t0, 1400) }); phone.step(); await tick(); seen.add(label()) }
 assert([...seen].some(l => l.includes('PRACTICE 2/3')), [...seen].join('|')); assert.equal(screen.run('count'), 0, 'trial swings never reach the screen game');
 phone.landmarks = skeleton({ s: TOP }); phone.advance(1800); await tick(); assert.equal(screen.run('mode'), 'remote'); assert.equal(phone.run('mode'), 'camera');
 const cyc = n => { const t = phone.time; return (async () => { for (let i = 0; i < 28 * n + 2; i++) { phone.landmarks = skeleton({ s: wave(phone.time - t, 1400) }); phone.step(); screen.step(); await tick() } phone.landmarks = skeleton({ s: TOP }); for (let i = 0; i < 8; i++) { phone.step(); screen.step(); await tick() } })() };
 await cyc(3); assert.equal(phone.run('count'), 3); assert.equal(screen.run('count'), 3, 'screen count follows the phone'); assert.equal(screen.run('hp'), 14, 'screen game hits the rock (3 swings x 2 damage)');
 // Hints from the phone appear on the screen.
 phone.landmarks = skeleton({ s: TOP, wrists: 'none' }); for (let i = 0; i < 30; i++) { phone.step(); await tick() } assert.equal(screen.el('poseHint').hidden, false); assert(screen.el('poseHint').textContent.includes('wrists'));
 phone.landmarks = skeleton({ s: TOP }); for (let i = 0; i < 20; i++) { phone.step(); await tick() } assert.equal(screen.el('poseHint').hidden, true);

 // --- commands from the screen ---
 await screen.run("$('pause').onclick()"); await tick(); assert.equal(phone.run('paused'), true, 'pause reaches the phone'); phone.step(); await tick(); assert.equal(screen.run('paused'), true, 'and comes back as state');
 await screen.run("$('pause').onclick()"); await tick(); assert.equal(phone.run('paused'), false); phone.step(); await tick();
 // Late/missed message: the screen resynchronises its count instead of replaying hits.
 screen.run('count=0'); phone.step(); await tick(); phone.run("pushState()"); await tick(); assert.equal(screen.run('count'), 3, 'count resynchronised from state');

 // --- link drop: phone keeps counting, screen says so ---
 phone.run('link.close()'); await tick(); assert.equal(screen.run('link.open'), false); assert(label().includes('LOST'), label()); await cyc(1); assert.equal(phone.run('count'), 4, 'phone keeps counting without the screen');
 // --- the phone reconnects by itself and the screen keeps its game ---
 const r1 = harness({ Peer: broker.Peer }), r2 = harness({ Peer: broker.Peer }); await r1.run('startScreen()'); await r2.run(`joinRoom(${JSON.stringify(parseRoom(r1.el('pairCode').value))})`); for (let i = 0; i < 4; i++) await tick();
 for (const x of [r1, r2]) x.run('count=7;$("count").textContent=7'); r1.run('hp=11'); r1.run('link.conn.close()'); for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 5)); assert.equal(r1.run('link.open'), true, 'phone reconnected'); assert.equal(r2.run('link.open'), true); assert.equal(r1.run('count'), 7, 'screen keeps its count across a reconnect'); assert.equal(r1.run('hp'), 11, 'and does not restart its game');
 // --- manual (serverless) pairing still works ---
 const s2 = harness({ rtc: FakePC }), p2 = harness({ rtc: FakePC }); await s2.run('startScreenManual()'); await p2.run(`startPhone(${JSON.stringify(s2.el('pairCode').value)})`); s2.el('pairPaste').value = p2.el('pairCode').value; await s2.run("$('pairApply').onclick()"); await tick(); await tick();
 await p2.run('openCamera()'); await s2.run("$('reset').onclick()"); await tick(); assert.equal(p2.run('stream'), null, 'reset command stops the phone camera'); assert(p2.stopped > 0);
 // --- an unlinked phone cannot start the camera: the game would have nowhere to go ---
 const lone = harness({ Peer: broker.Peer }); await lone.run('startPhone(null)'); assert.equal(lone.run('document.body.dataset.mode'), 'phone'); assert.equal(lone.el('camera').disabled, true); assert(lone.el('camera').textContent.includes('Connect'));
 // --- screen role can be left ---
 await s2.run("$('camera').onclick()"); assert.equal(s2.run('role'), 'solo'); assert.equal(s2.run('link'), null); assert.equal(s2.run('document.body.dataset.mode'), 'local');
 console.log('PASS: signal codes round-trip and reject garbage; screen/phone pairing; calibration progress, game hits, hints, pause/reset commands and count resync over the link; link drop leaves the phone counting.');
})().catch(e => { console.error(e); process.exitCode = 1 });
