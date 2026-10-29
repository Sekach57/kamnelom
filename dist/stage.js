'use strict';
// Bridge between the game logic (app.js, social.js) and the 3D scenes (scene3d.js).
// If WebGL or the models fail to load, the old 2D canvases stay visible (body.no3d); the pose pipeline is untouched.
(function () {
 const $ = id => document.getElementById(id);
 // the page may be embedded without the <body> attributes from index.html
 document.body.dataset.scr = document.body.dataset.scr || 'menu'; document.body.dataset.mode = document.body.dataset.mode || 'local';
 let wantEx = null, M = null, solo = null, grp = null, groupObj = null, last = performance.now(), soloId = null;
 const gid = () => (typeof stageGnomeId === 'function' ? stageGnomeId() : 'me');

 function fallback(why) { console.warn('3D scene unavailable, using 2D:', why); document.body.classList.add('no3d'); $('world').hidden = false; $('groupWorld').hidden = false }
 function ensureSolo() {
  if (solo || !M) return solo;
  try { solo = M.create($('world3d'), { mode: 'solo' }); { const wide = innerWidth > 820; solo.setShift(wide ? .2 : 0, wide ? 0 : -.2) } solo.setGnomes([soloId = gid()]); if (wantEx) solo.setExercise(soloId, wantEx); window.stage3d = true; if (typeof updateRock === 'function') updateRock() } catch (e) { fallback(e); M = null }
  return solo;
 }
 function tags() {
  const box = $('tags'); if (!grp || !groupObj || !box) return;
  const ms = groupObj.members.slice(0, 12);
  if (box.children.length !== ms.length) box.innerHTML = ms.map(m => '<span></span>').join('');
  ms.forEach((m, i) => { const el = box.children[i], p = grp.project(m.id); if (!p || p.behind) { el.hidden = true; return } el.hidden = false; el.textContent = m.nick; el.style.transform = `translate(${p.x.toFixed(0)}px,${p.y.toFixed(0)}px) translate(-50%,-100%)` });
 }
 function frame(t) {
  const dt = Math.min((t - last) / 1000, .1); last = t;
  try { const scr = (mode === 'idle' && !stream && calibration.state === 'idle') ? 'menu' : 'game'; if (document.body.dataset.scr !== scr) { document.body.dataset.scr = scr; if (solo) { const wide = innerWidth > 820; solo.setShift(scr === 'menu' ? (wide ? .2 : 0) : 0, scr === 'menu' ? (wide ? 0 : -.2) : 0) } } } catch { }
  if (!document.hidden) {
   const view = typeof currentView === 'string' ? currentView : 'play';
   if (solo && view === 'play') { const id = gid(); if (id !== soloId) { solo.setGnomes([soloId = id]); if (wantEx) solo.setExercise(soloId, wantEx) } solo.resize(); solo.render(dt) }
   if (grp && view === 'party' && groupObj) { grp.resize(); grp.render(dt); tags() }
  }
  requestAnimationFrame(frame);
 }
 window.addEventListener('resize', () => { solo && solo.resize(); grp && grp.resize() });

 // ---- hooks called from app.js ----
 window.stageStrike = (ex, dmg) => { if (solo) solo.hit(soloId, ex, dmg) };
 window.stageExercise = ex => { wantEx = ex; if (solo) solo.setExercise(soloId, ex) };
 window.stageRock = frac => { if (!solo) return; if (frac <= 0) solo.breakRock(); else solo.setHp(frac) };

 // ---- hooks called from social.js ----
 window.stageGroupOpen = g => {
  if (!M) return false;
  try { if (!grp) grp = M.create($('groupWorld3d'), { mode: 'group' }) } catch (e) { return false }
  groupObj = g; $('gstage').hidden = false; stageGroupUpdate(g, []); grp.resize(); return true;
 };
 window.stageGroupUpdate = (g, hits) => {
  if (!grp) return; groupObj = g;
  const ms = g.members.slice().sort((a, b) => b.total - a.total).slice(0, 12);
  grp.setGnomes(ms.map(m => m.id));
  const frac = g.done ? 0 : 1 - Math.min(1, g.total / g.goal);
  if (frac <= 0) grp.breakRock(); else grp.setHp(Math.max(.05, frac));
  for (const h of hits || []) { const run = () => { if (grp && groupObj) grp.hit(h.id, h.ex, 2) }; if (h.delay) setTimeout(run, h.delay * 1000); else run() }
 };
 window.stageGroupClose = () => { groupObj = null; const g = $('gstage'); if (g) g.hidden = true; if ($('tags')) $('tags').innerHTML = '' };

 const stageOn = () => document.body.classList.contains('no3d') ? null : M;
 window.stageReady = () => !!M;
 $('gear').onclick = () => { $('sheet').hidden = false };
 $('sheetClose').onclick = () => { $('sheet').hidden = true };
 $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true });

 import('./scene3d.js').then(async m => {
  if (!(await m.ready.then(() => true, () => false))) throw new Error('assets');
  M = m; window.dispatchEvent(new Event('stage-ready'));
  ensureSolo(); if (typeof renderProfile === 'function') renderProfile(); if (typeof loadBoard === 'function') loadBoard();
  requestAnimationFrame(t => { last = t; frame(t) });
 }).catch(e => fallback(e));
})();
