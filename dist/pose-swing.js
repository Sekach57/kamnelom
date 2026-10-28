'use strict';
// Swing counter on top of pose landmarks (MediaPipe layout: 11/12 shoulders, 13/14 elbows,
// 15/16 wrists, 23/24 hips). Pure logic: no DOM, camera or model, so it runs in Node tests.
// Signal: wrist height above the hip line in torso lengths. A swing is top -> bottom -> top.
// This counts movement cycles of the hands; it does not detect a kettlebell or judge technique.
const POSE_POINTS = { lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24 };
const POSE_DEFAULTS = {
 minVisibility: .5, margin: .02, minTorso: .08, // visibility/presence cut-off, frame margin, torso as a share of frame height
 tau: 70, scaleTau: 1500, // ms: signal smoothing and torso-size smoothing (slow, so hinge foreshortening averages out)
 needed: 3, zigzag: .22, minAmplitude: .35, // trial swings; extremes closer than zigzag are jitter; minimum amplitude in torso lengths
 minCycle: 450, maxCycle: 6000, lossReset: 800, // ms
 enter: .65, exit: .35, // hysteresis, as a fraction of the calibrated amplitude above the bottom
 moveScale: .35, moveShift: .25, moveHold: 600 // camera-moved limits: relative torso size change, hip shift in frame heights, ms
};
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 };

