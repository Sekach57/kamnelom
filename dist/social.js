'use strict';
// Accounts, leaderboard and group challenges: the client side of server/app.js.
// The game works without the server; reps are queued on the device and sent when it is reachable.
const API_BASE = (new URLSearchParams(location.search).get('api') || '').replace(/\/$/, '');
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } } };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EX_NAME = { squat: 'Squats', swing: 'Swings', pushup: 'Push-ups' }, EX_ICON = { swing: '⚒', squat: '⇩', pushup: '⇧' };
function onView(name) { if (name === 'board') loadBoard(); else if (name === 'me' || name === 'party') refreshMe() }
let account = store.get('kamnelom.account', null), repState = store.get('kamnelom.reps', { seq: 0, pending: {}, inflight: null }), activeGroup = store.get('kamnelom.group', null);
let accountBusy = null, flushTimer = null, flushing = false, backoff = 0, boardTab = 'total', online = null, myStats = null;

function setOnline(v) { if (online === v) return; online = v; const e = $('netStatus'); if (e) e.textContent = v ? 'Server: online' : 'Server unreachable: reps are saved on this device and sent later' }
async function api(path, { method = 'GET', body, auth = false, keepalive = false } = {}) {
 const headers = { 'Content-Type': 'application/json' }; if (auth && account) headers.Authorization = 'Bearer ' + account.id + '.' + account.secret;
 let r; try { r = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive }) } catch { setOnline(false); throw Object.assign(new Error('offline'), { offline: true }) }
 setOnline(true); const json = await r.json().catch(() => null);
 if (!r.ok) throw Object.assign(new Error(json?.message || 'http ' + r.status), { status: r.status, code: json?.error });
 return json;
}

// ---- account: the id made on first visit is registered with the server; the secret never leaves this device except in the login link ----
function ensureAccount() {
 if (account) return Promise.resolve(account);
 return accountBusy ??= api('/api/players', { method: 'POST', body: { id: profile.id } }).then(r => {
  account = { id: r.id, secret: r.secret, nick: r.nick }; store.set('kamnelom.account', account); if (r.id !== profile.id) adoptProfileId(r.id); renderProfile(); return account;
 }).finally(() => { accountBusy = null });
}
const loginLink = () => account ? location.origin + location.pathname + '#login=' + account.id + '.' + account.secret : '';
async function loginFromLink(id, secret) {
 const p = await api('/api/login', { method: 'POST', body: { id, secret } });
 if (account && account.id !== id && !confirm('Sign in as “' + p.nick + '”? The profile on this device will be replaced.')) return;
 account = { id: p.id, secret, nick: p.nick }; store.set('kamnelom.account', account); adoptProfileId(p.id); repState = { seq: 0, pending: {}, inflight: null }; store.set('kamnelom.reps', repState); myStats = p.stats; renderProfile(); loadBoard();
}
async function refreshMe() { if (!account) return; try { const p = await api('/api/me', { auth: true }); account.nick = p.nick; store.set('kamnelom.account', account); myStats = p.stats; renderProfile(); renderMyGroups(p.groups) } catch (e) { if (e.status === 401) { account = null; store.set('kamnelom.account', null); myStats = null; renderProfile() } } }
function renderProfile() {
 const nick = $('nick'); if (nick && account && document.activeElement !== nick) nick.value = account.nick;
 const c = $('meGnome'); if (c && window.stageReady && stageReady() && window.Scene3D) { try { c.width = c.height = 160; const x = c.getContext('2d'); x.clearRect(0, 0, 160, 160); x.drawImage(Scene3D.portrait(profile.id, 160), 0, 0) } catch { } } else if (c) { const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.save(); x.translate(c.width / 2, c.height - 6); x.scale(.62, .62); drawGnome(x, myLook, { tool: 'none' }); x.restore() }
 const s = $('meStats'); if (s) s.textContent = !account ? 'Your profile is created on the first connection to the server.' : myStats ? Object.entries(EX_NAME).map(([k, n]) => `${EX_ICON[k]} ${n}: ${myStats[k].reps} reps, ${myStats[k].points} pts, boulder #${myStats[k].rocks + 1} (${myStats[k].hp}/20)`).join('\n') : 'ID: ' + account.id;
 const l = $('loginLink'); if (l) { l.value = loginLink(); const q = $('loginQr'); if (account && q && l.value) drawQrTo(q, l.value).catch(() => { }) }
}

