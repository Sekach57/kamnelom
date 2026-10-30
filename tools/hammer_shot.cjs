'use strict';
// Test harness: the real game renderer (palette, post-processing, lights) with a swapped hammer.glb / dwarf.glb, nothing in dist/ is touched.
//   node tools/hammer_shot.cjs OUT_DIR DWARF.glb NAME=HAMMER.glb [NAME=HAMMER.glb ...]
// Files are swapped on the fly with page.route('**/assets/hammer.glb') and ('**/assets/dwarf.glb'). For every hammer, every pose and every
// scale it writes OUT_DIR/<name>_<pose>_<scale>.png (canvas screenshot), the same with the hammer hidden (..._nohammer.png) and meta.json
// (pixel size k, gnome position on screen, projected hammer-head box in game pixels). Poses: a clip action frozen at one frame, then rendered by
// the game's own Scene3D.render (Gnome.placeHammer copies the Hammer bone). Scales: 'native' = game solo (pixelH 270, k = 3, the gnome is
// about 70 px tall, same as Crew), 'close' = pixelH 720 (k = 1, the gnome is about 210 px tall).
const { spawn } = require('node:child_process'), fs = require('node:fs'), path = require('node:path'), { chromium } = require(path.resolve('node_modules/playwright'));
const [outArg, dwarfArg, ...vars] = process.argv.slice(2);
if (!outArg || !dwarfArg || !vars.length) { console.error('usage: node tools/hammer_shot.cjs OUT_DIR DWARF.glb NAME=HAMMER.glb ...'); process.exit(2); }
const out = path.resolve(outArg), port = 4197;
const POSES = [['ready0', 'swing_ready', 0], ['hit6', 'swing_hit', 6], ['hit12', 'swing_hit', 12]];
const SCALES = [['native', { pixelH: 270 }], ['close', { pixelH: 720, minK: 1 }]];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = spawn(process.execPath, [path.resolve('tools/serve.cjs'), 'dist', String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const problems = [], meta = {}; let code = 0;
  try {
    for (const v of vars) {
      const [name, file] = v.split('='); const hbuf = fs.readFileSync(path.resolve(file)), dbuf = fs.readFileSync(path.resolve(dwarfArg));
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', e => problems.push(name + ' pageerror: ' + e.message));
      await page.route('**/assets/hammer.glb', r => r.fulfill({ body: hbuf, contentType: 'model/gltf-binary' }));
      await page.route('**/assets/dwarf.glb', r => r.fulfill({ body: dbuf, contentType: 'model/gltf-binary' }));
      await page.goto(`http://127.0.0.1:${port}/#/play`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.Scene3D, null, { timeout: 30000 });
      await page.evaluate(() => window.Scene3D.ready);
      await page.evaluate(() => { for (const c of document.querySelectorAll('canvas')) c.style.visibility = 'hidden'; document.body.style.background = '#000' });
      for (const [sname, sopt] of SCALES) {
        await page.evaluate(({ sopt }) => {
          document.getElementById('hs_c')?.remove();
          const c = document.createElement('canvas'); c.id = 'hs_c'; c.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;visibility:visible';
          document.body.appendChild(c);
          const s = window.Scene3D.create(c, { mode: 'solo', ...sopt }); window.__s = s; s.setGnomes(['tester7']); s.render(0.016);
        }, { sopt });
        for (const [pname, clip, frame] of POSES) {
          const info = await page.evaluate(({ clip, frame }) => {
            const s = window.__s, g = s.gnomes.get('tester7'); g.mixer.stopAllAction();
            const a = g.act(clip); a.reset(); a.setLoop(s.THREE.LoopRepeat, Infinity); a.play(); a.paused = true; a.time = frame / 24; a.setEffectiveWeight(1); g.mixer.update(0);
            g.hmode = 'bone'; g.hshow = null; g.hammer.visible = true; s.render(0.001); s.render(0.001);
            const T = s.THREE, k = Math.max(s.opts.minK ?? 2, Math.round(720 / s.opts.pixelH)), p = s.project('tester7');
            let lo = [1e9, 1e9], hi = [-1e9, -1e9], n = 0; const v = new T.Vector3();
            g.hs.traverse(m => { if (!m.isMesh) return; const mn = (m.material.name || '');
              if (!/steel/.test(mn)) return; const pos = m.geometry.attributes.position; m.updateWorldMatrix(true, false);
              for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(s.camera); const x = (v.x + 1) / 2 * 1280 / k, y = (1 - v.y) / 2 * 720 / k; lo = [Math.min(lo[0], x), Math.min(lo[1], y)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y)]; n++ } });
            return { k, proj: p, headBoxGamePx: n ? { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1], w: hi[0] - lo[0], h: hi[1] - lo[1] } : null, mats: (() => { const a = []; g.hs.traverse(m => { if (m.isMesh) a.push(m.material.name) }); return a })() };
          }, { clip, frame });
          await page.waitForTimeout(300);
          const base = `${name}_${pname}_${sname}`;
          await page.screenshot({ path: path.join(out, base + '.png') });
          await page.evaluate(() => { window.__s.gnomes.get('tester7').hammer.visible = false; window.__s.render(0.001) });
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(out, base + '_nohammer.png') });
          meta[base] = info;
        }
      }
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 1));
    console.log('OK', Object.keys(meta).length, 'frames', problems.length ? problems : '');
  } catch (e) { console.error('failed', e.message); code = 1 } finally { await browser.close(); server.kill() }
  process.exit(code || (problems.length ? 1 : 0));
})();