class PoseSwingDetector {
 constructor(handlers = {}, options = {}) {
  this.h = handlers; this.o = { ...POSE_DEFAULTS, ...options };
  this.mode = 'idle'; this.params = null; this.baseHip = null; this.baseScale = null; this.cycles = []; this.reset();
 }
 // Forget the current signal and any unfinished cycle; calibration stays.
 reset() {
  this.s = null; this.t = null; this.lastValid = null; this.d = 0; this.scale = null; this.fast = null; this.hip = null; this.slowHip = null;
  this.phase = null; this.leftTop = null; this.moved = false; this.movedSince = null; this.status = 'no_person';
  this.zz = { dir: 0, init: false, hi: 0, lo: 0, hiT: 0, loT: 0, ext: 0, extT: 0 }; this.extremes = [];
 }
 startCalibration() { this.params = null; this.cycles = []; this.mode = 'calibrating'; this.reset(); this.baseHip = null; this.baseScale = null }
 startPlay() { if (!this.params) throw new Error('not calibrated'); this.mode = 'playing'; this.reset() }
 stop() { this.mode = 'idle'; this.reset() }
 point(p) {
  const o = this.o; if (!p) return 'weak';
  if ((p.visibility ?? 1) < o.minVisibility || (p.presence ?? 1) < o.minVisibility) return 'weak';
  return p.x < -o.margin || p.x > 1 + o.margin || p.y < -o.margin || p.y > 1 + o.margin ? 'outside' : 'ok';
 }
 // landmarks: array of normalized points or null; t: ms (monotonic); aspect: frame width / height.
 update(lm, t, aspect = 4 / 3) {
  const r = this.measure(lm, t, aspect); this.status = r.status;
  if (r.status !== 'ok') { this.invalid(t); return r }
  if (this.lastValid !== null && t - this.lastValid > this.o.lossReset) { this.clearCycle(); this.s = null } // long gap: never bridge it
  const dt = this.t === null ? 0 : Math.min(t - this.t, 200), a = this.s === null ? 1 : 1 - Math.exp(-dt / this.o.tau);
  this.s = this.s === null ? r.raw : this.s + (r.raw - this.s) * a; this.t = t; this.lastValid = t; r.height = this.s;
  if (this.mode === 'calibrating') this.calibrate(this.s, t); else if (this.mode === 'playing' && !this.moved) this.play(this.s, t);
  return r;
 }
 measure(lm, t, aspect) {
  const o = this.o, out = { status: 'ok', height: null, raw: null, hands: 0, points: null };
  if (!lm || lm.length < 25) { out.status = 'no_person'; return out }
  const P = k => lm[POSE_POINTS[k]], c = {}; for (const k in POSE_POINTS) c[k] = this.point(P(k)); out.points = c;
  const body = ['lShoulder', 'rShoulder', 'lHip', 'rHip'];
  if (body.some(k => c[k] === 'outside')) { out.status = 'out_of_frame'; return out }
  if (body.some(k => c[k] !== 'ok')) { out.status = 'body_weak'; return out }
  const sx = (P('lShoulder').x + P('rShoulder').x) / 2, sy = (P('lShoulder').y + P('rShoulder').y) / 2, hx = (P('lHip').x + P('rHip').x) / 2, hy = (P('lHip').y + P('rHip').y) / 2;
  const torso = Math.hypot((sx - hx) * aspect, sy - hy);
  if (torso < o.minTorso) { out.status = 'too_far'; return out }
  const dt = this.t === null ? 0 : Math.min(t - this.t, 200), k = this.scale === null ? 1 : 1 - Math.exp(-dt / o.scaleTau);
  const ok = ['lWrist', 'rWrist'].filter(n => c[n] === 'ok');
  if (!ok.length) { out.status = ['lWrist', 'rWrist'].some(n => c[n] === 'outside') ? 'hands_outside' : 'hands_lost'; return out }
  // The torso size and hip reference only advance on frames where the hands are also usable.
  this.scale = this.scale === null ? torso : this.scale + (torso - this.scale) * k;
  const hip = { x: hx * aspect, y: hy }, hk = this.hip === null ? 1 : 1 - Math.exp(-dt / 400);
  this.hip = this.hip === null ? hip : { x: this.hip.x + (hip.x - this.hip.x) * hk, y: this.hip.y + (hip.y - this.hip.y) * hk };
  const height = n => (hy - P(n).y) / this.scale;
  if (ok.length === 2) { const l = height('lWrist'), r = height('rWrist'); this.d += ((r - l) / 2 - this.d) * .2; out.raw = (l + r) / 2 }
  else out.raw = ok[0] === 'lWrist' ? height('lWrist') + this.d : height('rWrist') - this.d; // one hand hidden: keep the known left/right offset, never average with a lost point
  this.fast = this.fast == null ? torso : this.fast + (torso - this.fast) * (dt ? 1 - Math.exp(-dt / 300) : 1);
  out.hands = ok.length; this.checkMoved(t); if (this.moved) out.status = 'camera_moved';
  return out;
 }
 // Frames without a usable body/hands are never interpreted as a swing.
 invalid(t) { if (this.lastValid !== null && t - this.lastValid > this.o.lossReset) { this.clearCycle(); this.s = null; this.t = null; this.movedSince = null } }
 clearCycle() { this.phase = null; this.leftTop = null; this.zz = { dir: 0, init: false, hi: 0, lo: 0, hiT: 0, loT: 0, ext: 0, extT: 0 }; this.extremes = [] }
 checkMoved(t) {
  const o = this.o; if (this.baseScale === null || !this.baseHip) { this.moved = false; return }
  const off = Math.abs(this.fast / this.baseScale - 1) > o.moveScale || Math.hypot(this.hip.x - this.baseHip.x, this.hip.y - this.baseHip.y) > o.moveShift;
  if (!off) { this.moved = false; this.movedSince = null; return }
  this.movedSince ??= t; if (t - this.movedSince >= o.moveHold && !this.moved) { this.moved = true; this.clearCycle() }
 }
 // --- calibration: three full trial swings, found with a jitter-tolerant zigzag ---
 calibrate(s, t) {
  const z = this.zz, Z = this.o.zigzag;
  if (!z.init) { z.init = true; z.hi = z.lo = s; z.hiT = z.loT = t; return }
  if (z.dir === 0) {
   if (s > z.hi) { z.hi = s; z.hiT = t } if (s < z.lo) { z.lo = s; z.loT = t }
   if (s - z.lo >= Z) { this.push('valley', z.lo, z.loT); z.dir = 1; z.ext = s; z.extT = t } else if (z.hi - s >= Z) { this.push('peak', z.hi, z.hiT); z.dir = -1; z.ext = s; z.extT = t }
  } else if (z.dir === 1) {
   if (s >= z.ext) { z.ext = s; z.extT = t; this.rising(s, t) } else if (z.ext - s >= Z) { this.push('peak', z.ext, z.extT); z.dir = -1; z.ext = s; z.extT = t }
  } else {
   if (s <= z.ext) { z.ext = s; z.extT = t } else if (s - z.ext >= Z) { this.push('valley', z.ext, z.extT); z.dir = 1; z.ext = s; z.extT = t }
  }
 }
 push(type, v, t) {
  const e = this.extremes, last = e[e.length - 1];
  if (last && last.type === type) { if (type === 'peak' ? v > last.v : v < last.v) { last.v = v; last.t = t } return } // already closed early: refine the peak
  e.push({ type, v, t }); if (e.length > 3) e.shift();
  if (e.length === 3 && e[0].type === 'peak' && e[1].type === 'valley' && e[2].type === 'peak') this.close(e[0], e[1], e[2].v, e[2].t);
 }
 // The cycle is closed as soon as the hands are back near the top, so progress shows without waiting for the next swing down.
 rising(s, t) {
  const e = this.extremes; if (e.length < 2) return;
  const a = e[e.length - 2], b = e[e.length - 1];
  if (a.type === 'peak' && b.type === 'valley' && s >= b.v + .8 * (a.v - b.v)) this.close(a, b, s, t);
 }
 close(a, b, cv, ct) {
  const o = this.o, top = (a.v + cv) / 2, amp = top - b.v, ms = ct - a.t;
  this.extremes = [{ type: 'peak', v: cv, t: ct }]; // the return is the start of the next cycle
  if (amp < o.minAmplitude) return this.reject('small', { amp });
  if (ms < o.minCycle) return this.reject('fast', { ms });
  if (ms > o.maxCycle) return this.reject('slow', { ms });
  this.cycles.push({ top, bottom: b.v, amp, ms });
  const done = this.cycles.length; this.h.onCalibration?.(done, o.needed, this.cycles[done - 1]);
  if (done >= o.needed) this.finish();
 }
 reject(reason, info) { this.h.onReject?.(reason, info) }
 finish() {
  const c = this.cycles, top = median(c.map(x => x.top)), bottom = median(c.map(x => x.bottom)), amp = top - bottom;
  this.params = { top, bottom, amp, hi: bottom + amp * this.o.enter, lo: bottom + amp * this.o.exit, cycleMs: median(c.map(x => x.ms)) };
  this.baseScale = this.scale; this.baseHip = this.hip && { ...this.hip }; this.mode = 'idle'; this.h.onCalibrated?.(this.params);
 }
 // --- playing: top -> bottom -> top with hysteresis; leftTop is when the hands last left the top ---
 play(s, t) {
  const p = this.params, o = this.o;
  if (this.phase === 'bottom' && t - this.leftTop > o.maxCycle) this.phase = null; // stalled mid-cycle: forget it
  if (s >= p.hi) {
   if (this.phase === 'bottom' && t - this.leftTop >= o.minCycle) this.h.onSwing?.(t, { ms: t - this.leftTop });
   this.phase = 'top';
  } else if (s <= p.lo && this.phase === 'top') { this.phase = 'bottom'; this.leftTop = t }
 }
}
if (typeof module !== 'undefined') module.exports = { PoseSwingDetector, POSE_POINTS, POSE_DEFAULTS };
