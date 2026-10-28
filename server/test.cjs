'use strict';
const assert = require('node:assert'), { createApp } = require('./app.js');
(async () => {
 let now = 1_000_000_000_000; const app = createApp({ origins: ['https://dwarfgym.live'], now: () => now });
 await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.server.address().port;
 const call = async (method, path, { body, token, headers } = {}) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) } };

 // identity
 const a = await call('POST', '/api/players', { body: { nick: '  Торин <b>Дубощит</b> ' } }); assert.equal(a.status, 200); assert(/^p-[a-z0-9]{8}$/.test(a.json.id)); assert.equal(a.json.nick, 'Торин bДубощит/b', 'angle brackets and padding stripped');
 const b = await call('POST', '/api/players', { body: {} }); const mine = await call('POST', '/api/players', { body: { id: 'p-abcd1234' } }); assert.equal(mine.json.id, 'p-abcd1234', 'a client may bring its own id (keeps its gnome)'); assert.notEqual((await call('POST', '/api/players', { body: { id: 'p-abcd1234' } })).json.id, 'p-abcd1234', 'a taken id is never reused'); assert(/^Гном-/.test(b.json.nick), 'default nick');
 assert.equal((await call('GET', '/api/me')).status, 401); assert.equal((await call('GET', '/api/me', { token: a.json.id + '.wrongsecretwrongsecretwrong' })).status, 401);
 const me = await call('GET', '/api/me', { token: a.json.token }); assert.equal(me.status, 200); assert.equal(me.json.stats.swing.reps, 0);
 assert.equal((await call('POST', '/api/login', { body: { id: a.json.id, secret: a.json.secret } })).json.id, a.json.id, 'login with id+secret'); assert.equal((await call('POST', '/api/login', { body: { id: a.json.id, secret: 'x'.repeat(30) } })).status, 401);
 assert.equal((await call('PATCH', '/api/me', { token: a.json.token, body: { nick: 'Д' } })).status, 400); assert.equal((await call('PATCH', '/api/me', { token: a.json.token, body: { nick: 'Дварин' } })).json.nick, 'Дварин');
 assert(!JSON.stringify(app.db.prepare('SELECT * FROM players').all()).includes(a.json.secret), 'secret is stored hashed only');

 // reps, duplicates, plausibility
 now += 60_000; let r = await call('POST', '/api/reps', { token: a.json.token, body: { seq: 1, exercise: 'squat', n: 25 } }); assert.equal(r.json.applied, 25); assert.equal(r.json.points, 25); assert.equal(r.json.rocks, 1); assert.equal(r.json.hp, 15, '25 squats = 25 points = 1 rock broken, 15 hp left');
 r = await call('POST', '/api/reps', { token: a.json.token, body: { seq: 1, exercise: 'squat', n: 25 } }); assert.equal(r.json.duplicate, true); assert.equal(r.json.reps, 25, 'a retried request is not counted twice');
 r = await call('POST', '/api/reps', { token: a.json.token, body: { seq: 2, exercise: 'squat', n: 200 } }); assert.equal(r.json.applied, 12, 'two reps claimed in 0 s: only the burst allowance counts'); assert.equal(r.json.dropped, 188);
 now += 10_000; r = await call('POST', '/api/reps', { token: a.json.token, body: { seq: 3, exercise: 'swing', n: 30 } }); assert.equal(r.json.applied, 30); assert.equal(r.json.points, 60, 'a swing counts double'); assert.equal(r.json.rocks, 3);
 for (const bad of [{ seq: 4, exercise: 'burpee', n: 1 }, { seq: 4, exercise: 'squat', n: 0 }, { seq: 4, exercise: 'squat', n: 1.5 }, { seq: 0, exercise: 'squat', n: 1 }, { exercise: 'squat', n: 1 }]) assert.equal((await call('POST', '/api/reps', { token: a.json.token, body: bad })).status, 400, JSON.stringify(bad));

 // leaderboard
 now += 30_000; await call('POST', '/api/reps', { token: b.json.token, body: { seq: 1, exercise: 'squat', n: 10 } });
 let lb = await call('GET', '/api/leaderboard?exercise=squat'); assert.deepEqual(lb.json.rows.map(x => [x.rank, x.nick, x.reps]), [[1, 'Дварин', 37], [2, b.json.nick, 10]]); assert.equal(lb.json.rows[0].rocks, 1); assert.equal(lb.json.rows[0].points, 37);
 lb = await call('GET', '/api/leaderboard'); assert.equal(lb.json.exercise, 'total'); assert.equal(lb.json.rows[0].reps, 67); assert.equal(lb.json.rows[0].points, 97, 'total ranks by points: 37 squats + 30 swings x 2'); assert.equal(lb.json.rows[0].rocks, 4); assert.deepEqual(Object.keys(lb.json.rows[0].by), ['swing', 'squat', 'pushup']); assert.equal(lb.json.rows[0].by.swing.reps, 30); assert.equal((await call('GET', '/api/leaderboard?exercise=nope')).status, 400);
 assert.equal((await call('GET', '/api/players/' + a.json.id)).json.stats.squat.reps, 37); assert.equal((await call('GET', '/api/players/p-nobody00')).status, 404);

 // groups + live stream
 const g = await call('POST', '/api/groups', { token: a.json.token, body: { name: 'Башня', goal: 100 } }); assert.equal(g.status, 200); assert(/^g-[a-z0-9]{8}$/.test(g.json.id)); assert.equal(g.json.members.length, 1);
 const events = []; const ctl = new AbortController(); const sse = await fetch(base + `/api/groups/${g.json.id}/stream`, { signal: ctl.signal }); assert.equal(sse.headers.get('content-type').split(';')[0], 'text/event-stream');
 (async () => { const rd = sse.body.getReader(), dec = new TextDecoder(); let buf = ''; try { for (; ;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = /data: (.*)/.exec(buf.slice(0, i)); buf = buf.slice(i + 2); if (m) events.push(JSON.parse(m[1])) } } } catch { } })();
 const until = async (f, what) => { for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 10)); assert(f(), what) };
 await until(() => events.length === 1, 'initial state is streamed');
 assert.equal((await call('POST', `/api/groups/${g.json.id}/join`, { token: b.json.token })).json.members.length, 2); await until(() => events.length === 2, 'join is streamed');
 now += 20_000; await call('POST', '/api/reps', { token: b.json.token, body: { seq: 2, exercise: 'pushup', n: 8, groupId: g.json.id } }); await until(() => events.length === 3, 'reps are streamed');
 const state = events[2]; assert.equal(state.total, 24, '8 push-ups are 24 points'); assert.equal(state.members.find(m => m.id === b.json.id).counts.pushup, 8); assert.equal(state.members.find(m => m.id === b.json.id).reps, 8); assert.equal(state.done, false);
 now += 20_000; const outsider = await call('POST', '/api/players', { body: { nick: 'Чужой' } }); await call('POST', '/api/reps', { token: outsider.json.token, body: { seq: 1, exercise: 'swing', n: 5, groupId: g.json.id } });
 assert.equal((await call('GET', '/api/groups/' + g.json.id)).json.total, 24, 'non-members cannot add to a group');
 now += 60_000; await call('POST', '/api/reps', { token: a.json.token, body: { seq: 4, exercise: 'swing', n: 100, groupId: g.json.id } }); const fin = (await call('GET', '/api/groups/' + g.json.id)).json; assert.equal(fin.total, 224, '24 + 100 swings x 2'); assert.equal(fin.done, true); assert.equal(fin.members[0].nick, 'Дварин', 'members sorted by contribution');
 assert.equal((await call('GET', '/api/groups/g-nothing00')).status, 404); ctl.abort();

 // http hygiene
 let c = await call('GET', '/health', { headers: { Origin: 'https://dwarfgym.live' } }); assert.equal(c.headers.get('access-control-allow-origin'), 'https://dwarfgym.live'); c = await call('GET', '/health', { headers: { Origin: 'https://evil.example' } }); assert.equal(c.headers.get('access-control-allow-origin'), null, 'other origins get no CORS header');
 assert.equal((await fetch(base + '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://dwarfgym.live' } })).status, 204);
 assert.equal((await call('POST', '/api/players', { body: { nick: 'x'.repeat(10000) } })).status, 413); assert.equal((await fetch(base + '/api/players', { method: 'POST', body: '{nope' })).status, 400); assert.equal((await call('GET', '/nope')).status, 404);
 let limited = 0; for (let i = 0; i < 25; i++) if ((await call('POST', '/api/players', { body: {} })).status === 429) limited++; assert(limited > 0, 'player creation is rate limited');
 // static site from dist/ on the same origin
 const site = createApp({ staticDir: require('node:path').join(__dirname, '../dist') }); await new Promise(r => site.server.listen(0, '127.0.0.1', r)); const sb = 'http://127.0.0.1:' + site.server.address().port;
 let f = await fetch(sb + '/'); assert.equal(f.status, 200); assert(f.headers.get('content-type').startsWith('text/html')); assert((await f.text()).includes('Камнелом'));
 f = await fetch(sb + '/vendor/mediapipe/wasm/vision_wasm_internal.wasm', { method: 'HEAD' }); assert.equal(f.headers.get('content-type'), 'application/wasm'); f = await fetch(sb + '/vendor/mediapipe/vision_bundle.mjs', { method: 'HEAD' }); assert(f.headers.get('content-type').startsWith('text/javascript'));
 for (const bad of ['/../server/app.js', '/%2e%2e/server/app.js', '/..%2fserver%2fapp.js', '/nope.txt']) { f = await fetch(sb + bad); assert([400, 404].includes(f.status), bad + ' -> ' + f.status) }
 f = await fetch(sb + '/api/nothing'); assert.equal(f.status, 404); assert.equal((await fetch(sb + '/health')).status, 200); assert.equal((await fetch(sb + '/health', { method: 'HEAD' })).status, 200, 'HEAD works for health checks'); await site.close();
 await app.close(); console.log('PASS: server: identity (hashed secret, login, nick), reps (dedupe, plausibility), leaderboard, groups with live stream, CORS, limits, static site.');
})().catch(e => { console.error(e); process.exit(1) });
