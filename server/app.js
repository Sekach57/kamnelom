'use strict';
// Kamnelom API: players, leaderboard and group challenges. Node 22.13+/24, no dependencies (node:sqlite, SSE).
// Stores a nickname, a hashed secret and rep counters. No video, no IP addresses, no tracking.
const http = require('node:http'), crypto = require('node:crypto'), { DatabaseSync } = require('node:sqlite');

const EXERCISES = ['swing', 'squat', 'pushup'], ROCK = 20, MAX_BODY = 4096;
const rid = (prefix, bytes = 8) => prefix + Array.from(crypto.randomBytes(bytes), b => (b % 36).toString(36)).join('');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const clean = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// Difficulty: damage to the boulder per rep. Squats are the easiest, push-ups the hardest. Points = reps x weight.
const WEIGHT = { swing: 2, squat: 1, pushup: 3 };
const weightSql = `CASE s.exercise WHEN 'swing' THEN ${WEIGHT.swing} WHEN 'squat' THEN ${WEIGHT.squat} ELSE ${WEIGHT.pushup} END`;
const stage = (points, reps) => ({ reps, points, rocks: Math.floor(points / ROCK), hp: ROCK - (points % ROCK) });
const progress = (reps, exercise) => stage(reps * WEIGHT[exercise], reps);