// ---- reps: queued locally, sent in batches with a sequence number so a retry is never counted twice ----
function socialRep(exercise) {
 repState.pending[exercise] = (repState.pending[exercise] || 0) + 1; store.set('kamnelom.reps', repState); clearTimeout(flushTimer); flushTimer = setTimeout(flush, 3000);
}
async function flush(opts = {}) {
 if (flushing) return; flushing = true;
 try {
  await ensureAccount();
  for (; ;) {
   if (!repState.inflight) {
    const ex = Object.keys(repState.pending).find(k => repState.pending[k] > 0); if (!ex) break;
    const n = Math.min(repState.pending[ex], 200); repState.pending[ex] -= n; repState.inflight = { seq: ++repState.seq, exercise: ex, n, groupId: activeGroup || undefined }; store.set('kamnelom.reps', repState);
   }
   const b = repState.inflight; const r = await api('/api/reps', { method: 'POST', auth: true, body: b, keepalive: !!opts.keepalive });
   repState.inflight = null; store.set('kamnelom.reps', repState); backoff = 0; if (myStats) myStats[b.exercise] = { reps: r.reps, rocks: r.rocks, hp: r.hp };
  }
  renderProfile();
 } catch (e) {
  if (e.status === 401) { account = null; store.set('kamnelom.account', null) }
  else if (e.status && e.status < 500 && e.status !== 429 && repState.inflight) { repState.inflight = null; store.set('kamnelom.reps', repState) } // the server will never accept this batch
  backoff = Math.min(60000, (backoff || 2500) * 2); clearTimeout(flushTimer); flushTimer = setTimeout(flush, backoff);
 } finally { flushing = false }
}

// ---- leaderboard ----
function miniGnome(id, w = 34, h = 44) { if (window.stageReady && stageReady() && window.Scene3D) { try { const c = document.createElement('canvas'); c.width = 96; c.height = 96; c.getContext('2d').drawImage(Scene3D.portrait(id, 96), 0, 0); return c } catch { } } const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.save(); x.translate(w / 2, h - 4); x.scale(.34, .34); drawGnome(x, gnomeLook(id), { tool: 'none' }); x.restore(); return c }
async function loadBoard(tab = boardTab) {
 boardTab = tab; for (const b of document.querySelectorAll?.('[data-board]') || []) b.setAttribute('aria-selected', String(b.dataset.board === tab));
 const list = $('boardList'), status = $('boardStatus'); if (!list) return;
 try {
  const r = await api('/api/leaderboard?exercise=' + tab + '&limit=50'); status.textContent = r.rows.length ? '' : 'Nobody yet. Do the first rep!';
  list.innerHTML = r.rows.map(x => {
   const stage = r.exercise === 'total' ? Object.entries(EX_NAME).map(([k]) => `<span title="${EX_NAME[k]}: boulder #${x.by[k].rocks + 1}">${EX_ICON[k]} ${x.by[k].reps}</span>`).join('') + `<span>boulder #${x.rocks + 1}</span>` : `<span>${x.reps} reps</span><span>boulder #${x.rocks + 1}, ${x.hp}/20</span>`;
   return `<li class="${account && account.id === x.id ? 'me' : ''}"><b class="rank">${x.rank}</b><span class="face" data-id="${esc(x.id)}"></span><span class="who">${esc(x.nick)}</span><span class="prog">${stage}</span><strong class="reps" title="points">${x.points}</strong></li>`;
  }).join('');
  for (const f of list.querySelectorAll?.('.face') || []) f.appendChild(miniGnome(f.dataset.id));
 } catch { status.textContent = 'Ranks unavailable: no connection to the server.' }
}

