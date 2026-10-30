'use strict';
// Frames of the swing clips from the real game renderer (palette, post-processing) with a swapped dwarf.glb (dist/ is not touched).
//   node tools/swing_anim_shot.cjs OUT_DIR DWARF.glb
// writes OUT_DIR/hit_00..48.png (swing_hit, every frame), OUT_DIR/trans_00..11.png (pick-up end -> swing_raise -> swing_ready) at pixelH 270 (k = 3).
// Each pose is a clip frozen at one time and rendered by Scene3D.render; hammer mode follows the game (hand for the pick-up, bone otherwise).
const { spawn } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), { chromium } = require(path.resolve('node_modules/playwright'));
const [outArg, dwarf] = process.argv.slice(2), out = path.resolve(outArg), port = 4195;
const TRANS = [['Male_Bend_Over_Pick_Up', 2.2, 'hand'], ['Male_Bend_Over_Pick_Up', 2.5, 'hand'], ['Male_Bend_Over_Pick_Up', 2.9, 'hand'], ...[2, 4, 6, 8, 10, 12, 14, 16].map(f => ['swing_raise', f / 24, 'bone']), ['swing_ready', 12 / 24, 'bone']];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, [path.resolve('tools/serve.cjs'), 'dist', String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errs = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errs.push(e.message));
    await page.route('**/assets/dwarf.glb', r => r.fulfill({ body: fs.readFileSync(path.resolve(dwarf)), contentType: 'model/gltf-binary' }));
    await page.goto(`http://127.0.0.1:${port}/#/play`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.Scene3D, null, { timeout: 30000 });
    await page.evaluate(() => window.Scene3D.ready);
    await page.evaluate(() => { for (const c of document.querySelectorAll('canvas')) c.style.visibility = 'hidden';
      const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;visibility:visible'; document.body.appendChild(c);
      window.__s = window.Scene3D.create(c, { mode: 'solo', pixelH: 270 }); window.__s.setGnomes(['tester7']); window.__s.render(0.016) });
    const pose = (clip, t, mode) => page.evaluate(({ clip, t, mode }) => { const s = window.__s, g = s.gnomes.get('tester7'); g.mixer.stopAllAction();
      const a = g.act(clip); a.reset(); a.setLoop(s.THREE.LoopRepeat, Infinity); a.play(); a.paused = true; a.time = t; a.setEffectiveWeight(1); g.mixer.update(0);
      g.hmode = mode; g.hshow = null; s.render(0.001); s.render(0.001) }, { clip, t, mode });
    for (let f = 0; f <= 48; f++) { await pose('swing_hit', f / 24, 'bone'); await page.waitForTimeout(120); await page.screenshot({ path: path.join(out, `hit_${String(f).padStart(2, '0')}.png`) }) }
    for (let i = 0; i < TRANS.length; i++) { const [c, t, m] = TRANS[i]; await pose(c, t, m); await page.waitForTimeout(120); await page.screenshot({ path: path.join(out, `trans_${String(i).padStart(2, '0')}.png`) }) }
    fs.writeFileSync(path.join(out, 'trans.json'), JSON.stringify(TRANS));
    console.log('OK', errs);
  } finally { await browser.close(); server.kill() }
})();
