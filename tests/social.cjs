// Client (dist/social.js) against the real server (server/app.js), in-process.
const assert = require('assert'), harness = require('./harness.cjs'), { createApp } = require('../server/app.js');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
(async () => {
 let now = 2_000_000_000_000; const server = createApp({ allowAny: true, now: () => now }); await new Promise(r => server.server.listen(0, '127.0.0.1', r)); const api = 'http://127.0.0.1:' + server.server.address().port;
 // A small EventSource over fetch, as browsers provide it.
 class ES { constructor(url) { this.ctl = new AbortController(); fetch(url, { signal: this.ctl.signal }).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = ''; for (; ;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = /data: (.*)/.exec(buf.slice(0, i)); buf = buf.slice(i + 2); if (m) this.onmessage?.({ data: m[1] }) } } }).catch(() => { }) } close() { this.ctl.abort() } }
 const client = (store = {}) => { return harness({ search: '?api=' + api, store, fetchImpl: (u, o) => fetch(u, o), EventSource: ES }) };
 const rep = h => { h.time += 1000; h.run(`swing(${h.time})`); h.run('impact()') };
 const settle = async h => { for (let i = 0; i < 20; i++) await tick(5) };

 // 1. first visit: the local id is registered (so the gnome stays the same), the secret is kept on the device
 const a = client(); await settle(a); const idA = a.run('profile.id'); assert(/^p-[a-z0-9]{8}$/.test(idA)); assert.equal(a.run('account.id'), idA, 'server keeps the id the device made'); assert(a.run('account.secret').length >= 30);
 assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM players WHERE id = ?').get(idA).n, 1); assert(JSON.parse(a.store['kamnelom.account']).secret, 'account persisted on the device');
 assert.equal(a.run('document.querySelector').length >= 0, true);

 // 2. reps from the camera game are queued and delivered once, even if a response is lost
 a.run("mode='camera';paused=false;exercise='squat'"); for (let i = 0; i < 5; i++) rep(a)
 assert.equal(a.run('repState.pending.squat'), 5); assert.equal(a.run('count'), 5);
 let lost = 0; a.fetchImpl = async (u, o) => { const r = await fetch(u, o); if (String(u).endsWith('/api/reps') && lost++ < 1) throw new Error('response lost'); return r }; now += 20_000;
 await a.run('flush()'); assert.equal(a.run('repState.inflight.n'), 5, 'unacknowledged batch is kept'); assert.equal(server.db.prepare("SELECT reps FROM stats WHERE player_id = ?").get(idA).reps, 5, 'but the server already has it');
 a.fetchImpl = (u, o) => fetch(u, o); now += 5000; await a.run('flush()'); assert.equal(a.run('repState.inflight'), null); assert.equal(server.db.prepare("SELECT reps FROM stats WHERE player_id = ?").get(idA).reps, 5, 'the retry is recognised by its sequence number and not counted twice');
 a.fetchImpl = async () => { throw new Error('offline') }; for (let i = 0; i < 3; i++) rep(a); await a.run('flush()'); assert.equal(a.run('repState.inflight.n'), 3, 'offline: reps wait on the device'); assert.equal(JSON.parse(a.store['kamnelom.reps']).inflight.n, 3, 'and survive a reload');
 a.fetchImpl = (u, o) => fetch(u, o); now += 60_000; await a.run('flush()'); assert.equal(server.db.prepare("SELECT reps FROM stats WHERE player_id = ?").get(idA).reps, 8);
 // demo mode and the screen's mirrored swings never reach the leaderboard
 a.run("mode='demo'"); a.run(`swing(${a.time += 1000})`); a.run('impact()'); assert.equal(a.run('repState.pending.squat'), 0);

 // 3. leaderboard shows the player with the stage
 await a.run("$('nick').value='Бальдур';$('nickSave').onclick()"); await settle(a); await a.run("loadBoard('squat')"); const html = a.el('boardList').innerHTML; assert(html.includes('Бальдур') && html.includes('валун №1') && html.includes('12/20'), html);
 await a.run("loadBoard('total')"); assert(a.el('boardList').innerHTML.includes('⚒ 0') && a.el('boardList').innerHTML.includes('⇩ 8'), 'total tab shows each exercise');

 // 4. sign in on another device with the link: same id, same gnome
 const link = a.el('loginLink').value; assert(/#login=p-[a-z0-9]{8}\.[A-Za-z0-9_-]+$/.test(link)); const b = client(); b.sandbox.location.hash = ''; await settle(b);
 const idB0 = b.run('profile.id'); assert.notEqual(idB0, idA); await b.run(`loginFromLink(${JSON.stringify(link.split('#login=')[1].split('.')[0])}, ${JSON.stringify(link.split('.').slice(1).join('.'))})`); await settle(b);
 assert.equal(b.run('profile.id'), idA, 'the second device became the same player'); assert.equal(JSON.stringify(b.run('myLook')), JSON.stringify(a.run('myLook')), 'and shows the same gnome'); assert.equal(b.store['kamnelom.player'], idA); assert(b.el('meStats').textContent.includes('Приседания: 8'));

 // 5. group challenge with a live stream
 await a.run("$('groupName').value='Башня друзей';$('groupGoal').value='200';createGroup()"); await settle(a); const gid = a.run('group.id'); assert(/^g-[a-z0-9]{8}$/.test(gid)); assert(a.el('groupInvite').value.endsWith('#group=' + gid)); assert.equal(a.run('isMember()'), true);
 const c = client(); await settle(c); await c.run(`openGroup(${JSON.stringify(gid)})`); await settle(c); assert.equal(c.run('group.name'), 'Башня друзей'); assert.equal(c.run('isMember()'), false); assert.equal(c.el('groupJoin').hidden, false);
 await c.run('joinGroup()'); await settle(c); assert.equal(c.run('isMember()'), true); await settle(a); assert.equal(a.run('group.members.length'), 2, 'the first member sees the newcomer live');
 await c.run('toggleActive()'); assert.equal(c.run('activeGroup'), gid); c.run("mode='camera';paused=false;exercise='pushup'"); for (let i = 0; i < 4; i++) rep(c); now += 30_000; await c.run('flush()'); await settle(a);
 assert.equal(a.run('group.total'), 4, 'reps flow into the group and reach the other member through the stream'); assert.equal(a.run("group.members.find(m => m.nick !== 'Бальдур').counts.pushup"), 4); assert(a.el('groupProgress').textContent.includes('4 из 200'));
 a.run('sceneTick()'); c.run('sceneTick()'); a.run('closeGroup()'); assert.equal(a.el('groupPanel').hidden, true);
 // sign-in failure does not break the page
 const d = client(); await settle(d); await d.run("loginFromLink('p-zzzzzzzz','x'.repeat(30))").catch(() => { }); assert.equal(d.run('account.id'), d.run('profile.id'));
 // an unreachable server leaves the game usable
 const e = harness({ search: '?api=' + api }); await settle(e); e.run("mode='camera';paused=false"); rep(e); assert.equal(e.run('count'), 1); assert.equal(e.run('repState.pending.swing'), 1);
 await server.close(); console.log('PASS: client + server: id registered as made on device, reps queued/deduplicated/offline-safe, demo not reported, leaderboard stages, sign-in link gives the same gnome, group join + live stream + group reps, server outage tolerated.');
})().catch(e => { console.error(e); process.exit(1) });