// ---- groups ----
let group = null, groupStream = null, scene = { t0: 0, last: 0, hit: {}, counts: {}, raf: 0 };
const groupLink = id => location.origin + location.pathname + '#group=' + id;
function renderMyGroups(groups) { const e = $('myGroups'); if (!e) return; e.innerHTML = (groups || []).map(g => `<li><button data-group="${esc(g.id)}">${esc(g.name)} · goal ${g.goal}</button></li>`).join('') || '<li class="control-note">You are not in a crew yet.</li>'; for (const b of e.querySelectorAll?.('[data-group]') || []) b.onclick = () => openGroup(b.dataset.group) }
async function createGroup() {
 try { await ensureAccount(); const g = await api('/api/groups', { method: 'POST', auth: true, body: { name: $('groupName').value, goal: Number($('groupGoal').value) } }); showGroup(g); refreshMe() } catch (e) { $('groupStatus').textContent = e.offline ? 'No connection to the server.' : e.message }
}
async function openGroup(id) {
 $('groupStatus').textContent = 'Opening the crew…';
 try { const g = await api('/api/groups/' + encodeURIComponent(id)); showGroup(g); $('groupStatus').textContent = '' } catch (e) { $('groupStatus').textContent = e.status === 404 ? 'Crew not found: the link is out of date.' : 'No connection to the server.' }
}
function showGroup(g) {
 goView('party'); closeStream(); group = g; $('groupPanel').hidden = false; $('groupTitle').textContent = g.name; $('groupInvite').value = groupLink(g.id); drawQrTo($('groupQr'), groupLink(g.id)).catch(() => { });
 scene.t0 = performance.now() / 1000; scene.hit = {}; scene.counts = {}; renderGroup(); updateActive();
 try { groupStream = new EventSource(API_BASE + '/api/groups/' + encodeURIComponent(g.id) + '/stream'); groupStream.onmessage = e => { try { group = JSON.parse(e.data); renderGroup() } catch { } } } catch { }
 cancelAnimationFrame(scene.raf); if (!(window.stageGroupOpen && stageGroupOpen(g))) scene.raf = requestAnimationFrame(sceneTick);
}
function closeStream() { if (groupStream) { groupStream.close(); groupStream = null } }
function closeGroup() { closeStream(); cancelAnimationFrame(scene.raf); group = null; $('groupPanel').hidden = true; if (window.stageGroupClose) stageGroupClose() }
function isMember() { return !!(group && account && group.members.some(m => m.id === account.id)) }
function updateActive() { const b = $('groupActive'), j = $('groupJoin'); if (!group) return; j.hidden = isMember(); b.hidden = !isMember(); b.textContent = activeGroup === group.id ? '✓ Reps go to this crew (turn off)' : 'Train for this crew' }
function renderGroup() {
 if (!group) return; const pct = Math.min(100, Math.round(group.total / group.goal * 100)), max = Math.max(1, ...group.members.map(m => m.total));
 $('groupProgress').textContent = group.done ? `Boulder smashed! ${group.total} pts` : `${group.total} of ${group.goal} pts · ${pct}%`; $('groupBar').style.width = pct + '%';
 $('groupMembers').innerHTML = group.members.map(m => `<li><span class="who">${esc(m.nick)}</span><span class="bar"><i style="width:${Math.round(m.total / max * 100)}%"></i></span><span class="parts">${Object.keys(EX_NAME).filter(k => m.counts[k]).map(k => EX_ICON[k] + ' ' + m.counts[k]).join(' ')}</span><strong title="points">${m.total}</strong></li>`).join('');
 const hits = [];
 for (const m of group.members) { const prev = scene.counts[m.id] ?? m.total, ex = Object.keys(m.counts).reduce((a, k) => m.counts[k] > (m.counts[a] || 0) ? k : a, 'swing'); if (m.total > prev) { scene.hit[m.id] = { at: performance.now() / 1000, ex }; hits.push({ id: m.id, ex }) } scene.counts[m.id] = m.total }
 if (window.stageGroupUpdate) stageGroupUpdate(group, hits);
 updateActive();
}
async function joinGroup() { try { await ensureAccount(); showGroup(await api('/api/groups/' + encodeURIComponent(group.id) + '/join', { method: 'POST', auth: true })); refreshMe() } catch (e) { $('groupStatus').textContent = e.offline ? 'No connection to the server.' : e.message } }
function toggleActive() { activeGroup = activeGroup === group.id ? null : group.id; store.set('kamnelom.group', activeGroup); updateActive(); if (activeGroup) say('Reps now go to the crew “' + group.name + '”. Open Play, start the camera and train.') }