function createApp(options = {}) {
 const o = { staticDir: null, dbPath: ':memory:', origins: [], allowAny: false, trustProxy: false, now: () => Date.now(), repsPerSecond: 4, repBurst: 12, ...options };
 const db = new DatabaseSync(o.dbPath); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
 db.exec(`
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, nick TEXT NOT NULL, created_at INTEGER NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0, last_rep_at INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS stats (player_id TEXT NOT NULL REFERENCES players(id), exercise TEXT NOT NULL, reps INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player_id, exercise));
  CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, goal INTEGER NOT NULL, owner TEXT NOT NULL REFERENCES players(id), created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS group_members (group_id TEXT NOT NULL REFERENCES groups(id), player_id TEXT NOT NULL REFERENCES players(id), joined_at INTEGER NOT NULL, PRIMARY KEY (group_id, player_id));
  CREATE TABLE IF NOT EXISTS group_reps (group_id TEXT NOT NULL, player_id TEXT NOT NULL, exercise TEXT NOT NULL, reps INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, player_id, exercise));
  CREATE INDEX IF NOT EXISTS stats_by_exercise ON stats (exercise, reps DESC);`);
 const q = {
  addPlayer: db.prepare('INSERT INTO players (id, secret_hash, nick, created_at) VALUES (?, ?, ?, ?)'),
  player: db.prepare('SELECT * FROM players WHERE id = ?'),
  setNick: db.prepare('UPDATE players SET nick = ? WHERE id = ?'),
  touch: db.prepare('UPDATE players SET last_seq = ?, last_rep_at = ? WHERE id = ?'),
  addReps: db.prepare('INSERT INTO stats (player_id, exercise, reps, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (player_id, exercise) DO UPDATE SET reps = reps + excluded.reps, updated_at = excluded.updated_at'),
  stats: db.prepare('SELECT exercise, reps FROM stats WHERE player_id = ?'),
  board: db.prepare('SELECT p.id, p.nick, s.reps FROM stats s JOIN players p ON p.id = s.player_id WHERE s.exercise = ? AND s.reps > 0 ORDER BY s.reps DESC, p.created_at ASC LIMIT ?'),
  boardTotal: db.prepare(`SELECT p.id, p.nick, SUM(s.reps) AS reps, SUM(s.reps * ${weightSql}) AS points, SUM(CASE WHEN s.exercise = 'swing' THEN s.reps ELSE 0 END) AS swing, SUM(CASE WHEN s.exercise = 'squat' THEN s.reps ELSE 0 END) AS squat, SUM(CASE WHEN s.exercise = 'pushup' THEN s.reps ELSE 0 END) AS pushup FROM stats s JOIN players p ON p.id = s.player_id GROUP BY p.id HAVING reps > 0 ORDER BY points DESC, p.created_at ASC LIMIT ?`),
  addGroup: db.prepare('INSERT INTO groups (id, name, goal, owner, created_at) VALUES (?, ?, ?, ?, ?)'),
  group: db.prepare('SELECT * FROM groups WHERE id = ?'),
  join: db.prepare('INSERT OR IGNORE INTO group_members (group_id, player_id, joined_at) VALUES (?, ?, ?)'),
  isMember: db.prepare('SELECT 1 AS x FROM group_members WHERE group_id = ? AND player_id = ?'),
  members: db.prepare('SELECT p.id, p.nick FROM group_members m JOIN players p ON p.id = m.player_id WHERE m.group_id = ? ORDER BY m.joined_at'),
  memberCount: db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?'),
  groupReps: db.prepare('SELECT player_id, exercise, reps FROM group_reps WHERE group_id = ?'),
  addGroupReps: db.prepare('INSERT INTO group_reps (group_id, player_id, exercise, reps) VALUES (?, ?, ?, ?) ON CONFLICT (group_id, player_id, exercise) DO UPDATE SET reps = reps + excluded.reps'),
  myGroups: db.prepare('SELECT g.id, g.name, g.goal FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.player_id = ? ORDER BY m.joined_at DESC LIMIT 20'),
  playerCount: db.prepare('SELECT COUNT(*) AS n FROM players')
 };
 const err = (status, code, message) => Object.assign(new Error(message || code), { status, code });

 // ---- rate limits (in memory, keyed by client address; addresses are never stored) ----
 const hits = new Map();
 function limit(key, max, windowMs) {
  const t = o.now(), list = (hits.get(key) || []).filter(x => t - x < windowMs); if (list.length >= max) { hits.set(key, list); throw err(429, 'rate_limited', 'Слишком часто. Попробуй чуть позже.') }
  list.push(t); hits.set(key, list);
 }
 const sweep = setInterval(() => { const t = o.now(); for (const [k, v] of hits) { const live = v.filter(x => t - x < 3600e3); live.length ? hits.set(k, live) : hits.delete(k) } }, 60e3); sweep.unref?.();
 const clientKey = req => (o.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

 // ---- auth: "Bearer <id>.<secret>" ----
 function auth(req) {
  const m = /^Bearer (p-[a-z0-9]{8,20})\.([A-Za-z0-9_-]{20,64})$/.exec(req.headers.authorization || ''); if (!m) throw err(401, 'unauthorized', 'Нужен вход.');
  const p = q.player.get(m[1]); const a = Buffer.from(hash(m[2])), b = Buffer.from(p?.secret_hash || '0'.repeat(64));
  if (!p || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw err(401, 'unauthorized', 'Неверный секрет.');
  return p;
 }
 const profile = p => { const stats = {}; for (const e of EXERCISES) stats[e] = progress(0, e); for (const s of q.stats.all(p.id)) stats[s.exercise] = progress(s.reps, s.exercise); return { id: p.id, nick: p.nick, stats, groups: q.myGroups.all(p.id) } };

 // ---- groups ----
 const streams = new Map(); // groupId -> Set(res)
 function groupState(id) {
  const g = q.group.get(id); if (!g) throw err(404, 'not_found', 'Группа не найдена.');
  const members = q.members.all(id).map(m => ({ id: m.id, nick: m.nick, counts: { swing: 0, squat: 0, pushup: 0 }, reps: 0, total: 0 })), by = Object.fromEntries(members.map(m => [m.id, m]));
  let total = 0; for (const r of q.groupReps.all(id)) { const m = by[r.player_id]; if (m && EXERCISES.includes(r.exercise)) { m.counts[r.exercise] += r.reps; m.reps += r.reps; m.total += r.reps * WEIGHT[r.exercise]; total += r.reps * WEIGHT[r.exercise] } }
  return { id: g.id, name: g.name, goal: g.goal, total, done: total >= g.goal, owner: g.owner, members: members.sort((a, b) => b.total - a.total), now: o.now() };
 }
 const broadcast = id => { const set = streams.get(id); if (!set || !set.size) return; const data = `data: ${JSON.stringify(groupState(id))}\n\n`; for (const res of set) res.write(data) };

 // ---- routes ----
 const routes = [];
 const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
 route('GET', '/health', () => ({ ok: true, players: q.playerCount.get().n }));
 route('POST', '/api/players', (req, body) => {
  limit('new:' + clientKey(req), 20, 3600e3);
  const wanted = /^p-[a-z0-9]{8}$/.test(String(body.id)) && !q.player.get(body.id) ? body.id : null, id = wanted || rid('p-'), secret = crypto.randomBytes(24).toString('base64url'), nick = clean(body.nick, 20) || 'Гном-' + id.slice(2, 6);
  q.addPlayer.run(id, hash(secret), nick, o.now()); return { id, secret, nick, token: id + '.' + secret };
 });
 route('POST', '/api/login', (req, body) => {
  limit('login:' + clientKey(req), 30, 600e3);
  const fake = { headers: { authorization: 'Bearer ' + String(body.id) + '.' + String(body.secret) } }; return profile(auth(fake));
 });
 route('GET', '/api/me', req => profile(auth(req)));
 route('PATCH', '/api/me', (req, body) => { const p = auth(req), nick = clean(body.nick, 20); if (nick.length < 2) throw err(400, 'bad_nick', 'Ник от 2 до 20 символов.'); q.setNick.run(nick, p.id); for (const id of streams.keys()) if (q.isMember.get(id, p.id)) broadcast(id); return profile(q.player.get(p.id)) });
 // Reports a batch of reps. seq grows on every request from a device so a retried request is not counted twice.
 route('POST', '/api/reps', (req, body) => {
  const p = auth(req); limit('reps:' + p.id, 60, 60e3);
  const exercise = body.exercise, n = Number(body.n), seq = Number(body.seq);
  if (!EXERCISES.includes(exercise) || !Number.isInteger(n) || n < 1 || n > 200 || !Number.isInteger(seq) || seq < 1) throw err(400, 'bad_request', 'Некорректный запрос.');
  if (seq <= p.last_seq) return { duplicate: true, ...progress(q.stats.all(p.id).find(s => s.exercise === exercise)?.reps || 0, exercise) };
  // Plausibility: a few reps per second at most, with a small burst allowance. The excess is dropped, not an error.
  const t = o.now(), elapsed = Math.min((t - (p.last_rep_at || t - 60e3)) / 1000, 600), allowed = Math.floor(elapsed * o.repsPerSecond + o.repBurst), add = Math.min(n, allowed);
  q.touch.run(seq, t, p.id); let group = null;
  if (add > 0) {
   q.addReps.run(p.id, exercise, add, t);
   if (body.groupId) { const gid = String(body.groupId); if (q.isMember.get(gid, p.id)) { q.addGroupReps.run(gid, p.id, exercise, add); group = gid } }
  }
  if (group) broadcast(group);
  return { applied: add, dropped: n - add, ...progress(q.stats.all(p.id).find(s => s.exercise === exercise)?.reps || 0, exercise) };
 });
 route('GET', '/api/leaderboard', (req, body, url) => {
  limit('board:' + clientKey(req), 120, 60e3);
  const exercise = url.searchParams.get('exercise') || 'total', lim = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
  const rows = exercise === 'total' ? q.boardTotal.all(lim) : EXERCISES.includes(exercise) ? q.board.all(exercise, lim) : (() => { throw err(400, 'bad_exercise', 'Неизвестное упражнение.') })();
  return { exercise, rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, nick: r.nick, ...(exercise === 'total' ? { ...stage(Number(r.points), Number(r.reps)), by: { swing: progress(Number(r.swing), 'swing'), squat: progress(Number(r.squat), 'squat'), pushup: progress(Number(r.pushup), 'pushup') } } : progress(Number(r.reps), exercise)) })) };
 });
 route('GET', '/api/players/:id', (req, body, url, params) => { const p = q.player.get(params.id); if (!p) throw err(404, 'not_found', 'Игрок не найден.'); const { groups, ...pub } = profile(p); return pub });
 route('POST', '/api/groups', (req, body) => {
  const p = auth(req); limit('mkgroup:' + p.id, 10, 3600e3);
  const name = clean(body.name, 40) || 'Башня Камнелома', goal = Math.max(50, Math.min(100000, Math.round(Number(body.goal) || 500))) , id = rid('g-', 8), t = o.now();
  q.addGroup.run(id, name, goal, p.id, t); q.join.run(id, p.id, t); return groupState(id);
 });
 route('POST', '/api/groups/:id/join', (req, body, url, params) => { const p = auth(req); limit('join:' + p.id, 30, 3600e3); if (!q.group.get(params.id)) throw err(404, 'not_found', 'Группа не найдена.'); if (q.memberCount.get(params.id).n >= 24 && !q.isMember.get(params.id, p.id)) throw err(409, 'full', 'В группе уже 24 гнома.'); q.join.run(params.id, p.id, o.now()); broadcast(params.id); return groupState(params.id) });
 route('GET', '/api/groups/:id', (req, body, url, params) => { limit('group:' + clientKey(req), 120, 60e3); return groupState(params.id) });

 // ---- http ----
 function cors(req, res) {
  const origin = req.headers.origin; if (origin && (o.allowAny || o.origins.includes(origin))) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS'); res.setHeader('Access-Control-Max-Age', '600');
 }
 const send = (res, status, data) => { const text = JSON.stringify(data); res.writeHead(status, { ...(status === 413 ? { Connection: 'close' } : {}), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(text) }); res.end(text) };
 const readBody = req => new Promise((resolve, reject) => { let size = 0, over = false; const chunks = []; req.on('data', c => { size += c.length; if (size > 1 << 20) return req.destroy(); if (over) return; if (size > MAX_BODY) { over = true; chunks.length = 0; reject(err(413, 'too_large', 'Слишком большой запрос.')) } else chunks.push(c) }); req.on('end', () => { if (over) return; if (!chunks.length) return resolve({}); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) } catch { reject(err(400, 'bad_json', 'Некорректный JSON.')) } }); req.on('error', reject) });
 // The game itself (dist/) is served by the same process, so the site and the API share one origin.
 const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
 const root = o.staticDir && require('node:fs').realpathSync(require('node:path').resolve(o.staticDir));
 function serveStatic(req, res, url) {
  const fs = require('node:fs'), path = require('node:path'); let p; try { p = decodeURIComponent(url.pathname) } catch { throw err(400, 'bad_path') }
  if (p.includes('\0')) throw err(400, 'bad_path'); let file = path.resolve(root, '.' + (p.endsWith('/') ? p + 'index.html' : p));
  try { file = fs.realpathSync(file); if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html') } catch { throw err(404, 'not_found', 'Не найдено.') }
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw err(404, 'not_found', 'Не найдено.');
  const ext = path.extname(file), immutable = ['.wasm', '.task'].includes(ext) || file.includes(path.sep + 'vendor' + path.sep);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': fs.statSync(file).size };
  res.writeHead(200, headers); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
 }
 let sseCount = 0;
 const server = http.createServer(async (req, res) => {
  cors(req, res);
  try {
   const url = new URL(req.url, 'http://x'); if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
   const stream = /^\/api\/groups\/([^/]+)\/stream$/.exec(url.pathname);
   if (stream && req.method === 'GET') {
    limit('sse:' + clientKey(req), 20, 60e3); const id = stream[1]; const state = groupState(id); const set = streams.get(id) || streams.set(id, new Set()).get(id);
    if (set.size >= 100 || sseCount >= 1000) throw err(503, 'busy', 'Слишком много наблюдателей.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write(`retry: 3000\ndata: ${JSON.stringify(state)}\n\n`);
    set.add(res); sseCount++; const beat = setInterval(() => res.write(': hb\n\n'), 20e3); req.on('close', () => { clearInterval(beat); if (set.delete(res)) sseCount--; if (!set.size) streams.delete(id) }); return;
   }
   const r = routes.find(x => x.method === (req.method === 'HEAD' ? 'GET' : req.method) && x.re.test(url.pathname));
   if (!r && o.staticDir && ['GET', 'HEAD'].includes(req.method) && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
   if (!r) throw err(404, 'not_found', 'Не найдено.');
   limit('all:' + clientKey(req), 300, 60e3);
   const body = ['GET', 'HEAD'].includes(req.method) ? {} : await readBody(req); send(res, 200, r.fn(req, body, url, url.pathname.match(r.re).groups || {}));
  } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.code || 'server_error', message: e.status ? e.message : 'Ошибка сервера.' }); else res.end(); if (!e.status) console.error(e) }
 });
 server.on('close', () => { clearInterval(sweep); db.close() });
 return { server, db, close: () => new Promise(r => { for (const set of streams.values()) for (const res of set) res.end(); server.close(() => r()); server.closeAllConnections?.() }) };
}
module.exports = { createApp, progress, ROCK, EXERCISES, WEIGHT };
