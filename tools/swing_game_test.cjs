'use strict';
// In-game continuity tests with a swapped dwarf.glb (page.route; dist/assets is not touched). The game code is the working tree's dist/scene3d.js.
//   node tools/swing_game_test.cjs DWARF.glb
// (a) strike -> clip finished -> swing_ready (b) second blow 0.7 s after the first (c) swing -> squat -> swing chain (pickup, swing_raise, walk).
// Reports the largest per-frame step (cm in model units) of Head / RightHand / LeftHand / Spine02 / LeftFoot and of the hammer head, plus the step
// right across every join (clip change or hammer mode switch).
const { spawn } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), { chromium } = require(path.resolve('node_modules/playwright'));
const dwarf = process.argv[2], port = 4196;
(async () => {
  const server = spawn(process.execPath, [path.resolve('tools/serve.cjs'), 'dist', String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } }), errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()) });
    await page.route('**/assets/dwarf.glb', r => r.fulfill({ body: fs.readFileSync(path.resolve(dwarf)), contentType: 'model/gltf-binary' }));
    await page.goto(`http://127.0.0.1:${port}/#/play`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Scene3D, null, { timeout: 30000 });
    await page.evaluate(() => window.Scene3D.ready);
    const res = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px'; document.body.appendChild(c);
      const s = window.Scene3D.create(c, { mode: 'solo', pixelH: 270 }); s.setGnomes(['tester7']); s.render(0.016);
      const g = s.gnomes.get('tester7'), T = s.THREE, names = ['Head', 'RightHand', 'LeftHand', 'Spine02', 'LeftFoot'], S = 1.6 * 1.0;
      const cm = v => v * 100 / S, dt = 1 / 60, v3 = new T.Vector3();
      const snap = () => { g.root.updateMatrixWorld(true); const o = {}; for (const n of names) o[n] = g.b[n].getWorldPosition(new T.Vector3()); o.hammerHead = g.hs.localToWorld(new T.Vector3(-.25, 0, 0)); o.hammerButt = g.hs.localToWorld(new T.Vector3(.36, 0, 0)); return o };
      const label = () => (g.step ? g.step.name : g.strikeAct ? 'strike:' + g.strikeAct.getClip().name : g.cur ? g.cur.getClip().name : '?') + '/' + g.hmode;
      const run = (frames, hook) => { const rows = []; let prev = snap(), pl = label(); for (let i = 0; i < frames; i++) { if (hook) hook(i); s.render(dt); probe(); const p = snap(), l = label(), step = {}; let mx = 0; for (const k in p) { step[k] = cm(p[k].distanceTo(prev[k])); if (k !== 'hammerButt') mx = Math.max(mx, step[k]) } rows.push({ i, l, mx, hammer: step.hammerHead, join: l !== pl }); prev = p; pl = l } return rows };
      const summary = rows => { const idle = rows.filter(r => !r.join).map(r => r.mx).sort((a, b) => a - b), med = idle[Math.floor(idle.length / 2)] || 0; const joins = rows.filter(r => r.join).map(r => ({ at: r.i, into: r.l, maxBoneStepCm: +r.mx.toFixed(2), hammerHeadStepCm: +r.hammer.toFixed(2) })); return { medianStepCm: +med.toFixed(3), maxStepCm: +Math.max(...rows.map(r => r.mx)).toFixed(2), joins } };
      const probes = [];
      const modeGap = tag => { // hammer centre / orientation placeHammer() gets from the 'hand' formula vs from the Hammer bone, same pose
        const save = { m: g.hmode, h: g.hshow && { p: g.hshow.p.clone(), q: g.hshow.q.clone() } }, res = {};
        for (const m of ['hand', 'bone']) { g.hmode = m; g.hshow = null; g.placeHammer(1); res[m] = { p: g.hammer.position.clone(), q: g.hammer.quaternion.clone(), head: g.hs.localToWorld(new T.Vector3(-.25, 0, 0)) } }
        g.hmode = save.m; g.hshow = save.h; g.placeHammer(1);
        return { tag, centreGapCm: +cm(res.hand.p.distanceTo(res.bone.p)).toFixed(2), headGapCm: +cm(res.hand.head.distanceTo(res.bone.head)).toFixed(2), angleDeg: +(res.hand.q.angleTo(res.bone.q) * 180 / Math.PI).toFixed(1) } };
      let probedFwd = false, probedRev = false;
      const probe = () => { if (!g.step || g.step.name !== 'swing_raise') return; const fwd = g.step.from === 0; if (fwd && !probedFwd && g.step.e > .03) { probedFwd = true; probes.push(modeGap('raise start (pickup -> raise), step.e=' + g.step.e.toFixed(2))) } if (!fwd && !probedRev && g.step.e >= g.step.dur - .03) { probedRev = true; probes.push(modeGap('raise end (reverse, then hand mode)')) } };
      const out = {};
      // (a) one blow, wait for the clip to finish and return to swing_ready
      let rows = run(60); const a = run(240, i => { if (i === 0) s.hit('tester7', 'swing', 1) });
      const fin = a.filter(r => r.join); out.a = { ...summary(a), joinsDetail: fin.map(r => r.l + '@' + r.i), endLabel: label() };
      // (b) blow, second blow 0.7 s later
      run(120); const b = run(260, i => { if (i === 0 || i === 42) s.hit('tester7', 'swing', 1) }); out.b = summary(b);
      // (c) swing -> squat -> swing
      run(60); s.setExercise('tester7', 'squat'); const c1 = run(900, () => { }); out.c_swing_to_squat = { ...summary(c1), stance: g.stance };
      s.setExercise('tester7', 'swing'); const c2 = run(900, () => { }); out.c_squat_to_swing = { ...summary(c2), stance: g.stance };
      out.hammerModeGaps = probes; return out;
    });
    console.log(JSON.stringify({ res, errs }, null, 1));
  } finally { await browser.close(); server.kill() }
})();