// Group scene: the camera pulls back from the tower to show every gnome and their share of the work.
function sceneTick() {
 const c = $('groupWorld'); if (!group || !c) return; const g = c.getContext('2d'), now = performance.now() / 1000, W = 640, H = 360;
 const grow = Math.min(1, (now - scene.t0) / 1.8), zoom = 1 + .55 * (1 - grow * grow * (3 - 2 * grow));
 g.save(); g.fillStyle = '#282633'; g.fillRect(0, 0, W, H); g.fillStyle = '#36323f'; g.beginPath(); [[0, 190], [90, 110], [170, 160], [260, 70], [350, 150], [440, 90], [540, 150], [640, 100], [640, 300], [0, 300]].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.fill();
 g.translate(320, 300); g.scale(zoom, zoom); g.translate(-320, -300);
 g.fillStyle = '#554447'; g.fillRect(-200, 300, 1040, 220); g.fillStyle = '#8a6550'; g.fillRect(-200, 300, 1040, 5);
 const levels = 11, bw = 28, bh = 19, per = 5, built = Math.min(1, group.total / group.goal) * levels;
 for (let l = 0; l < Math.ceil(built); l++) { const frac = Math.min(1, built - l), n = Math.ceil(per * frac); for (let b = 0; b < n; b++) { const shade = ['#7d7683', '#6a6470', '#908895', '#5f5966'][(l + b) % 4]; g.fillStyle = shade; g.fillRect(320 - per * bw / 2 + b * bw + (l % 2 ? 4 : 0), 300 - (l + 1) * bh, bw - 2, bh - 2); g.fillStyle = '#ffffff22'; g.fillRect(320 - per * bw / 2 + b * bw + (l % 2 ? 4 : 0), 300 - (l + 1) * bh, bw - 2, 2) } }
 if (group.done) { g.fillStyle = '#e8b95f'; g.fillRect(318, 300 - levels * bh - 26, 3, 26); g.fillStyle = '#d37f47'; g.fillRect(321, 300 - levels * bh - 26, 18, 10) }
 const ms = group.members, side = i => i % 2 ? 1 : -1, cols = Math.max(1, Math.ceil(ms.length / 4)), step = cols > 1 ? Math.min(60, 150 / (cols - 1)) : 0;
 ms.forEach((m, i) => {
  const slot = Math.floor(i / 2), col = Math.floor(slot / 2), row = slot % 2, x = 320 + side(i) * (140 + col * step), y = 300 - row * 20, sc = .62 - row * .06, h = scene.hit[m.id], phase = h ? now - h.at : -1;
  const ex = h ? h.ex : Object.keys(m.counts).reduce((a, k) => m.counts[k] > (m.counts[a] || 0) ? k : a, 'swing');
  g.save(); g.translate(x, y); g.scale(sc * -side(i), sc); drawGnome(g, gnomeLook(m.id), gnomePose(ex, phase)); g.restore();
  g.fillStyle = '#f6eddd'; g.font = '9px ui-monospace,monospace'; g.textAlign = 'center'; g.fillText(String(m.nick).slice(0, 12), x, y + 12); g.fillStyle = '#f7b36d'; g.fillText(String(m.total), x, y - 100 * sc - 4);
 });
 g.restore(); scene.raf = requestAnimationFrame(sceneTick);
}

// ---- wiring ----
$('nickSave').onclick = async () => { try { await ensureAccount(); const p = await api('/api/me', { method: 'PATCH', auth: true, body: { nick: $('nick').value } }); account.nick = p.nick; store.set('kamnelom.account', account); $('nickStatus').textContent = 'Saved.'; loadBoard() } catch (e) { $('nickStatus').textContent = e.offline ? 'No connection to the server.' : e.message } };
$('loginCopy').onclick = async () => { try { await navigator.clipboard.writeText(loginLink()); $('nickStatus').textContent = 'Link copied. Don\'t show it to anyone.' } catch { $('loginLink').select?.() } };
for (const b of document.querySelectorAll?.('[data-board]') || []) b.onclick = () => loadBoard(b.dataset.board);
$('groupCreate').onclick = createGroup; $('groupJoin').onclick = joinGroup; $('groupActive').onclick = toggleActive; $('groupClose').onclick = closeGroup;
$('groupCopy').onclick = async () => { try { await navigator.clipboard.writeText($('groupInvite').value); $('groupStatus').textContent = 'Invite link copied.' } catch { $('groupInvite').select?.() } };
window.addEventListener('pagehide', () => { if (repState.pending && Object.values(repState.pending).some(n => n > 0) || repState.inflight) flush({ keepalive: true }) });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadBoard(); refreshMe() } });
renderProfile();
async function handleHash() {
 const h = location.hash, login = /^#login=(p-[a-z0-9]{8})\.([A-Za-z0-9_-]{20,64})$/.exec(h), grp = /^#group=(g-[a-z0-9]{8})$/.exec(h);
 if (!login && !grp) return; history.replaceState(null, '', location.pathname + location.search);
 if (login) { goView('me'); try { await loginFromLink(login[1], login[2]) } catch { } } else await ensureAccount().catch(() => { });
 if (grp) { goView('party'); openGroup(grp[1]) }
}
window.addEventListener('hashchange', handleHash);
(async function start() {
 const pending = /^#(login|group)=/.test(location.hash); if (pending) await handleHash(); else await ensureAccount().catch(() => { });
 refreshMe(); loadBoard(); setInterval(() => { if (!document.hidden) loadBoard() }, 30000); if (repState.inflight || Object.values(repState.pending).some(n => n > 0)) flush();
})();
